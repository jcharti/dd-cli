#!/usr/bin/env node
// src/bin/dd-cli.ts
import { Command } from "commander";

// src/index.ts
import { readFileSync as readFileSync10 } from "fs";
import * as path11 from "path";
import { fileURLToPath } from "url";

// src/types/dev-type.ts
var DEV_TYPES = [
  "greenfield",
  "brownfield-feature",
  "brownfield-refactor",
  "modernizacion",
  "integracion-externa"
];
function isDevType(value) {
  return typeof value === "string" && DEV_TYPES.includes(value);
}
function requiresRepoContext(type) {
  return type !== "greenfield";
}
function requiresBaseline(type) {
  return type === "brownfield-refactor";
}

// src/types/session.ts
import { z } from "zod";
var DevTypeSchema = z.enum(DEV_TYPES);
var DevTypeSourceSchema = z.enum([
  "business-brief",
  "tech-lead-approval",
  "inherited",
  "reclassify"
]);
var FlowStateSchema = z.enum([
  "not_started",
  "started",
  "repo_mapped",
  "baseline_ready",
  "spec_ready",
  "change_active",
  "ended"
]);
var TaskStatus = z.enum(["pending", "in_progress", "done", "blocked"]);
var TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: TaskStatus,
  completed_at: z.string().nullable()
});
var BlockerSchema = z.object({
  task_id: z.string(),
  reason: z.string(),
  reported_at: z.string(),
  resolved_at: z.string().nullable(),
  resolution: z.string().nullable()
});
var AnomalySchema = z.object({
  type: z.enum([
    "stale_session",
    "long_open_session",
    "stuck_in_started",
    "no_spec_after_30min",
    "missing_repo_context",
    "missing_baseline"
  ]),
  detected_at: z.string(),
  acknowledged: z.boolean(),
  details: z.string()
});
var VendorSchema = z.object({
  name: z.string(),
  api_version: z.string(),
  docs_url: z.string().optional(),
  sandbox_url: z.string().optional()
});
var SessionStateSchema = z.object({
  // Identificación
  feature_id: z.string().nullable(),
  feature_name: z.string().nullable(),
  session_id: z.string(),
  // Tiempos
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  last_heartbeat: z.string().nullable(),
  // Modo
  mode: z.enum(["local", "platform"]),
  platform_url: z.string().nullable(),
  unclosed: z.boolean().default(false),
  // dev_type machinery
  dev_type: DevTypeSchema.nullable(),
  dev_type_subtype: z.string().max(40).nullable(),
  dev_type_source: DevTypeSourceSchema,
  dev_type_rationale: z.string().max(300),
  dev_type_locked: z.boolean().default(false),
  dev_type_locked_at: z.string().nullable(),
  dev_type_reclassified_from: DevTypeSchema.nullable().optional(),
  // Contexto del repo
  apps_affected: z.array(z.string()).default([]),
  repo_context_path: z.string().nullable(),
  baseline_path: z.string().nullable(),
  legacy_system: z.string().nullable(),
  vendor: VendorSchema.nullable(),
  // Enforcement
  enforcement_rules: z.array(z.string()).default([]),
  // Estado del flujo
  flow_state: FlowStateSchema,
  active_change: z.string().nullable(),
  // Tasks y blockers
  tasks: z.array(TaskSchema).default([]),
  blockers: z.array(BlockerSchema).default([]),
  // RAG (platform only)
  rag_context_snapshot: z.array(z.string()).nullable(),
  // Diagnóstico
  anomalies: z.array(AnomalySchema).default([]),
  // Metadata
  cli_version: z.string(),
  schema_version: z.literal(2)
});
function createInitialSession(cliVersion) {
  return {
    feature_id: null,
    feature_name: null,
    session_id: "sess-init",
    started_at: null,
    ended_at: null,
    last_heartbeat: null,
    mode: "local",
    platform_url: null,
    unclosed: false,
    dev_type: null,
    dev_type_subtype: null,
    dev_type_source: "business-brief",
    dev_type_rationale: "",
    dev_type_locked: false,
    dev_type_locked_at: null,
    apps_affected: [],
    repo_context_path: null,
    baseline_path: null,
    legacy_system: null,
    vendor: null,
    enforcement_rules: [],
    flow_state: "not_started",
    active_change: null,
    tasks: [],
    blockers: [],
    rag_context_snapshot: null,
    anomalies: [],
    cli_version: cliVersion,
    schema_version: 2
  };
}

// src/flow-state/detect.ts
import { existsSync, readFileSync, statSync } from "fs";
import * as path from "path";
import { globbySync } from "globby";
function detectFlowState({
  projectRoot,
  session
}) {
  if (session.ended_at) return "ended";
  if (!session.started_at) return "not_started";
  const devType = session.dev_type;
  const needsRepoContext = devType !== null && requiresRepoContext(devType);
  const needsBaseline = devType !== null && requiresBaseline(devType);
  const specPath = path.join(projectRoot, ".ai/SPEC.md");
  const hasSpec = existsSync(specPath) && statSync(specPath).size > 100;
  const isLocked = session.dev_type_locked === true;
  if (hasSpec && isLocked) {
    const changes = globbySync("openspec/changes/*/tasks.md", { cwd: projectRoot });
    if (changes.length > 0) return "change_active";
    return "spec_ready";
  }
  if (needsBaseline) {
    const baselineFiles = globbySync(".ai/BASELINE-*.md", { cwd: projectRoot });
    const hasLockedBaseline = baselineFiles.some(
      (f) => hasLockedFrontmatter(path.join(projectRoot, f))
    );
    if (hasLockedBaseline) return "baseline_ready";
    const repoContextPath = path.join(projectRoot, ".ai/REPO-CONTEXT.md");
    if (existsSync(repoContextPath)) return "repo_mapped";
    return "started";
  }
  if (needsRepoContext) {
    const repoContextPath = path.join(projectRoot, ".ai/REPO-CONTEXT.md");
    if (existsSync(repoContextPath)) return "repo_mapped";
    return "started";
  }
  return "started";
}
function hasLockedFrontmatter(filePath) {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;
  const frontmatter = fmMatch[1] ?? "";
  const lockedAtMatch = frontmatter.match(/^locked_at:\s*(.+)$/m);
  if (!lockedAtMatch) return false;
  const value = (lockedAtMatch[1] ?? "").trim();
  return value !== "null" && value !== "" && value !== "~";
}
function suggestedNextStep(flowState, devType) {
  if (flowState === "not_started") {
    return "Ejecuta `dd-cli start-session <feature-id>` para iniciar una sesi\xF3n";
  }
  if (flowState === "started") {
    if (!devType || devType === "greenfield") {
      return "Ejecuta `/new-spec` para generar SPEC maestra";
    }
    if (devType === "modernizacion") {
      return "Ejecuta `/init-repo-context --on=<legacy-path>` para mapear sistema legacy";
    }
    if (devType === "integracion-externa") {
      return "Si toc\xE1s app existente: `/init-repo-context`. Si es greenfield: `/new-spec` directo";
    }
    return "Ejecuta `/init-repo-context` para mapear el repo existente";
  }
  if (flowState === "repo_mapped") {
    if (devType === "brownfield-feature") {
      return "Ejecuta `/new-spec` \u2014 la entrevista ser\xE1 breve gracias a REPO-CONTEXT";
    }
    if (devType === "brownfield-refactor") {
      return "Ejecuta `/map-service` + `/capture-baseline` antes de `/new-spec`";
    }
    if (devType === "modernizacion") {
      return "Ejecuta `/trace-flow` + `/map-service` antes de `/new-spec`";
    }
    if (devType === "integracion-externa") {
      return "Ejecuta `/new-spec(I)` \u2014 con info del vendor en HDU";
    }
  }
  if (flowState === "baseline_ready") {
    return "BASELINE listo. Ejecuta `/new-spec(R)` con plan de no-regresi\xF3n";
  }
  if (flowState === "spec_ready") {
    return "Ejecuta `/opsx:propose <change-name>` para dise\xF1ar el cambio";
  }
  if (flowState === "change_active") {
    return "Contin\xFAa tasks con `/opsx:apply`";
  }
  return "Sesi\xF3n cerrada. Para retomar: `dd-cli start-session <feature-id>`";
}

// src/enforcement/rules.ts
var ALL_TYPES = [
  "greenfield",
  "brownfield-feature",
  "brownfield-refactor",
  "modernizacion",
  "integracion-externa"
];
var NON_GREENFIELD = [
  "brownfield-feature",
  "brownfield-refactor",
  "modernizacion",
  "integracion-externa"
];
var RULES = {
  REQUIRE_REPO_CONTEXT_MD: {
    id: "REQUIRE_REPO_CONTEXT_MD",
    applies_to: NON_GREENFIELD,
    severity: "block",
    evaluate: ({ session, fileExists }) => {
      const ok2 = fileExists(".ai/REPO-CONTEXT.md");
      return {
        rule_id: "REQUIRE_REPO_CONTEXT_MD",
        passed: ok2,
        severity: "block",
        message: ok2 ? ".ai/REPO-CONTEXT.md presente" : `Esta HDU es ${session.dev_type} y requiere mapeo del repo existente. Ejecuta \`/init-repo-context\` antes de \`/new-spec\`.`
      };
    }
  },
  REQUIRE_BASELINE_MD: {
    id: "REQUIRE_BASELINE_MD",
    applies_to: ["brownfield-refactor"],
    severity: "block",
    evaluate: ({ session }) => {
      const ok2 = session.baseline_path !== null;
      return {
        rule_id: "REQUIRE_BASELINE_MD",
        passed: ok2,
        severity: "block",
        message: ok2 ? `.ai/BASELINE-* presente (${session.baseline_path})` : "Refactor sin baseline no garantiza no-regresi\xF3n. Ejecuta `/capture-baseline <modulo>` antes de `/new-spec`. Si no hay tests previos, el skill registra el caso expl\xEDcitamente."
      };
    }
  },
  BLOCK_NEW_APP: {
    id: "BLOCK_NEW_APP",
    applies_to: NON_GREENFIELD,
    severity: "block",
    evaluate: ({ session }) => {
      return {
        rule_id: "BLOCK_NEW_APP",
        passed: false,
        severity: "block",
        message: `Esta HDU es ${session.dev_type}. Usa el repo existente. \`/new-app\` solo aplica a greenfield.`
      };
    }
  },
  REQUIRE_LEGACY_SYSTEM_FIELD: {
    id: "REQUIRE_LEGACY_SYSTEM_FIELD",
    applies_to: ["modernizacion"],
    severity: "block",
    evaluate: ({ session }) => {
      const ok2 = session.legacy_system !== null && session.legacy_system.trim() !== "";
      return {
        rule_id: "REQUIRE_LEGACY_SYSTEM_FIELD",
        passed: ok2,
        severity: "block",
        message: ok2 ? `legacy_system: ${session.legacy_system}` : "Modernizaci\xF3n requiere identificar el sistema legacy a reemplazar. Complet\xE1 el campo `legacy_system` en la HDU."
      };
    }
  },
  REQUIRE_VENDOR_FIELD: {
    id: "REQUIRE_VENDOR_FIELD",
    applies_to: ["integracion-externa"],
    severity: "block",
    evaluate: ({ session }) => {
      const v = session.vendor;
      const ok2 = v !== null && typeof v.name === "string" && v.name.length > 0 && typeof v.api_version === "string" && v.api_version.length > 0;
      return {
        rule_id: "REQUIRE_VENDOR_FIELD",
        passed: ok2,
        severity: "block",
        message: ok2 ? `vendor: ${v.name} v${v.api_version}` : "Integraci\xF3n externa requiere identificar el vendor y la versi\xF3n de API. Complet\xE1 los campos `vendor` en la HDU."
      };
    }
  },
  OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION: {
    id: "OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION",
    applies_to: ["brownfield-refactor"],
    severity: "warn",
    evaluate: () => {
      return {
        rule_id: "OPSX_PROPOSE_REQUIRE_NO_FUNCTIONAL_CHANGE_SECTION",
        passed: true,
        severity: "warn",
        message: "Validada por /opsx:propose tras generar proposal.md"
      };
    }
  },
  OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER: {
    id: "OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER",
    applies_to: ["integracion-externa"],
    severity: "warn",
    evaluate: () => ({
      rule_id: "OPSX_PROPOSE_SUGGEST_ANTI_CORRUPTION_LAYER",
      passed: true,
      severity: "warn",
      message: "Validada por /opsx:propose tras generar design.md"
    })
  },
  RELEASE_CHECK_VALIDATE_CONTRACTS: {
    id: "RELEASE_CHECK_VALIDATE_CONTRACTS",
    applies_to: ["brownfield-refactor"],
    severity: "block",
    evaluate: () => ({
      rule_id: "RELEASE_CHECK_VALIDATE_CONTRACTS",
      passed: true,
      severity: "block",
      message: "Validada por /release-check(R) en el MR \u2014 diff contratos vs BASELINE"
    })
  },
  RELEASE_CHECK_VALIDATE_PARITY: {
    id: "RELEASE_CHECK_VALIDATE_PARITY",
    applies_to: ["modernizacion"],
    severity: "block",
    evaluate: () => ({
      rule_id: "RELEASE_CHECK_VALIDATE_PARITY",
      passed: true,
      severity: "block",
      message: "Validada por /release-check(M) en el MR \u2014 matriz paridad"
    })
  },
  RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY: {
    id: "RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY",
    applies_to: ["integracion-externa"],
    severity: "block",
    evaluate: () => ({
      rule_id: "RELEASE_CHECK_VALIDATE_INTEGRATION_SECURITY",
      passed: true,
      severity: "block",
      message: "Validada por /release-check(I) en el MR \u2014 credenciales/firmas/idempotencia"
    })
  },
  COMMIT_TRAILER_DEVFLOW_TYPE: {
    id: "COMMIT_TRAILER_DEVFLOW_TYPE",
    applies_to: ALL_TYPES,
    severity: "block",
    evaluate: () => ({
      rule_id: "COMMIT_TRAILER_DEVFLOW_TYPE",
      passed: true,
      severity: "block",
      message: "Validada por CI/CD pipeline \u2014 cada commit del MR incluye trailer DevFlow-Type"
    })
  },
  MOVE_TO_SPRINT_REQUIRES_DEV_TYPE: {
    id: "MOVE_TO_SPRINT_REQUIRES_DEV_TYPE",
    applies_to: ALL_TYPES,
    severity: "block",
    evaluate: ({ session }) => {
      const ok2 = session.dev_type !== null;
      return {
        rule_id: "MOVE_TO_SPRINT_REQUIRES_DEV_TYPE",
        passed: ok2,
        severity: "block",
        message: ok2 ? `dev_type: ${session.dev_type}` : "Esta HDU no tiene dev_type definido. Volver al portal de negocio o pedir al PMO que lo complete antes de planificar."
      };
    }
  }
};
function rulesForDevType(devType) {
  return Object.values(RULES).filter((r) => r.applies_to.includes(devType));
}
function enforcementRuleIdsForDevType(devType) {
  return rulesForDevType(devType).map((r) => r.id);
}

// src/enforcement/evaluator.ts
import { existsSync as existsSync2 } from "fs";
import * as path2 from "path";
function evaluateRules({
  projectRoot,
  session,
  ruleIds
}) {
  const ctx = {
    projectRoot,
    session,
    fileExists: (relPath) => existsSync2(path2.join(projectRoot, relPath))
  };
  let rulesToEvaluate;
  if (ruleIds && ruleIds.length > 0) {
    rulesToEvaluate = ruleIds.map((id) => RULES[id]).filter((r) => r !== void 0);
  } else if (session.dev_type) {
    rulesToEvaluate = rulesForDevType(session.dev_type);
  } else {
    return [];
  }
  return rulesToEvaluate.map((r) => r.evaluate(ctx));
}
function partition(results) {
  return {
    blockers: results.filter((r) => !r.passed && r.severity === "block"),
    warnings: results.filter((r) => !r.passed && r.severity === "warn"),
    audits: results.filter((r) => r.severity === "audit")
  };
}
function formatDoctorOutput(results, devType) {
  const lines = [];
  lines.push(`Validaci\xF3n para dev_type: ${devType ?? "(no definido)"}`);
  for (const r of results) {
    const icon = r.passed ? "\u2713" : r.severity === "block" ? "\u2717" : "\u26A0";
    lines.push(`  ${icon} ${r.rule_id} \u2014 ${r.message}`);
  }
  const { blockers } = partition(results);
  if (blockers.length === 0) {
    lines.push("");
    lines.push("Resultado: \u2713 Todas las precondiciones OK");
  } else {
    lines.push("");
    lines.push(`Resultado: ${blockers.length} regla(s) violada(s)`);
  }
  return lines.join("\n");
}

// src/utils/paths.ts
import { existsSync as existsSync3, statSync as statSync2 } from "fs";
import * as path3 from "path";
import * as os from "os";
function getProjectRoot(startDir = process.cwd()) {
  let current = path3.resolve(startDir);
  const root = path3.parse(current).root;
  while (current !== root) {
    if (existsSync3(path3.join(current, ".devflow"))) {
      return current;
    }
    current = path3.dirname(current);
  }
  return path3.resolve(startDir);
}
function findDevFlowProjectRoot(startDir = process.cwd()) {
  let current = path3.resolve(startDir);
  const root = path3.parse(current).root;
  const home = path3.resolve(os.homedir());
  while (current !== root) {
    if (current !== home) {
      const sessionFile = path3.join(current, ".devflow", "session.json");
      if (existsSync3(sessionFile)) {
        return current;
      }
    }
    current = path3.dirname(current);
  }
  return null;
}
function getClaudeGlobalSettingsPath() {
  return path3.join(getClaudeHome(), "settings.json");
}
function getSessionPath(projectRoot) {
  return path3.join(projectRoot, ".devflow", "session.json");
}
function getDevflowDir(projectRoot) {
  return path3.join(projectRoot, ".devflow");
}
function getClaudeHome() {
  return path3.join(os.homedir(), ".claude");
}
function getClaudeSkillsDir() {
  return path3.join(getClaudeHome(), "commands", "devflow-ia");
}
function getProjectClaudeDir(projectRoot) {
  return path3.join(projectRoot, ".claude");
}
function getProjectClaudeSettingsPath(projectRoot) {
  return path3.join(projectRoot, ".claude", "settings.json");
}
function isClaudeCodeInstalled() {
  const dir = getClaudeHome();
  return existsSync3(dir) && statSync2(dir).isDirectory();
}

// src/utils/session-io.ts
import { existsSync as existsSync4, readFileSync as readFileSync2, writeFileSync, mkdirSync } from "fs";
var SessionIOError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "SessionIOError";
  }
  cause;
};
function loadSession(projectRoot) {
  const sessionPath = getSessionPath(projectRoot);
  if (!existsSync4(sessionPath)) return null;
  let rawContent;
  try {
    rawContent = readFileSync2(sessionPath, "utf-8");
  } catch (err2) {
    throw new SessionIOError(`No se pudo leer ${sessionPath}`, err2);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err2) {
    throw new SessionIOError(`session.json no es JSON v\xE1lido`, err2);
  }
  const result = SessionStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new SessionIOError(
      `session.json no cumple el schema (v2):
${result.error.message}`,
      result.error
    );
  }
  return result.data;
}
function saveSession(projectRoot, session) {
  const devflowDir = getDevflowDir(projectRoot);
  if (!existsSync4(devflowDir)) {
    mkdirSync(devflowDir, { recursive: true });
  }
  const sessionPath = getSessionPath(projectRoot);
  const result = SessionStateSchema.safeParse(session);
  if (!result.success) {
    throw new SessionIOError(
      `No se puede guardar session \u2014 no cumple schema:
${result.error.message}`,
      result.error
    );
  }
  writeFileSync(sessionPath, JSON.stringify(result.data, null, 2) + "\n", "utf-8");
}
function hasSession(projectRoot) {
  return existsSync4(getSessionPath(projectRoot));
}

// src/utils/error-codes.ts
var ERROR_CODES = [
  // ── Genéricos ───────────────────────────────────────────────────────
  "INTERNAL_ERROR",
  "NOT_IMPLEMENTED",
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "NETWORK_ERROR",
  // ── Proyecto / config local ─────────────────────────────────────────
  "PROJECT_NOT_INITIALIZED",
  "CONFIG_INVALID",
  "CONFIG_MISSING",
  // ── Cliente / registry / cache ──────────────────────────────────────
  "CLIENT_NOT_REGISTERED",
  "CLIENT_ALREADY_REGISTERED",
  "CONTEXT_CACHE_MISSING",
  "CONTEXT_CACHE_STALE",
  "CONTEXT_REPO_EMPTY",
  "REGISTRY_INVALID",
  // ── Provider / git ──────────────────────────────────────────────────
  "TOKEN_MISSING",
  "TOKEN_INVALID",
  "TOKEN_INSUFFICIENT_SCOPE",
  "PROVIDER_NOT_SUPPORTED",
  "GIT_CLONE_FAILED",
  "GIT_PULL_FAILED",
  "GIT_PUSH_FAILED",
  // ── Schema / catalog / context ──────────────────────────────────────
  "CATALOG_PARSE_ERROR",
  "CATALOG_NOT_FOUND",
  "CONTEXT_REPO_INVALID",
  "STACK_CONFIG_MISSING",
  // ── Sesión / flujo ──────────────────────────────────────────────────
  "SESSION_NOT_STARTED",
  "SESSION_ALREADY_ACTIVE",
  "SESSION_INVALID",
  "PRECONDITION_NOT_MET",
  // ── HDU (futuro Sprint 5) ───────────────────────────────────────────
  "HDU_NOT_FOUND",
  "HDU_ID_COLLISION",
  "HDU_ALREADY_CLAIMED"
];
function exitCodeFor(code) {
  switch (code) {
    case "CONFIG_INVALID":
    case "REGISTRY_INVALID":
    case "CONTEXT_REPO_INVALID":
    case "CATALOG_PARSE_ERROR":
    case "INVALID_INPUT":
    case "SESSION_INVALID":
      return 3;
    case "PROJECT_NOT_INITIALIZED":
    case "CONFIG_MISSING":
    case "CLIENT_NOT_REGISTERED":
    case "CONTEXT_CACHE_MISSING":
    case "STACK_CONFIG_MISSING":
    case "CATALOG_NOT_FOUND":
    case "TOKEN_MISSING":
    case "TOKEN_INSUFFICIENT_SCOPE":
    case "SESSION_NOT_STARTED":
    case "PRECONDITION_NOT_MET":
    case "HDU_NOT_FOUND":
      return 2;
    default:
      return 1;
  }
}

// src/utils/json-output.ts
function isJsonMode(opts) {
  if (opts?.json) return true;
  if (process.env.DEVFLOW_CLAUDE_MODE === "1") return true;
  return false;
}
function emitJson(output) {
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  const code = output.status === "success" ? 0 : exitCodeFor(output.code);
  process.exit(code);
}
function jsonSuccess(command, data, nextSafeCommand) {
  return {
    status: "success",
    command,
    cli_version: CLI_VERSION,
    data,
    ...nextSafeCommand !== void 0 ? { next_safe_command: nextSafeCommand } : {}
  };
}
function jsonError(opts) {
  return {
    status: "error",
    command: opts.command,
    cli_version: CLI_VERSION,
    code: opts.code,
    message: opts.message,
    ...opts.context ? { context: opts.context } : {},
    ...opts.recovery_hints ? { recovery_hints: opts.recovery_hints } : {},
    ...opts.next_safe_command !== void 0 ? { next_safe_command: opts.next_safe_command } : {}
  };
}

// src/utils/client-state.ts
import { z as z3 } from "zod";
import { existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
import * as path5 from "path";

// src/types/registry.ts
import { z as z2 } from "zod";
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync2 } from "fs";
import * as path4 from "path";
import * as os2 from "os";
import * as yaml from "js-yaml";
var ClientRegistryEntrySchema = z2.object({
  slug: z2.string(),
  name: z2.string().default(""),
  context_url: z2.string().url(),
  local_cache: z2.string(),
  // path absoluto a ~/.devflow/clients/<slug>/
  last_synced: z2.string().nullable().default(null),
  registered_at: z2.string()
});
var RegistrySchema = z2.object({
  clients: z2.record(z2.string(), ClientRegistryEntrySchema).default({})
});
function getDevflowGlobalDir() {
  return path4.join(os2.homedir(), ".devflow");
}
function getRegistryPath() {
  return path4.join(getDevflowGlobalDir(), "registry.yml");
}
function getClientCacheDir(slug) {
  return path4.join(getDevflowGlobalDir(), "clients", slug);
}
function loadRegistry() {
  const registryPath = getRegistryPath();
  if (!existsSync5(registryPath)) {
    return { clients: {} };
  }
  const raw = readFileSync3(registryPath, "utf-8");
  const parsed = yaml.load(raw);
  const result = RegistrySchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new Error(`registry.yml inv\xE1lido:
${result.error.message}`);
  }
  return result.data;
}
function saveRegistry(registry) {
  const globalDir = getDevflowGlobalDir();
  if (!existsSync5(globalDir)) mkdirSync2(globalDir, { recursive: true });
  const validated = RegistrySchema.parse(registry);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync2(getRegistryPath(), yamlStr, "utf-8");
}
function getClient(slug) {
  const registry = loadRegistry();
  return registry.clients[slug] ?? null;
}
function registerClient(entry) {
  const registry = loadRegistry();
  registry.clients[entry.slug] = {
    ...entry,
    registered_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveRegistry(registry);
}
function updateLastSynced(slug) {
  const registry = loadRegistry();
  const entry = registry.clients[slug];
  if (entry) {
    entry.last_synced = (/* @__PURE__ */ new Date()).toISOString();
    saveRegistry(registry);
  }
}

// src/utils/client-state.ts
var CLIENT_STATES = [
  "REGISTERED",
  "DISCOVERED",
  "DRAFT",
  "READY",
  "ACTIVE",
  "NEEDS_REFRESH"
];
var STATE_TRANSITIONS = {
  REGISTERED: ["DISCOVERED", "DRAFT"],
  // discover → DISCOVERED; review → DRAFT
  DISCOVERED: ["DRAFT", "READY", "DISCOVERED"],
  // review → DRAFT; publish skip review → READY; re-discover idempotente
  DRAFT: ["READY", "DRAFT", "DISCOVERED"],
  // publish → READY; re-review → DRAFT; rollback a discovery
  READY: ["ACTIVE", "NEEDS_REFRESH", "DRAFT", "DISCOVERED"],
  // init → ACTIVE; refresh → DRAFT/DISCOVERED; rollback
  ACTIVE: ["NEEDS_REFRESH", "ACTIVE", "READY"],
  NEEDS_REFRESH: ["DRAFT", "DISCOVERED", "READY", "ACTIVE"]
  // refresh → DRAFT; sync sin cambios → READY
};
function canTransitionTo(from, to) {
  if (from === void 0) return to === "REGISTERED";
  if (from === to) return STATE_TRANSITIONS[from].includes(to);
  return STATE_TRANSITIONS[from].includes(to);
}
function suggestedCommandFor(state, slug) {
  switch (state) {
    case "REGISTERED":
      return `dd-cli client discover ${slug}`;
    case "DISCOVERED":
      return `dd-cli client publish ${slug}    # o /devflow-ia:client-review`;
    case "DRAFT":
      return `dd-cli client publish ${slug}`;
    case "READY":
      return `cd <repo-de-codigo> && dd-cli init --client=${slug}`;
    case "ACTIVE":
      return null;
    case "NEEDS_REFRESH":
      return `dd-cli client refresh ${slug}`;
  }
}
var PROVIDERS = ["gitlab", "github"];
var ClientStateErrorSchema = z3.object({
  code: z3.enum(ERROR_CODES),
  message: z3.string(),
  context: z3.record(z3.string(), z3.unknown()).optional(),
  recovery_hints: z3.array(z3.string()).optional()
}).passthrough();
var ClientStateSchema = z3.object({
  schema_version: z3.literal("1.0").default("1.0"),
  slug: z3.string(),
  state: z3.enum(CLIENT_STATES),
  provider: z3.enum(PROVIDERS).optional(),
  last_command: z3.string(),
  last_command_at: z3.string(),
  last_error: ClientStateErrorSchema.nullable().default(null),
  draft_path: z3.string().optional(),
  open_gaps: z3.number().int().nonnegative().optional(),
  next_safe_command: z3.string().nullable().optional()
});
function getClientStatePath(slug) {
  return path5.join(getDevflowGlobalDir(), "clients", `${slug}.state.json`);
}
function getStateCandidates(slug) {
  return [
    getClientStatePath(slug),
    path5.join(getClientCacheDir(slug), "..", `${slug}.state.json`)
  ];
}
function readClientState(slug) {
  for (const candidate of getStateCandidates(slug)) {
    if (!existsSync6(candidate)) continue;
    try {
      const raw = readFileSync4(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      const result = ClientStateSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
    }
  }
  return null;
}
function writeClientState(state) {
  const statePath = getClientStatePath(state.slug);
  mkdirSync3(path5.dirname(statePath), { recursive: true });
  const validated = ClientStateSchema.parse(state);
  writeFileSync3(statePath, JSON.stringify(validated, null, 2) + "\n", "utf-8");
}
function updateClientState(slug, patch, opts = {}) {
  const existing = readClientState(slug);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (patch.state && !opts.allowAnyTransition) {
    const fromState = existing?.state;
    if (!canTransitionTo(fromState, patch.state)) {
      throw new Error(
        `Transici\xF3n de estado inv\xE1lida para "${slug}": ${fromState ?? "(none)"} \u2192 ${patch.state}. Transiciones legales desde ${fromState ?? "(none)"}: ${fromState ? STATE_TRANSITIONS[fromState].join(", ") : "REGISTERED"}.`
      );
    }
  }
  const base = existing ?? {
    schema_version: "1.0",
    slug,
    state: "REGISTERED",
    last_command: "unknown",
    last_command_at: now,
    last_error: null
  };
  const merged = {
    ...base,
    ...patch,
    slug,
    // slug es inmutable
    last_command_at: patch.last_command_at ?? now
  };
  const parsed = ClientStateSchema.parse(merged);
  writeClientState(parsed);
  return parsed;
}
function recordCommandResult(slug, command, result) {
  if (result.success) {
    updateClientState(slug, {
      last_command: command,
      last_error: null,
      ...result.state ? { state: result.state } : {},
      ...result.nextSafe !== void 0 ? { next_safe_command: result.nextSafe } : {}
    });
  } else {
    updateClientState(slug, {
      last_command: command,
      last_error: result.error,
      ...result.nextSafe !== void 0 ? { next_safe_command: result.nextSafe } : {}
    });
  }
}

// src/types/stack-config.ts
import { z as z4 } from "zod";
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readFileSync as readFileSync5, writeFileSync as writeFileSync4 } from "fs";
import * as path6 from "path";
import * as yaml2 from "js-yaml";
var StackInfraSchema = z4.object({
  backend_framework: z4.string().min(1),
  frontend_framework: z4.string().min(1),
  databases: z4.array(z4.string()).min(1),
  infra: z4.string().min(1),
  // ej: "Kubernetes"
  k8s_namespaces: z4.record(z4.string(), z4.string()).optional(),
  cicd_platform: z4.string().min(1),
  // ej: "GitLab CI", "GitHub Actions"
  identity_provider: z4.string().nullable().default(null),
  container_registry: z4.string().nullable().default(null),
  base_domain: z4.string().nullable().default(null)
});
var NamingSchema = z4.object({
  feature_id_pattern: z4.string().default("HDU-{n}"),
  branch_pattern: z4.string().default("feature/{feature_id}-{slug}"),
  spec_filename: z4.string().default("SPEC-{slug}.md"),
  epic_filename: z4.string().default("EPIC-{slug}.md")
});
var DefaultsSchema = z4.object({
  acceptance_format: z4.enum(["gherkin", "checklist", "narrative"]).default("gherkin"),
  story_format: z4.enum(["como-quiero-para", "user-story", "free"]).default("como-quiero-para"),
  sprint_duration_weeks: z4.number().int().min(1).max(8).default(2),
  main_branch: z4.string().default("main"),
  qa_branch: z4.string().default("develop")
});
var StackTemplatesSchema = z4.object({
  fullstack: z4.string().nullable().default(null),
  // ej: "iprsa-group/laravel-fullstack-template"
  api: z4.string().nullable().default(null)
}).passthrough();
var StackDevflowSchema = z4.object({
  mode: z4.enum(["local", "platform"]).default("local"),
  url: z4.string().url().nullable().default(null)
});
var StackConfigSchema = z4.object({
  schema_version: z4.literal("1.0").default("1.0"),
  client: z4.object({
    slug: z4.string().min(1).regex(/^[a-z0-9-]+$/, "Debe ser kebab-case"),
    name: z4.string().min(1),
    industry: z4.string().nullable().default(null),
    team_size: z4.number().int().nonnegative().nullable().default(null),
    primary_contact: z4.string().nullable().default(null)
  }),
  stack: StackInfraSchema,
  naming: NamingSchema.default({}),
  defaults: DefaultsSchema.default({}),
  templates: StackTemplatesSchema.default({}),
  devflow: StackDevflowSchema.default({})
});
var STACK_DIR = ".devflow-context";
var STACK_FILENAME = "stack.yml";
function getStackConfigPath(contextRepoRoot) {
  return path6.join(contextRepoRoot, STACK_DIR, STACK_FILENAME);
}
function hasStackConfig(contextRepoRoot) {
  return existsSync7(getStackConfigPath(contextRepoRoot));
}
function loadStackConfig(contextRepoRoot) {
  const p = getStackConfigPath(contextRepoRoot);
  if (!existsSync7(p)) return null;
  const raw = readFileSync5(p, "utf-8");
  const parsed = yaml2.load(raw);
  const result = StackConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`stack.yml inv\xE1lido en ${p}:
${result.error.message}`);
  }
  return result.data;
}
function saveStackConfig(contextRepoRoot, config) {
  const stackDir = path6.join(contextRepoRoot, STACK_DIR);
  if (!existsSync7(stackDir)) mkdirSync4(stackDir, { recursive: true });
  const validated = StackConfigSchema.parse(config);
  const yamlStr = yaml2.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync4(getStackConfigPath(contextRepoRoot), yamlStr, "utf-8");
}
function looksLikeLegacyMasterConfig(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed;
  return "stack" in obj || "project" in obj || "naming" in obj || "templates" in obj;
}

// src/types/catalog.ts
import { z as z6 } from "zod";
import { existsSync as existsSync9, mkdirSync as mkdirSync6, readFileSync as readFileSync7, writeFileSync as writeFileSync6 } from "fs";
import * as path8 from "path";
import * as yaml4 from "js-yaml";

// src/types/project-config.ts
import { z as z5 } from "zod";
import { readFileSync as readFileSync6, writeFileSync as writeFileSync5, existsSync as existsSync8, mkdirSync as mkdirSync5 } from "fs";
import * as path7 from "path";
import * as yaml3 from "js-yaml";
var APP_TYPES = [
  "microservice",
  "bff",
  "api-rest",
  "frontend-app",
  "frontend-mfe",
  "worker",
  "library"
];
var APP_ORIGINS = ["greenfield-app", "legacy-app", "external-app"];
var ProjectConfigSchema = z5.object({
  client: z5.object({
    slug: z5.string().min(1).regex(/^[a-z0-9-]+$/, "Debe ser kebab-case"),
    name: z5.string().min(1),
    context_url: z5.string().url("Debe ser una URL de GitHub/GitLab")
  }),
  app: z5.object({
    slug: z5.string().min(1).regex(/^[a-z0-9-]+$/, "Debe ser kebab-case"),
    type: z5.enum(APP_TYPES),
    auth_profile: z5.string().min(1),
    ci_cd_profile: z5.string().min(1),
    app_origin: z5.enum(APP_ORIGINS).default("legacy-app"),
    preferred_dev_types: z5.array(z5.enum(DEV_TYPES)).default([])
  }),
  devflow: z5.object({
    mode: z5.enum(["local", "platform"]).default("local"),
    platform_url: z5.string().url().nullable().default(null)
  }).default({ mode: "local", platform_url: null })
});
var CONFIG_FILENAME = "config.yml";
function getProjectConfigPath(projectRoot) {
  return path7.join(projectRoot, ".devflow", CONFIG_FILENAME);
}
function loadProjectConfig(projectRoot) {
  const configPath = getProjectConfigPath(projectRoot);
  if (!existsSync8(configPath)) return null;
  const raw = readFileSync6(configPath, "utf-8");
  const parsed = yaml3.load(raw);
  const result = ProjectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `config.yml inv\xE1lido en ${configPath}:
${result.error.message}`
    );
  }
  return result.data;
}
function saveProjectConfig(projectRoot, config) {
  const devflowDir = path7.join(projectRoot, ".devflow");
  if (!existsSync8(devflowDir)) mkdirSync5(devflowDir, { recursive: true });
  const validated = ProjectConfigSchema.parse(config);
  const yamlStr = yaml3.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync5(getProjectConfigPath(projectRoot), yamlStr, "utf-8");
}
function hasProjectConfig(projectRoot) {
  return existsSync8(getProjectConfigPath(projectRoot));
}
function buildProjectConfig(opts) {
  return ProjectConfigSchema.parse({
    client: {
      slug: opts.clientSlug,
      name: opts.clientName,
      context_url: opts.contextUrl
    },
    app: {
      slug: opts.appSlug,
      type: opts.appType,
      auth_profile: opts.authProfile,
      ci_cd_profile: opts.ciCdProfile,
      app_origin: opts.appOrigin ?? "legacy-app",
      preferred_dev_types: opts.preferredDevTypes ?? []
    },
    devflow: { mode: "local", platform_url: null }
  });
}

// src/types/catalog.ts
var APP_STATUSES = ["prod", "qa", "dev", "deprecated", "inactive", "empty", "unknown"];
var APP_ROLES = ["provider", "consumer", "portal", "standalone", "data-layer", "integration", "unknown"];
var CatalogAppSchema = z6.object({
  slug: z6.string().min(1).regex(/^[a-z0-9-]+$/, "Debe ser kebab-case"),
  name: z6.string().min(1),
  type: z6.enum(APP_TYPES),
  role: z6.enum(APP_ROLES).default("standalone"),
  auth_profile: z6.string().nullable().default(null),
  ci_cd_profile: z6.string().nullable().default(null),
  repo: z6.string().nullable().default(null),
  branch: z6.string().default("main"),
  status: z6.enum(APP_STATUSES).default("unknown"),
  app_origin: z6.enum(APP_ORIGINS).default("legacy-app"),
  template_origin: z6.string().nullable().default(null),
  preferred_dev_types: z6.array(z6.enum(DEV_TYPES)).default([]),
  tags: z6.array(z6.string()).default([]),
  notes: z6.string().nullable().default(null)
});
var CatalogSchema = z6.object({
  schema_version: z6.literal("1.0").default("1.0"),
  apps: z6.array(CatalogAppSchema).default([])
});
var CATALOG_DIR = ".devflow-context";
var CATALOG_YAML = "catalog.yml";
var CATALOG_MARKDOWN_LEGACY = "app-catalog.md";
function getCatalogYamlPath(contextRepoRoot) {
  return path8.join(contextRepoRoot, CATALOG_DIR, CATALOG_YAML);
}
function getCatalogMarkdownPath(contextRepoRoot) {
  return path8.join(contextRepoRoot, CATALOG_DIR, CATALOG_MARKDOWN_LEGACY);
}
function hasCatalog(contextRepoRoot) {
  return existsSync9(getCatalogYamlPath(contextRepoRoot)) || existsSync9(getCatalogMarkdownPath(contextRepoRoot));
}
function loadCatalog(contextRepoRoot) {
  const yamlPath = getCatalogYamlPath(contextRepoRoot);
  if (existsSync9(yamlPath)) {
    const raw = readFileSync7(yamlPath, "utf-8");
    const parsed = yaml4.load(raw);
    const result = CatalogSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`catalog.yml inv\xE1lido en ${yamlPath}:
${result.error.message}`);
    }
    return result.data;
  }
  const mdPath = getCatalogMarkdownPath(contextRepoRoot);
  if (existsSync9(mdPath)) {
    const apps = parseMarkdownCatalog(readFileSync7(mdPath, "utf-8"));
    return CatalogSchema.parse({ apps });
  }
  return null;
}
function saveCatalog(contextRepoRoot, catalog) {
  const dir = path8.join(contextRepoRoot, CATALOG_DIR);
  if (!existsSync9(dir)) mkdirSync6(dir, { recursive: true });
  const validated = CatalogSchema.parse(catalog);
  const yamlStr = yaml4.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync6(getCatalogYamlPath(contextRepoRoot), yamlStr, "utf-8");
}
function parseMarkdownCatalog(content) {
  const stripBackticks = (s) => s.replace(/^`+/, "").replace(/`+$/, "").trim();
  const looksLikeBoolean = (s) => /^(sí|si|no|yes|true|false|✓|✗|—|-)?$/i.test(s.trim());
  const apps = [];
  for (const line of content.split("\n")) {
    if (!/^\|\s*[`a-z0-9]/i.test(line)) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cols = line.split("|").map((c3) => stripBackticks(c3.trim())).filter(Boolean);
    if (cols.length < 4) continue;
    const firstCol = (cols[0] ?? "").toLowerCase();
    if (firstCol === "slug" || firstCol === "app") continue;
    const slug = cols[0] ?? "";
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    const rawType = cols[1] ?? "";
    const type = APP_TYPES.includes(rawType) ? rawType : "bff";
    const rawOrigin = cols[2] ?? "legacy-app";
    const app_origin = APP_ORIGINS.includes(rawOrigin) ? rawOrigin : "legacy-app";
    const rawCiCd = cols[5] ?? "";
    const ci_cd_profile = looksLikeBoolean(rawCiCd) ? null : rawCiCd;
    const rawStatus = (cols[6] ?? "").toLowerCase();
    const status = APP_STATUSES.includes(rawStatus) ? rawStatus : "unknown";
    const preferred_dev_types = (cols[7] ?? "").split(",").map((s) => stripBackticks(s)).filter((s) => DEV_TYPES.includes(s));
    apps.push(CatalogAppSchema.parse({
      slug,
      name: slug,
      // sin display name en md viejo
      type,
      role: "standalone",
      auth_profile: cols[3] || null,
      ci_cd_profile,
      repo: cols[4] || null,
      branch: "main",
      status,
      app_origin,
      preferred_dev_types,
      tags: [],
      notes: null
    }));
  }
  return apps;
}
function renderCatalogMarkdown(catalog) {
  const apps = catalog.apps;
  const lines = [];
  lines.push("# App catalog");
  lines.push("");
  lines.push("Generado por dd-cli context render \u2014 no editar a mano (edit\xE1 catalog.yml).");
  lines.push("");
  lines.push("| slug | tipo | app_origin | auth-profile | repo | ci_cd_profile | estado | preferred_dev_types |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const app of apps) {
    const cells = [
      "`" + app.slug + "`",
      app.type,
      app.app_origin,
      app.auth_profile ?? "\u2014",
      app.repo ?? "\u2014",
      app.ci_cd_profile ?? "\u2014",
      app.status,
      app.preferred_dev_types.join(", ") || "\u2014"
    ];
    lines.push("| " + cells.join(" | ") + " |");
  }
  lines.push("");
  return lines.join("\n");
}

// src/types/context-repo.ts
import { z as z7 } from "zod";
import { existsSync as existsSync10, mkdirSync as mkdirSync7, readFileSync as readFileSync8, writeFileSync as writeFileSync7 } from "fs";
import * as path9 from "path";
import * as yaml5 from "js-yaml";
var ContextRepoSchema = z7.object({
  kind: z7.literal("context-repo"),
  schema_version: z7.string().default("1.1"),
  client: z7.object({
    slug: z7.string().min(1).regex(/^[a-z0-9-]+$/),
    name: z7.string().min(1)
  }),
  provider: z7.object({
    type: z7.enum(["gitlab", "github"]),
    base_url: z7.string().url(),
    group_or_org: z7.string().min(1)
  }).optional(),
  generated_by: z7.string().default("/devflow-ia:client-onboard"),
  last_generated_at: z7.string(),
  cli_version: z7.string(),
  discovery_source: z7.object({
    type: z7.literal("provider-api").default("provider-api"),
    ref: z7.string().default("HEAD")
  }).optional(),
  checksums: z7.record(z7.string(), z7.string()).optional()
});
var MARKER_DIR = ".devflow-context";
var MARKER_FILENAME = ".context-repo.yml";
function getContextRepoMarkerPath(repoRoot) {
  return path9.join(repoRoot, MARKER_DIR, MARKER_FILENAME);
}
function isContextRepo(repoRoot) {
  if (existsSync10(getContextRepoMarkerPath(repoRoot))) return true;
  const contextDir = path9.join(repoRoot, MARKER_DIR);
  if (!existsSync10(contextDir)) return false;
  const evidenceFiles = ["stack.yml", "catalog.yml", "app-catalog.md", "client-assessment.md"];
  for (const f of evidenceFiles) {
    if (existsSync10(path9.join(contextDir, f))) return true;
  }
  const projectConfig = path9.join(repoRoot, ".devflow", "config.yml");
  return !existsSync10(projectConfig);
}
function loadContextRepoMarker(repoRoot) {
  const p = getContextRepoMarkerPath(repoRoot);
  if (!existsSync10(p)) return null;
  const raw = readFileSync8(p, "utf-8");
  const parsed = yaml5.load(raw);
  const result = ContextRepoSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`.context-repo.yml inv\xE1lido en ${p}:
${result.error.message}`);
  }
  return result.data;
}
function saveContextRepoMarker(repoRoot, marker) {
  const dir = path9.join(repoRoot, MARKER_DIR);
  if (!existsSync10(dir)) mkdirSync7(dir, { recursive: true });
  const validated = ContextRepoSchema.parse(marker);
  const yamlStr = yaml5.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync7(getContextRepoMarkerPath(repoRoot), yamlStr, "utf-8");
}

// src/types/hdu.ts
import { z as z8 } from "zod";
import { existsSync as existsSync11, mkdirSync as mkdirSync8, readFileSync as readFileSync9, writeFileSync as writeFileSync8, appendFileSync, readdirSync } from "fs";
import * as path10 from "path";
import * as yaml6 from "js-yaml";
var HDU_STATUSES = ["draft", "approved", "in-progress", "in-review", "done", "cancelled"];
var HDU_PRIORITIES = ["baja", "media", "alta", "cr\xEDtica"];
var HduFrontmatterSchema = z8.object({
  id: z8.string().regex(/^HDU-(\d+|LOCAL-[a-z0-9-]+)$/, "Debe ser HDU-NNN o HDU-LOCAL-<slug>"),
  title: z8.string().min(1),
  status: z8.enum(HDU_STATUSES).default("draft"),
  dev_type: z8.enum(DEV_TYPES).optional(),
  dev_type_locked: z8.boolean().default(false),
  dev_type_source: z8.string().optional(),
  priority: z8.enum(HDU_PRIORITIES).default("media"),
  apps_affected: z8.array(z8.string()).default([]),
  assigned_to: z8.string().email().nullable().default(null),
  created_by: z8.string().email().optional(),
  created_at: z8.string(),
  approved_by: z8.string().email().nullable().default(null),
  approved_at: z8.string().nullable().default(null),
  sprint: z8.string().nullable().default(null),
  lead_time_estimated_days: z8.number().int().min(0).nullable().default(null),
  references: z8.array(z8.string()).default([]),
  // ej: HDU-123 (HDU previa cancelled)
  tags: z8.array(z8.string()).default([])
});
var HduTransitionSchema = z8.object({
  ts: z8.string(),
  hdu: z8.string(),
  from: z8.enum(HDU_STATUSES).nullable(),
  to: z8.enum(HDU_STATUSES),
  by: z8.string(),
  // email del actor o "system" para CI jobs
  reason: z8.string().nullable().default(null),
  via: z8.enum(["cli", "pr-merge", "ci-job", "direct-commit"]).default("cli")
});
var HduIndexEntrySchema = z8.object({
  id: z8.string(),
  title: z8.string(),
  status: z8.enum(HDU_STATUSES),
  dev_type: z8.enum(DEV_TYPES).optional(),
  priority: z8.enum(HDU_PRIORITIES),
  apps_affected: z8.array(z8.string()),
  assigned_to: z8.string().email().nullable(),
  sprint: z8.string().nullable(),
  created_at: z8.string()
});
var HduIndexSchema = z8.object({
  schema_version: z8.literal("1.0").default("1.0"),
  generated_at: z8.string(),
  next_hdu_id: z8.number().int().min(1).default(1),
  hdus: z8.array(HduIndexEntrySchema).default([])
});
var HDUS_DIR = "hdus";
var TRANSITIONS_FILE = "_transitions.jsonl";
var INDEX_FILE = "_index.yml";
function getHdusDir(contextRepoRoot) {
  return path10.join(contextRepoRoot, HDUS_DIR);
}
function getHduTransitionsPath(contextRepoRoot) {
  return path10.join(getHdusDir(contextRepoRoot), TRANSITIONS_FILE);
}
function getHduIndexPath(contextRepoRoot) {
  return path10.join(getHdusDir(contextRepoRoot), INDEX_FILE);
}
function getHduFilePath(contextRepoRoot, id, slug) {
  return path10.join(getHdusDir(contextRepoRoot), `${id}-${slug}.md`);
}
function parseHduFile(content, filename) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`HDU "${filename}" no tiene frontmatter YAML v\xE1lido.`);
  }
  const fmRaw = yaml6.load(match[1] ?? "");
  const result = HduFrontmatterSchema.safeParse(fmRaw);
  if (!result.success) {
    throw new Error(`Frontmatter inv\xE1lido en "${filename}":
${result.error.message}`);
  }
  return {
    frontmatter: result.data,
    body: match[2] ?? "",
    filename
  };
}
function serializeHdu(hdu) {
  const fm = HduFrontmatterSchema.parse(hdu.frontmatter);
  const yamlStr = yaml6.dump(fm, { indent: 2, lineWidth: 120 });
  return `---
${yamlStr}---
${hdu.body}`;
}
function loadHdu(contextRepoRoot, filename) {
  const fullPath = path10.join(getHdusDir(contextRepoRoot), filename);
  const content = readFileSync9(fullPath, "utf-8");
  return parseHduFile(content, filename);
}
function saveHdu(contextRepoRoot, hdu) {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync11(dir)) mkdirSync8(dir, { recursive: true });
  const content = serializeHdu(hdu);
  writeFileSync8(path10.join(dir, hdu.filename), content, "utf-8");
}
function listHdus(contextRepoRoot) {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync11(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  return files.map((f) => {
    try {
      return loadHdu(contextRepoRoot, f);
    } catch {
      return null;
    }
  }).filter((h) => h !== null);
}
function appendTransition(contextRepoRoot, transition) {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync11(dir)) mkdirSync8(dir, { recursive: true });
  const validated = HduTransitionSchema.parse(transition);
  const line = JSON.stringify(validated) + "\n";
  appendFileSync(getHduTransitionsPath(contextRepoRoot), line, "utf-8");
}
function readTransitions(contextRepoRoot) {
  const p = getHduTransitionsPath(contextRepoRoot);
  if (!existsSync11(p)) return [];
  return readFileSync9(p, "utf-8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
    try {
      return HduTransitionSchema.parse(JSON.parse(l));
    } catch {
      return null;
    }
  }).filter((t) => t !== null);
}
function saveHduIndex(contextRepoRoot, index) {
  const dir = getHdusDir(contextRepoRoot);
  if (!existsSync11(dir)) mkdirSync8(dir, { recursive: true });
  const validated = HduIndexSchema.parse(index);
  writeFileSync8(getHduIndexPath(contextRepoRoot), yaml6.dump(validated, { indent: 2 }), "utf-8");
}
function regenerateHduIndex(contextRepoRoot) {
  const hdus = listHdus(contextRepoRoot);
  const ids = hdus.map((h) => h.frontmatter.id.match(/^HDU-(\d+)/)).filter((m) => m !== null).map((m) => Number.parseInt(m[1] ?? "0", 10));
  const nextHduId2 = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const index = {
    schema_version: "1.0",
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    next_hdu_id: nextHduId2,
    hdus: hdus.map((h) => HduIndexEntrySchema.parse({
      id: h.frontmatter.id,
      title: h.frontmatter.title,
      status: h.frontmatter.status,
      dev_type: h.frontmatter.dev_type,
      priority: h.frontmatter.priority,
      apps_affected: h.frontmatter.apps_affected,
      assigned_to: h.frontmatter.assigned_to,
      sprint: h.frontmatter.sprint,
      created_at: h.frontmatter.created_at
    }))
  };
  saveHduIndex(contextRepoRoot, index);
  return index;
}
var HDU_TRANSITIONS = {
  "draft": ["approved", "cancelled"],
  "approved": ["in-progress", "cancelled", "draft"],
  // rollback a draft posible
  "in-progress": ["in-review", "approved", "cancelled"],
  // pausar = approved nuevamente
  "in-review": ["done", "in-progress", "cancelled"],
  // rechazar = volver a in-progress
  "done": [],
  // terminal
  "cancelled": []
  // terminal
};
function canHduTransitionTo(from, to) {
  return HDU_TRANSITIONS[from]?.includes(to) ?? false;
}
function legalNextStatuses(from) {
  return [...HDU_TRANSITIONS[from] ?? []];
}

// src/providers/types.ts
var ProviderError = class extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
    this.name = "ProviderError";
  }
  cause;
};
var NotImplementedError = class extends ProviderError {
  constructor(provider, feature) {
    super(`${provider}: ${feature} no est\xE1 implementado todav\xEDa (Sprint 3)`, { provider });
    this.name = "NotImplementedError";
  }
};

// src/providers/gitlab.ts
var GitLabProvider = class {
  type = "gitlab";
  base_url;
  group_or_org;
  token;
  constructor(opts) {
    this.base_url = opts.base_url.replace(/\/$/, "");
    this.group_or_org = opts.group;
    this.token = opts.token;
  }
  // ── HTTP helpers ──────────────────────────────────────────────────
  async request(endpoint, params = {}, init) {
    const url = new URL(`${this.base_url}/api/v4/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
        ...init?.headers ?? {}
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `GitLab API ${response.status} en ${endpoint}: ${body.slice(0, 300)}`,
        { provider: "gitlab", status: response.status, body }
      );
    }
    return response.json();
  }
  // ── validateToken ─────────────────────────────────────────────────
  /**
   * Mapeo de operación → scopes mínimos requeridos (sección 4.7).
   * GitLab `api` incluye casi todo; `read_api` es solo lectura.
   */
  requiredScopesFor(op) {
    switch (op) {
      case "read":
        return ["read_api"];
      case "write":
        return ["api"];
      case "create_repo":
        return ["api"];
      case "branch_protection":
        return ["api"];
      case "webhook":
        return ["api"];
    }
  }
  async validateToken(opts = {}) {
    let user = null;
    let scopes_present = [];
    let is_admin_of_group = null;
    let message = "";
    try {
      const tokenInfo = await this.request("personal_access_tokens/self");
      scopes_present = tokenInfo.scopes ?? [];
      if (tokenInfo.user_id) {
        const userResp = await this.request(`users/${tokenInfo.user_id}`);
        user = userResp.username ?? null;
      }
      message = "Token v\xE1lido";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        user: null,
        scopes_present: [],
        scopes_missing: [],
        is_admin_of_group: null,
        message: `Token inv\xE1lido o sin acceso a la API: ${msg}`
      };
    }
    try {
      const groupResp = await this.request(`groups/${encodeURIComponent(this.group_or_org)}`);
      if (groupResp.full_path) {
        try {
          const members = await this.request(
            `groups/${encodeURIComponent(this.group_or_org)}/members/all`,
            { query: user ?? "" }
          );
          const me = members.find((m) => m.username === user);
          if (me) is_admin_of_group = me.access_level >= 40;
        } catch {
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message = `Token v\xE1lido pero sin acceso al group ${this.group_or_org}: ${msg}`;
    }
    const required = /* @__PURE__ */ new Set();
    for (const op of opts.required_for ?? []) {
      for (const s of this.requiredScopesFor(op)) required.add(s);
    }
    const scopes_missing = [...required].filter((s) => !scopes_present.includes(s));
    return {
      valid: true,
      user,
      scopes_present,
      scopes_missing,
      is_admin_of_group,
      message
    };
  }
  // ── listGroupRepos ────────────────────────────────────────────────
  async listGroupRepos() {
    const encodedGroup = encodeURIComponent(this.group_or_org);
    const projects = await this.request(
      `groups/${encodedGroup}/projects`,
      {
        per_page: "100",
        include_subgroups: "true",
        with_shared: "false",
        order_by: "last_activity_at",
        sort: "desc"
      }
    );
    return projects.map((p) => ({
      id: p["id"],
      slug: p["path"] ?? "",
      name: p["name"] ?? "",
      description: p["description"] ?? "",
      url: p["http_url_to_repo"] ?? "",
      ssh_url: p["ssh_url_to_repo"] ?? "",
      default_branch: p["default_branch"] ?? "main",
      last_push: p["last_activity_at"] ?? "",
      language: null,
      size_kb: p["statistics"]?.["repository_size"] ?? 0,
      topics: p["topics"] ?? [],
      archived: p["archived"] ?? false,
      ci_config_path: p["ci_config_path"] ?? null
    }));
  }
  // ── readFile / readFirstFound ─────────────────────────────────────
  async readFile(repoIdOrSlug, filePath, ref = "main") {
    try {
      const encoded = encodeURIComponent(filePath);
      const data = await this.request(
        `projects/${repoIdOrSlug}/repository/files/${encoded}`,
        { ref }
      );
      const content = Buffer.from(data["content"] ?? "", "base64").toString("utf-8");
      return { path: filePath, content, found: true };
    } catch {
      return { path: filePath, content: "", found: false };
    }
  }
  async readFirstFound(repoIdOrSlug, candidates, ref = "main") {
    for (const candidate of candidates) {
      const result = await this.readFile(repoIdOrSlug, candidate, ref);
      if (result.found) return result;
    }
    return { path: candidates[0] ?? "", content: "", found: false };
  }
  // ── Write side (Sprint 3 — implementado) ─────────────────────────
  /**
   * Crea un proyecto en GitLab dentro del group del provider.
   * Mapeo de visibility: 'private' → GitLab "private", 'internal' → "internal",
   * 'public' → "public".
   */
  async createRepo(opts) {
    const group = await this.request(`groups/${encodeURIComponent(this.group_or_org)}`);
    if (!group.id) {
      throw new ProviderError(
        `No se pudo resolver el group "${this.group_or_org}" en GitLab.`,
        { provider: "gitlab" }
      );
    }
    const body = {
      name: opts.name,
      path: opts.name,
      namespace_id: group.id,
      description: opts.description ?? "",
      visibility: opts.visibility ?? "private",
      initialize_with_readme: opts.initialize_with_readme ?? true,
      default_branch: opts.default_branch ?? "main"
    };
    const created = await this.request("projects", {}, {
      method: "POST",
      body: JSON.stringify(body)
    });
    return {
      id: created["id"],
      slug: created["path"] ?? opts.name,
      name: created["name"] ?? opts.name,
      description: created["description"] ?? "",
      url: created["http_url_to_repo"] ?? "",
      ssh_url: created["ssh_url_to_repo"] ?? "",
      default_branch: created["default_branch"] ?? body.default_branch,
      last_push: created["last_activity_at"] ?? (/* @__PURE__ */ new Date()).toISOString(),
      language: null,
      size_kb: 0,
      topics: created["topics"] ?? [],
      archived: false,
      ci_config_path: null
    };
  }
  /**
   * Configura branch protection en GitLab.
   * GitLab usa access levels: 40 = Maintainer, 30 = Developer.
   * Sin protección previa: crea. Con protección previa: reemplaza (idempotente).
   */
  async setBranchProtection(repoIdOrSlug, rules) {
    try {
      await this.request(
        `projects/${repoIdOrSlug}/protected_branches/${encodeURIComponent(rules.branch)}`,
        {},
        { method: "DELETE" }
      );
    } catch {
    }
    const allowForce = rules.allow_force_push ?? false;
    const requirePR = rules.require_pull_request ?? true;
    const pushLevel = requirePR ? 40 : 30;
    const mergeLevel = 40;
    await this.request(
      `projects/${repoIdOrSlug}/protected_branches`,
      {},
      {
        method: "POST",
        body: JSON.stringify({
          name: rules.branch,
          push_access_level: pushLevel,
          merge_access_level: mergeLevel,
          allow_force_push: allowForce
        })
      }
    );
  }
  async createPullRequest(_repo, _opts) {
    throw new NotImplementedError("gitlab", "createPullRequest (createMergeRequest)");
  }
  async configureWebhook(_repo, _opts) {
    throw new NotImplementedError("gitlab", "configureWebhook");
  }
};

// src/providers/github.ts
var GitHubProvider = class {
  type = "github";
  base_url;
  group_or_org;
  token;
  constructor(opts) {
    this.base_url = opts.base_url.replace(/\/$/, "");
    this.group_or_org = opts.org;
    this.token = opts.token;
  }
  // ── HTTP helpers ──────────────────────────────────────────────────
  async request(endpoint, params = {}, init) {
    const url = new URL(`${this.base_url}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...init?.headers ?? {}
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `GitHub API ${response.status} en ${endpoint}: ${body.slice(0, 300)}`,
        { provider: "github", status: response.status, body }
      );
    }
    return { json: await response.json(), headers: response.headers };
  }
  // ── validateToken ─────────────────────────────────────────────────
  /**
   * GitHub Classic PAT: la API devuelve scopes en el header `x-oauth-scopes`.
   * Fine-grained PAT: el header viene vacío (los permisos son por-repo),
   * en ese caso reportamos `scopes_present: []` y dejamos que el caller
   * intente la operación — fallará con 403 si no tiene permiso.
   */
  requiredScopesFor(op) {
    switch (op) {
      case "read":
        return ["repo"];
      // o public_repo si público
      case "write":
        return ["repo"];
      case "create_repo":
        return ["repo"];
      case "branch_protection":
        return ["repo"];
      case "webhook":
        return ["admin:repo_hook"];
    }
  }
  async validateToken(opts = {}) {
    let user = null;
    let scopes_present = [];
    let is_admin_of_group = null;
    let message = "";
    try {
      const { json, headers } = await this.request("user");
      const u = json;
      user = u.login ?? null;
      const scopeHeader = headers.get("x-oauth-scopes") ?? "";
      scopes_present = scopeHeader.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      message = scopeHeader === "" ? "Token v\xE1lido (fine-grained PAT \u2014 scopes por-repo)" : "Token v\xE1lido";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        valid: false,
        user: null,
        scopes_present: [],
        scopes_missing: [],
        is_admin_of_group: null,
        message: `Token inv\xE1lido o sin acceso a la API: ${msg}`
      };
    }
    if (user) {
      try {
        const { json } = await this.request(`orgs/${this.group_or_org}/memberships/${user}`);
        const membership = json;
        is_admin_of_group = membership.role === "admin" && membership.state === "active";
      } catch {
      }
    }
    const required = /* @__PURE__ */ new Set();
    for (const op of opts.required_for ?? []) {
      for (const s of this.requiredScopesFor(op)) required.add(s);
    }
    const scopes_missing = scopes_present.length === 0 ? [] : [...required].filter((s) => !scopes_present.includes(s));
    return {
      valid: true,
      user,
      scopes_present,
      scopes_missing,
      is_admin_of_group,
      message
    };
  }
  // ── listGroupRepos ────────────────────────────────────────────────
  async listGroupRepos() {
    const { json } = await this.request(
      `orgs/${this.group_or_org}/repos`,
      { per_page: "100", sort: "pushed", direction: "desc" }
    );
    const repos = json;
    return repos.map((r) => ({
      id: r["id"],
      slug: r["name"] ?? "",
      name: r["full_name"] ?? "",
      description: r["description"] ?? "",
      url: r["clone_url"] ?? "",
      ssh_url: r["ssh_url"] ?? "",
      default_branch: r["default_branch"] ?? "main",
      last_push: r["pushed_at"] ?? "",
      language: r["language"] ?? null,
      size_kb: r["size"] ?? 0,
      topics: r["topics"] ?? [],
      archived: r["archived"] ?? false,
      ci_config_path: null
    }));
  }
  // ── readFile / readFirstFound ─────────────────────────────────────
  async readFile(repoIdOrSlug, filePath, ref = "main") {
    try {
      const { json } = await this.request(
        `repos/${this.group_or_org}/${repoIdOrSlug}/contents/${filePath}`,
        { ref }
      );
      const data = json;
      const content = Buffer.from(data["content"] ?? "", "base64").toString("utf-8");
      return { path: filePath, content, found: true };
    } catch {
      return { path: filePath, content: "", found: false };
    }
  }
  async readFirstFound(repoIdOrSlug, candidates, ref = "main") {
    for (const candidate of candidates) {
      const result = await this.readFile(repoIdOrSlug, candidate, ref);
      if (result.found) return result;
    }
    return { path: candidates[0] ?? "", content: "", found: false };
  }
  // ── Write side (Sprint 3 — implementado) ─────────────────────────
  /**
   * Crea un repo en GitHub dentro del org del provider.
   * Si el provider apunta a un user (no org), usa el endpoint /user/repos.
   */
  async createRepo(opts) {
    let endpoint = `orgs/${this.group_or_org}/repos`;
    try {
      await this.request(`orgs/${this.group_or_org}`);
    } catch {
      endpoint = "user/repos";
    }
    const body = {
      name: opts.name,
      description: opts.description ?? "",
      private: (opts.visibility ?? "private") !== "public",
      auto_init: opts.initialize_with_readme ?? true,
      ...opts.default_branch ? { default_branch: opts.default_branch } : {}
    };
    const { json } = await this.request(endpoint, {}, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const created = json;
    return {
      id: created["id"],
      slug: created["name"] ?? opts.name,
      name: created["full_name"] ?? opts.name,
      description: created["description"] ?? "",
      url: created["clone_url"] ?? "",
      ssh_url: created["ssh_url"] ?? "",
      default_branch: created["default_branch"] ?? opts.default_branch ?? "main",
      last_push: created["pushed_at"] ?? (/* @__PURE__ */ new Date()).toISOString(),
      language: null,
      size_kb: 0,
      topics: created["topics"] ?? [],
      archived: false,
      ci_config_path: null
    };
  }
  /**
   * Configura branch protection en GitHub via PUT /repos/<owner>/<repo>/branches/<b>/protection.
   * Idempotente: PUT reemplaza la config existente.
   */
  async setBranchProtection(repoIdOrSlug, rules) {
    const requirePR = rules.require_pull_request ?? true;
    const requiredApprovals = rules.required_approvals ?? 1;
    const allowForce = rules.allow_force_push ?? false;
    const body = {
      required_status_checks: null,
      enforce_admins: false,
      required_pull_request_reviews: requirePR ? { required_approving_review_count: requiredApprovals } : null,
      restrictions: null,
      allow_force_pushes: allowForce,
      allow_deletions: false
    };
    await this.request(
      `repos/${this.group_or_org}/${repoIdOrSlug}/branches/${encodeURIComponent(rules.branch)}/protection`,
      {},
      { method: "PUT", body: JSON.stringify(body) }
    );
  }
  async createPullRequest(_repo, _opts) {
    throw new NotImplementedError("github", "createPullRequest");
  }
  async configureWebhook(_repo, _opts) {
    throw new NotImplementedError("github", "configureWebhook");
  }
};

// src/providers/factory.ts
function createProvider(creds, overrides = {}) {
  const type = overrides.type ?? inferProviderType(creds.git_host, creds.git_base_url);
  const base_url = overrides.base_url ?? defaultBaseUrlFor(type, creds.git_base_url);
  const group_or_org = overrides.group_or_org ?? creds.git_group;
  switch (type) {
    case "gitlab":
      return new GitLabProvider({
        base_url,
        group: group_or_org,
        token: creds.git_token
      });
    case "github":
      return new GitHubProvider({
        base_url,
        org: group_or_org,
        token: creds.git_token
      });
  }
}
function inferProviderType(host, baseUrl) {
  if (host === "github") return "github";
  if (host === "gitlab") return "gitlab";
  if (/github/i.test(baseUrl)) return "github";
  return "gitlab";
}
function defaultBaseUrlFor(type, raw) {
  if (type === "gitlab") return raw;
  if (/^https?:\/\/(www\.)?github\.com\/?$/i.test(raw)) {
    return "https://api.github.com";
  }
  if (/\/api\/v\d/.test(raw)) return raw;
  if (/github/i.test(raw)) return `${raw.replace(/\/$/, "")}/api/v3`;
  return raw;
}

// src/index.ts
function readPkgVersion() {
  try {
    const here = path11.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path11.resolve(here, "../package.json"),
      path11.resolve(here, "../../package.json"),
      path11.resolve(here, "../../../package.json")
    ];
    for (const c3 of candidates) {
      try {
        const pkg = JSON.parse(readFileSync10(c3, "utf-8"));
        if (typeof pkg.version === "string") return pkg.version;
      } catch {
      }
    }
  } catch {
  }
  return "0.0.0-unknown";
}
var CLI_VERSION = readPkgVersion();

// src/commands/init.ts
import { existsSync as existsSync12, readFileSync as readFileSync11, writeFileSync as writeFileSync9, mkdirSync as mkdirSync9, readdirSync as readdirSync2, statSync as statSync3, copyFileSync, rmSync } from "fs";
import * as path12 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/utils/output.ts
import chalk from "chalk";
var isTTY = process.stdout.isTTY;
var ok = (text) => isTTY ? chalk.green(text) : text;
var warn = (text) => isTTY ? chalk.yellow(text) : text;
var err = (text) => isTTY ? chalk.red(text) : text;
var info = (text) => isTTY ? chalk.cyan(text) : text;
var dim = (text) => isTTY ? chalk.gray(text) : text;
var bold = (text) => isTTY ? chalk.bold(text) : text;
function printOk(message) {
  console.log(`${ok("\u2713")} ${message}`);
}
function printWarn(message) {
  console.log(`${warn("\u26A0")} ${message}`);
}
function printErr(message) {
  console.error(`${err("\u2717")} ${message}`);
}
function printInfo(message) {
  console.log(`${info("\u2192")} ${message}`);
}
function printDim(message) {
  console.log(dim(message));
}
function devTypeBadge(devType) {
  if (!devType) return dim("\u2B22 sin tipo");
  const colors = {
    "greenfield": (s) => isTTY ? chalk.green(s) : s,
    "brownfield-feature": (s) => isTTY ? chalk.cyan(s) : s,
    "brownfield-refactor": (s) => isTTY ? chalk.hex("#ffa657")(s) : s,
    "modernizacion": (s) => isTTY ? chalk.magenta(s) : s,
    "integracion-externa": (s) => isTTY ? chalk.hex("#3fd5e0")(s) : s
  };
  const colorFn = colors[devType] ?? ((s) => s);
  return colorFn(`\u2B22 ${devType}`);
}

// src/commands/init.ts
var META_FILES = /* @__PURE__ */ new Set([
  "AUDIT.md",
  "CUSTOMIZATION.md",
  "ENFORCEMENT.md",
  "DISENO_INIT_CONTEXT.md"
]);
function resolveSkillsSourceDir() {
  const here = path12.dirname(fileURLToPath2(import.meta.url));
  const bundled = path12.resolve(here, "..", "..", "skills");
  if (existsSync12(bundled)) return bundled;
  const monorepo = path12.resolve(here, "..", "..", "..", "skills");
  if (existsSync12(monorepo)) return monorepo;
  return null;
}
function copySkillsTree(srcDir, destDir) {
  if (!existsSync12(destDir)) mkdirSync9(destDir, { recursive: true });
  const copied = [];
  const entries = readdirSync2(srcDir);
  for (const entry of entries) {
    const srcPath = path12.join(srcDir, entry);
    const destPath = path12.join(destDir, entry);
    const st = statSync3(srcPath);
    if (st.isDirectory()) {
      copied.push(...copySkillsTree(srcPath, destPath));
    } else if (st.isFile() && entry.endsWith(".md") && !META_FILES.has(entry)) {
      copyFileSync(srcPath, destPath);
      copied.push(path12.relative(destDir, destPath));
    }
  }
  return copied;
}
function writeSkillsVersion() {
  const skillsDir = getClaudeSkillsDir();
  writeFileSync9(path12.join(skillsDir, ".version"), `${CLI_VERSION}
`, "utf-8");
}
function buildSettingsJson(existing = {}) {
  const settings = { ...existing };
  const hooks = settings.hooks ?? {};
  const heartbeatHook = {
    type: "command",
    command: "dd-cli heartbeat --silent 2>/dev/null || true"
  };
  const stopHook = {
    type: "command",
    command: "dd-cli heartbeat --silent --on-stop 2>/dev/null || true"
  };
  const postToolUse = hooks.PostToolUse ?? [];
  const alreadyHas = postToolUse.some((entry) => {
    const list = entry.hooks ?? [];
    return list.some((h) => typeof h.command === "string" && h.command.includes("dd-cli heartbeat"));
  });
  if (!alreadyHas) {
    postToolUse.push({
      matcher: "Write|Edit|Bash",
      hooks: [heartbeatHook]
    });
  }
  hooks.PostToolUse = postToolUse;
  const stop = hooks.Stop ?? [];
  const stopAlready = stop.some((entry) => {
    const list = entry.hooks ?? [];
    return list.some((h) => typeof h.command === "string" && h.command.includes("--on-stop"));
  });
  if (!stopAlready) {
    stop.push({ hooks: [stopHook] });
  }
  hooks.Stop = stop;
  settings.hooks = hooks;
  return settings;
}
async function runInit(opts = {}) {
  const projectRoot = getProjectRoot();
  const claudeMdPath = path12.join(projectRoot, "CLAUDE.md");
  if (!existsSync12(claudeMdPath) || opts.force) {
    const here = path12.dirname(fileURLToPath2(import.meta.url));
    const templatePath = path12.resolve(here, "..", "..", "templates", "CLAUDE.md.template");
    if (existsSync12(templatePath)) {
      const projectName = path12.basename(projectRoot);
      let content = readFileSync11(templatePath, "utf-8");
      content = content.replaceAll("{{PROJECT_NAME}}", projectName);
      content = content.replaceAll("{{STACK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{INFRA}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{BACKEND_FRAMEWORK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{FRONTEND_FRAMEWORK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{DB}}", "Completar en CLAUDE.md");
      writeFileSync9(claudeMdPath, content, "utf-8");
    }
  }
  console.log(bold(`
DevFlow IA \u2014 init`));
  printDim(`  Proyecto: ${projectRoot}
`);
  if (!isClaudeCodeInstalled()) {
    printErr(`Claude Code no detectado en ${getClaudeHome()}`);
    printInfo(`Instal\xE1 Claude Code primero: https://claude.com/claude-code`);
    return 2;
  }
  printOk(`Detectado Claude Code en ${getClaudeHome()}`);
  const devflowDir = getDevflowDir(projectRoot);
  const sessionPath = getSessionPath(projectRoot);
  const sessionExists = existsSync12(sessionPath);
  if (sessionExists && !opts.force) {
    printWarn(`.devflow/session.json ya existe \u2014 usa --force para sobrescribir`);
  } else {
    if (sessionExists && opts.force) {
      rmSync(sessionPath);
    }
    const initial = createInitialSession(CLI_VERSION);
    saveSession(projectRoot, initial);
    printOk(`Creado .devflow/ con session.json inicial (schema_version: ${initial.schema_version})`);
  }
  if (!opts.skipSkills) {
    const srcDir = resolveSkillsSourceDir();
    if (!srcDir) {
      printWarn(`No se encontraron skills bundleadas; saltando instalaci\xF3n de skills`);
      printDim(`  Esperado en <package>/skills/ o <monorepo>/skills/`);
    } else {
      const destDir = getClaudeSkillsDir();
      const copied = copySkillsTree(srcDir, destDir);
      writeSkillsVersion();
      printOk(`Skills instaladas en ${destDir}`);
      printDim(`  ${copied.length} skills (v${CLI_VERSION})`);
    }
  } else {
    printDim(`  (skip skills)`);
  }
  if (!opts.skipHooks) {
    const projectClaudeDir = getProjectClaudeDir(projectRoot);
    if (!existsSync12(projectClaudeDir)) {
      mkdirSync9(projectClaudeDir, { recursive: true });
    }
    const settingsPath = getProjectClaudeSettingsPath(projectRoot);
    let existing = {};
    if (existsSync12(settingsPath)) {
      try {
        existing = JSON.parse(readFileSync11(settingsPath, "utf-8"));
      } catch {
        if (!opts.force) {
          printErr(`.claude/settings.json existe pero no es JSON v\xE1lido \u2014 usa --force para sobrescribir`);
          return 2;
        }
      }
    }
    const merged = buildSettingsJson(existing);
    writeFileSync9(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    printOk(`Hooks configurados en .claude/settings.json`);
  } else {
    printDim(`  (skip hooks)`);
  }
  if (existsSync12(path12.join(projectRoot, "CLAUDE.md"))) {
    printOk(`CLAUDE.md generado con auto-onboarding`);
    printDim(`  Edita las variables {{...}} con los datos del proyecto`);
  }
  console.log(`
${bold("Listo.")} Abre Claude Code en este directorio.`);
  printDim(`
Pr\xF3ximo paso: dd-cli start-session <feature-id>`);
  printDim(`Tip: para ver la statusline en Claude Code \u2192 ejecuta una sola vez: dd-cli install`);
  return 0;
}

// src/commands/status.ts
function statusOutput({ projectRoot, session }) {
  const lines = [];
  if (!session.started_at) {
    lines.push("Sin sesi\xF3n activa.");
    lines.push("Para empezar: dd-cli start-session <feature-id>");
    return { lines, exitCode: 1 };
  }
  const actualFlowState = detectFlowState({ projectRoot, session });
  lines.push("Estado de sesi\xF3n");
  lines.push(`  Feature:    ${session.feature_id ?? "?"} \xB7 ${session.feature_name ?? ""}`);
  if (session.dev_type) {
    const lockTag = session.dev_type_locked ? `locked desde ${session.dev_type_locked_at}, fuente: ${session.dev_type_source}` : `sin lock, fuente: ${session.dev_type_source}`;
    lines.push(`  Tipo:       \u2B22 ${session.dev_type}  (${lockTag})`);
  } else {
    lines.push("  Tipo:       \u26A0 no definido");
  }
  lines.push(`  Estado:     ${actualFlowState}`);
  if (session.active_change) {
    const total = session.tasks.length;
    const done = session.tasks.filter((t) => t.status === "done").length;
    lines.push(`  Change:     ${session.active_change} (${done}/${total} tasks)`);
  }
  lines.push(`  Modo:       ${session.mode === "platform" ? "\u25CF platform" : "local"}`);
  if (session.apps_affected.length > 0) {
    lines.push(`  Apps:       ${session.apps_affected.join(", ")}`);
  }
  const results = evaluateRules({ projectRoot, session });
  const { blockers, warnings } = partition(results);
  if (blockers.length > 0 || warnings.length > 0) {
    lines.push("");
    lines.push("\u26A0 Anomal\xEDas detectadas:");
    for (const b of blockers) {
      lines.push(`  \u2192 ${b.message}`);
    }
    for (const w of warnings) {
      lines.push(`  \u2192 ${w.message}`);
    }
  }
  lines.push("");
  lines.push(`Siguiente paso esperado: ${suggestedNextStep(actualFlowState, session.dev_type)}`);
  const exitCode = blockers.length > 0 ? 2 : 0;
  return { lines, exitCode };
}

// src/flow-state/flow-stages.ts
function stagesForDevType(devType) {
  switch (devType) {
    case "greenfield":
      return [
        stage(1, "start-session", "Iniciar sesi\xF3n", "Registra la HDU que vas a trabajar y arranca el flujo.", "dd-cli start-session <HDU-id>", "terminal"),
        stage(2, "/new-spec", "Generar SPEC maestra", "Claude entrevista al dev y produce el documento t\xE9cnico de la feature.", "/new-spec", "claude"),
        stage(3, "/new-app", "Scaffolding inicial", "Crea el esqueleto de la app nueva desde los templates del cliente.", "/new-app", "claude"),
        stage(4, "/derive-spec", "Derivar spec por app", "Si la feature toca varias apps, divide el SPEC para cada una.", "/derive-spec", "claude"),
        stage(5, "/opsx:propose", "Proponer cambio", "Claude dise\xF1a la implementaci\xF3n (proposal + design + tasks).", "/opsx:propose <change-name>", "claude"),
        stage(6, "/opsx:apply", "Implementar", "Claude programa task por task siguiendo el plan aprobado.", "/opsx:apply", "claude"),
        stage(7, "/release-check", "Revisi\xF3n pre-merge", "Verifica que el c\xF3digo cumple el SPEC antes de abrir el MR.", "/release-check", "claude"),
        stage(8, "/end-session", "Cerrar sesi\xF3n", "Commit + push + resumen. Cierra el ciclo y notifica al equipo.", "/end-session", "claude")
      ];
    case "brownfield-feature":
      return [
        stage(1, "start-session", "Iniciar sesi\xF3n", "Registra la HDU que vas a trabajar y arranca el flujo.", "dd-cli start-session <HDU-id>", "terminal"),
        stage(2, "/init-repo-context", "Mapear el repo", "Claude analiza el c\xF3digo existente y crea un resumen estructurado.", "/init-repo-context", "claude"),
        stage(3, "/new-spec", "Generar SPEC maestra", "Con el repo ya entendido, Claude redacta el SPEC sin re-preguntar lo conocido.", "/new-spec", "claude"),
        stage(4, "/derive-spec", "Derivar spec por app", "Si la feature toca varias apps, divide el SPEC para cada una.", "/derive-spec", "claude"),
        stage(5, "/opsx:propose", "Proponer cambio", "Claude dise\xF1a la implementaci\xF3n (proposal + design + tasks).", "/opsx:propose <change-name>", "claude"),
        stage(6, "/opsx:apply", "Implementar", "Claude programa task por task siguiendo el plan aprobado.", "/opsx:apply", "claude"),
        stage(7, "/release-check", "Revisi\xF3n pre-merge", "Verifica que el c\xF3digo cumple el SPEC antes de abrir el MR.", "/release-check", "claude"),
        stage(8, "/end-session", "Cerrar sesi\xF3n", "Commit + push + resumen. Cierra el ciclo y notifica al equipo.", "/end-session", "claude")
      ];
    case "brownfield-refactor":
      return [
        stage(1, "start-session", "Iniciar sesi\xF3n", "Registra la HDU de refactor que vas a trabajar.", "dd-cli start-session <HDU-id>", "terminal"),
        stage(2, "/init-repo-context", "Mapear el repo", "Claude analiza el c\xF3digo existente y crea un resumen estructurado.", "/init-repo-context", "claude"),
        stage(3, "/map-service", "Diagrama del m\xF3dulo", "Mermaid de la arquitectura interna del m\xF3dulo a refactorizar.", "/map-service <modulo>", "claude"),
        stage(4, "/capture-baseline", "Capturar baseline", "Snapshot de tests, m\xE9tricas y contratos p\xFAblicos antes de tocar nada.", "/capture-baseline <modulo>", "claude"),
        stage(5, "/new-spec", "Generar SPEC del refactor", "Con baseline en mano, Claude redacta el plan de no-regresi\xF3n.", "/new-spec", "claude"),
        stage(6, "/opsx:propose", "Proponer refactor", 'Dise\xF1o con secci\xF3n obligatoria "no functional change".', "/opsx:propose <change-name>", "claude"),
        stage(7, "/opsx:apply", "Implementar refactor", "Cambios task por task con re-ejecuci\xF3n de golden tests.", "/opsx:apply", "claude"),
        stage(8, "/release-check", "Validar contratos", "Diff de API p\xFAblica contra baseline + golden tests pasan.", "/release-check", "claude"),
        stage(9, "/end-session", "Cerrar sesi\xF3n", "Commit + push + resumen del refactor.", "/end-session", "claude")
      ];
    case "modernizacion":
      return [
        stage(1, "start-session", "Iniciar sesi\xF3n", "Registra la HDU de modernizaci\xF3n del sistema legacy.", "dd-cli start-session <HDU-id>", "terminal"),
        stage(2, "/init-repo-context", "Mapear el legacy", "Claude analiza el sistema legacy (--on=<legacy-path> si est\xE1 aparte).", "/init-repo-context --on=<legacy-path>", "claude"),
        stage(3, "/trace-flow", "Trazar flujos cross-service", "Diagrama de comunicaci\xF3n del legacy + drawio editable.", "/trace-flow --scope=<dominio>", "claude"),
        stage(4, "/map-service", "Diagrama por servicio", "Diagrama interno de cada servicio del legacy a reemplazar.", "/map-service <servicio>", "claude"),
        stage(5, "/new-spec", "Generar SPEC de modernizaci\xF3n", "Matriz de paridad + plan rollback + rampa de tr\xE1fico.", "/new-spec", "claude"),
        stage(6, "/derive-spec", "Derivar por app target", "Spec espec\xEDfico para cada app que reemplaza al legacy.", "/derive-spec", "claude"),
        stage(7, "/opsx:propose", "Proponer modernizaci\xF3n", "Dise\xF1o con cohabitaci\xF3n legacy/nuevo durante rampa.", "/opsx:propose <change-name>", "claude"),
        stage(8, "/opsx:apply", "Implementar", "Cambios task por task; el legacy sigue corriendo en paralelo.", "/opsx:apply", "claude"),
        stage(9, "/release-check", "Validar paridad", "Shadow testing + feature flag de rampa configurado.", "/release-check", "claude")
      ];
    case "integracion-externa":
      return [
        stage(1, "start-session", "Iniciar sesi\xF3n", "Registra la HDU de integraci\xF3n con vendor externo.", "dd-cli start-session <HDU-id>", "terminal"),
        stage(2, "/init-repo-context", "Mapear el repo", "Solo si la integraci\xF3n vive sobre app existente. Salteable si es greenfield.", "/init-repo-context", "claude"),
        stage(3, "/new-spec", "Generar SPEC de integraci\xF3n", "Vendor + auth + rate limits + idempotencia + webhooks + sandbox.", "/new-spec", "claude"),
        stage(4, "/derive-spec", "Derivar adaptador", "Spec del adaptador anti-corrupci\xF3n en la app destino.", "/derive-spec", "claude"),
        stage(5, "/opsx:propose", "Proponer integraci\xF3n", "Dise\xF1o con port-adapter / anti-corruption layer.", "/opsx:propose <change-name>", "claude"),
        stage(6, "/opsx:apply", "Implementar", "Cambios task por task con retries + idempotencia + manejo de errores.", "/opsx:apply", "claude"),
        stage(7, "/release-check", "Validar seguridad", "Credenciales NO en c\xF3digo + firma webhooks + idempotencia OK.", "/release-check", "claude"),
        stage(8, "/end-session", "Cerrar sesi\xF3n", "Commit + push + resumen de la integraci\xF3n.", "/end-session", "claude")
      ];
  }
}
function stage(index, id, label, rationale, command, invokeIn) {
  return { index, id, label, rationale, command, invokeIn };
}
function currentStageIndex(devType, flowState) {
  const stages = stagesForDevType(devType);
  const total = stages.length;
  if (flowState === "not_started") return null;
  if (flowState === "ended") return total;
  switch (devType) {
    case "greenfield":
      if (flowState === "started") return 2;
      if (flowState === "spec_ready") return 3;
      if (flowState === "change_active") return 6;
      break;
    case "brownfield-feature":
      if (flowState === "started") return 2;
      if (flowState === "repo_mapped") return 3;
      if (flowState === "spec_ready") return 4;
      if (flowState === "change_active") return 6;
      break;
    case "brownfield-refactor":
      if (flowState === "started") return 2;
      if (flowState === "repo_mapped") return 3;
      if (flowState === "baseline_ready") return 5;
      if (flowState === "spec_ready") return 6;
      if (flowState === "change_active") return 7;
      break;
    case "modernizacion":
      if (flowState === "started") return 2;
      if (flowState === "repo_mapped") return 3;
      if (flowState === "spec_ready") return 6;
      if (flowState === "change_active") return 8;
      break;
    case "integracion-externa":
      if (flowState === "started") return 2;
      if (flowState === "repo_mapped") return 3;
      if (flowState === "spec_ready") return 4;
      if (flowState === "change_active") return 6;
      break;
  }
  return null;
}
function getStageContext(session, flowState) {
  if (!session.dev_type) return null;
  const stages = stagesForDevType(session.dev_type);
  const total = stages.length;
  const currentIndex = currentStageIndex(session.dev_type, flowState);
  let currentStage = null;
  let nextStage = null;
  if (currentIndex !== null) {
    currentStage = stages[currentIndex - 1] ?? null;
    nextStage = stages[currentIndex] ?? null;
  }
  return { total, currentIndex, currentStage, nextStage, stages };
}
function stageStatus(stageIndex, currentIndex, flowState) {
  if (flowState === "ended") {
    return "done";
  }
  if (currentIndex === null) return "pending";
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) return "current";
  return "pending";
}

// src/commands/status-narrative.ts
import { existsSync as existsSync13, readFileSync as readFileSync12, writeFileSync as writeFileSync10 } from "fs";
import * as path13 from "path";
var isTTY2 = process.stdout.isTTY;
var c = {
  green: (s) => isTTY2 ? `\x1B[32m${s}\x1B[0m` : s,
  cyan: (s) => isTTY2 ? `\x1B[36m${s}\x1B[0m` : s,
  dim: (s) => isTTY2 ? `\x1B[90m${s}\x1B[0m` : s,
  bold: (s) => isTTY2 ? `\x1B[1m${s}\x1B[0m` : s,
  yellow: (s) => isTTY2 ? `\x1B[33m${s}\x1B[0m` : s,
  orange: (s) => isTTY2 ? `\x1B[38;5;208m${s}\x1B[0m` : s,
  magenta: (s) => isTTY2 ? `\x1B[35m${s}\x1B[0m` : s,
  teal: (s) => isTTY2 ? `\x1B[38;5;43m${s}\x1B[0m` : s
};
function devTypeBadgeColored(devType) {
  const map = {
    "greenfield": c.green,
    "brownfield-feature": c.cyan,
    "brownfield-refactor": c.orange,
    "modernizacion": c.magenta,
    "integracion-externa": c.teal
  };
  const fn = map[devType] ?? c.dim;
  return fn(`\u2B22 ${devType}`);
}
function formatDuration(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "?";
  const totalMin = Math.floor(ms / 6e4);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function stageIcon(status) {
  if (status === "done") return isTTY2 ? "\x1B[32m\u2705\x1B[0m" : "\u2705";
  if (status === "current") return isTTY2 ? "\x1B[36m\u{1F535}\x1B[0m" : "\u25B6";
  return isTTY2 ? "\x1B[90m\u26AA\x1B[0m" : "\u25CB";
}
var HUMAN_BLOCKERS = {
  REQUIRE_REPO_CONTEXT_MD: {
    title: "Falta un paso antes de continuar",
    steps: [
      "Abre Claude Code en este repo",
      "Tipea: /init-repo-context",
      "Claude va a analizar el repo y crear un resumen",
      "Despu\xE9s puedes ejecutar /new-spec sin problema"
    ],
    why: "Sin entender el c\xF3digo existente, Claude podr\xEDa proponer soluciones que rompen lo que ya funciona.",
    command: "/init-repo-context"
  },
  REQUIRE_BASELINE_MD: {
    title: "Falta capturar el estado inicial del c\xF3digo",
    steps: [
      "Abre Claude Code en este repo",
      "Tipea: /capture-baseline <modulo> (ej: /capture-baseline cobranza)",
      "Claude va a guardar los tests, m\xE9tricas y contratos actuales",
      "Esto protege que el refactor no rompa nada funcionando"
    ],
    why: "Sin un baseline, no puedes demostrar que el refactor no rompi\xF3 nada. Es el contrato de no-regresi\xF3n.",
    command: "/capture-baseline <modulo>"
  },
  REQUIRE_LEGACY_SYSTEM_FIELD: {
    title: "La HDU de modernizaci\xF3n necesita el nombre del sistema legacy",
    steps: [
      "Vuelve al portal de DevFlow IA (portal negocio o backlog)",
      'Edita la HDU y completa el campo "Sistema legacy"',
      "Guarda y vuelve ac\xE1"
    ],
    why: "Sin saber qu\xE9 sistema reemplaz\xE1s, Claude no puede armar la matriz de paridad funcional.",
    command: "(completar en la APP)"
  },
  REQUIRE_VENDOR_FIELD: {
    title: "La HDU de integraci\xF3n necesita el nombre del vendor",
    steps: [
      "Vuelve al portal de DevFlow IA",
      'Edita la HDU y completa "Vendor", "API version" y la URL de documentaci\xF3n',
      "Guarda y vuelve ac\xE1"
    ],
    why: "Sin saber el vendor, Claude no puede hacer las preguntas correctas sobre rate limits, idempotencia y autenticaci\xF3n.",
    command: "(completar en la APP)"
  }
};
function renderBlocker(blocker) {
  const human = HUMAN_BLOCKERS[blocker.rule_id];
  const lines = [];
  lines.push(`
${isTTY2 ? "\x1B[31m\u{1F6D1}\x1B[0m" : "\u{1F6D1}"}  ${c.bold(human?.title ?? "Precondici\xF3n pendiente")}
`);
  if (human) {
    human.steps.forEach((step, i) => {
      lines.push(`    ${c.dim(`${i + 1}.`)} ${step}`);
    });
    lines.push("");
    lines.push(`    ${c.dim("\u{1F4AC} \xBFPor qu\xE9?")} ${c.dim(human.why)}`);
  } else {
    lines.push(`    ${blocker.message}`);
  }
  return lines;
}
function runStatusNarrative(opts = {}) {
  const projectRoot = getProjectRoot();
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (!session || !session.started_at) {
    if (opts.quiet) return 1;
    if (opts.json) {
      console.log(JSON.stringify({ status: "no_session" }));
      return 1;
    }
    console.log(`Sin sesi\xF3n activa.
Para empezar: dd-cli start-session <feature-id>`);
    return 1;
  }
  if (opts.raw || opts.json) {
    const flowState2 = detectFlowState({ projectRoot, session });
    const results2 = evaluateRules({ projectRoot, session });
    const data = { session, flow_state: flowState2, enforcement: results2 };
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
    return 0;
  }
  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  const lastTransition = popLastTransition(projectRoot);
  if (lastTransition) {
    const match = lastTransition.match(/flow_state: (\S+) → (\S+)/);
    if (match) {
      const [, from, to] = match;
      const stepMsg = ctx ? `Pasaste al paso ${ctx.currentIndex ?? "?"}/${ctx.total}` : "Progresaste";
      console.log(`
\u{1F389}  ${c.bold(`\xA1${stepMsg}!`)}  ${c.dim(`${from} \u2192 ${to}`)}
`);
    }
  }
  const featureLabel = `${session.feature_id ?? "?"} \xB7 ${session.feature_name ?? ""}`;
  const boxWidth = Math.max(featureLabel.length + 12, 46);
  const title = `Tu viaje en ${featureLabel}`;
  const hrLine = "\u2500".repeat(boxWidth);
  console.log("");
  console.log(`\u256D${hrLine}\u256E`);
  console.log(`\u2502  ${c.bold(title)}${" ".repeat(Math.max(0, boxWidth - title.length - 2))}\u2502`);
  console.log(`\u2502  ${c.dim(devTypeBadgeColored(session.dev_type ?? "?"))}${" ".repeat(Math.max(0, boxWidth - (session.dev_type?.length ?? 1) - 4))}\u2502`);
  console.log(`\u255E${hrLine}\u2561`);
  if (ctx) {
    ctx.stages.forEach((stage2) => {
      const sStatus = stageStatus(stage2.index, ctx.currentIndex, flowState);
      const icon = stageIcon(sStatus);
      const isCurrentFlag = sStatus === "current" ? c.dim("  \u2190 est\xE1s ac\xE1") : "";
      const label = sStatus === "current" ? c.bold(stage2.id) : sStatus === "done" ? c.dim(stage2.id) : stage2.id;
      const line = `\u2502  ${icon}  ${label}${isCurrentFlag}`;
      const paddedLine = line + " ".repeat(Math.max(0, boxWidth - stripAnsi(line).length + 2)) + "\u2502";
      console.log(paddedLine);
    });
  } else {
    console.log(`\u2502  ${c.dim("(sin tipo definido \u2014 ejecuta dd-cli start-session)")}  \u2502`);
  }
  console.log(`\u255E${hrLine}\u2561`);
  const duration = session.started_at ? `Llevas ${formatDuration(session.started_at)} en esta sesi\xF3n` : "";
  const dLine = `\u2502  \u23F1  ${c.dim(duration)}`;
  console.log(dLine + " ".repeat(Math.max(0, boxWidth - stripAnsi(dLine).length + 2)) + "\u2502");
  console.log(`\u2570${hrLine}\u256F`);
  const results = evaluateRules({ projectRoot, session });
  const { blockers, warnings } = partition(results);
  for (const b of blockers) {
    renderBlocker(b).forEach((line) => console.log(line));
  }
  for (const w of warnings) {
    console.log(`
${c.yellow("\u26A0")}  ${w.message}`);
  }
  if (blockers.length === 0 && ctx?.currentStage) {
    const stage2 = ctx.currentStage;
    console.log("");
    console.log(`\u{1F4A1}  ${c.bold(`Tu siguiente paso es: ${stage2.id}`)}`);
    console.log("");
    console.log(`    ${c.dim(stage2.rationale)}`);
    console.log("");
    if (stage2.invokeIn === "claude") {
      console.log(`    En Claude Code, tipea:`);
      console.log(`        ${c.cyan(stage2.command)}`);
    } else {
      console.log(`    En tu terminal, ejecuta:`);
      console.log(`        ${c.cyan(stage2.command)}`);
    }
  }
  console.log("");
  return blockers.length > 0 ? 2 : 0;
}
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function popLastTransition(projectRoot) {
  const logPath = path13.join(getDevflowDir(projectRoot), "transitions.log");
  const ackPath = path13.join(getDevflowDir(projectRoot), "transitions.ack");
  if (!existsSync13(logPath)) return null;
  const lines = readFileSync12(logPath, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  const lastAck = existsSync13(ackPath) ? readFileSync12(ackPath, "utf-8").trim() : "";
  if (lastAck === lastLine) return null;
  writeFileSync10(ackPath, lastLine, "utf-8");
  return lastLine;
}

// src/commands/status-cmd.ts
function runStatus(opts = {}) {
  if (opts.quiet || opts.json || opts.raw) {
    const projectRoot = getProjectRoot();
    let session;
    try {
      session = loadSession(projectRoot);
    } catch (e) {
      if (e instanceof SessionIOError) {
        if (!opts.quiet) printErr(e.message);
        return 2;
      }
      throw e;
    }
    if (!session) {
      if (opts.quiet) return 1;
      if (opts.json) {
        console.log(JSON.stringify({ status: "no_session" }));
        return 1;
      }
      console.log("Sin sesi\xF3n activa.\nPara empezar: dd-cli start-session <feature-id>");
      return 1;
    }
    if (opts.json) {
      const result2 = statusOutput({ projectRoot, session });
      console.log(JSON.stringify({ session, status_lines: result2.lines, exit_code: result2.exitCode }));
      return result2.exitCode;
    }
    if (opts.quiet) {
      return statusOutput({ projectRoot, session }).exitCode;
    }
    const result = statusOutput({ projectRoot, session });
    for (const line of result.lines) console.log(line);
    return result.exitCode;
  }
  return runStatusNarrative();
}

// src/commands/end-session.ts
function formatDuration2(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "?";
  const ms = end - start;
  const hours = Math.floor(ms / 36e5);
  const minutes = Math.floor(ms % 36e5 / 6e4);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
async function runEndSession(opts = {}) {
  const projectRoot = getProjectRoot();
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (!session) {
    printWarn("No hay sesi\xF3n activa para cerrar.");
    return 1;
  }
  if (!session.started_at) {
    printWarn("La sesi\xF3n existe pero nunca fue iniciada (started_at vac\xEDo).");
    return 1;
  }
  if (session.ended_at) {
    printWarn(`La sesi\xF3n ya estaba cerrada (ended_at: ${session.ended_at})`);
    return 1;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = {
    ...session,
    ended_at: now,
    flow_state: "ended",
    unclosed: false,
    last_heartbeat: now
  };
  saveSession(projectRoot, updated);
  console.log(bold(`
Sesi\xF3n cerrada
`));
  printOk(`Feature: ${updated.feature_id ?? "?"} \xB7 ${updated.feature_name ?? ""}`);
  printOk(`Duraci\xF3n: ${formatDuration2(updated.started_at, now)}`);
  const total = updated.tasks.length;
  const done = updated.tasks.filter((t) => t.status === "done").length;
  if (total > 0) {
    printOk(`Tasks: ${done}/${total} completadas`);
  }
  if (updated.blockers.length > 0) {
    printWarn(`${updated.blockers.length} blocker(s) activos sin resolver`);
  }
  if (opts.noCommit === false || opts.message) {
    printDim(`
(commit/push delegado a la skill /end-session de Claude Code)`);
  }
  return 0;
}

// src/types/credentials.ts
import { z as z9 } from "zod";
import { existsSync as existsSync14, readFileSync as readFileSync13, writeFileSync as writeFileSync11, chmodSync } from "fs";
import * as path14 from "path";
import * as yaml7 from "js-yaml";
var GitHostSchema = z9.enum(["gitlab", "github", "bitbucket", "azure"]);
var ClientCredentialsSchema = z9.object({
  git_token: z9.string().min(1),
  git_host: GitHostSchema.default("gitlab"),
  git_base_url: z9.string().url().default("https://gitlab.com"),
  git_group: z9.string().min(1)
  // grupo/org a escanear
});
var CredentialsFileSchema = z9.object({
  clients: z9.record(z9.string(), ClientCredentialsSchema).default({})
});
function getCredentialsPath() {
  return path14.join(getDevflowGlobalDir(), "credentials.yml");
}
function loadCredentials() {
  const p = getCredentialsPath();
  if (!existsSync14(p)) return { clients: {} };
  const raw = readFileSync13(p, "utf-8");
  const parsed = yaml7.load(raw);
  const result = CredentialsFileSchema.safeParse(parsed ?? {});
  if (!result.success) throw new Error(`credentials.yml inv\xE1lido:
${result.error.message}`);
  return result.data;
}
function saveCredentials(creds) {
  const p = getCredentialsPath();
  const validated = CredentialsFileSchema.parse(creds);
  const yamlStr = yaml7.dump(validated, { indent: 2 });
  writeFileSync11(p, yamlStr, { encoding: "utf-8", mode: 384 });
  try {
    chmodSync(p, 384);
  } catch {
  }
}
function getClientCredentials(slug) {
  return loadCredentials().clients[slug] ?? null;
}
function setClientCredentials(slug, creds) {
  const all = loadCredentials();
  all.clients[slug] = ClientCredentialsSchema.parse(creds);
  saveCredentials(all);
}

// src/commands/statusline.ts
function formatDuration3(startedAt) {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  if (Number.isNaN(start) || now < start) return "?";
  const ms = now - start;
  const totalMin = Math.floor(ms / 6e4);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
function clientStatusSummary() {
  try {
    const registry = loadRegistry();
    const creds = loadCredentials();
    const slugs = Object.keys(registry.clients);
    if (slugs.length === 0) {
      return `DevFlow IA \xB7 v${CLI_VERSION} \xB7 sin cliente \xB7 dd-cli register-client`;
    }
    if (slugs.length === 1) {
      const slug = slugs[0];
      const hasCreds = !!creds.clients[slug];
      const indicator = hasCreds ? "\u2713" : "\u26A0 sin creds";
      return `DevFlow IA \xB7 ${slug} ${indicator}`;
    }
    const withCreds = slugs.filter((s) => !!creds.clients[s]).length;
    return `DevFlow IA \xB7 ${slugs.length} clientes (${withCreds} con API)`;
  } catch {
    return `DevFlow IA \xB7 v${CLI_VERSION} ready`;
  }
}
function runStatusline() {
  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) {
    return clientStatusSummary();
  }
  let session;
  try {
    session = loadSession(projectRoot);
  } catch {
    return "DevFlow IA \xB7 session.json inv\xE1lido \xB7 revisa .devflow/";
  }
  if (!session || !session.started_at) {
    return "DevFlow IA \xB7 sin sesi\xF3n \xB7 ejecuta: dd-cli start-session <HDU-id>";
  }
  if (session.ended_at) {
    const feature2 = session.feature_id ?? "?";
    const duration2 = session.started_at && session.ended_at ? formatDurationBetween(session.started_at, session.ended_at) : "?";
    const badge2 = devTypeBadge(session.dev_type);
    return `\u2713 ${feature2} cerrada \xB7 ${duration2}  ${badge2}`;
  }
  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  const duration = formatDuration3(session.started_at);
  const feature = session.feature_id ?? "?";
  const badge = devTypeBadge(session.dev_type);
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);
  if (blockers.length > 0 && ctx?.currentStage) {
    const blocker = blockers[0];
    const hint = extractBlockerHint(blocker.message);
    return `\u26A0 ${feature} \xB7 paso ${ctx.currentIndex}/${ctx.total} \xB7 ${hint} \xB7 ${duration}  ${badge}`;
  }
  if (ctx?.currentStage) {
    const current = ctx.currentStage.id;
    const next = ctx.nextStage?.id ?? "fin";
    return `${feature} \xB7 paso ${ctx.currentIndex}/${ctx.total}: ${current} \u2192 ${next} \xB7 ${duration}  ${badge}`;
  }
  return `${feature} \xB7 iniciada hace ${duration} \xB7 sin tipo definido  \u2B22 ?`;
}
function formatDurationBetween(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "?";
  const ms = end - start;
  const totalMin = Math.floor(ms / 6e4);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
function extractBlockerHint(message) {
  if (message.includes("REPO-CONTEXT")) return "falta REPO-CONTEXT.md";
  if (message.includes("BASELINE")) return "falta BASELINE.md";
  if (message.includes("legacy_system")) return "falta legacy_system";
  if (message.includes("vendor")) return "falta vendor";
  if (message.includes("greenfield")) return "tipo no compatible con /new-app";
  return "precondici\xF3n pendiente";
}

// src/commands/start-session-cmd.ts
import { input, select } from "@inquirer/prompts";

// src/commands/start-session.ts
function buildStartSessionState(input6, cliVersion, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  const warnings = [];
  if (input6.mode === "local" && !input6.devType) {
    warnings.push(
      "Modo local sin dev_type especificado. Se requiere flag --type=<tipo> o entrevista interactiva (no implementada en este stub)."
    );
  }
  if (input6.mode === "platform" && !input6.devType) {
    warnings.push(
      "Modo platform: llamar primero devflow_get_feature() para obtener dev_type"
    );
  }
  const enforcementRules = input6.devType ? enforcementRuleIdsForDevType(input6.devType) : [];
  const session = {
    feature_id: input6.featureId,
    feature_name: input6.featureName ?? null,
    session_id: `sess-${now()}`,
    started_at: now(),
    ended_at: null,
    last_heartbeat: now(),
    mode: input6.mode,
    platform_url: null,
    unclosed: false,
    dev_type: input6.devType ?? null,
    dev_type_subtype: input6.devTypeSubtype ?? null,
    dev_type_source: input6.mode === "platform" ? "tech-lead-approval" : "business-brief",
    dev_type_rationale: input6.devTypeRationale ?? "",
    dev_type_locked: false,
    // LOCK ocurre en /new-spec → devflow_save_spec
    dev_type_locked_at: null,
    apps_affected: input6.appsAffected ?? [],
    repo_context_path: null,
    baseline_path: null,
    legacy_system: input6.legacySystem ?? null,
    vendor: input6.vendor ?? null,
    enforcement_rules: enforcementRules,
    flow_state: "started",
    active_change: null,
    tasks: [],
    blockers: [],
    rag_context_snapshot: null,
    anomalies: [],
    cli_version: cliVersion,
    schema_version: 2
  };
  return { session, warnings };
}

// src/commands/start-session-cmd.ts
var DEV_TYPE_DESCRIPTIONS = {
  "greenfield": "App o m\xF3dulo completamente nuevo, sin c\xF3digo previo",
  "brownfield-feature": "Feature nueva sobre una app existente",
  "brownfield-refactor": "Mejora t\xE9cnica sin cambio funcional (deuda, performance)",
  "modernizacion": "Reemplazo de un sistema legacy con paridad funcional",
  "integracion-externa": "Conectar con SaaS / API de tercero (webhooks, OAuth, ETL)"
};
async function runStartSession(featureId, opts = {}) {
  if (!featureId) {
    printErr("Falta el feature-id. Uso: dd-cli start-session <HDU-id>");
    return 2;
  }
  const projectRoot = getProjectRoot();
  if (!hasSession(projectRoot)) {
    printErr(`Este proyecto no tiene .devflow/. Ejecuta primero: dd-cli init`);
    return 2;
  }
  let existing;
  try {
    existing = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (existing && existing.started_at && !existing.ended_at) {
    printWarn(`Ya tienes una sesi\xF3n activa: ${existing.feature_id ?? "?"}`);
    printInfo(`Cierra la anterior con: dd-cli end-session`);
    printInfo(`O retoma con: /resume-session (dentro de Claude Code)`);
    return 1;
  }
  console.log(bold(`
Nueva sesi\xF3n \u2014 ${featureId}
`));
  const useInteractive = !opts.yes && process.stdout.isTTY;
  let featureName;
  let devType;
  let subtype;
  let appsAffectedRaw;
  let rationale;
  let legacySystem;
  let vendorName;
  let vendorApiVersion;
  if (useInteractive) {
    featureName = await input({
      message: "Nombre de la feature:",
      default: opts.featureName,
      validate: (v) => v.trim().length > 0 || "Requerido"
    });
    devType = await select({
      message: "Tipo de desarrollo:",
      choices: DEV_TYPES.map((t) => ({
        name: `${t.padEnd(22)}  ${DEV_TYPE_DESCRIPTIONS[t]}`,
        value: t
      })),
      default: opts.type ?? "brownfield-feature"
    });
    subtype = await input({
      message: "Subtipo (opcional, \u226440 chars):",
      default: "",
      validate: (v) => v.length <= 40 || "M\xE1ximo 40 caracteres"
    });
    appsAffectedRaw = await input({
      message: "Apps afectadas (separadas por coma):",
      default: opts.apps ?? ""
    });
    rationale = await input({
      message: "Justificaci\xF3n corta (\u2264300 chars):",
      default: opts.rationale,
      validate: (v) => {
        if (v.trim().length < 10) {
          return "M\xEDnimo 10 caracteres \u2014 ayuda al equipo entender por qu\xE9 este tipo";
        }
        if (v.length > 300) return "M\xE1ximo 300 caracteres";
        return true;
      }
    });
    if (devType === "modernizacion") {
      legacySystem = await input({
        message: "Sistema legacy a reemplazar:",
        validate: (v) => v.trim().length > 0 || "Requerido para modernizaci\xF3n"
      });
    }
    if (devType === "integracion-externa") {
      vendorName = await input({
        message: "Vendor (ej: TOKU, Stripe, Auth0):",
        validate: (v) => v.trim().length > 0 || "Requerido para integraci\xF3n externa"
      });
      vendorApiVersion = await input({
        message: "Versi\xF3n de API del vendor:",
        validate: (v) => v.trim().length > 0 || "Requerido para integraci\xF3n externa"
      });
    }
  } else {
    if (!opts.featureName || !opts.type || !opts.rationale) {
      printErr(
        `Modo no-interactivo: faltan flags. Requeridos: --feature-name, --type, --rationale`
      );
      return 2;
    }
    if (!DEV_TYPES.includes(opts.type)) {
      printErr(`--type debe ser uno de: ${DEV_TYPES.join(", ")}`);
      return 2;
    }
    featureName = opts.featureName;
    devType = opts.type;
    subtype = "";
    appsAffectedRaw = opts.apps ?? "";
    rationale = opts.rationale;
  }
  const appsArray = appsAffectedRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const vendor = devType === "integracion-externa" && vendorName ? {
    name: vendorName.trim(),
    api_version: (vendorApiVersion ?? "").trim()
  } : void 0;
  const { session, warnings } = buildStartSessionState(
    {
      featureId,
      featureName,
      mode: "local",
      devType,
      devTypeSubtype: subtype || void 0,
      devTypeRationale: rationale,
      appsAffected: appsArray,
      legacySystem,
      vendor
    },
    CLI_VERSION
  );
  saveSession(projectRoot, session);
  for (const w of warnings) printWarn(w);
  console.log("");
  printOk(`Sesi\xF3n iniciada`);
  console.log(`  ${labelPad("Feature:")}  ${session.feature_id} \xB7 ${session.feature_name}`);
  console.log(`  ${labelPad("Tipo:")}     \u2B22 ${session.dev_type}  ${dimColor(`(fuente: ${session.dev_type_source})`)}`);
  console.log(`  ${labelPad("Modo:")}     ${session.mode}`);
  if (session.legacy_system) {
    console.log(`  ${labelPad("Legacy:")}   ${session.legacy_system}`);
  }
  if (session.vendor) {
    console.log(`  ${labelPad("Vendor:")}   ${session.vendor.name} v${session.vendor.api_version}`);
  }
  if (session.apps_affected.length > 0) {
    console.log(`  ${labelPad("Apps:")}     ${session.apps_affected.join(", ")}`);
  }
  console.log("");
  printInfo(`Pr\xF3ximo paso: ejecuta ${bold("dd-cli next")} para ver qu\xE9 viene`);
  printDim(`(o levanta la barra de estado en otro pane: dd-cli watch)`);
  return 0;
}
function labelPad(s) {
  return s.padEnd(10);
}
function dimColor(s) {
  return process.stdout.isTTY ? `\x1B[90m${s}\x1B[0m` : s;
}

// src/commands/next-cmd.ts
var isTTY3 = process.stdout.isTTY;
var cyan = (s) => isTTY3 ? `\x1B[36m${s}\x1B[0m` : s;
var dim2 = (s) => isTTY3 ? `\x1B[90m${s}\x1B[0m` : s;
function runNext() {
  const projectRoot = getProjectRoot();
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (!session || !session.started_at) {
    console.log(`Tu siguiente paso es: ${cyan("dd-cli start-session <HDU-id>")}`);
    console.log("");
    console.log(dim2("\xBFPor qu\xE9? No hay sesi\xF3n activa en este proyecto."));
    console.log(`\u2192 En tu terminal, ejecuta: ${cyan("dd-cli start-session <HDU-id>")}`);
    return 1;
  }
  const flowState = detectFlowState({ projectRoot, session });
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);
  if (blockers.length > 0) {
    const b = blockers[0];
    const human = HUMAN_BLOCKERS[b.rule_id];
    if (human) {
      console.log(`Tu siguiente paso es: ${bold(human.command === "(completar en la APP)" ? "completar campos en la APP" : human.command)}`);
      console.log("");
      console.log(dim2(`\xBFPor qu\xE9? ${human.why}`));
      if (human.command !== "(completar en la APP)") {
        console.log(`\u2192 En Claude Code, tipea: ${cyan(human.command)}`);
      }
    } else {
      console.log(`Tu siguiente paso es: ${bold("resolver precondici\xF3n pendiente")}`);
      console.log("");
      console.log(dim2(b.message));
    }
    return 2;
  }
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  if (!ctx || !ctx.currentStage) {
    console.log(`Tu siguiente paso es: ${cyan("dd-cli start-session <HDU-id>")}`);
    console.log("");
    console.log(dim2("\xBFPor qu\xE9? La sesi\xF3n existe pero el dev_type no est\xE1 definido."));
    return 1;
  }
  const stage2 = ctx.currentStage;
  console.log(`Tu siguiente paso es: ${bold(stage2.id)}`);
  console.log("");
  console.log(dim2(`\xBFPor qu\xE9? ${stage2.rationale}`));
  console.log("");
  if (stage2.invokeIn === "claude") {
    console.log(`\u2192 En Claude Code, tipea: ${cyan(stage2.command)}`);
  } else {
    console.log(`\u2192 En tu terminal, ejecuta: ${cyan(stage2.command)}`);
  }
  return 0;
}

// src/commands/heartbeat.ts
import { existsSync as existsSync15, appendFileSync as appendFileSync2, mkdirSync as mkdirSync10 } from "fs";
import * as path15 from "path";
function log(msg, silent) {
  if (!silent) console.log(msg);
}
function safeLog(projectRoot, line) {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync15(dir)) mkdirSync10(dir, { recursive: true });
    appendFileSync2(path15.join(dir, "heartbeat.log"), line + "\n", "utf-8");
  } catch {
  }
}
function safeLogTransition(projectRoot, from, to) {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync15(dir)) mkdirSync10(dir, { recursive: true });
    const line = `${(/* @__PURE__ */ new Date()).toISOString()}  flow_state: ${from} \u2192 ${to}`;
    appendFileSync2(path15.join(dir, "transitions.log"), line + "\n", "utf-8");
  } catch {
  }
}
function detectAnomalies(session) {
  const now = Date.now();
  const anomalies = [];
  if (!session.started_at) return anomalies;
  if (session.last_heartbeat) {
    const lastMs = now - new Date(session.last_heartbeat).getTime();
    if (lastMs > 2 * 36e5 && session.flow_state !== "ended") {
      anomalies.push({
        type: "stale_session",
        detected_at: (/* @__PURE__ */ new Date()).toISOString(),
        acknowledged: false,
        details: `Sin heartbeat hace ${Math.floor(lastMs / 6e4)} min`
      });
    }
  }
  const openMs = now - new Date(session.started_at).getTime();
  if (openMs > 8 * 36e5 && !session.ended_at) {
    anomalies.push({
      type: "long_open_session",
      detected_at: (/* @__PURE__ */ new Date()).toISOString(),
      acknowledged: false,
      details: `Sesi\xF3n lleva ${Math.floor(openMs / 36e5)}h abierta`
    });
  }
  if (session.flow_state === "started") {
    if (openMs > 30 * 6e4) {
      anomalies.push({
        type: "stuck_in_started",
        detected_at: (/* @__PURE__ */ new Date()).toISOString(),
        acknowledged: false,
        details: 'M\xE1s de 30 min en estado "started" sin generar SPEC'
      });
    }
  }
  return anomalies;
}
async function runHeartbeat(opts = {}) {
  const { silent = false, onStop = false } = opts;
  let projectRoot;
  try {
    projectRoot = getProjectRoot();
  } catch {
    return;
  }
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    safeLog(projectRoot, `[heartbeat] ERROR loading session: ${String(e)}`);
    return;
  }
  if (!session || !session.started_at) {
    return;
  }
  if (session.ended_at) {
    return;
  }
  try {
    const previousFlowState = session.flow_state;
    const newFlowState = detectFlowState({ projectRoot, session });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let changed = false;
    const updated = { ...session, last_heartbeat: now };
    if (newFlowState !== previousFlowState) {
      updated.flow_state = newFlowState;
      safeLogTransition(projectRoot, previousFlowState, newFlowState);
      log(`[DevFlow IA] Progresaste: ${previousFlowState} \u2192 ${newFlowState}`, silent);
      changed = true;
    }
    const newAnomalies = detectAnomalies(updated);
    if (newAnomalies.length > 0) {
      const existingTypes = new Set(session.anomalies.map((a) => a.type));
      const toAdd = newAnomalies.filter((a) => !existingTypes.has(a.type));
      if (toAdd.length > 0) {
        updated.anomalies = [...session.anomalies, ...toAdd];
        changed = true;
      }
    }
    if (onStop && session.flow_state !== "ended") {
      updated.unclosed = true;
      changed = true;
      safeLog(projectRoot, `[heartbeat] Stop detectado sin /end-session (flow_state=${session.flow_state})`);
    }
    if (changed) {
      saveSession(projectRoot, updated);
    } else {
      saveSession(projectRoot, updated);
    }
  } catch (e) {
    safeLog(projectRoot, `[heartbeat] ERROR: ${String(e)}`);
  }
}

// src/commands/skills-cmd.ts
import { existsSync as existsSync16, readdirSync as readdirSync3, statSync as statSync4, readFileSync as readFileSync14 } from "fs";
import { createHash } from "crypto";
import * as path16 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
var __dirname = path16.dirname(fileURLToPath3(import.meta.url));
var META_FILES2 = /* @__PURE__ */ new Set([
  "AUDIT.md",
  "CUSTOMIZATION.md",
  "ENFORCEMENT.md",
  "DISENO_INIT_CONTEXT.md",
  "PLAN.md"
]);
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.+)/);
    if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return fm;
}
function sha256File(filePath) {
  const content = readFileSync14(filePath);
  return createHash("sha256").update(content).digest("hex");
}
function collectSkills(dir, relBase = "") {
  const skills2 = [];
  if (!existsSync16(dir)) return skills2;
  for (const entry of readdirSync3(dir)) {
    const fullPath = path16.join(dir, entry);
    const st = statSync4(fullPath);
    if (st.isDirectory()) {
      skills2.push(...collectSkills(fullPath, path16.join(relBase, entry)));
    } else if (entry.endsWith(".md") && !META_FILES2.has(entry)) {
      const content = readFileSync14(fullPath, "utf-8");
      const fm = parseFrontmatter(content);
      skills2.push({
        relPath: path16.join(relBase, entry),
        name: fm["name"] ?? entry.replace(".md", ""),
        category: fm["category"] ?? "?",
        model: fm["model"] ?? "?",
        version: fm["version"] ?? "?",
        origin: fm["origin"] ?? "?"
      });
    }
  }
  return skills2;
}
function resolveChecksumsPath() {
  const pkgRoot = path16.resolve(__dirname, "..", "..");
  const candidate = path16.join(pkgRoot, "skills.checksums");
  return existsSync16(candidate) ? candidate : null;
}
function loadChecksums() {
  const p = resolveChecksumsPath();
  if (!p) return {};
  try {
    return JSON.parse(readFileSync14(p, "utf-8"));
  } catch {
    return {};
  }
}
function runSkillsList() {
  const skillsDir = getClaudeSkillsDir();
  if (!existsSync16(skillsDir)) {
    printWarn(`Skills no instaladas en ${skillsDir}`);
    printDim(`  Ejecuta: dd-cli init`);
    return 1;
  }
  const versionFile = path16.join(skillsDir, ".version");
  const version = existsSync16(versionFile) ? readFileSync14(versionFile, "utf-8").trim() : "?";
  const skills2 = collectSkills(skillsDir);
  console.log(`
Skills instaladas en ${skillsDir} (v${version})
`);
  const byOrigin = {};
  for (const s of skills2) {
    const key = s.origin.includes("OpenSpec") ? "OpenSpec (adaptado)" : "Digital-Dev";
    (byOrigin[key] ??= []).push(s);
  }
  const modelIcon = { opus: "\u2B1B", sonnet: "\u2B1C", haiku: "\u25AA", "?": "\xB7" };
  for (const [origin, list] of Object.entries(byOrigin)) {
    console.log(`  ${bold(origin)}:`);
    for (const s of list) {
      const icon = modelIcon[s.model] ?? "\xB7";
      const name = s.name.padEnd(26);
      console.log(`    ${icon} /${name} ${printDimInline(s.category.padEnd(12))} ${printDimInline(s.model)}`);
    }
    console.log("");
  }
  console.log(printDimInline(`Total: ${skills2.length} skills  \xB7  opus \u2B1B  sonnet \u2B1C  haiku \u25AA`));
  return 0;
}
function runSkillsVerify() {
  const skillsDir = getClaudeSkillsDir();
  const checksums = loadChecksums();
  if (Object.keys(checksums).length === 0) {
    printWarn("No se encontr\xF3 skills.checksums. Ejecuta npm run build:full para generarlo.");
    return 1;
  }
  const skills2 = collectSkills(skillsDir);
  let ok2 = 0;
  let modified = 0;
  for (const s of skills2) {
    const expected = checksums[s.relPath];
    if (!expected) {
      printWarn(`${s.relPath}: no est\xE1 en checksums (skill nueva?)`);
      continue;
    }
    const actual = sha256File(path16.join(skillsDir, s.relPath));
    if (actual === expected) {
      ok2++;
    } else {
      printWarn(`${s.relPath}: modificada localmente`);
      printDim(`  Restaurar: dd-cli skills install --force`);
      modified++;
    }
  }
  if (modified === 0) {
    printOk(`${ok2} skills verificadas \u2014 todas coinciden con checksums`);
    return 0;
  }
  return 2;
}
async function runSkillsInstall(opts = {}) {
  return runInit({ force: !!opts.force, skipHooks: true });
}
function printDimInline(s) {
  return process.stdout.isTTY ? `\x1B[90m${s}\x1B[0m` : s;
}

// src/commands/help-cmd.ts
var isTTY4 = process.stdout.isTTY;
var bold3 = (s) => isTTY4 ? `\x1B[1m${s}\x1B[0m` : s;
var cyan2 = (s) => isTTY4 ? `\x1B[36m${s}\x1B[0m` : s;
var dim3 = (s) => isTTY4 ? `\x1B[90m${s}\x1B[0m` : s;
var ALL_COMMANDS = [
  { cmd: "dd-cli init", desc: "Configura el proyecto (skills + hooks + CLAUDE.md)" },
  { cmd: "dd-cli start-session <id>", desc: "Inicia una sesi\xF3n de trabajo sobre una HDU" },
  { cmd: "dd-cli end-session", desc: "Cierra la sesi\xF3n (normalmente lo hace la skill /end-session)" },
  { cmd: "dd-cli status", desc: "Tu viaje actual: pasos completados y pendientes" },
  { cmd: "dd-cli next", desc: "Atajo: \xBFqu\xE9 tipeo ahora?" },
  { cmd: "dd-cli statusline", desc: "1 l\xEDnea para la statusLine de Claude Code (uso interno)" },
  { cmd: "dd-cli heartbeat", desc: "Se\xF1al de vida (llamado por hooks autom\xE1ticamente)" },
  { cmd: "dd-cli reclassify", desc: "Cambia el dev_type (solo Tech Lead, post-lock)" },
  { cmd: "dd-cli doctor", desc: "Verifica que el entorno est\xE9 bien configurado" },
  { cmd: "dd-cli skills list", desc: "Lista las 19 skills instaladas con modelo" },
  { cmd: "dd-cli skills verify", desc: "Verifica que ninguna skill fue modificada localmente" },
  { cmd: "dd-cli skills install", desc: "Reinstala skills (\xFAtil tras actualizar dd-cli)" }
];
function printCommands(entries) {
  const maxLen = Math.max(...entries.map((e) => e.cmd.length));
  for (const { cmd, desc } of entries) {
    console.log(`  ${cyan2(cmd.padEnd(maxLen + 2))} ${dim3(desc)}`);
  }
}
function runHelp(opts = {}) {
  let projectRoot;
  try {
    projectRoot = getProjectRoot();
  } catch {
    projectRoot = process.cwd();
  }
  if (opts.all) {
    console.log(`
${bold3("Todos los comandos de dd-cli")}
`);
    printCommands(ALL_COMMANDS);
    console.log("");
    return 0;
  }
  const session = (() => {
    try {
      return loadSession(projectRoot);
    } catch {
      return null;
    }
  })();
  const flowState = session ? detectFlowState({ projectRoot, session }) : "not_started";
  const ctx = session?.dev_type ? getStageContext(session, flowState) : null;
  if (!session || !session.started_at) {
    console.log(`
${bold3("Empezando en este proyecto")}
`);
    printCommands([
      { cmd: "dd-cli init", desc: "Primera vez: configura el proyecto" },
      { cmd: "dd-cli start-session <id>", desc: "Inicia sesi\xF3n con el ID de tu HDU" },
      { cmd: "dd-cli status", desc: "Ver estado actual" }
    ]);
    console.log("");
    return 0;
  }
  const stageName = ctx?.currentStage?.id ?? "?";
  const devType = session.dev_type ?? "?";
  console.log(`
${bold3(`Est\xE1s en: ${stageName}`)} ${dim3(`(paso ${ctx?.currentIndex ?? "?"}/${ctx?.total ?? "?"} \xB7 ${devType})`)}
`);
  const contextual = [
    { cmd: "dd-cli status", desc: "Ver progreso completo del viaje" },
    { cmd: "dd-cli next", desc: "\xBFQu\xE9 tipeo ahora?" }
  ];
  if (flowState === "change_active") {
    contextual.push({ cmd: "dd-cli heartbeat", desc: "Actualizar estado (lo hacen los hooks solos)" });
  }
  if (session.ended_at) {
    contextual.push({ cmd: "dd-cli start-session <id>", desc: "Iniciar nueva sesi\xF3n" });
  } else {
    contextual.push({ cmd: "dd-cli end-session", desc: "Cerrar sesi\xF3n al terminar el d\xEDa" });
  }
  printCommands(contextual);
  if (ctx?.nextStage) {
    console.log("");
    console.log(dim3(`Cuando termines este paso, en Claude Code ejecuta: ${ctx.nextStage.command}`));
  }
  console.log("");
  console.log(dim3(`Ver todos los comandos: dd-cli help --all`));
  console.log("");
  return 0;
}

// src/commands/reclassify-cmd.ts
import { appendFileSync as appendFileSync3 } from "fs";
import * as path17 from "path";

// src/commands/reclassify.ts
var MIN_REASON_CHARS = 30;
function reclassify(input6) {
  if (input6.session.mode !== "platform") {
    return {
      ok: false,
      error: "NOT_PLATFORM_MODE",
      message: "Reclasificaci\xF3n solo permitida en modo platform. El audit-log requiere persistencia server-side."
    };
  }
  if (!input6.session.started_at) {
    return {
      ok: false,
      error: "NO_SESSION",
      message: "No hay sesi\xF3n activa para reclasificar."
    };
  }
  if (input6.reason.trim().length < MIN_REASON_CHARS) {
    return {
      ok: false,
      error: "REASON_TOO_SHORT",
      message: `Justificaci\xF3n requiere al menos ${MIN_REASON_CHARS} caracteres.`
    };
  }
  if (input6.callerRole !== "tech-lead" && input6.callerRole !== "admin") {
    return {
      ok: false,
      error: "INSUFFICIENT_ROLE",
      message: "Solo Tech Lead o admin pueden reclassify despu\xE9s del lock."
    };
  }
  if (input6.session.dev_type === input6.newType) {
    return {
      ok: false,
      error: "SAME_TYPE",
      message: `El tipo ya es ${input6.newType}. Nada que reclasificar.`
    };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = {
    ...input6.session,
    dev_type: input6.newType,
    dev_type_subtype: null,
    // reset al cambiar tipo
    dev_type_source: "reclassify",
    dev_type_rationale: input6.reason,
    dev_type_locked: true,
    dev_type_locked_at: now,
    dev_type_reclassified_from: input6.session.dev_type ?? void 0,
    // Recalcular enforcement_rules
    enforcement_rules: enforcementRuleIdsForDevType(input6.newType)
  };
  return {
    ok: true,
    updatedSession: updated,
    message: `Reclasificaci\xF3n aplicada: ${input6.session.dev_type} \u2192 ${input6.newType}. La plataforma generar\xE1 audit-log y evaluar\xE1 delta de lead-time.`
  };
}

// src/commands/reclassify-cmd.ts
var isTTY5 = process.stdout.isTTY;
var dim4 = (s) => isTTY5 ? `\x1B[90m${s}\x1B[0m` : s;
var orange = (s) => isTTY5 ? `\x1B[38;5;208m${s}\x1B[0m` : s;
function runReclassifyCmd(opts) {
  if (!DEV_TYPES.includes(opts.to)) {
    printErr(`--to debe ser uno de: ${DEV_TYPES.join(", ")}`);
    return 2;
  }
  const projectRoot = getProjectRoot();
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (!session || !session.started_at) {
    printErr("No hay sesi\xF3n activa para reclassify.");
    return 1;
  }
  const result = reclassify({
    session,
    newType: opts.to,
    reason: opts.reason,
    callerRole: "tech-lead"
    // MVP: confiamos en el usuario
  });
  if (!result.ok) {
    switch (result.error) {
      case "REASON_TOO_SHORT":
        printErr("La justificaci\xF3n necesita al menos 30 caracteres.");
        printDim(`  Escribe una raz\xF3n m\xE1s descriptiva del cambio: --reason="<texto>"`);
        break;
      case "SAME_TYPE":
        printWarn(`El tipo ya es ${session.dev_type}. Nada que cambiar.`);
        break;
      default:
        printErr(result.message);
    }
    return 1;
  }
  const updated = result.updatedSession;
  updated.enforcement_rules = enforcementRuleIdsForDevType(updated.dev_type);
  saveSession(projectRoot, updated);
  const auditLine = `${(/* @__PURE__ */ new Date()).toISOString()}  HDU ${session.feature_id}  ${session.dev_type} \u2192 ${updated.dev_type}  reason: ${opts.reason}`;
  try {
    appendFileSync3(path17.join(getDevflowDir(projectRoot), "audit.log"), auditLine + "\n", "utf-8");
  } catch {
  }
  console.log("");
  printOk(`Reclasificaci\xF3n aplicada`);
  console.log(`  ${dim4("Anterior:")}  ${orange(`\u2B22 ${session.dev_type}`)}`);
  console.log(`  ${dim4("Nuevo:")}     \u2B22 ${updated.dev_type}`);
  console.log(`  ${dim4("Raz\xF3n:")}     ${opts.reason}`);
  console.log("");
  printDim(`Audit log guardado en .devflow/audit.log`);
  printDim(`Nota: en modo platform el Tech Lead confirma este cambio en la APP.`);
  console.log("");
  return 0;
}

// src/commands/register-client.ts
import { execSync } from "child_process";
import { existsSync as existsSync18, mkdirSync as mkdirSync11, readFileSync as readFileSync16, rmSync as rmSync2 } from "fs";
import * as path18 from "path";
import * as yaml8 from "js-yaml";
function runGit(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch (e) {
    const err2 = e;
    throw new Error(err2.stderr?.trim() || err2.message || String(e));
  }
}
function deriveNameFromUrl(url) {
  const base = url.replace(/\.git$/, "").split("/").pop() ?? url;
  return base.replace(/-devflow-context$/, "");
}
function readClientName(cacheDir, contextUrl) {
  const stackYmlPath = path18.join(cacheDir, ".devflow-context", "stack.yml");
  if (existsSync18(stackYmlPath)) {
    try {
      const parsed = yaml8.load(readFileSync16(stackYmlPath, "utf-8"));
      const client = parsed?.client;
      const name = client?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
    }
  }
  const contextRepoYmlPath = path18.join(cacheDir, ".devflow-context", ".context-repo.yml");
  if (existsSync18(contextRepoYmlPath)) {
    try {
      const parsed = yaml8.load(readFileSync16(contextRepoYmlPath, "utf-8"));
      const client = parsed?.client;
      const name = client?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
    }
  }
  for (const filename of ["CLAUDE.md", "README.md"]) {
    const mdPath = path18.join(cacheDir, filename);
    if (existsSync18(mdPath)) {
      try {
        const content = readFileSync16(mdPath, "utf-8");
        const h1 = content.match(/^#\s+(.+?)\s*$/m);
        if (h1 && h1[1]?.trim()) return h1[1].trim();
      } catch {
      }
    }
  }
  return deriveNameFromUrl(contextUrl);
}
async function runRegisterClient(slug, opts) {
  if (!slug) {
    printErr("Falta el slug del cliente. Uso: dd-cli register-client <slug> --context-url=<url>");
    return 2;
  }
  const cacheDir = getClientCacheDir(slug);
  const registry = loadRegistry();
  const alreadyExists = !!registry.clients[slug];
  console.log(bold(`
Registrando cliente: ${slug}
`));
  if (alreadyExists && !opts.force) {
    printInfo(`El cliente "${slug}" ya est\xE1 registrado. Actualizando cache...`);
    return syncClient(slug, cacheDir, opts.contextUrl);
  }
  const parentDir = path18.dirname(cacheDir);
  if (!existsSync18(parentDir)) mkdirSync11(parentDir, { recursive: true });
  if (existsSync18(cacheDir) && opts.force) {
    printDim(`  Sobreescribiendo cache existente en ${cacheDir}`);
    rmSync2(cacheDir, { recursive: true, force: true });
  }
  if (!existsSync18(cacheDir)) {
    printInfo(`Clonando repo de contexto...`);
    printDim(`  ${opts.contextUrl}`);
    printDim(`  \u2192 ${cacheDir}`);
    try {
      runGit(`git clone "${opts.contextUrl}" "${cacheDir}"`);
      printOk(`Repo clonado`);
    } catch (e) {
      printErr(`Error al clonar: ${e instanceof Error ? e.message : String(e)}`);
      printDim(`  Verifica que la URL es correcta y tienes acceso al repo.`);
      return 1;
    }
  }
  const clientName = opts.name ?? readClientName(cacheDir, opts.contextUrl);
  registerClient({
    slug,
    name: clientName,
    context_url: opts.contextUrl,
    local_cache: cacheDir,
    last_synced: (/* @__PURE__ */ new Date()).toISOString()
  });
  printOk(`Cliente registrado en ~/.devflow/registry.yml`);
  if (opts.gitToken && opts.gitGroup) {
    const host = opts.gitHost ?? "gitlab";
    const baseUrl = opts.gitBaseUrl ?? (host === "github" ? "https://api.github.com" : "https://gitlab.com");
    setClientCredentials(slug, {
      git_token: opts.gitToken,
      git_host: host,
      git_base_url: baseUrl,
      git_group: opts.gitGroup
    });
    printOk(`Credenciales git guardadas en ~/.devflow/credentials.yml (chmod 600)`);
    printDim(`  Host: ${host}  \xB7  Grupo: ${opts.gitGroup}`);
  } else if (opts.gitToken || opts.gitGroup) {
    printWarn(`Para guardar credenciales git se necesitan tanto --git-token como --git-group`);
  }
  if (hasCatalog(cacheDir)) {
    try {
      const catalog = loadCatalog(cacheDir);
      const appCount = catalog?.apps.length ?? 0;
      if (appCount > 0) {
        printOk(`App catalog: ${appCount} apps encontradas`);
      }
    } catch (e) {
      printWarn(`Catalog inv\xE1lido: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  console.log("");
  printInfo(`Pr\xF3ximo paso para conectar un repo de c\xF3digo a este cliente:`);
  console.log(`    dd-cli init --client=${slug}`);
  console.log("");
  return 0;
}
function syncClient(slug, cacheDir, contextUrl) {
  if (!existsSync18(cacheDir)) {
    printWarn(`Cache local no encontrada. Clonando de nuevo...`);
    try {
      const parentDir = path18.dirname(cacheDir);
      if (!existsSync18(parentDir)) mkdirSync11(parentDir, { recursive: true });
      runGit(`git clone "${contextUrl}" "${cacheDir}"`);
    } catch (e) {
      printErr(`Error al clonar: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    try {
      runGit("git pull", cacheDir);
    } catch (e) {
      printErr(`Error al actualizar: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  updateLastSynced(slug);
  printOk(`Cache actualizada (${slug})`);
  try {
    const log2 = runGit("git log --oneline -3", cacheDir);
    if (log2) {
      printDim(`
\xDAltimos cambios:`);
      log2.split("\n").forEach((l) => printDim(`  ${l}`));
    }
  } catch {
  }
  return 0;
}

// src/commands/init-client.ts
import { existsSync as existsSync19, mkdirSync as mkdirSync12 } from "fs";
import * as path19 from "path";
import { execSync as execSync2 } from "child_process";
import { select as select2, input as input2, confirm } from "@inquirer/prompts";
var isTTY6 = process.stdout.isTTY;
function toEntry(app) {
  return {
    slug: app.slug,
    type: app.type,
    auth_profile: app.auth_profile ?? "",
    ci_cd_profile: app.ci_cd_profile ?? "[por-confirmar]",
    app_origin: app.app_origin,
    preferred_dev_types: app.preferred_dev_types
  };
}
function syncCache(slug, contextUrl) {
  const cacheDir = getClientCacheDir(slug);
  try {
    if (!existsSync19(cacheDir)) {
      mkdirSync12(path19.dirname(cacheDir), { recursive: true });
      execSync2(`git clone "${contextUrl}" "${cacheDir}"`, { stdio: "pipe" });
    } else {
      execSync2("git pull", { cwd: cacheDir, stdio: "pipe" });
    }
    updateLastSynced(slug);
    return true;
  } catch {
    return false;
  }
}
async function runInitClient(clientSlug) {
  const projectRoot = getProjectRoot();
  console.log(bold(`
Conectando repo al cliente: ${clientSlug}
`));
  const clientEntry = getClient(clientSlug);
  if (!clientEntry) {
    printErr(`Cliente "${clientSlug}" no registrado en esta m\xE1quina.`);
    printInfo(`Primero registra el cliente:`);
    printDim(`  dd-cli register-client ${clientSlug} --context-url=<github-url>`);
    return 2;
  }
  printInfo(`Actualizando contexto de ${clientSlug}...`);
  const synced = syncCache(clientSlug, clientEntry.context_url);
  if (synced) {
    printOk(`Cache actualizada`);
  } else {
    printWarn(`No se pudo actualizar la cache. Usando versi\xF3n local.`);
  }
  const cacheDir = getClientCacheDir(clientSlug);
  const catalog = loadCatalog(cacheDir);
  const existingApps = catalog?.apps.map(toEntry) ?? [];
  let selectedApp = null;
  let isNewApp = false;
  if (existingApps.length > 0) {
    console.log("");
    const choices = [
      ...existingApps.map((a) => ({
        name: `${a.slug.padEnd(35)} ${a.type.padEnd(15)} ${a.auth_profile}`,
        value: a.slug
      })),
      { name: "+ Esta es una app nueva (no est\xE1 en el cat\xE1logo todav\xEDa)", value: "__new__" }
    ];
    const chosen = await select2({
      message: "\xBFQu\xE9 app del cat\xE1logo es este repo?",
      choices
    });
    if (chosen === "__new__") {
      isNewApp = true;
    } else {
      selectedApp = existingApps.find((a) => a.slug === chosen) ?? null;
    }
  } else {
    printWarn(`No se encontr\xF3 app-catalog en el contexto del cliente.`);
    isNewApp = true;
  }
  let appSlug;
  let appType;
  let authProfile;
  let ciCdProfile;
  let appOrigin;
  let preferredDevTypes;
  if (selectedApp) {
    appSlug = selectedApp.slug;
    appType = APP_TYPES.includes(selectedApp.type) ? selectedApp.type : "bff";
    authProfile = selectedApp.auth_profile;
    ciCdProfile = selectedApp.ci_cd_profile;
    appOrigin = APP_ORIGINS.includes(selectedApp.app_origin) ? selectedApp.app_origin : "legacy-app";
    preferredDevTypes = selectedApp.preferred_dev_types.filter(
      (t) => DEV_TYPES.includes(t)
    );
    console.log("");
    printDim(`  App:         ${appSlug}`);
    printDim(`  Tipo:        ${appType}`);
    printDim(`  Auth:        ${authProfile}`);
    printDim(`  CI/CD:       ${ciCdProfile}`);
    printDim(`  Origen:      ${appOrigin}`);
  } else {
    console.log("");
    printInfo("Registrando nueva app en el contexto del cliente:");
    appSlug = await input2({
      message: "Slug de la app (kebab-case):",
      default: path19.basename(projectRoot),
      validate: (v) => /^[a-z0-9-]+$/.test(v) || "Debe ser kebab-case (solo min\xFAsculas, n\xFAmeros y guiones)"
    });
    appType = await select2({
      message: "Tipo de app:",
      choices: APP_TYPES.map((t) => ({ name: t, value: t })),
      default: "bff"
    });
    authProfile = await input2({
      message: "Auth profile (debe existir en .devflow-context/auth-profiles/):",
      default: "custom-jwt"
    });
    ciCdProfile = await input2({
      message: "CI/CD profile (debe existir en .devflow-context/cicd-profiles/):",
      default: "gitlab-laravel-k8s"
    });
    appOrigin = await select2({
      message: "Origen del codebase:",
      choices: [
        { name: "legacy-app   \u2014 c\xF3digo existente con historial", value: "legacy-app" },
        { name: "greenfield-app \u2014 app nueva sin c\xF3digo previo", value: "greenfield-app" },
        { name: "external-app \u2014 repositorio de tercero (solo lectura)", value: "external-app" }
      ],
      default: "legacy-app"
    });
    preferredDevTypes = [];
  }
  if (hasProjectConfig(projectRoot)) {
    const overwrite = await confirm({
      message: "Ya existe .devflow/config.yml. \xBFSobreescribir?",
      default: false
    });
    if (!overwrite) {
      printInfo("Manteniendo config.yml existente. Continuando con el setup...");
    }
  }
  const config = buildProjectConfig({
    clientSlug,
    clientName: clientEntry.name,
    contextUrl: clientEntry.context_url,
    appSlug,
    appType,
    authProfile,
    ciCdProfile,
    appOrigin,
    preferredDevTypes
  });
  saveProjectConfig(projectRoot, config);
  printOk(`.devflow/config.yml generado`);
  printDim(`  \u21B3 Commitear este archivo para que otros devs lo usen`);
  console.log("");
  const initResult = await runInit({ force: false, skipSkills: false, skipHooks: false });
  if (initResult === 0) {
    console.log("");
    printOk(`Repo "${appSlug}" conectado al cliente "${clientSlug}"`);
    printDim(`  Commitea .devflow/config.yml para que cualquier dev pueda usar dd-cli init`);
  }
  return initResult;
}

// src/commands/pull-context.ts
import { execSync as execSync3 } from "child_process";
import { existsSync as existsSync20, mkdirSync as mkdirSync13 } from "fs";
import * as path20 from "path";
function runGit2(cmd, cwd) {
  return execSync3(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  }).trim();
}
function runPullContext(slugArg, opts) {
  const jsonMode = isJsonMode(opts);
  let slug;
  let context_url;
  let appSlugFromLocalConfig;
  if (slugArg) {
    const entry = getClient(slugArg);
    if (!entry) {
      if (jsonMode) {
        emitJson(jsonError({
          command: "pull-context",
          code: "CLIENT_NOT_REGISTERED",
          message: `Cliente "${slugArg}" no registrado en ~/.devflow/registry.yml.`,
          context: { slug: slugArg },
          recovery_hints: [
            `Registr\xE1 el cliente: dd-cli register-client ${slugArg} --context-url=<url>`,
            "O abr\xED Claude Code y ejecut\xE1 /devflow-ia:client-onboard para onboarding completo"
          ],
          next_safe_command: `dd-cli register-client ${slugArg} --context-url=<url>`
        }));
      }
      printErr(`Cliente "${slugArg}" no registrado en ~/.devflow/registry.yml.`);
      printInfo("Primero registra el cliente:");
      printDim(`  dd-cli register-client ${slugArg} --context-url=<url>`);
      return 2;
    }
    slug = entry.slug;
    context_url = entry.context_url;
  } else {
    const projectRoot = getProjectRoot();
    const config = loadProjectConfig(projectRoot);
    if (!config) {
      if (jsonMode) {
        emitJson(jsonError({
          command: "pull-context",
          code: "PROJECT_NOT_INITIALIZED",
          message: "No se encontr\xF3 .devflow/config.yml en este proyecto.",
          context: { cwd: projectRoot },
          recovery_hints: [
            "Conect\xE1 el repo al cliente: dd-cli init --client=<slug>",
            "O sync expl\xEDcito sin estar en un repo: dd-cli pull-context <slug>"
          ],
          next_safe_command: "dd-cli init --client=<slug>"
        }));
      }
      printErr("No se encontr\xF3 .devflow/config.yml en este proyecto.");
      printInfo("Opciones:");
      printDim("  \u2022 Conectar el repo al cliente: dd-cli init --client=<slug>");
      printDim("  \u2022 Sync expl\xEDcito sin estar en un repo: dd-cli pull-context <slug>");
      return 2;
    }
    slug = config.client.slug;
    context_url = config.client.context_url;
    appSlugFromLocalConfig = config.app.slug;
  }
  const cacheDir = getClientCacheDir(slug);
  if (!jsonMode) {
    console.log(bold(`
Actualizando contexto del cliente: ${slug}
`));
    printDim(`  Cache: ${cacheDir}`);
    printDim(`  Fuente: ${context_url}`);
    console.log("");
  }
  if (!existsSync20(cacheDir)) {
    if (!jsonMode) printInfo("Cache local no encontrada. Clonando...");
    try {
      mkdirSync13(path20.dirname(cacheDir), { recursive: true });
      execSync3(`git clone "${context_url}" "${cacheDir}"`, { stdio: "pipe" });
      updateLastSynced(slug);
      recordCommandResult(slug, "pull-context", { success: true });
      if (jsonMode) {
        emitJson(jsonSuccess("pull-context", {
          slug,
          action: "cloned",
          cache_dir: cacheDir,
          context_url
        }));
      }
      printOk("Contexto clonado correctamente");
      return 0;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const jsonErr = {
        code: "GIT_CLONE_FAILED",
        message: `Error al clonar contexto del cliente: ${errMsg}`,
        context: { slug, context_url, cache_dir: cacheDir },
        recovery_hints: [
          "Verific\xE1 que ten\xE9s acceso al repo del contexto",
          `Valid\xE1 el token del cliente: dd-cli health --client=${slug}`
        ]
      };
      recordCommandResult(slug, "pull-context", { success: false, error: jsonErr });
      if (jsonMode) {
        emitJson(jsonError({ command: "pull-context", ...jsonErr }));
      }
      printErr(`Error al clonar: ${errMsg}`);
      printDim("  Verifica que tienes acceso al repo del contexto.");
      return 1;
    }
  }
  let beforeHash = "";
  try {
    beforeHash = runGit2("git rev-parse HEAD", cacheDir);
  } catch {
  }
  try {
    const pullOutput = runGit2("git pull", cacheDir);
    if (pullOutput.includes("Already up to date")) {
      updateLastSynced(slug);
      recordCommandResult(slug, "pull-context", { success: true });
      if (jsonMode) {
        emitJson(jsonSuccess("pull-context", {
          slug,
          action: "already-up-to-date",
          cache_dir: cacheDir
        }));
      }
      printOk("El contexto ya est\xE1 actualizado \u2014 no hay cambios");
      return 0;
    }
    updateLastSynced(slug);
    let commits = [];
    if (beforeHash) {
      try {
        const log2 = runGit2(`git log ${beforeHash}..HEAD --oneline`, cacheDir);
        if (log2) commits = log2.split("\n");
      } catch {
      }
    }
    let appCatalogChanged = false;
    if (appSlugFromLocalConfig) {
      try {
        const diff = runGit2(
          `git diff ${beforeHash}..HEAD -- .devflow-context/app-catalog.md`,
          cacheDir
        );
        appCatalogChanged = diff.includes(`+| ${appSlugFromLocalConfig}`) || diff.includes(`-| ${appSlugFromLocalConfig}`);
      } catch {
      }
    }
    recordCommandResult(slug, "pull-context", { success: true });
    if (jsonMode) {
      emitJson(jsonSuccess("pull-context", {
        slug,
        action: "pulled",
        commits_count: commits.length,
        commits,
        app_catalog_changed_for: appCatalogChanged ? appSlugFromLocalConfig : null
      }));
    }
    printOk("Contexto actualizado");
    if (commits.length > 0) {
      console.log("");
      printDim("Cambios recibidos:");
      commits.forEach((l) => printDim(`  ${l}`));
    }
    if (appCatalogChanged && appSlugFromLocalConfig) {
      console.log("");
      printWarn(`La entrada de "${appSlugFromLocalConfig}" en app-catalog.md cambi\xF3.`);
      printInfo("Revisa si necesitas actualizar .devflow/config.yml");
    }
    return 0;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const jsonErr = {
      code: "GIT_PULL_FAILED",
      message: `Error al actualizar contexto: ${errMsg}`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [
        "Verific\xE1 tu conexi\xF3n y acceso al repo del contexto",
        `Re-valid\xE1 el token: dd-cli health --client=${slug}`,
        `Si la cache est\xE1 corrupta: dd-cli register-client ${slug} --context-url=${context_url} --force`
      ]
    };
    recordCommandResult(slug, "pull-context", { success: false, error: jsonErr });
    if (jsonMode) {
      emitJson(jsonError({ command: "pull-context", ...jsonErr }));
    }
    printErr(`Error al actualizar: ${errMsg}`);
    printDim("  Verifica tu conexi\xF3n y acceso al repo del contexto.");
    return 1;
  }
}

// src/commands/doctor-cmd.ts
import { existsSync as existsSync21 } from "fs";

// src/commands/doctor.ts
function doctor({ projectRoot, session, forType }) {
  const targetType = forType ?? session.dev_type;
  if (!targetType) {
    return {
      text: "No hay dev_type para validar. Usa --for=<tipo> o inicia una sesi\xF3n.",
      exitCode: 1
    };
  }
  const ruleIds = enforcementRuleIdsForDevType(targetType);
  const results = evaluateRules({ projectRoot, session, ruleIds });
  const { blockers } = partition(results);
  return {
    text: formatDoctorOutput(results, targetType),
    exitCode: blockers.length > 0 ? 2 : 0
  };
}

// src/commands/doctor-cmd.ts
var isTTY7 = process.stdout.isTTY;
var dim5 = (s) => isTTY7 ? `\x1B[90m${s}\x1B[0m` : s;
var green = (s) => isTTY7 ? `\x1B[32m${s}\x1B[0m` : s;
function runDoctorCmd(opts = {}) {
  const projectRoot = getProjectRoot();
  console.log(`
${bold("Diagn\xF3stico del entorno DevFlow IA")}
`);
  console.log(`${dim5("Sistema:")}`);
  if (isClaudeCodeInstalled()) {
    printOk(`Claude Code detectado en ${getClaudeHome()}`);
  } else {
    printErr(`Claude Code no encontrado en ${getClaudeHome()}`);
    printDim(`  Instala Claude Code: https://claude.com/claude-code`);
  }
  const skillsDir = getClaudeSkillsDir();
  if (existsSync21(skillsDir)) {
    printOk(`Skills instaladas en ${skillsDir}`);
  } else {
    printWarn(`Skills no instaladas`);
    printDim(`  Ejecuta: dd-cli init`);
  }
  const settingsPath = `${projectRoot}/.claude/settings.json`;
  if (existsSync21(settingsPath)) {
    printOk(`.claude/settings.json con hooks presente`);
  } else {
    printWarn(`.claude/settings.json no encontrado`);
    printDim(`  Ejecuta: dd-cli init`);
  }
  console.log("");
  console.log(`${dim5("Proyecto:")}`);
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    if (e instanceof SessionIOError) {
      printErr(e.message);
      return 2;
    }
    throw e;
  }
  if (!session || !session.started_at) {
    printWarn(`Sin sesi\xF3n activa`);
    printDim(`  Ejecuta: dd-cli start-session <HDU-id>`);
  } else {
    printOk(`Sesi\xF3n activa: ${session.feature_id} \xB7 ${session.dev_type ?? "?"}`);
  }
  const targetType = opts.forType ?? session?.dev_type ?? null;
  if (targetType) {
    if (!DEV_TYPES.includes(targetType)) {
      printErr(`--for debe ser uno de: ${DEV_TYPES.join(", ")}`);
      return 2;
    }
    console.log("");
    const label = opts.forType ? `Precondiciones para ${targetType}` : `Precondiciones del tipo activo (${targetType})`;
    console.log(`${dim5(label + ":")}`);
    const result = doctor({
      projectRoot,
      session: session ?? {
        feature_id: null,
        feature_name: null,
        session_id: "doctor",
        started_at: (/* @__PURE__ */ new Date()).toISOString(),
        ended_at: null,
        last_heartbeat: null,
        mode: "local",
        platform_url: null,
        unclosed: false,
        dev_type: targetType,
        dev_type_subtype: null,
        dev_type_source: "business-brief",
        dev_type_rationale: "",
        dev_type_locked: false,
        dev_type_locked_at: null,
        apps_affected: [],
        repo_context_path: null,
        baseline_path: null,
        legacy_system: null,
        vendor: null,
        enforcement_rules: [],
        flow_state: "started",
        active_change: null,
        tasks: [],
        blockers: [],
        rag_context_snapshot: null,
        anomalies: [],
        cli_version: "0.2.0",
        schema_version: 2
      },
      forType: targetType
    });
    for (const line of result.text.split("\n").slice(1)) {
      if (line.includes("\u2713")) {
        console.log(`  ${green("\u2713")} ${line.replace(/\s*✓\s*/, "").trim()}`);
      } else if (line.includes("\u2717")) {
        const msg = line.replace(/\s*✗\s*/, "").trim();
        console.log(`  ${isTTY7 ? "\x1B[31m\u2717\x1B[0m" : "\u2717"} ${humanizeRuleId(msg)}`);
      }
    }
    if (result.exitCode === 0) {
      console.log("");
      printOk(`Todas las precondiciones OK para ${targetType}`);
      printDim(`  Puedes ejecutar /new-spec`);
    } else {
      console.log("");
      printWarn(`Hay precondiciones pendientes \u2014 ejecuta dd-cli next para ver qu\xE9 falta`);
    }
  }
  console.log("");
  return 0;
}
function humanizeRuleId(technicalMsg) {
  if (technicalMsg.includes("REPO-CONTEXT") || technicalMsg.includes("REPO_CONTEXT")) {
    return "Falta mapear el repo existente \u2192 ejecuta /init-repo-context en Claude Code";
  }
  if (technicalMsg.includes("BASELINE")) {
    return "Falta capturar el baseline del m\xF3dulo \u2192 ejecuta /capture-baseline en Claude Code";
  }
  if (technicalMsg.includes("legacy_system")) {
    return "Falta identificar el sistema legacy \u2192 completa la HDU en la APP";
  }
  if (technicalMsg.includes("vendor")) {
    return "Falta identificar el vendor \u2192 completa la HDU en la APP";
  }
  return technicalMsg;
}

// src/commands/watch.ts
import { existsSync as existsSync22, readFileSync as readFileSync17, readdirSync as readdirSync4, statSync as statSync5 } from "fs";
import * as path21 from "path";
var isTTY8 = process.stdout.isTTY;
var c2 = {
  reset: "\x1B[0m",
  bold: (s) => isTTY8 ? `\x1B[1m${s}\x1B[0m` : s,
  green: (s) => isTTY8 ? `\x1B[32m${s}\x1B[0m` : s,
  cyan: (s) => isTTY8 ? `\x1B[36m${s}\x1B[0m` : s,
  dim: (s) => isTTY8 ? `\x1B[90m${s}\x1B[0m` : s,
  yellow: (s) => isTTY8 ? `\x1B[33m${s}\x1B[0m` : s
};
function formatDuration4(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "?";
  const totalMin = Math.floor(ms / 6e4);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}
function progressBar(done, total, width = 12) {
  if (total === 0) return "\u2500".repeat(width);
  const filled = Math.round(done / total * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
function activeChangeName(projectRoot) {
  try {
    const changes = path21.join(projectRoot, "openspec", "changes");
    if (!existsSync22(changes)) return null;
    const entries = readdirSync4(changes).filter((e) => {
      return statSync5(path21.join(changes, e)).isDirectory() && existsSync22(path21.join(changes, e, "tasks.md"));
    });
    return entries[0] ?? null;
  } catch {
    return null;
  }
}
function countTasks(projectRoot, changeName) {
  try {
    const content = readFileSync17(path21.join(projectRoot, "openspec", "changes", changeName, "tasks.md"), "utf-8");
    const total = (content.match(/^- \[[ x]\]/gm) ?? []).length;
    const done = (content.match(/^- \[x\]/gm) ?? []).length;
    return { done, total };
  } catch {
    return { done: 0, total: 0 };
  }
}
function renderLines(projectRoot) {
  const W = 78;
  let session;
  try {
    session = loadSession(projectRoot);
  } catch {
    return buildBox(["DevFlow IA", "sin sesi\xF3n"], W);
  }
  if (!session || !session.started_at) {
    return buildBox([
      `${c2.bold("DevFlow IA")}  \xB7  sin sesi\xF3n activa`,
      `Ejecuta: ${c2.cyan("dd-cli start-session <HDU-id>")}`,
      ""
    ], W);
  }
  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  const feature = `${session.feature_id ?? "?"} \xB7 ${session.feature_name ?? ""}`;
  const changeName = activeChangeName(projectRoot);
  const specPart = changeName ? `spec: ${c2.cyan(changeName)}` : c2.dim("spec: pendiente");
  const line1 = `${c2.bold("DevFlow IA")} ${c2.dim("\u2502")} ${feature} ${c2.dim("\u2502")} ${specPart}`;
  const duration = formatDuration4(session.started_at);
  const mode = session.mode === "platform" ? `${c2.green("\u25CF")} platform` : c2.dim("local");
  let taskPart = c2.dim("tasks: \u2014");
  if (changeName) {
    const { done, total } = countTasks(projectRoot, changeName);
    const bar = progressBar(done, total);
    taskPart = `tasks: ${c2.green(bar)}  ${done}/${total}`;
  }
  const line2 = `${taskPart}  ${c2.dim("\u2502")}  ${c2.yellow("\u23F1")} ${duration}  ${c2.dim("\u2502")}  ${mode}`;
  const badge = devTypeBadge(session.dev_type);
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);
  let line3;
  if (blockers.length > 0) {
    const hint = extractHint(blockers[0].message);
    line3 = `${badge}  ${c2.yellow("\u26A0")} ${hint}`;
  } else if (ctx?.currentStage) {
    const step = `paso ${ctx.currentIndex}/${ctx.total}: ${ctx.currentStage.id}`;
    const next = ctx.nextStage ? ` ${c2.dim("\u2192")} ${ctx.nextStage.id}` : "";
    line3 = `${badge}  ${c2.dim(step)}${next}`;
  } else {
    line3 = `${badge}  ${c2.dim(flowState)}`;
  }
  return buildBox([line1, line2, line3], W);
}
function extractHint(msg) {
  if (msg.includes("REPO-CONTEXT")) return c2.cyan("/init-repo-context");
  if (msg.includes("BASELINE")) return c2.cyan("/capture-baseline");
  if (msg.includes("legacy_system")) return "completa legacy_system en HDU";
  if (msg.includes("vendor")) return "completa vendor en HDU";
  return "precondici\xF3n pendiente";
}
function buildBox(lines, width) {
  const hr = "\u2550".repeat(width);
  const out = [`\u2554${hr}\u2557`];
  for (const line of lines) {
    const visible = stripAnsi2(line);
    const pad2 = Math.max(0, width - visible.length - 2);
    out.push(`\u2551 ${line}${" ".repeat(pad2)} \u2551`);
  }
  out.push(`\u255A${hr}\u255D`);
  return out;
}
function stripAnsi2(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
async function runWatch(opts = {}) {
  const interval = (opts.intervalSeconds ?? 5) * 1e3;
  const projectRoot = getProjectRoot();
  if (!isTTY8) {
    renderLines(projectRoot).forEach((l) => console.log(l));
    return;
  }
  process.stdout.write("\x1B[?25l");
  const cleanup = () => {
    process.stdout.write("\x1B[?25h\n");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  let firstRender = true;
  const LINE_COUNT = 5;
  const render = () => {
    const lines = renderLines(projectRoot);
    if (!firstRender) {
      process.stdout.write(`\x1B[${LINE_COUNT}A\r`);
    }
    lines.forEach((l) => process.stdout.write(l + "\n"));
    firstRender = false;
  };
  render();
  const timer = setInterval(render, interval);
  await new Promise((resolve12) => {
    process.on("SIGINT", () => {
      clearInterval(timer);
      cleanup();
      resolve12();
    });
  });
}

// src/commands/install-cmd.ts
import { existsSync as existsSync23, mkdirSync as mkdirSync14, readFileSync as readFileSync18, writeFileSync as writeFileSync12 } from "fs";
import * as path22 from "path";
var STATUSLINE_COMMAND = "dd-cli statusline";
function readGlobalSettings() {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync23(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync18(settingsPath, "utf-8"));
  } catch {
    throw new Error(
      `${settingsPath} existe pero no es JSON v\xE1lido. Corr\xEDgelo manualmente o usa --force.`
    );
  }
}
function writeGlobalSettings(settings) {
  const settingsPath = getClaudeGlobalSettingsPath();
  const dir = path22.dirname(settingsPath);
  if (!existsSync23(dir)) mkdirSync14(dir, { recursive: true });
  writeFileSync12(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}
async function runInstall(opts = {}) {
  console.log(bold("\nDevFlow IA \u2014 install (global)\n"));
  if (!isClaudeCodeInstalled()) {
    printErr(`Claude Code no detectado en ${getClaudeHome()}`);
    printInfo("Instala Claude Code primero: https://claude.com/claude-code");
    return 2;
  }
  let settings;
  try {
    settings = readGlobalSettings();
  } catch (e) {
    if (!opts.force) {
      printErr(e instanceof Error ? e.message : String(e));
      return 2;
    }
    settings = {};
  }
  const existing = settings.statusLine;
  const alreadyOurs = existing?.type === "command" && existing.command === STATUSLINE_COMMAND;
  if (alreadyOurs && !opts.force) {
    printInfo("La statusline DevFlow IA ya est\xE1 instalada globalmente.");
    printDim(`  ${getClaudeGlobalSettingsPath()}`);
    return 0;
  }
  if (existing && !alreadyOurs && !opts.force) {
    printWarn("Ya hay una statusLine configurada en tu settings.json global:");
    printDim(`  ${JSON.stringify(existing)}`);
    printInfo("Usa --force para reemplazarla con la de DevFlow IA.");
    return 1;
  }
  settings.statusLine = {
    type: "command",
    command: STATUSLINE_COMMAND
  };
  writeGlobalSettings(settings);
  printOk("Statusline DevFlow IA instalada globalmente.");
  printDim(`  ${getClaudeGlobalSettingsPath()}`);
  console.log("");
  printInfo("Reinicia Claude Code para verla. Comportamiento por contexto:");
  printDim('  \xB7 Fuera de un proyecto DevFlow \u2192 "DevFlow IA \xB7 vX.Y.Z ready"');
  printDim('  \xB7 Proyecto sin sesi\xF3n          \u2192 "DevFlow IA \xB7 sin sesi\xF3n \xB7 ..."');
  printDim('  \xB7 Sesi\xF3n activa                \u2192 "HDU-X \xB7 paso N/M: ... \xB7 Tm  \u2B22 tipo"');
  return 0;
}
async function runUninstall() {
  console.log(bold("\nDevFlow IA \u2014 uninstall (global)\n"));
  if (!existsSync23(getClaudeGlobalSettingsPath())) {
    printInfo("No hay settings.json global; nada que desinstalar.");
    return 0;
  }
  let settings;
  try {
    settings = readGlobalSettings();
  } catch (e) {
    printErr(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const existing = settings.statusLine;
  const isOurs = existing?.type === "command" && existing.command === STATUSLINE_COMMAND;
  if (!isOurs) {
    printInfo("La statusline global no pertenece a DevFlow IA \u2014 no la toco.");
    if (existing) printDim(`  Actual: ${JSON.stringify(existing)}`);
    return 0;
  }
  delete settings.statusLine;
  writeGlobalSettings(settings);
  printOk("Statusline DevFlow IA removida de tu settings.json global.");
  return 0;
}

// src/commands/flow-cmd.ts
var STAGE_GROUPS = [
  { label: "CAPTURA & DISE\xD1O", matches: (s) => s.id === "start-session" },
  { label: "MAPEO DEL REPO", matches: (s) => s.id === "/init-repo-context" || s.id === "/map-service" || s.id === "/trace-flow" || s.id === "/capture-baseline" },
  { label: "SPEC", matches: (s) => s.id === "/new-spec" || s.id === "/derive-spec" || s.id === "/new-app" },
  { label: "CONSTRUCCI\xD3N SDD", matches: (s) => s.id.startsWith("/opsx:") },
  { label: "RELEASE", matches: (s) => s.id === "/release-check" || s.id === "/end-session" }
];
function groupForStage(s) {
  for (const g of STAGE_GROUPS) if (g.matches(s)) return g.label;
  return "OTROS";
}
function statusIcon(stageIndex, currentIndex) {
  if (currentIndex === null) return "\u2B1C";
  if (stageIndex < currentIndex) return ok("\u2705");
  if (stageIndex === currentIndex) return info("\u{1F535}");
  return "\u2B1C";
}
function resolveContext(opts) {
  if (opts.type) {
    if (!isDevType(opts.type)) {
      return { error: `dev_type inv\xE1lido: "${opts.type}". V\xE1lidos: ${DEV_TYPES.join(", ")}` };
    }
    return {
      devType: opts.type,
      source: "flag",
      currentIndex: null,
      featureId: null,
      featureName: null
    };
  }
  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) {
    return {
      error: "No estoy en un proyecto DevFlow IA y no diste --type.\n  Prueba: dd-cli flow --type=brownfield-feature  (o --all)"
    };
  }
  let session;
  try {
    session = loadSession(projectRoot);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!session || !session.dev_type) {
    return {
      error: "No hay sesi\xF3n activa con dev_type. Opciones:\n  \xB7 dd-cli flow --type=<tipo>  para ver un tipo hipot\xE9tico\n  \xB7 dd-cli flow --all          para ver los 5 tipos\n  \xB7 dd-cli start-session <HDU> para arrancar una sesi\xF3n"
    };
  }
  const flowState = detectFlowState({ projectRoot, session });
  return {
    devType: session.dev_type,
    source: "session",
    currentIndex: currentStageIndex(session.dev_type, flowState),
    featureId: session.feature_id ?? null,
    featureName: session.feature_name ?? null
  };
}
function renderFlow(ctx) {
  const stages = stagesForDevType(ctx.devType);
  const total = stages.length;
  const headerTitle = `Flujo DevFlow IA \xB7 ${ctx.devType}`;
  const subtitle = ctx.source === "session" ? `${ctx.featureId ?? "?"}${ctx.featureName ? " \xB7 " + ctx.featureName : ""}` : "(vista hipot\xE9tica \u2014 sin sesi\xF3n activa)";
  console.log("");
  console.log(bold(headerTitle));
  console.log(dim(subtitle));
  console.log(dim(devTypeBadge(ctx.devType)));
  console.log("");
  let lastGroup = "";
  for (const s of stages) {
    const grp = groupForStage(s);
    if (grp !== lastGroup) {
      if (lastGroup !== "") console.log("");
      console.log(bold(`  ${grp}`));
      lastGroup = grp;
    }
    const icon = statusIcon(s.index, ctx.currentIndex);
    const idCol = s.id.padEnd(22);
    const whereCol = s.invokeIn === "claude" ? dim("(claude)") : dim("(terminal)");
    const youAreHere = ctx.currentIndex !== null && s.index === ctx.currentIndex ? "  " + info("\u2190 est\xE1s ac\xE1") : "";
    console.log(`    ${icon}  ${idCol} ${whereCol}${youAreHere}`);
    if (s.rationale) {
      console.log(`        ${dim(s.rationale)}`);
    }
  }
  console.log("");
  console.log(dim(`Total: ${total} pasos`));
  if (ctx.source === "session" && ctx.currentIndex !== null) {
    const next = stages[ctx.currentIndex - 1];
    if (next) {
      const where = next.invokeIn === "claude" ? "Claude Code" : "la terminal";
      console.log("");
      printInfo(`Tu pr\xF3ximo paso: ejecuta ${bold(next.command)} en ${where}.`);
    }
  } else if (ctx.source === "flag") {
    console.log("");
    printDim("Esta es una vista hipot\xE9tica. Para arrancar:");
    printDim("  dd-cli start-session <HDU-id>");
  }
  console.log("");
}
function renderAll() {
  console.log("");
  console.log(bold("Flujos DevFlow IA \u2014 los 5 dev_types\n"));
  for (const type of DEV_TYPES) {
    const stages = stagesForDevType(type);
    console.log(bold(devTypeBadge(type)) + dim(`  \xB7 ${stages.length} pasos`));
    const summary = stages.map((s) => s.id).join(" \u2192 ");
    console.log(`  ${dim(summary)}`);
    console.log("");
  }
  printDim("Para ver el detalle de uno: dd-cli flow --type=<tipo>");
  console.log("");
}
function runFlow(opts = {}) {
  if (opts.all) {
    renderAll();
    return 0;
  }
  const ctx = resolveContext(opts);
  if ("error" in ctx) {
    printErr(ctx.error);
    return 1;
  }
  renderFlow(ctx);
  return 0;
}

// src/commands/new-hdu-cmd.ts
import { execSync as execSync4, spawn } from "child_process";
import { existsSync as existsSync25, mkdirSync as mkdirSync15, readdirSync as readdirSync5, writeFileSync as writeFileSync13 } from "fs";
import * as path24 from "path";

// src/utils/templates.ts
import { existsSync as existsSync24, readFileSync as readFileSync19 } from "fs";
import * as path23 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
function resolveTemplatesDir() {
  const here = path23.dirname(fileURLToPath4(import.meta.url));
  const bundled = path23.resolve(here, "..", "..", "templates");
  if (existsSync24(bundled)) return bundled;
  const monorepo = path23.resolve(here, "..", "..", "..", "templates");
  if (existsSync24(monorepo)) return monorepo;
  return null;
}
function getTemplatePath(name) {
  const dir = resolveTemplatesDir();
  if (!dir) return null;
  const full = path23.join(dir, name);
  return existsSync24(full) ? full : null;
}
function renderTemplate(templatePath, vars) {
  let content = readFileSync19(templatePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

// src/commands/new-hdu-cmd.ts
var HDU_DIR = path24.join("docs", "hdus");
function slugify(title) {
  return title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "").slice(0, 60);
}
function pad(n) {
  return n.toString().padStart(3, "0");
}
function nextHduId(hduDir) {
  if (!existsSync25(hduDir)) return "001";
  const entries = readdirSync5(hduDir).filter((f) => f.endsWith(".md"));
  let max = 0;
  for (const entry of entries) {
    const match = entry.match(/^HDU-(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return pad(max + 1);
}
function getGitUser(projectRoot) {
  try {
    return execSync4("git config user.name", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim() || (process.env["USER"] ?? "unknown");
  } catch {
    return process.env["USER"] ?? "unknown";
  }
}
function launchClaude(opts) {
  printInfo(`Lanzando Claude Code con ${bold(opts.skill)}...`);
  printDim(`  Archivo: ${opts.hduPath}`);
  console.log("");
  try {
    const child = spawn("claude", [], {
      stdio: "inherit",
      env: {
        ...process.env,
        DEVFLOW_INITIAL_SKILL: opts.skill,
        DEVFLOW_HDU_PATH: opts.hduPath
      }
    });
    child.on("error", (err2) => {
      printWarn(`No pude lanzar 'claude' autom\xE1ticamente: ${err2.message}`);
      printInfo("Abre Claude Code manualmente y ejecuta:");
      printDim(`  ${opts.skill}  (sobre ${opts.hduPath})`);
    });
  } catch (e) {
    printWarn(`No pude lanzar 'claude' autom\xE1ticamente: ${e instanceof Error ? e.message : e}`);
    printInfo("Abre Claude Code manualmente y ejecuta:");
    printDim(`  ${opts.skill}  (sobre ${opts.hduPath})`);
  }
}
async function runNewHdu(title, opts = {}) {
  if (!title || title.trim().length < 5) {
    printErr('Falta el t\xEDtulo de la HDU. Uso: dd-cli new-hdu "<t\xEDtulo>"');
    return 2;
  }
  const projectRoot = findDevFlowProjectRoot() ?? getProjectRoot();
  if (!findDevFlowProjectRoot()) {
    printWarn("No est\xE1s en un proyecto DevFlow IA (no encuentro .devflow/).");
    printInfo("Ejecuta primero: dd-cli init  (o dd-cli init --client=<slug>)");
    return 2;
  }
  const hduDir = path24.join(projectRoot, HDU_DIR);
  if (!existsSync25(hduDir)) mkdirSync15(hduDir, { recursive: true });
  const id = nextHduId(hduDir);
  const slug = slugify(title.trim());
  const fileName = `HDU-${id}-${slug}.md`;
  const hduPath = path24.join(hduDir, fileName);
  const hduPathRel = path24.relative(projectRoot, hduPath);
  const templatePath = getTemplatePath("HDU.md.template");
  if (!templatePath) {
    printErr("No encontr\xE9 HDU.md.template en el paquete.");
    printDim("  Esperado en <package>/templates/ o <monorepo>/templates/");
    return 2;
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const content = renderTemplate(templatePath, {
    ID: id,
    TITLE: title.trim(),
    DATE: today,
    USER: getGitUser(projectRoot)
  });
  if (existsSync25(hduPath)) {
    printErr(`Ya existe ${hduPathRel}. Cambia el t\xEDtulo o borra el archivo.`);
    return 1;
  }
  writeFileSync13(hduPath, content, "utf-8");
  console.log(bold(`
DevFlow IA \u2014 nueva HDU
`));
  printOk(`Creada: ${hduPathRel}`);
  printDim(`  ID:       HDU-${id}`);
  printDim(`  T\xEDtulo:   ${title.trim()}`);
  if (opts.type) printDim(`  Sugerido: ${opts.type} (Tech Lead aprueba en design-hdu)`);
  console.log("");
  if (opts.noClaude) {
    printInfo("Pr\xF3ximo paso (manual): abre Claude Code y ejecuta:");
    printDim(`  /devflow-ia:design-hdu  (sobre ${hduPathRel})`);
    console.log("");
    return 0;
  }
  launchClaude({
    hduPath: hduPathRel,
    skill: "/devflow-ia:design-hdu"
  });
  return 0;
}

// src/commands/health-cmd.ts
import { existsSync as existsSync26, readFileSync as readFileSync20, readdirSync as readdirSync6, statSync as statSync6 } from "fs";
import * as path25 from "path";
function check(label, status, detail) {
  const icons = { ok: ok("\u2713"), warn: warn("\u26A0"), err: err("\u2717"), skip: dim("\xB7") };
  const icon = icons[status];
  const labelPad2 = label.padEnd(16);
  console.log(`  ${icon}  ${labelPad2}${detail}`);
}
function header(title) {
  console.log("");
  console.log(bold(`  ${title}`));
  console.log(dim("  " + "\u2500".repeat(52)));
}
function formatAge(isoDate) {
  if (!isoDate) return "nunca sincronizado";
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(ms / 6e4);
  if (min < 60) return `hace ${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}
function countSkills(dir) {
  if (!existsSync26(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync6(dir)) {
    const full = path25.join(dir, entry);
    try {
      const stat = statSync6(full);
      if (stat.isDirectory()) {
        count += countSkills(full);
      } else if (entry.endsWith(".md")) {
        count++;
      }
    } catch {
    }
  }
  return count;
}
function checkSkills() {
  const skillsDir = getClaudeSkillsDir();
  if (!existsSync26(skillsDir)) {
    return { status: "err", detail: `no instaladas \u2014 ejecuta: dd-cli init o dd-cli skills install` };
  }
  const versionFile = path25.join(skillsDir, ".version");
  if (!existsSync26(versionFile)) {
    return { status: "warn", detail: `instaladas, sin versi\xF3n registrada` };
  }
  const installed = readFileSync20(versionFile, "utf-8").trim();
  if (installed !== CLI_VERSION) {
    return { status: "warn", detail: `v${installed} instalada, v${CLI_VERSION} disponible \u2014 ejecuta: dd-cli skills install` };
  }
  const skills2 = countSkills(skillsDir);
  return { status: "ok", detail: `${skills2} skills \xB7 v${installed}` };
}
function checkStatusline() {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync26(settingsPath)) {
    return { status: "warn", detail: `no configurada \u2014 ejecuta: dd-cli install` };
  }
  try {
    const settings = JSON.parse(readFileSync20(settingsPath, "utf-8"));
    const sl = settings.statusLine;
    if (sl?.type === "command" && sl.command === "dd-cli statusline") {
      return { status: "ok", detail: `activa en ${settingsPath}` };
    }
    return { status: "warn", detail: `settings.json existe pero statusLine no es de DevFlow IA \u2014 ejecuta: dd-cli install` };
  } catch {
    return { status: "warn", detail: `settings.json inv\xE1lido` };
  }
}
function checkClient(slug) {
  const registry = loadRegistry();
  const creds = loadCredentials();
  const entry = registry.clients[slug];
  const issues = [];
  const details = {};
  if (!entry) {
    return { slug, status: "err", issues: ["no registrado \u2014 ejecuta: dd-cli register-client"], details };
  }
  if (!existsSync26(entry.local_cache)) {
    issues.push(`contexto no clonado en ${entry.local_cache}`);
  } else {
    details["contexto"] = entry.local_cache;
    if (hasCatalog(entry.local_cache)) {
      try {
        const catalog = loadCatalog(entry.local_cache);
        const appCount = catalog?.apps.length ?? 0;
        details["app catalog"] = `${appCount} apps catalogadas`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push(`catalog inv\xE1lido \u2014 ${msg.split("\n")[0]}`);
      }
    } else {
      issues.push("catalog no encontrado \u2014 ejecuta /devflow-ia:init-context");
    }
  }
  const clientCreds = creds.clients[slug];
  if (!clientCreds) {
    issues.push("sin credenciales API \u2014 agrega --git-token al register-client");
    details["API"] = "sin credenciales";
  } else {
    details["API"] = `${clientCreds.git_host} \xB7 ${clientCreds.git_group}`;
  }
  const age = formatAge(entry.last_synced ?? null);
  const ageMs = entry.last_synced ? Date.now() - new Date(entry.last_synced).getTime() : Infinity;
  const stale = ageMs > 7 * 24 * 60 * 60 * 1e3;
  details["\xFAltima sync"] = age;
  if (stale) issues.push(`contexto desactualizado (${age}) \u2014 ejecuta: dd-cli pull-context`);
  const status = issues.length === 0 ? "ok" : issues.some((i) => i.includes("no clonado") || i.includes("no registrado")) ? "err" : "warn";
  return { slug, status, issues, details };
}
function checkProject() {
  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) return { isDevFlow: false };
  let connectedClient;
  try {
    const cfg = loadProjectConfig(projectRoot);
    connectedClient = cfg?.client.slug;
  } catch {
  }
  let sessionStatus = "sin sesi\xF3n activa";
  try {
    const session = loadSession(projectRoot);
    if (session?.started_at && !session.ended_at) {
      const feature = session.feature_id ?? "?";
      const type = session.dev_type ?? "?";
      sessionStatus = `sesi\xF3n activa \xB7 ${feature} \xB7 ${devTypeBadge(type)}`;
    } else if (session?.ended_at) {
      sessionStatus = `sesi\xF3n cerrada \xB7 ${session.feature_id ?? "?"}`;
    }
  } catch {
  }
  return { isDevFlow: true, projectRoot, connectedClient, sessionStatus };
}
async function runHealth(opts = {}) {
  const registry = loadRegistry();
  const clientSlugs = opts.client ? [opts.client] : Object.keys(registry.clients);
  if (isJsonMode(opts)) {
    const slCheck2 = checkStatusline();
    const skillsCheck2 = checkSkills();
    const claudeInstalled = isClaudeCodeInstalled();
    const proj2 = checkProject();
    const clients = clientSlugs.map((slug) => {
      const h = checkClient(slug);
      const entry = registry.clients[slug];
      return {
        slug: h.slug,
        status: h.status,
        registered: !!entry,
        context_cache: entry?.local_cache ?? null,
        last_synced: entry?.last_synced ?? null,
        details: h.details,
        issues: h.issues
      };
    });
    const anyClientErr2 = clients.some((c3) => c3.status === "err");
    const overall = slCheck2.status !== "ok" || skillsCheck2.status !== "ok" || anyClientErr2 || clientSlugs.length === 0 ? anyClientErr2 ? "err" : "warn" : "ok";
    emitJson(jsonSuccess("health", {
      cli_version: CLI_VERSION,
      machine: {
        cli: { status: "ok", version: CLI_VERSION },
        statusline: slCheck2,
        claude_code: { installed: claudeInstalled, home: getClaudeHome() },
        skills: skillsCheck2
      },
      clients,
      project: {
        is_devflow: proj2.isDevFlow,
        project_root: proj2.projectRoot ?? null,
        connected_client: proj2.connectedClient ?? null,
        session_status: proj2.sessionStatus ?? null
      },
      overall
    }));
  }
  console.log("");
  console.log(bold("DevFlow IA \u2014 Estado del entorno"));
  console.log(dim(`  v${CLI_VERSION} \xB7 ${(/* @__PURE__ */ new Date()).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}`));
  header("M\xC1QUINA");
  check("CLI", "ok", `v${CLI_VERSION}`);
  const slCheck = checkStatusline();
  check("Statusline", slCheck.status, slCheck.detail);
  if (!isClaudeCodeInstalled()) {
    check("Claude Code", "err", `no detectado en ${getClaudeHome()}`);
  } else {
    check("Claude Code", "ok", `${getClaudeHome()}`);
  }
  const skillsCheck = checkSkills();
  check("Skills", skillsCheck.status, skillsCheck.detail);
  header(`CLIENTES REGISTRADOS (${clientSlugs.length})`);
  if (clientSlugs.length === 0) {
    console.log(`  ${warn("\u26A0")}  Ning\xFAn cliente registrado.`);
    console.log(dim(`     Ejecuta: dd-cli register-client <slug> --context-url=<url>`));
  }
  let anyClientErr = false;
  for (const slug of clientSlugs) {
    const health = checkClient(slug);
    const icon = health.status === "ok" ? ok("\u2713") : health.status === "warn" ? warn("\u26A0") : err("\u2717");
    console.log("");
    console.log(`  ${icon}  ${bold(slug)}`);
    for (const [key, val] of Object.entries(health.details)) {
      console.log(dim(`       ${key.padEnd(14)}${val}`));
    }
    for (const issue of health.issues) {
      console.log(`       ${warn("\u2192")} ${issue}`);
    }
    if (health.status === "err") anyClientErr = true;
  }
  header("PROYECTO ACTUAL");
  const proj = checkProject();
  if (!proj.isDevFlow) {
    check("Proyecto", "skip", `no es un proyecto DevFlow IA (sin .devflow/)`);
    console.log(dim(`     Si quieres inicializar: dd-cli init [--client=<slug>]`));
  } else {
    check("Proyecto", "ok", proj.projectRoot ?? "");
    if (proj.connectedClient) {
      const clientOk = registry.clients[proj.connectedClient] !== void 0;
      check("Cliente", clientOk ? "ok" : "warn", proj.connectedClient + (clientOk ? "" : " (no registrado en esta m\xE1quina)"));
    } else {
      check("Cliente", "warn", "no conectado \u2014 considera: dd-cli init --client=<slug>");
    }
    check("Sesi\xF3n", proj.sessionStatus?.startsWith("sesi\xF3n activa") ? "ok" : "skip", proj.sessionStatus ?? "");
  }
  console.log("");
  const hasIssues = slCheck.status !== "ok" || skillsCheck.status !== "ok" || anyClientErr || clientSlugs.length === 0;
  if (!hasIssues) {
    console.log(`  ${ok("\u2713")}  ${bold("Todo listo.")} Puedes arrancar con: dd-cli start-session <HDU-id>`);
  } else {
    printInfo("Hay configuraciones pendientes. Revisa los \u26A0 y \u2717 arriba.");
    console.log(dim("  dd-cli health --check-api  para verificar la conexi\xF3n a las APIs git"));
  }
  console.log("");
  return hasIssues ? 1 : 0;
}

// src/commands/client-migrate.ts
import { execSync as execSync5 } from "child_process";
import { existsSync as existsSync27, readFileSync as readFileSync21, cpSync } from "fs";
import * as path26 from "path";
import * as yaml9 from "js-yaml";
function runGit3(cmd, cwd) {
  return execSync5(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function buildStackFromLegacyMaster(slug, legacy) {
  const legacyStack = legacy["stack"] ?? {};
  const legacyClient = legacy["client"] ?? legacy["project"] ?? {};
  const s = (obj, key, fallback = "") => {
    const v = obj[key];
    return typeof v === "string" ? v : fallback;
  };
  const n = (obj, key) => {
    const v = obj[key];
    return typeof v === "number" ? v : null;
  };
  const databases = Array.isArray(legacyStack["databases"]) ? legacyStack["databases"] : s(legacyStack, "database") ? [s(legacyStack, "database")] : ["[por-confirmar]"];
  const clientSlug = s(legacyClient, "client_slug") || s(legacyClient, "slug") || slug;
  const clientName = s(legacyClient, "client_name") || s(legacyClient, "name") || slug;
  const industry = s(legacyClient, "industry");
  const teamSize = n(legacyClient, "team_size");
  const primaryContact = s(legacyClient, "primary_contact");
  return {
    schema_version: "1.0",
    client: {
      slug: clientSlug,
      name: clientName,
      industry: industry || null,
      team_size: teamSize,
      primary_contact: primaryContact || null
    },
    stack: {
      backend_framework: s(legacyStack, "backend_framework", "[por-confirmar]"),
      frontend_framework: s(legacyStack, "frontend_framework", "[por-confirmar]"),
      databases,
      infra: s(legacyStack, "infra", "[por-confirmar]"),
      k8s_namespaces: legacyStack["k8s_namespaces"] ?? void 0,
      cicd_platform: s(legacyStack, "cicd_platform", s(legacyStack, "ci_cd_platform", "[por-confirmar]")),
      identity_provider: s(legacyStack, "identity_provider") || null,
      container_registry: s(legacyStack, "container_registry") || null,
      base_domain: s(legacyStack, "base_domain") || null
    },
    naming: legacy["naming"] ?? {},
    defaults: legacy["defaults"] ?? {},
    templates: legacy["templates"] ?? {},
    devflow: legacy["devflow"] ?? {}
  };
}
function planMigration(cacheDir, slug) {
  const steps = [];
  const legacyMasterPath = path26.join(cacheDir, ".devflow", "config.yml");
  const stackYmlExists = hasStackConfig(cacheDir);
  if (!stackYmlExists && existsSync27(legacyMasterPath)) {
    try {
      const raw = readFileSync21(legacyMasterPath, "utf-8");
      const parsed = yaml9.load(raw);
      if (looksLikeLegacyMasterConfig(parsed)) {
        const next = buildStackFromLegacyMaster(slug, parsed);
        StackConfigSchema.parse(next);
        steps.push({
          type: "create-stack-yml-from-legacy-config",
          description: "Generar .devflow-context/stack.yml desde .devflow/config.yml (legacy master)",
          from: ".devflow/config.yml",
          to: ".devflow-context/stack.yml"
        });
      }
    } catch (e) {
      steps.push({
        type: "noop-nothing-to-migrate",
        description: `No se pudo derivar stack.yml desde .devflow/config.yml: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`
      });
    }
  }
  const catalogYmlExists = existsSync27(getCatalogYamlPath(cacheDir));
  const catalogMdExists = existsSync27(getCatalogMarkdownPath(cacheDir));
  if (!catalogYmlExists && catalogMdExists) {
    try {
      const catalog = loadCatalog(cacheDir);
      const validated = CatalogSchema.parse(catalog ?? { apps: [] });
      steps.push({
        type: "create-catalog-yml-from-markdown",
        description: `Generar .devflow-context/catalog.yml desde app-catalog.md (${validated.apps.length} apps)`,
        from: ".devflow-context/app-catalog.md",
        to: ".devflow-context/catalog.yml",
        details: { app_count: validated.apps.length }
      });
    } catch (e) {
      steps.push({
        type: "noop-nothing-to-migrate",
        description: `No se pudo derivar catalog.yml desde app-catalog.md: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`
      });
    }
  }
  if (steps.length === 0) {
    if (stackYmlExists && (catalogYmlExists || !catalogMdExists)) {
      steps.push({
        type: "noop-already-migrated",
        description: "El cliente ya usa el schema nuevo \u2014 nada que migrar"
      });
    } else if (!hasCatalog(cacheDir) && !existsSync27(legacyMasterPath)) {
      steps.push({
        type: "noop-nothing-to-migrate",
        description: "Context repo vac\xEDo o incompleto \u2014 corr\xE9 /devflow-ia:init-context primero"
      });
    }
  }
  return steps;
}
function applyMigration(cacheDir, slug, steps) {
  for (const step of steps) {
    if (step.type === "create-stack-yml-from-legacy-config") {
      const raw = readFileSync21(path26.join(cacheDir, ".devflow", "config.yml"), "utf-8");
      const parsed = yaml9.load(raw);
      const next = buildStackFromLegacyMaster(slug, parsed);
      const config = StackConfigSchema.parse(next);
      saveStackConfig(cacheDir, config);
    }
    if (step.type === "create-catalog-yml-from-markdown") {
      const catalog = loadCatalog(cacheDir);
      if (catalog) saveCatalog(cacheDir, catalog);
    }
  }
}
function makeBackup(cacheDir, slug) {
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = `${path26.dirname(cacheDir)}/${slug}.bak-${ts}`;
  cpSync(cacheDir, backupDir, { recursive: true });
  return backupDir;
}
function commitAndPush(cacheDir, slug, steps, noPush) {
  try {
    const filesTouched = steps.filter((s) => s.to).map((s) => s.to).join(" ");
    if (!filesTouched) return false;
    runGit3(`git add ${filesTouched}`, cacheDir);
    let status = "";
    try {
      status = runGit3("git diff --cached --stat", cacheDir);
    } catch {
    }
    if (!status.trim()) return false;
    runGit3(
      `git commit -m "chore: migrate ${slug} to dd-cli v0.6 schemas

${steps.map((s) => "- " + s.description).join("\n")}

Generado por dd-cli client migrate"`,
      cacheDir
    );
    if (!noPush) {
      try {
        runGit3("git push origin HEAD", cacheDir);
      } catch {
        return false;
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function runClientMigrate(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug) {
    const err2 = {
      code: "INVALID_INPUT",
      message: "Falta el slug del cliente. Uso: dd-cli client migrate <slug>",
      recovery_hints: ["Ejecut\xE1: dd-cli client list para ver los registrados"]
    };
    if (jsonMode) emitJson(jsonError({ command: "client migrate", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const entry = getClient(slug);
  if (!entry) {
    const err2 = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${slug}" no registrado en ~/.devflow/registry.yml.`,
      context: { slug },
      recovery_hints: [
        `Registr\xE1 el cliente primero: dd-cli register-client ${slug} --context-url=<url>`
      ],
      next_safe_command: `dd-cli register-client ${slug} --context-url=<url>`
    };
    if (jsonMode) emitJson(jsonError({ command: "client migrate", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(slug);
  if (!existsSync27(cacheDir)) {
    const err2 = {
      code: "CONTEXT_CACHE_MISSING",
      message: `Cache local no encontrada en ${cacheDir}.`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [`Sincroniz\xE1: dd-cli pull-context ${slug}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client migrate", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const steps = planMigration(cacheDir, slug);
  const apply = !!opts.apply;
  const noPush = !!opts.noPush;
  const plan = {
    slug,
    cache_dir: cacheDir,
    steps,
    applied: false,
    pushed: false
  };
  const hasWork = steps.some((s) => s.type !== "noop-already-migrated" && s.type !== "noop-nothing-to-migrate");
  if (!apply || !hasWork) {
    if (jsonMode) {
      emitJson(jsonSuccess("client migrate", plan, hasWork ? `dd-cli client migrate ${slug} --apply` : null));
    }
    console.log(bold(`
Plan de migraci\xF3n para ${slug}
`));
    printDim(`  Cache: ${cacheDir}`);
    console.log("");
    for (const step of steps) {
      const marker = step.type.startsWith("noop") ? printDim : printOk;
      marker(`  ${step.description}`);
    }
    if (hasWork && !apply) {
      console.log("");
      printInfo("Para aplicar: dd-cli client migrate " + slug + " --apply");
    }
    recordCommandResult(slug, "client migrate", { success: true });
    return 0;
  }
  try {
    const backupDir = makeBackup(cacheDir, slug);
    plan.backup_dir = backupDir;
    if (!jsonMode) printDim(`  \u2713 Backup en ${backupDir}`);
    applyMigration(cacheDir, slug, steps);
    plan.applied = true;
    if (!jsonMode) printOk("Migraci\xF3n aplicada en la cache local");
    plan.pushed = commitAndPush(cacheDir, slug, steps, noPush);
    if (!jsonMode) {
      if (plan.pushed) printOk("Commit + push al context repo");
      else if (noPush) printInfo("--no-push activo, commit local sin push");
      else printWarn("No se pudo pushear (revis\xE1 permisos del token)");
    }
    recordCommandResult(slug, "client migrate", { success: true, state: "READY" });
    if (jsonMode) {
      emitJson(jsonSuccess("client migrate", plan, `dd-cli health --client=${slug}`));
    }
    console.log("");
    printOk("Migraci\xF3n completada");
    printInfo(`Verific\xE1: dd-cli health --client=${slug}`);
    return 0;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const errObj = {
      code: "INTERNAL_ERROR",
      message: `Error durante la migraci\xF3n: ${errMsg}`,
      context: { slug, cache_dir: cacheDir, backup_dir: plan.backup_dir },
      recovery_hints: [
        plan.backup_dir ? `Restaur\xE1 desde el backup: rm -rf ${cacheDir} && mv ${plan.backup_dir} ${cacheDir}` : "",
        `Report\xE1 el bug con el output de: dd-cli client migrate ${slug} --json`
      ].filter(Boolean)
    };
    recordCommandResult(slug, "client migrate", { success: false, error: errObj });
    if (jsonMode) emitJson(jsonError({ command: "client migrate", ...errObj }));
    printErr(errObj.message);
    return 1;
  }
}

// src/commands/client-discover.ts
import { mkdirSync as mkdirSync17, writeFileSync as writeFileSync15 } from "fs";
import * as path27 from "path";
import ora from "ora";

// src/discovery/pattern-detector.ts
function detectStack(files) {
  const pkg = files["package.json"];
  const composer = files["composer.json"];
  const pom = files["pom.xml"];
  const requirements = files["requirements.txt"];
  const gemfile = files["Gemfile"];
  if (pkg?.found) {
    try {
      const json = JSON.parse(pkg.content);
      const deps = { ...json.dependencies, ...json.devDependencies };
      const scripts = json.scripts ?? {};
      const enginesNode = json.engines?.node ?? null;
      let framework = null;
      if (deps["@nestjs/core"]) framework = "nestjs";
      else if (deps["express"]) framework = "express";
      else if (deps["fastify"]) framework = "fastify";
      else if (deps["@angular/core"]) framework = "angular";
      else if (deps["react"]) framework = "react";
      else if (deps["next"]) framework = "nextjs";
      else if (deps["vue"]) framework = "vue";
      let db = null;
      if (deps["typeorm"] || deps["@nestjs/typeorm"]) db = "typeorm";
      if (deps["pg"] || deps["pg-promise"]) db = db ? `${db}+postgresql` : "postgresql";
      if (deps["oracledb"]) db = db ? `${db}+oracle` : "oracle";
      if (deps["mysql2"] || deps["mysql"]) db = db ? `${db}+mysql` : "mysql";
      if (deps["mongoose"] || deps["mongodb"]) db = db ? `${db}+mongodb` : "mongodb";
      return {
        language: "typescript/javascript",
        framework,
        db,
        node_version: enginesNode,
        php_version: null
      };
    } catch {
    }
  }
  if (composer?.found) {
    try {
      const json = JSON.parse(composer.content);
      const require2 = json.require ?? {};
      let framework = null;
      if (require2["laravel/framework"]) framework = "laravel";
      else if (require2["symfony/symfony"]) framework = "symfony";
      let db = null;
      if (framework === "laravel") db = "eloquent";
      const phpVersion = json.require?.["php"]?.replace(/[^0-9.]/g, "") ?? null;
      return { language: "php", framework, db, node_version: null, php_version: phpVersion };
    } catch {
    }
  }
  if (pom?.found) {
    const hasSpring = pom.content.includes("spring-boot");
    return {
      language: "java",
      framework: hasSpring ? "spring-boot" : "java",
      db: pom.content.includes("postgresql") ? "postgresql" : null,
      node_version: null,
      php_version: null
    };
  }
  if (requirements?.found) {
    const hasDjango = requirements.content.includes("Django");
    const hasFastAPI = requirements.content.includes("fastapi");
    return {
      language: "python",
      framework: hasFastAPI ? "fastapi" : hasDjango ? "django" : null,
      db: requirements.content.includes("psycopg") ? "postgresql" : null,
      node_version: null,
      php_version: null
    };
  }
  if (gemfile?.found) {
    const hasRails = gemfile.content.includes("'rails'");
    return { language: "ruby", framework: hasRails ? "rails" : null, db: null, node_version: null, php_version: null };
  }
  return { language: null, framework: null, db: null, node_version: null, php_version: null };
}
function detectAuth(files, repoSlug) {
  const allContent = Object.values(files).map((f) => f.content).join("\n").toLowerCase();
  if (allContent.includes("messagebus") || allContent.includes("postmessage") || allContent.includes("portal-bridge") || allContent.includes("portalauthservice")) {
    return "portal-embedded";
  }
  if (allContent.includes("keycloak") || allContent.includes("azure-ad") || allContent.includes("auth0") || allContent.includes("openidconnect") || allContent.includes("oauth2") || allContent.includes("oidc")) {
    return "oauth2-oidc";
  }
  if (allContent.includes("jsonwebtoken") || allContent.includes("jwtservice") || allContent.includes("@nestjs/jwt") || allContent.includes("jwt_secret") || allContent.includes("passport-jwt") || allContent.includes("tymon/jwt-auth")) {
    return "custom-jwt";
  }
  if (allContent.includes("x-api-key") || allContent.includes("apikey") || allContent.includes("api-key-guard") || allContent.includes("apikeyguard")) {
    return "api-key-internal";
  }
  if (repoSlug.includes("landing") || repoSlug.includes("docs") || repoSlug.includes("static") || repoSlug.includes("public")) {
    return "none-public";
  }
  return "unknown";
}
function detectCiStages(ciFile) {
  if (!ciFile.found) return [];
  const stageMatch = ciFile.content.match(/^stages:\s*\n((?:\s+-\s+\S+\n?)+)/m);
  if (!stageMatch) return [];
  return (stageMatch[1] ?? "").split("\n").map((l) => l.replace(/^\s+-\s+/, "").trim()).filter(Boolean);
}
function detectK8sNamespace(ciFile) {
  if (!ciFile.found) return null;
  const match = ciFile.content.match(/NAMESPACE[:\s=]+["']?([a-z0-9-]+)["']?/i);
  return match?.[1] ?? null;
}
function detectAppType(files, stack, repoSlug) {
  const pkg = files["package.json"];
  if (pkg?.found) {
    try {
      const json = JSON.parse(pkg.content);
      const deps = { ...json.dependencies, ...json.devDependencies };
      if (deps["single-spa"] || deps["@angular-architects/module-federation"]) return "frontend-mfe";
      if (stack.framework === "angular" || stack.framework === "react" || stack.framework === "vue") return "frontend-app";
      if (stack.framework === "nestjs" && repoSlug.includes("bff")) return "bff";
      if (stack.framework === "nestjs") return repoSlug.includes("api") ? "api-rest" : "microservice";
    } catch {
    }
  }
  if (stack.framework === "laravel") return repoSlug.includes("api") ? "api-rest" : "microservice";
  if (stack.framework === "spring-boot") return "microservice";
  if (repoSlug.includes("worker") || repoSlug.includes("job") || repoSlug.includes("cron")) return "worker";
  return "microservice";
}
function analyzeRepo(meta, files) {
  const stack = detectStack(files);
  const auth = detectAuth(files, meta.slug);
  const ciFile = files[".gitlab-ci.yml"] ?? files[".github/workflows/ci.yml"] ?? { path: "", content: "", found: false };
  const ciStages = detectCiStages(ciFile);
  const k8sNamespace = detectK8sNamespace(ciFile);
  const appType = detectAppType(files, stack, meta.slug);
  const lastPushDate = meta.last_push ? new Date(meta.last_push) : null;
  const lastActiveDays = lastPushDate ? Math.floor((Date.now() - lastPushDate.getTime()) / 864e5) : 9999;
  const isTemplate = /template|base|starter|scaffold/i.test(meta.slug);
  const isPortalShell = meta.slug.includes("shell") || meta.slug.includes("portal") || (files["package.json"]?.content ?? "").includes("single-spa");
  const isMfe = appType === "frontend-mfe" || meta.slug.includes("mfe");
  return {
    slug: meta.slug,
    display_name: meta.name,
    stack,
    app_type: appType,
    app_origin: lastActiveDays < 180 && !meta.archived ? "legacy-app" : "legacy-app",
    // siempre legacy hasta confirmar
    auth_pattern: auth,
    is_template: isTemplate,
    is_portal_shell: isPortalShell,
    is_mfe: isMfe,
    ci_stages: ciStages,
    k8s_namespace: k8sNamespace,
    last_active_days: lastActiveDays,
    inactive: lastActiveDays > 365 || meta.archived
  };
}
function synthesizeDiscovery(analyses) {
  const active = analyses.filter((a) => !a.inactive);
  const inactive = analyses.filter((a) => a.inactive);
  const authPatterns = [...new Set(active.map((a) => a.auth_pattern).filter((p) => p !== "unknown"))];
  const templates = active.filter((a) => a.is_template).map((a) => a.slug);
  const portal = active.find((a) => a.is_portal_shell)?.slug ?? null;
  const mfes = active.filter((a) => a.is_mfe).map((a) => a.slug);
  const dbs = [...new Set(active.map((a) => a.stack.db).filter(Boolean))];
  const withCi = active.filter((a) => a.ci_stages.length > 0);
  const ciTemplate = withCi.length > 0 ? withCi[0]?.ci_stages.join(" \u2192 ") ?? null : null;
  const summary = [
    `Encontr\xE9 ${analyses.length} repos en total (${active.length} activos, ${inactive.length} sin actividad en >1 a\xF1o).`,
    authPatterns.length > 0 ? `Patrones de auth detectados: ${authPatterns.join(", ")}.` : "",
    templates.length > 0 ? `Templates base identificados: ${templates.join(", ")}.` : "",
    portal ? `Portal shell principal: ${portal}.` : "",
    mfes.length > 0 ? `Microfrontends: ${mfes.length} (${mfes.slice(0, 3).join(", ")}${mfes.length > 3 ? "..." : ""}).` : "",
    dbs.length > 0 ? `Bases de datos: ${dbs.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  return {
    repos: analyses,
    auth_profiles_detected: authPatterns,
    templates_detected: templates,
    portal_shell: portal,
    mfes,
    ci_template: ciTemplate,
    dbs_detected: dbs,
    active_repos: active.length,
    inactive_repos: inactive.length,
    summary
  };
}

// src/commands/client-discover.ts
var DISCOVERY_FILES = [
  // stack
  "package.json",
  "composer.json",
  "pom.xml",
  "requirements.txt",
  "Gemfile",
  // ci/cd
  ".gitlab-ci.yml",
  ".github/workflows/ci.yml",
  // auth detection necesita ver código, pero leer todo es caro;
  // tomamos config/sso.php y src/auth/index.ts como muestras representativas
  "config/sso.php",
  "config/auth.php",
  "src/auth/index.ts",
  "src/main.ts",
  "app/Http/Kernel.php"
];
async function readKeyFiles(provider, repoIdOrSlug, branch, concurrency) {
  const result = {};
  const queue = [...DISCOVERY_FILES];
  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        result[file] = await provider.readFile(repoIdOrSlug, file, branch);
      } catch {
        result[file] = { path: file, content: "", found: false };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}
function getDiscoveryPath(slug, override) {
  if (override) return path27.resolve(override);
  return path27.join(getDevflowGlobalDir(), "clients", `${slug}.discovery.json`);
}
async function runClientDiscover(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug) {
    const err2 = {
      code: "INVALID_INPUT",
      message: "Falta el slug. Uso: dd-cli client discover <slug>",
      recovery_hints: ["List\xE1 clientes registrados: dd-cli health"]
    };
    if (jsonMode) emitJson(jsonError({ command: "client discover", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const entry = getClient(slug);
  if (!entry) {
    const err2 = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${slug}" no registrado.`,
      context: { slug },
      recovery_hints: [
        `Registr\xE1 el cliente: dd-cli register-client ${slug} --context-url=<url> --git-token=<PAT> --git-group=<grupo>`
      ],
      next_safe_command: `dd-cli register-client ${slug} --context-url=<url>`
    };
    if (jsonMode) emitJson(jsonError({ command: "client discover", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const creds = getClientCredentials(slug);
  if (!creds) {
    const err2 = {
      code: "TOKEN_MISSING",
      message: `No hay credenciales API para "${slug}".`,
      context: { slug },
      recovery_hints: [
        `Agreg\xE1 las credenciales: dd-cli register-client ${slug} --context-url=${entry.context_url} --git-token=<PAT> --git-group=<grupo> --force`
      ],
      next_safe_command: `dd-cli register-client ${slug} --git-token=<PAT> --git-group=<grupo> --force`
    };
    if (jsonMode) emitJson(jsonError({ command: "client discover", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const provider = createProvider(creds);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 20));
  const outPath = getDiscoveryPath(slug, opts.out);
  const spinner = jsonMode ? null : ora({ text: `Analizando repos de ${provider.type}/${provider.group_or_org} ...`, isSilent: false }).start();
  try {
    const tokenCheck = await provider.validateToken({ required_for: ["read"] });
    if (!tokenCheck.valid) {
      spinner?.fail("Token inv\xE1lido");
      const err2 = {
        code: "TOKEN_INVALID",
        message: tokenCheck.message,
        context: { provider: provider.type, user: tokenCheck.user },
        recovery_hints: [
          `Regener\xE1 el token: dd-cli register-client ${slug} --git-token=<nuevo> --force`
        ]
      };
      recordCommandResult(slug, "client discover", { success: false, error: err2 });
      if (jsonMode) emitJson(jsonError({ command: "client discover", ...err2 }));
      printErr(tokenCheck.message);
      return 1;
    }
    const repos = await provider.listGroupRepos();
    if (spinner) spinner.text = `Encontrados ${repos.length} repos. Analizando archivos clave ...`;
    const candidates = opts.activeOnly ? repos.filter((r) => !r.archived) : repos;
    const analyses = [];
    let processed = 0;
    for (const meta of candidates) {
      const lastPushDate = meta.last_push ? new Date(meta.last_push) : null;
      const lastActiveDays = lastPushDate ? Math.floor((Date.now() - lastPushDate.getTime()) / 864e5) : 9999;
      const veryInactive = meta.archived || lastActiveDays > 365;
      const files = veryInactive ? {} : await readKeyFiles(provider, identifierFor(provider, meta), meta.default_branch, concurrency);
      analyses.push(analyzeRepo(meta, files));
      processed++;
      if (spinner) spinner.text = `Analizando repos ... ${processed}/${candidates.length}`;
    }
    const discovery = synthesizeDiscovery(analyses);
    const output = {
      slug,
      provider: provider.type,
      group_or_org: provider.group_or_org,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      discovery,
      saved_to: outPath
    };
    mkdirSync17(path27.dirname(outPath), { recursive: true });
    writeFileSync15(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
    recordCommandResult(slug, "client discover", {
      success: true,
      state: "DISCOVERED",
      nextSafe: `dd-cli client migrate ${slug} --apply  # si es legacy`
    });
    spinner?.succeed(`Discovery completo (${analyses.length} repos)`);
    if (jsonMode) {
      emitJson(jsonSuccess("client discover", output, `dd-cli client migrate ${slug}`));
    }
    console.log("");
    console.log(bold(`Discovery para ${slug}`));
    console.log(dimLine(`  Provider:     ${provider.type} @ ${provider.base_url}`));
    console.log(dimLine(`  Group/Org:    ${provider.group_or_org}`));
    console.log(dimLine(`  Repos:        ${discovery.repos.length} total \xB7 ${discovery.active_repos} activos \xB7 ${discovery.inactive_repos} inactivos`));
    if (discovery.auth_profiles_detected.length > 0) {
      console.log(dimLine(`  Auth:         ${discovery.auth_profiles_detected.join(", ")}`));
    }
    if (discovery.templates_detected.length > 0) {
      console.log(dimLine(`  Templates:    ${discovery.templates_detected.join(", ")}`));
    }
    if (discovery.portal_shell) {
      console.log(dimLine(`  Portal shell: ${discovery.portal_shell}`));
    }
    if (discovery.mfes.length > 0) {
      console.log(dimLine(`  MFEs:         ${discovery.mfes.length} (${discovery.mfes.slice(0, 5).join(", ")}${discovery.mfes.length > 5 ? "..." : ""})`));
    }
    if (discovery.dbs_detected.length > 0) {
      console.log(dimLine(`  DBs:          ${discovery.dbs_detected.join(", ")}`));
    }
    console.log("");
    printInfo(`JSON guardado: ${outPath}`);
    printDim("  Consumible por skills, CI y la app web futura.");
    console.log("");
    printInfo("Pr\xF3ximo paso:");
    printDim(`  dd-cli client migrate ${slug}      # si tiene contexto legacy`);
    printDim(`  /devflow-ia:client-onboard         # publicar context repo nuevo (Sprint 3)`);
    return 0;
  } catch (e) {
    spinner?.fail("Discovery fall\xF3");
    const errMsg = e instanceof Error ? e.message : String(e);
    const err2 = {
      code: "NETWORK_ERROR",
      message: `Error durante discovery: ${errMsg}`,
      context: { slug, provider: provider.type },
      recovery_hints: [
        "Verific\xE1 conectividad y validez del token",
        `Valid\xE1 scopes: dd-cli health --check-api --client=${slug}`
      ]
    };
    recordCommandResult(slug, "client discover", { success: false, error: err2 });
    if (jsonMode) emitJson(jsonError({ command: "client discover", ...err2 }));
    printErr(err2.message);
    return 1;
  }
}
function identifierFor(provider, meta) {
  if (provider.type === "gitlab") return meta.id;
  return meta.slug;
}
function dimLine(s) {
  return s;
}

// src/commands/context-validate.ts
import { existsSync as existsSync28, readdirSync as readdirSync7 } from "fs";
import * as path28 from "path";
function authProfilesAvailable(repoRoot) {
  const dir = path28.join(repoRoot, ".devflow-context", "auth-profiles");
  if (!existsSync28(dir)) return /* @__PURE__ */ new Set();
  return new Set(
    readdirSync7(dir).filter((f) => f.endsWith(".md") || f.endsWith(".yml")).map((f) => f.replace(/\.(md|yml)$/, ""))
  );
}
function cicdProfilesAvailable(repoRoot) {
  const dir = path28.join(repoRoot, ".devflow-context", "cicd-profiles");
  if (!existsSync28(dir)) return /* @__PURE__ */ new Set();
  return new Set(
    readdirSync7(dir).filter((f) => f.endsWith(".yml")).map((f) => f.replace(/\.yml$/, ""))
  );
}
function validateContextRepo(repoRoot) {
  const findings = [];
  if (!isContextRepo(repoRoot)) {
    findings.push({
      level: "err",
      rule: "is-context-repo",
      message: "El directorio no parece ser un context repo (no hay .devflow-context/).",
      hint: "Corr\xE9 /devflow-ia:client-onboard para inicializarlo (Sprint 3)."
    });
    return findings;
  }
  const markerPath = getContextRepoMarkerPath(repoRoot);
  if (!existsSync28(markerPath)) {
    findings.push({
      level: "warn",
      rule: "context-repo-marker",
      message: ".devflow-context/.context-repo.yml no encontrado (legacy).",
      hint: "Ser\xE1 generado al pasar por /devflow-ia:client-onboard o dd-cli client publish."
    });
  } else {
    try {
      const marker = loadContextRepoMarker(repoRoot);
      if (marker) {
        findings.push({
          level: "ok",
          rule: "context-repo-marker",
          message: `Marcador OK \u2014 cliente "${marker.client.slug}", schema v${marker.schema_version}`
        });
      }
    } catch (e) {
      findings.push({
        level: "err",
        rule: "context-repo-marker",
        message: e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e),
        hint: "Revis\xE1 el YAML del marcador."
      });
    }
  }
  if (!hasStackConfig(repoRoot)) {
    findings.push({
      level: "warn",
      rule: "stack-config",
      message: ".devflow-context/stack.yml no encontrado.",
      hint: "Si es un context repo legacy, corr\xE9: dd-cli client migrate <slug> --apply"
    });
  } else {
    try {
      const stack = loadStackConfig(repoRoot);
      if (stack) {
        findings.push({
          level: "ok",
          rule: "stack-config",
          message: `stack.yml OK \u2014 ${stack.stack.backend_framework} + ${stack.stack.frontend_framework}`
        });
      }
    } catch (e) {
      findings.push({
        level: "err",
        rule: "stack-config",
        message: e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e),
        hint: `Revis\xE1 ${getStackConfigPath(repoRoot)}`
      });
    }
  }
  if (!hasCatalog(repoRoot)) {
    findings.push({
      level: "warn",
      rule: "catalog",
      message: "No hay catalog.yml ni app-catalog.md",
      hint: "Corr\xE9 /devflow-ia:init-context para poblarlo."
    });
  } else {
    try {
      const catalog = loadCatalog(repoRoot);
      const apps = catalog?.apps ?? [];
      findings.push({
        level: "ok",
        rule: "catalog",
        message: `catalog OK \u2014 ${apps.length} apps`
      });
      const authAvailable = authProfilesAvailable(repoRoot);
      const cicdAvailable = cicdProfilesAvailable(repoRoot);
      for (const app of apps) {
        if (app.auth_profile && !authAvailable.has(app.auth_profile)) {
          findings.push({
            level: "warn",
            rule: "app-auth-ref",
            message: `App "${app.slug}" referencia auth_profile "${app.auth_profile}" que no existe en auth-profiles/`,
            hint: `Agreg\xE1 auth-profiles/${app.auth_profile}.md`
          });
        }
        if (app.ci_cd_profile && app.ci_cd_profile !== "[por-confirmar]" && !cicdAvailable.has(app.ci_cd_profile)) {
          findings.push({
            level: "warn",
            rule: "app-cicd-ref",
            message: `App "${app.slug}" referencia ci_cd_profile "${app.ci_cd_profile}" que no existe en cicd-profiles/`,
            hint: `Agreg\xE1 cicd-profiles/${app.ci_cd_profile}.yml`
          });
        }
      }
      if (!existsSync28(getCatalogYamlPath(repoRoot)) && existsSync28(getCatalogMarkdownPath(repoRoot))) {
        findings.push({
          level: "warn",
          rule: "catalog-format",
          message: "Cat\xE1logo en markdown legacy (app-catalog.md).",
          hint: `Migr\xE1 a YAML can\xF3nico: dd-cli context render (o dd-cli client migrate)`
        });
      }
    } catch (e) {
      findings.push({
        level: "err",
        rule: "catalog",
        message: e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e)
      });
    }
  }
  return findings;
}
async function runContextValidate(repoPathArg, opts = {}) {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path28.resolve(repoPathArg ?? process.cwd());
  if (!existsSync28(repoRoot)) {
    const err2 = {
      code: "INVALID_INPUT",
      message: `El path "${repoRoot}" no existe.`,
      recovery_hints: ["Corr\xE9 desde un context repo o pas\xE1 un path v\xE1lido."]
    };
    if (jsonMode) emitJson(jsonError({ command: "context validate", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const findings = validateContextRepo(repoRoot);
  const errors = findings.filter((f) => f.level === "err");
  const warnings = findings.filter((f) => f.level === "warn");
  const oks = findings.filter((f) => f.level === "ok");
  if (jsonMode) {
    emitJson(jsonSuccess("context validate", {
      repo_root: repoRoot,
      findings,
      summary: {
        ok: oks.length,
        warnings: warnings.length,
        errors: errors.length
      },
      passed: errors.length === 0
    }));
  }
  console.log("");
  console.log(bold(`Validaci\xF3n del context repo: ${repoRoot}`));
  console.log("");
  for (const f of findings) {
    if (f.level === "ok") printOk(`  ${f.rule}: ${f.message}`);
    else if (f.level === "warn") printWarn(`  ${f.rule}: ${f.message}`);
    else printErr(`  ${f.rule}: ${f.message}`);
    if (f.hint) printDim(`     \u2192 ${f.hint}`);
  }
  console.log("");
  if (errors.length === 0 && warnings.length === 0) {
    printOk("Context repo v\xE1lido.");
  } else if (errors.length === 0) {
    printInfo(`${oks.length} OK \xB7 ${warnings.length} warnings \xB7 0 errores`);
  } else {
    printErr(`${oks.length} OK \xB7 ${warnings.length} warnings \xB7 ${errors.length} errores`);
  }
  return errors.length === 0 ? 0 : 3;
}

// src/commands/context-render.ts
import { existsSync as existsSync29, readFileSync as readFileSync22, writeFileSync as writeFileSync16 } from "fs";
import * as path29 from "path";
async function runContextRender(repoPathArg, opts = {}) {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path29.resolve(repoPathArg ?? process.cwd());
  if (!existsSync29(repoRoot)) {
    const err2 = {
      code: "INVALID_INPUT",
      message: `El path "${repoRoot}" no existe.`,
      recovery_hints: ["Corr\xE9 desde un context repo o pas\xE1 un path v\xE1lido."]
    };
    if (jsonMode) emitJson(jsonError({ command: "context render", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  if (!isContextRepo(repoRoot)) {
    const err2 = {
      code: "CONTEXT_REPO_INVALID",
      message: "El directorio no parece ser un context repo (no hay .devflow-context/).",
      context: { repo_root: repoRoot },
      recovery_hints: [
        "Valid\xE1 primero: dd-cli context validate",
        "Si todav\xEDa no existe el context repo: /devflow-ia:client-onboard (Sprint 3)"
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "context render", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const steps = [];
  const yamlPath = getCatalogYamlPath(repoRoot);
  const mdPath = getCatalogMarkdownPath(repoRoot);
  if (!existsSync29(yamlPath)) {
    steps.push({
      type: "catalog-md",
      from: yamlPath,
      to: mdPath,
      action: "skipped",
      reason: "No hay catalog.yml \u2014 nada que renderizar. Corr\xE9 `dd-cli client migrate <slug>` si ten\xE9s app-catalog.md viejo."
    });
  } else {
    try {
      const catalog = loadCatalog(repoRoot);
      if (!catalog) {
        steps.push({ type: "catalog-md", from: yamlPath, to: mdPath, action: "skipped", reason: "catalog.yml vac\xEDo" });
      } else {
        const next = renderCatalogMarkdown(catalog);
        const current = existsSync29(mdPath) ? readFileSync22(mdPath, "utf-8") : "";
        if (current === next && !opts.force) {
          steps.push({ type: "catalog-md", from: yamlPath, to: mdPath, action: "unchanged" });
        } else if (opts.dryRun) {
          steps.push({ type: "catalog-md", from: yamlPath, to: mdPath, action: "would-write" });
        } else {
          writeFileSync16(mdPath, next, "utf-8");
          steps.push({ type: "catalog-md", from: yamlPath, to: mdPath, action: "written" });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message.split("\n")[0] ?? e.message : String(e);
      const err2 = {
        code: "CATALOG_PARSE_ERROR",
        message: `catalog.yml inv\xE1lido: ${errMsg}`,
        context: { repo_root: repoRoot, yaml_path: yamlPath },
        recovery_hints: [
          "Valid\xE1 schema: dd-cli context validate",
          `Revis\xE1 ${yamlPath} a mano`
        ]
      };
      if (jsonMode) emitJson(jsonError({ command: "context render", ...err2 }));
      printErr(err2.message);
      return 3;
    }
  }
  if (jsonMode) {
    emitJson(jsonSuccess("context render", {
      repo_root: repoRoot,
      steps,
      written: steps.some((s) => s.action === "written"),
      dry_run: !!opts.dryRun
    }));
  }
  console.log("");
  console.log(bold(`Render de vistas derivadas: ${repoRoot}`));
  console.log("");
  for (const step of steps) {
    const target = path29.relative(repoRoot, step.to);
    switch (step.action) {
      case "written":
        printOk(`  ${target} \u2190 regenerado`);
        break;
      case "would-write":
        printInfo(`  ${target} \u2190 cambiar\xEDa (dry-run)`);
        break;
      case "unchanged":
        printDim(`  ${target} sin cambios`);
        break;
      case "skipped":
        printDim(`  ${target} omitido (${step.reason ?? "sin raz\xF3n"})`);
        break;
    }
  }
  return 0;
}

// src/commands/context-install-ci.ts
import { existsSync as existsSync30, readFileSync as readFileSync23, writeFileSync as writeFileSync17, mkdirSync as mkdirSync18 } from "fs";
import * as path30 from "path";
import { fileURLToPath as fileURLToPath5 } from "url";
function resolveTemplatePath(filename) {
  try {
    const here = path30.dirname(fileURLToPath5(import.meta.url));
    const candidates = [
      path30.resolve(here, "../templates/ci", filename),
      path30.resolve(here, "../../templates/ci", filename),
      path30.resolve(here, "../../../templates/ci", filename)
    ];
    for (const c3 of candidates) {
      if (existsSync30(c3)) return c3;
    }
  } catch {
  }
  return null;
}
async function runContextInstallCi(repoPathArg, opts = {}) {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path30.resolve(repoPathArg ?? process.cwd());
  if (!existsSync30(repoRoot) || !isContextRepo(repoRoot)) {
    const e = {
      code: "CONTEXT_REPO_INVALID",
      message: `${repoRoot} no parece ser un context repo.`,
      recovery_hints: ["Valid\xE1: dd-cli context validate"]
    };
    if (jsonMode) emitJson(jsonError({ command: "context install-ci", ...e }));
    printErr(e.message);
    return 3;
  }
  let provider = opts.provider;
  if (!provider) {
    const marker = loadContextRepoMarker(repoRoot);
    provider = marker?.provider?.type;
  }
  if (!provider) {
    const e = {
      code: "CONFIG_MISSING",
      message: "No pude detectar el provider del context repo.",
      recovery_hints: [
        "Asegurate que .devflow-context/.context-repo.yml tenga el campo provider",
        "O pasalo expl\xEDcito: dd-cli context install-ci --provider=gitlab|github"
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "context install-ci", ...e }));
    printErr(e.message);
    return 2;
  }
  const templateFilename = provider === "gitlab" ? "gitlab-hdu-transitions.yml" : "github-hdu-transitions.yml";
  const targetRelPath = provider === "gitlab" ? ".gitlab-ci.yml" : ".github/workflows/hdu-transitions.yml";
  const targetPath = path30.join(repoRoot, targetRelPath);
  const templatePath = resolveTemplatePath(templateFilename);
  if (!templatePath) {
    const e = {
      code: "CONFIG_MISSING",
      message: `Template "${templateFilename}" no se encuentra en la instalaci\xF3n del CLI.`,
      recovery_hints: ["Reinstal\xE1 el CLI o report\xE1 el bug"]
    };
    if (jsonMode) emitJson(jsonError({ command: "context install-ci", ...e }));
    printErr(e.message);
    return 1;
  }
  const templateContent = readFileSync23(templatePath, "utf-8");
  let action;
  if (!existsSync30(targetPath)) {
    mkdirSync18(path30.dirname(targetPath), { recursive: true });
    writeFileSync17(targetPath, templateContent, "utf-8");
    action = "written";
  } else {
    const current = readFileSync23(targetPath, "utf-8");
    if (current === templateContent) {
      action = "unchanged";
    } else if (opts.force) {
      writeFileSync17(targetPath, templateContent, "utf-8");
      action = "overwritten";
    } else {
      action = "conflict";
    }
  }
  const result = {
    provider,
    target_path: targetPath,
    template_path: templatePath,
    action
  };
  if (jsonMode) {
    emitJson(jsonSuccess("context install-ci", result, action === "conflict" ? `dd-cli context install-ci ${repoPathArg ?? ""} --force` : null));
  }
  console.log("");
  console.log(bold(`CI install \u2014 provider: ${provider}`));
  switch (action) {
    case "written":
      printOk(`Escrito: ${targetPath}`);
      break;
    case "unchanged":
      printDim(`Sin cambios: ${targetPath} ya est\xE1 al d\xEDa`);
      break;
    case "overwritten":
      printOk(`Sobreescrito: ${targetPath}`);
      break;
    case "conflict":
      printWarn(`Conflicto: ${targetPath} ya existe con contenido distinto`);
      printInfo("Para sobreescribir: dd-cli context install-ci --force");
      printInfo("Para mergearlo a mano: ver " + templatePath);
      return 2;
  }
  if (action === "written" || action === "overwritten") {
    console.log("");
    printInfo("Pr\xF3ximos pasos:");
    printDim(`  1. Commit + push el archivo: cd ${repoRoot} && git add ${targetRelPath} && git commit -m "ci: install HDU transitions" && git push`);
    printDim(`  2. Configurar el bot token en el provider:`);
    if (provider === "gitlab") {
      printDim("     GitLab \u2192 Project Settings \u2192 CI/CD \u2192 Variables \u2192 HDU_BOT_TOKEN (write_repository)");
    } else {
      printDim("     GitHub \u2192 Settings \u2192 Secrets and variables \u2192 Actions \u2192 HDU_BOT_TOKEN (repo)");
    }
    printDim(`  3. Ver la gu\xEDa completa: ${resolveTemplatePath("README.md") ?? "templates/ci/README.md"}`);
  }
  return 0;
}

// src/commands/client-new.ts
import { execSync as execSync6 } from "child_process";
import { existsSync as existsSync31, mkdirSync as mkdirSync19, rmSync as rmSync3 } from "fs";
import * as path31 from "path";
import * as os3 from "os";
import { input as input3, password, select as select3, confirm as confirm2 } from "@inquirer/prompts";
var isTTY9 = process.stdout.isTTY;
function runGit4(cmd, cwd) {
  return execSync6(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function defaultBaseUrlFor2(type) {
  return type === "github" ? "https://api.github.com" : "https://gitlab.com";
}
function contextRepoNameFor(slug) {
  return `${slug}-devflow-context`;
}
async function runClientNew(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    const err2 = {
      code: "INVALID_INPUT",
      message: "Falta el slug del cliente o no es kebab-case. Uso: dd-cli client new <slug>",
      recovery_hints: ["El slug debe ser kebab-case: min\xFAsculas, n\xFAmeros y guiones."]
    };
    if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const existingClient = getClient(slug);
  if (existingClient && !opts.yes && !jsonMode && isTTY9) {
    const proceed = await confirm2({
      message: `El cliente "${slug}" ya est\xE1 registrado. \xBFContinuar e intentar reparar lo que falte?`,
      default: false
    });
    if (!proceed) {
      printDim("Cancelado.");
      return 0;
    }
  }
  if (!jsonMode) console.log(bold(`
Onboarding del cliente: ${slug}
`));
  let name = opts.name;
  let provider = opts.provider;
  let baseUrl = opts.baseUrl;
  let group = opts.group;
  let gitToken = opts.gitToken;
  const needsInteractive = !name || !provider || !baseUrl || !group || !gitToken;
  if (needsInteractive && !isTTY9) {
    const err2 = {
      code: "INVALID_INPUT",
      message: "En modo no interactivo se necesitan --name, --provider, --base-url, --group y --git-token.",
      recovery_hints: [
        `Ejemplo: dd-cli client new ${slug} --name="X" --provider=gitlab --base-url=https://gitlab.com --group=foo --git-token=glpat-...`
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  if (!name) {
    name = await input3({
      message: "Nombre completo del cliente:",
      default: slug,
      validate: (v) => v.trim().length > 0 || "El nombre es obligatorio"
    });
  }
  if (!provider) {
    provider = await select3({
      message: "Plataforma git:",
      choices: [
        { name: "GitLab (cloud o self-hosted)", value: "gitlab" },
        { name: "GitHub (cloud o Enterprise)", value: "github" }
      ],
      default: "gitlab"
    });
  }
  if (!baseUrl) {
    baseUrl = await input3({
      message: "URL base (cloud o self-hosted):",
      default: defaultBaseUrlFor2(provider),
      validate: (v) => /^https?:\/\//.test(v) || "Debe ser una URL http(s)"
    });
  }
  if (!group) {
    group = await input3({
      message: provider === "github" ? "Org / usuario:" : "Group:",
      validate: (v) => v.trim().length > 0 || "Es obligatorio"
    });
  }
  if (!gitToken) {
    gitToken = await password({
      message: "Token API (PAT con scope api/repo):",
      mask: "*",
      validate: (v) => v.trim().length > 0 || "El token es obligatorio"
    });
  }
  const providerCreds = {
    git_token: gitToken,
    git_host: provider,
    git_base_url: baseUrl,
    git_group: group
  };
  const tempProvider = createProvider(providerCreds, {
    type: provider,
    base_url: baseUrl,
    group_or_org: group
  });
  if (!jsonMode) printInfo(`Validando token contra ${provider} / ${group} ...`);
  const tokenCheck = await tempProvider.validateToken({
    required_for: opts.noBranchProtection ? ["read", "create_repo"] : ["read", "create_repo", "branch_protection"]
  });
  if (!tokenCheck.valid) {
    const err2 = {
      code: "TOKEN_INVALID",
      message: tokenCheck.message,
      context: { provider, group_or_org: group },
      recovery_hints: ["Regener\xE1 el token con scope `api` (GitLab) o `repo` (GitHub)."]
    };
    if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
    printErr(err2.message);
    return 1;
  }
  if (tokenCheck.scopes_missing.length > 0) {
    const err2 = {
      code: "TOKEN_INSUFFICIENT_SCOPE",
      message: `Al token le faltan scopes: ${tokenCheck.scopes_missing.join(", ")}.`,
      context: {
        provider,
        scopes_present: tokenCheck.scopes_present,
        scopes_missing: tokenCheck.scopes_missing
      },
      recovery_hints: [
        provider === "gitlab" ? "GitLab: regener\xE1 el PAT con scope `api`." : "GitHub: PAT classic con `repo` o fine-grained con Administration:Write."
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
    printErr(err2.message);
    printInfo("Para continuar igual: agreg\xE1 --no-branch-protection si no quer\xE9s ese scope.");
    return 2;
  }
  if (!jsonMode) {
    printOk(`Token v\xE1lido \u2014 usuario ${tokenCheck.user ?? "desconocido"}`);
    if (tokenCheck.is_admin_of_group === false) {
      printWarn(`No sos admin/Maintainer de ${group} \u2014 la creaci\xF3n del repo puede fallar.`);
    }
  }
  const repoName = contextRepoNameFor(slug);
  const existingRepos = await tempProvider.listGroupRepos();
  const existingContextRepo = existingRepos.find((r) => r.slug === repoName);
  let contextRepoUrl;
  let contextRepoCreated = false;
  let repoIdOrSlug;
  if (existingContextRepo) {
    contextRepoUrl = existingContextRepo.url;
    repoIdOrSlug = provider === "gitlab" ? existingContextRepo.id : existingContextRepo.slug;
    if (!jsonMode) printDim(`Context repo ya existe: ${contextRepoUrl}`);
  } else {
    if (!jsonMode) printInfo(`Creando context repo ${group}/${repoName} ...`);
    try {
      const created = await tempProvider.createRepo({
        name: repoName,
        description: `DevFlow IA context repository for ${name}`,
        visibility: "private",
        initialize_with_readme: true,
        default_branch: "main"
      });
      contextRepoUrl = created.url;
      repoIdOrSlug = provider === "gitlab" ? created.id : created.slug;
      contextRepoCreated = true;
      if (!jsonMode) printOk(`Context repo creado: ${contextRepoUrl}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const err2 = {
        code: "INTERNAL_ERROR",
        message: `No se pudo crear el repo en ${provider}: ${errMsg}`,
        context: { provider, group_or_org: group, repo_name: repoName },
        recovery_hints: [
          "Verific\xE1 que sos admin/Maintainer del group",
          `Verific\xE1 que el repo "${repoName}" no exista ya (si existe, dd-cli client new lo detecta y reutiliza)`
        ]
      };
      if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
      printErr(err2.message);
      return 1;
    }
  }
  let branchProtectionApplied = false;
  if (!opts.noBranchProtection) {
    try {
      await tempProvider.setBranchProtection(repoIdOrSlug, {
        branch: "main",
        require_pull_request: false,
        // primer publish va directo a main (D-1)
        allow_force_push: false
      });
      branchProtectionApplied = true;
      if (!jsonMode) printOk("Branch protection aplicada a main (sin require PR para el primer publish)");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (!jsonMode) printWarn(`No se pudo aplicar branch protection: ${errMsg}`);
    }
  }
  const cacheDir = getClientCacheDir(slug);
  const cloneUrl = embedTokenInUrl(contextRepoUrl, gitToken, provider);
  if (existsSync31(cacheDir)) {
    try {
      runGit4("git pull --ff-only", cacheDir);
      if (!jsonMode) printDim(`Cache local ya exist\xEDa, pull OK: ${cacheDir}`);
    } catch {
      if (!jsonMode) printWarn("Pull fall\xF3; re-clonando ...");
      rmSync3(cacheDir, { recursive: true, force: true });
    }
  }
  if (!existsSync31(cacheDir)) {
    const parentDir = path31.dirname(cacheDir);
    if (!existsSync31(parentDir)) mkdirSync19(parentDir, { recursive: true });
    try {
      runGit4(`git clone "${cloneUrl}" "${cacheDir}"`);
      if (!jsonMode) printOk(`Cache local: ${cacheDir}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const err2 = {
        code: "GIT_CLONE_FAILED",
        message: `git clone fall\xF3: ${errMsg}`,
        context: { url: contextRepoUrl, cache_dir: cacheDir },
        recovery_hints: ["Verific\xE1 que el token tenga acceso al repo reci\xE9n creado."]
      };
      if (jsonMode) emitJson(jsonError({ command: "client new", ...err2 }));
      printErr(err2.message);
      return 1;
    }
  }
  registerClient({
    slug,
    name,
    context_url: contextRepoUrl,
    local_cache: cacheDir,
    last_synced: (/* @__PURE__ */ new Date()).toISOString()
  });
  setClientCredentials(slug, providerCreds);
  if (!jsonMode) printOk("Registry + credentials guardados (~/.devflow/)");
  try {
    const markerPath = getContextRepoMarkerPath(cacheDir);
    if (!existsSync31(markerPath) || opts.yes) {
      saveContextRepoMarker(cacheDir, {
        kind: "context-repo",
        schema_version: "1.1",
        client: { slug, name },
        provider: { type: provider, base_url: baseUrl, group_or_org: group },
        generated_by: "/devflow-ia:client-onboard",
        last_generated_at: (/* @__PURE__ */ new Date()).toISOString(),
        cli_version: CLI_VERSION
      });
      try {
        runGit4("git add .devflow-context/.context-repo.yml", cacheDir);
        runGit4(`git -c commit.gpgsign=false commit -m "chore: devflow context marker for ${slug}"`, cacheDir);
        runGit4("git push origin HEAD", cacheDir);
        if (!jsonMode) printOk("Marcador .context-repo.yml escrito + pusheado");
      } catch {
        if (!jsonMode) printDim("Marcador escrito en local; push se har\xE1 en client publish");
      }
    }
  } catch (e) {
    if (!jsonMode) printWarn(`No se pudo escribir el marcador: ${e instanceof Error ? e.message : String(e)}`);
  }
  recordCommandResult(slug, "client new", {
    success: true,
    state: "REGISTERED",
    nextSafe: `dd-cli client discover ${slug}`
  });
  const result = {
    slug,
    name,
    provider,
    base_url: baseUrl,
    group_or_org: group,
    context_repo_url: contextRepoUrl,
    cache_dir: cacheDir,
    context_repo_created: contextRepoCreated,
    branch_protection_applied: branchProtectionApplied,
    state: "REGISTERED"
  };
  if (jsonMode) {
    emitJson(jsonSuccess("client new", result, `dd-cli client discover ${slug}`));
  }
  console.log("");
  printOk(`Cliente ${bold(slug)} registrado. Estado: REGISTERED.`);
  console.log("");
  printInfo("Pr\xF3ximo paso:");
  printDim(`  dd-cli client discover ${slug}`);
  printDim(`  # o desde Claude: /devflow-ia:client-onboard ${slug}`);
  return 0;
}
function embedTokenInUrl(url, token, provider) {
  try {
    const u = new URL(url);
    if (provider === "github") {
      u.username = "x-access-token";
      u.password = token;
    } else {
      u.username = "oauth2";
      u.password = token;
    }
    return u.toString();
  } catch {
    return url;
  }
}

// src/commands/client-publish.ts
import { execSync as execSync7 } from "child_process";
import { existsSync as existsSync32 } from "fs";
function runGit5(cmd, cwd) {
  return execSync7(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
async function runClientPublish(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug) {
    const err2 = {
      code: "INVALID_INPUT",
      message: "Falta el slug del cliente. Uso: dd-cli client publish <slug>"
    };
    if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  const entry = getClient(slug);
  if (!entry) {
    const err2 = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${slug}" no registrado.`,
      context: { slug },
      recovery_hints: [
        `Registr\xE1 el cliente primero: dd-cli client new ${slug}`
      ],
      next_safe_command: `dd-cli client new ${slug}`
    };
    if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(slug);
  if (!existsSync32(cacheDir)) {
    const err2 = {
      code: "CONTEXT_CACHE_MISSING",
      message: `Cache local no encontrada: ${cacheDir}`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [`Re-clonar: dd-cli pull-context ${slug}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
    printErr(err2.message);
    return 2;
  }
  const steps = [];
  const findings = validateContextRepo(cacheDir);
  const errors = findings.filter((f) => f.level === "err");
  const warnings = findings.filter((f) => f.level === "warn");
  if (errors.length > 0) {
    steps.push({ type: "validate", action: "failed", detail: `${errors.length} errores` });
    const err2 = {
      code: "CONTEXT_REPO_INVALID",
      message: `Context repo inv\xE1lido: ${errors.length} errores. No se puede publicar.`,
      context: { errors: errors.map((e) => ({ rule: e.rule, message: e.message })) },
      recovery_hints: [
        `Revis\xE1 los errores: dd-cli context validate ${cacheDir}`,
        "Edit\xE1 los archivos a mano o re-corr\xE9 /devflow-ia:client-onboard"
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
    printErr(err2.message);
    return 3;
  }
  if (warnings.length > 0 && !opts.ignoreWarnings && !jsonMode) {
    printWarn(`${warnings.length} warnings detectados:`);
    for (const w of warnings.slice(0, 5)) printDim(`  ${w.rule}: ${w.message}`);
    if (warnings.length > 5) printDim(`  ... y ${warnings.length - 5} m\xE1s`);
    printDim("Tip\xE1 Ctrl-C para abortar, o re-corr\xE9 con --ignore-warnings para continuar.");
  }
  steps.push({ type: "validate", action: "ok", detail: `${findings.filter((f) => f.level === "ok").length} OK, ${warnings.length} warnings` });
  try {
    await runContextRender(cacheDir, {
      json: true
      /* silenciar output */
    });
    steps.push({ type: "render", action: "ok" });
  } catch (e) {
    steps.push({ type: "render", action: "failed", detail: e instanceof Error ? e.message : String(e) });
  }
  let hasChanges = false;
  try {
    const status = runGit5("git status --porcelain", cacheDir);
    hasChanges = status.trim().length > 0;
  } catch (e) {
    const err2 = {
      code: "INTERNAL_ERROR",
      message: `git status fall\xF3: ${e instanceof Error ? e.message : String(e)}`,
      context: { cache_dir: cacheDir }
    };
    if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
    printErr(err2.message);
    return 1;
  }
  if (!hasChanges) {
    steps.push({ type: "commit", action: "no-changes" });
    if (!jsonMode) printDim("No hay cambios para publicar.");
  } else {
    try {
      runGit5("git add .", cacheDir);
      const commitMsg = `feat: publish context for ${slug}

Generado por dd-cli client publish (S3-4).`;
      runGit5(`git -c commit.gpgsign=false commit -m "${commitMsg}"`, cacheDir);
      steps.push({ type: "commit", action: "ok" });
      if (!jsonMode) printOk("Commit creado");
    } catch (e) {
      const err2 = {
        code: "INTERNAL_ERROR",
        message: `git commit fall\xF3: ${e instanceof Error ? e.message : String(e)}`,
        context: { cache_dir: cacheDir }
      };
      if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
      printErr(err2.message);
      return 1;
    }
    if (!opts.noPush) {
      try {
        runGit5("git push origin HEAD", cacheDir);
        steps.push({ type: "push", action: "ok" });
        if (!jsonMode) printOk(`Push a ${entry.context_url}`);
      } catch (e) {
        steps.push({ type: "push", action: "failed", detail: e instanceof Error ? e.message : String(e) });
        const err2 = {
          code: "GIT_PUSH_FAILED",
          message: `git push fall\xF3: ${e instanceof Error ? e.message : String(e)}`,
          context: { context_url: entry.context_url },
          recovery_hints: [
            "Verific\xE1 permisos del token (scope `api` o `repo`)",
            "Si branch protection bloquea, consider\xE1 --no-branch-protection en client new"
          ]
        };
        if (jsonMode) emitJson(jsonError({ command: "client publish", ...err2 }));
        printErr(err2.message);
        return 1;
      }
    } else {
      steps.push({ type: "push", action: "skipped", detail: "--no-push" });
    }
  }
  updateLastSynced(slug);
  steps.push({ type: "sync", action: "ok" });
  const existingState = readClientState(slug)?.state;
  try {
    recordCommandResult(slug, "client publish", {
      success: true,
      state: "READY",
      nextSafe: "cd <repo-de-codigo> && dd-cli init --client=" + slug
    });
  } catch (e) {
    if (!jsonMode) printDim(`Estado actual: ${existingState ?? "unknown"} (no se pudo avanzar a READY)`);
  }
  if (jsonMode) {
    emitJson(jsonSuccess("client publish", {
      slug,
      cache_dir: cacheDir,
      context_url: entry.context_url,
      steps,
      state: "READY"
    }, `cd <repo-de-codigo> && dd-cli init --client=${slug}`));
  }
  console.log("");
  printOk(`Cliente ${bold(slug)} \u2192 ${bold("READY")}`);
  console.log("");
  printInfo("Para que un dev arranque a programar:");
  printDim(`  cd <repo-de-codigo>`);
  printDim(`  dd-cli init --client=${slug}`);
  printDim(`  dd-cli start-session <HDU-id>`);
  return 0;
}

// src/commands/client-show.ts
import { existsSync as existsSync33 } from "fs";
function ageInHours(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}
function maskCredentials(url) {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
    }
    return u.toString();
  } catch {
    return url.replace(/\/\/[^@]+@/, "//***@");
  }
}
function formatAge2(iso) {
  if (!iso) return "nunca";
  const h = ageInHours(iso);
  if (h < 1) return "hace minutos";
  if (h < 24) return `hace ${Math.floor(h)}h`;
  return `hace ${Math.floor(h / 24)}d`;
}
function stateBadgeColor(state) {
  switch (state) {
    case "READY":
    case "ACTIVE":
      return ok;
    case "NEEDS_REFRESH":
      return warn;
    case "REGISTERED":
    case "DISCOVERED":
    case "DRAFT":
      return warn;
    default:
      return err;
  }
}
async function runClientShow(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug) {
    const e = {
      code: "INVALID_INPUT",
      message: "Falta el slug. Uso: dd-cli client show <slug>"
    };
    if (jsonMode) emitJson(jsonError({ command: "client show", ...e }));
    printErr(e.message);
    return 3;
  }
  const entry = getClient(slug);
  if (!entry) {
    const e = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${slug}" no registrado.`,
      recovery_hints: [
        `Ver clientes registrados: dd-cli client list`,
        `Registrar nuevo: dd-cli client new ${slug}`
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "client show", ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(slug);
  const cacheExists = existsSync33(cacheDir);
  const state = readClientState(slug);
  const stateName = state?.state ?? "UNKNOWN";
  const isStale = ageInHours(entry.last_synced) > 24;
  let stackConfig = null;
  let catalog = null;
  let marker = null;
  if (cacheExists) {
    try {
      stackConfig = loadStackConfig(cacheDir);
    } catch {
    }
    try {
      catalog = loadCatalog(cacheDir);
    } catch {
    }
    try {
      marker = loadContextRepoMarker(cacheDir);
    } catch {
    }
  }
  const apps = catalog?.apps ?? [];
  const appsByType = {};
  const appsByStatus = {};
  const authProfiles = /* @__PURE__ */ new Set();
  const cicdProfiles = /* @__PURE__ */ new Set();
  for (const a of apps) {
    appsByType[a.type] = (appsByType[a.type] ?? 0) + 1;
    appsByStatus[a.status] = (appsByStatus[a.status] ?? 0) + 1;
    if (a.auth_profile) authProfiles.add(a.auth_profile);
    if (a.ci_cd_profile && a.ci_cd_profile !== "[por-confirmar]") cicdProfiles.add(a.ci_cd_profile);
  }
  const suggestedActions = [];
  const cmd = suggestedCommandFor(stateName === "UNKNOWN" ? "REGISTERED" : stateName, slug);
  if (cmd) suggestedActions.push(cmd);
  if (isStale) suggestedActions.push(`dd-cli pull-context ${slug}    # cache stale (${formatAge2(entry.last_synced)})`);
  if (!cacheExists) suggestedActions.push(`dd-cli pull-context ${slug}    # cache no existe`);
  const output = {
    slug,
    name: stackConfig?.client.name ?? marker?.client.name ?? entry.name ?? slug,
    state: stateName,
    context_url: maskCredentials(entry.context_url),
    last_synced: entry.last_synced ?? null,
    stale: isStale,
    provider: marker?.provider ? { type: marker.provider.type, base_url: marker.provider.base_url, group_or_org: marker.provider.group_or_org } : null,
    stack: stackConfig ? {
      backend: stackConfig.stack.backend_framework,
      frontend: stackConfig.stack.frontend_framework,
      databases: stackConfig.stack.databases,
      infra: stackConfig.stack.infra,
      cicd_platform: stackConfig.stack.cicd_platform
    } : null,
    apps_count: apps.length,
    apps_by_type: appsByType,
    apps_by_status: appsByStatus,
    auth_profiles: [...authProfiles],
    cicd_profiles: [...cicdProfiles],
    last_command: state?.last_command ?? null,
    last_command_at: state?.last_command_at ?? null,
    next_safe_command: state?.next_safe_command ?? cmd ?? null,
    suggested_actions: suggestedActions
  };
  if (jsonMode) {
    emitJson(jsonSuccess("client show", output, cmd));
  }
  const badgeFn = stateBadgeColor(stateName);
  console.log("");
  console.log(`  ${bold(output.name)}    ${badgeFn("\u25CF " + stateName)}`);
  console.log(`  ${dim(slug)}`);
  if (stackConfig?.client.industry) console.log(`  ${dim(stackConfig.client.industry)}`);
  if (stackConfig?.client.primary_contact) console.log(`  ${dim("Contacto: " + stackConfig.client.primary_contact)}`);
  console.log("");
  console.log(bold("  CONTEXT REPO"));
  console.log(`    ${maskCredentials(entry.context_url)}`);
  console.log(`    ${dim("\xFAltimo sync:    " + formatAge2(entry.last_synced))}${isStale ? "  " + warn("\u26A0 stale") : "  " + ok("\u2713")}`);
  if (marker) console.log(`    ${dim("schema:         v" + marker.schema_version)}`);
  console.log("");
  if (stackConfig) {
    console.log(bold("  STACK"));
    console.log(`    ${"backend".padEnd(11)}${stackConfig.stack.backend_framework}`);
    console.log(`    ${"frontend".padEnd(11)}${stackConfig.stack.frontend_framework}`);
    if (stackConfig.stack.databases.length > 0) {
      console.log(`    ${"db".padEnd(11)}${stackConfig.stack.databases.join(", ")}`);
    }
    console.log(`    ${"infra".padEnd(11)}${stackConfig.stack.infra}`);
    console.log(`    ${"ci/cd".padEnd(11)}${stackConfig.stack.cicd_platform}`);
    console.log("");
  } else if (cacheExists) {
    printDim("  STACK no configurado \u2014 falta .devflow-context/stack.yml");
    console.log("");
  }
  if (apps.length > 0) {
    console.log(bold(`  APPS (${apps.length})`));
    for (const [type, count] of Object.entries(appsByType)) {
      console.log(`    ${("\xB7 " + type).padEnd(20)}${count}`);
    }
    console.log("");
  }
  if (authProfiles.size > 0 || cicdProfiles.size > 0) {
    console.log(bold("  PROFILES"));
    if (authProfiles.size > 0) console.log(`    auth        ${[...authProfiles].slice(0, 3).join(", ")}${authProfiles.size > 3 ? ", ..." : ""}`);
    if (cicdProfiles.size > 0) console.log(`    ci/cd       ${[...cicdProfiles].slice(0, 3).join(", ")}${cicdProfiles.size > 3 ? ", ..." : ""}`);
    console.log("");
  }
  if (state) {
    console.log(bold("  ACTIVIDAD"));
    console.log(`    \xFAltimo comando: ${state.last_command} (${formatAge2(state.last_command_at)})`);
    console.log("");
  }
  if (suggestedActions.length > 0) {
    console.log(bold("  ACCIONES SUGERIDAS"));
    for (const action of suggestedActions) console.log(`    \u2192 ${action}`);
    console.log("");
  }
  return 0;
}

// src/commands/client-list.ts
import { existsSync as existsSync34, readdirSync as readdirSync8 } from "fs";
function ageInHours2(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}
function formatAge3(iso) {
  if (!iso) return "nunca";
  const h = ageInHours2(iso);
  if (h < 1) return "hace minutos";
  if (h < 24) return `hace ${Math.floor(h)}h`;
  return `hace ${Math.floor(h / 24)}d`;
}
function badgeForState(state) {
  switch (state) {
    case "READY":
    case "ACTIVE":
      return ok("\u25CF");
    case "NEEDS_REFRESH":
      return warn("\u26A0");
    case "REGISTERED":
    case "DISCOVERED":
    case "DRAFT":
      return warn("\u2699");
    default:
      return err("\u2717");
  }
}
function listClients() {
  const registry = loadRegistry();
  return Object.values(registry.clients).map((entry) => {
    const cacheDir = getClientCacheDir(entry.slug);
    const state = readClientState(entry.slug);
    let appsCount = 0;
    if (existsSync34(cacheDir)) {
      try {
        const catalog = loadCatalog(cacheDir);
        appsCount = catalog?.apps.length ?? 0;
      } catch {
      }
    }
    return {
      slug: entry.slug,
      name: entry.name,
      state: state?.state ?? "UNKNOWN",
      apps_count: appsCount,
      last_synced: entry.last_synced ?? null,
      stale: ageInHours2(entry.last_synced) > 24
    };
  });
}
async function runClientList(opts = {}) {
  const jsonMode = isJsonMode(opts);
  const clients = listClients();
  if (jsonMode) {
    emitJson(jsonSuccess("client list", { clients, total: clients.length }));
  }
  console.log("");
  if (clients.length === 0) {
    printWarn("Ning\xFAn cliente registrado.");
    printInfo("Registrar el primero: dd-cli client new <slug>");
    console.log("");
    return 0;
  }
  for (const c3 of clients) {
    const badge = badgeForState(c3.state);
    const sync = c3.stale ? warn(formatAge3(c3.last_synced)) : dim(formatAge3(c3.last_synced));
    const stateLabel = c3.state.padEnd(14);
    const appsLabel = `${c3.apps_count} apps`.padEnd(10);
    console.log(`  ${badge}  ${bold(c3.slug.padEnd(20))}${stateLabel}${appsLabel}${sync}`);
  }
  console.log("");
  printDim(`  Total: ${clients.length} clientes \xB7 ${clients.reduce((s, c3) => s + c3.apps_count, 0)} apps catalogadas`);
  printDim(`  \u2192 dd-cli client show <slug>      detalle por cliente`);
  console.log("");
  return 0;
}
async function runHome(opts = {}) {
  const jsonMode = isJsonMode(opts);
  const clients = listClients();
  const skillsDir = getClaudeSkillsDir();
  const skillsCount = existsSync34(skillsDir) ? readdirSync8(skillsDir).filter((f) => f.endsWith(".md")).length : 0;
  const claudeOk = isClaudeCodeInstalled();
  let activeSession = null;
  const projectRoot = findDevFlowProjectRoot();
  if (projectRoot) {
    try {
      const session = loadSession(projectRoot);
      if (session?.started_at && !session.ended_at) {
        activeSession = {
          feature_id: session.feature_id ?? "?",
          dev_type: session.dev_type ?? "?",
          step: 0
          // S6 calculará esto bien
        };
      }
    } catch {
    }
  }
  const byState = {};
  for (const c3 of clients) byState[c3.state] = (byState[c3.state] ?? 0) + 1;
  if (jsonMode) {
    emitJson(jsonSuccess("home", {
      cli_version: CLI_VERSION,
      skills_count: skillsCount,
      claude_code: claudeOk,
      clients_total: clients.length,
      clients_by_state: byState,
      clients,
      active_session: activeSession
    }));
  }
  console.log("");
  console.log(bold(`  DevFlow IA   \xB7 ${(/* @__PURE__ */ new Date()).toLocaleDateString("es-CL")}`));
  console.log("");
  console.log(bold(`  TUS CLIENTES (${clients.length})`));
  if (clients.length === 0) {
    printDim("    (ninguno)");
    printInfo("    Registrar el primero: dd-cli client new <slug>");
  } else {
    for (const c3 of clients) {
      const badge = badgeForState(c3.state);
      console.log(`    ${badge} ${bold(c3.slug.padEnd(15))}${c3.state.padEnd(14)}${dim(formatAge3(c3.last_synced))}`);
    }
  }
  console.log("");
  if (activeSession) {
    console.log(bold("  ACTIVIDAD"));
    console.log(`    sesi\xF3n activa: ${activeSession.feature_id} \xB7 ${activeSession.dev_type}`);
    console.log("");
  }
  console.log(bold("  SISTEMA"));
  console.log(`    CLI v${CLI_VERSION}        ${ok("\u2713")}`);
  console.log(`    Skills ${skillsCount}          ${skillsCount > 0 ? ok("\u2713") : warn("\u26A0")}`);
  console.log(`    Claude Code      ${claudeOk ? ok("\u2713") : err("\u2717")}`);
  console.log("");
  return 0;
}

// src/commands/client-refresh.ts
import { existsSync as existsSync35 } from "fs";
function discoveryRepoToCatalogApp(repo) {
  const authProfile = repo.auth_pattern === "unknown" ? null : repo.auth_pattern;
  return CatalogAppSchema.parse({
    slug: repo.slug,
    name: repo.display_name || repo.slug,
    type: repo.app_type,
    role: repo.is_portal_shell ? "portal" : repo.is_template ? "standalone" : "standalone",
    auth_profile: authProfile,
    ci_cd_profile: null,
    // refresh no decide profiles — los humanos lo hacen
    repo: null,
    // se podría reconstruir desde provider.url
    branch: "main",
    status: repo.inactive ? "inactive" : "unknown",
    app_origin: "legacy-app",
    template_origin: null,
    preferred_dev_types: [],
    tags: repo.is_template ? ["template"] : [],
    notes: null
  });
}
function computeDiff(current, next) {
  const diffs = [];
  const currentBySlug = new Map(current.map((a) => [a.slug, a]));
  const nextBySlug = new Map(next.map((a) => [a.slug, a]));
  for (const [slug, app] of nextBySlug) {
    if (!currentBySlug.has(slug)) {
      diffs.push({ slug, change: "added", after: app });
    }
  }
  for (const [slug, app] of currentBySlug) {
    if (!nextBySlug.has(slug)) {
      diffs.push({ slug, change: "removed", before: app });
    }
  }
  const watchedFields = ["type", "status", "auth_profile", "role"];
  for (const [slug, before] of currentBySlug) {
    const after = nextBySlug.get(slug);
    if (!after) continue;
    const changed = [];
    for (const f of watchedFields) {
      if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) changed.push(String(f));
    }
    if (changed.length > 0) {
      diffs.push({
        slug,
        change: "modified",
        before: Object.fromEntries(changed.map((f) => [f, before[f]])),
        after: Object.fromEntries(changed.map((f) => [f, after[f]])),
        changed_fields: changed
      });
    }
  }
  return diffs;
}
function applyDiffToCatalog(current, next, diff) {
  const currentBySlug = new Map(current.apps.map((a) => [a.slug, a]));
  const apps = [];
  for (const fresh of next) {
    const existing = currentBySlug.get(fresh.slug);
    if (existing) {
      apps.push({
        ...fresh,
        // Preservar lo editado a mano:
        name: existing.name && existing.name !== fresh.slug ? existing.name : fresh.name,
        ci_cd_profile: existing.ci_cd_profile,
        repo: existing.repo,
        preferred_dev_types: existing.preferred_dev_types.length > 0 ? existing.preferred_dev_types : fresh.preferred_dev_types,
        tags: [.../* @__PURE__ */ new Set([...existing.tags, ...fresh.tags])],
        notes: existing.notes ?? fresh.notes,
        // Status mantiene el del discovery solo si dejó de existir (inactive),
        // si no, preservar el editado a mano (puede haber sido marcado deprecated).
        status: fresh.status === "inactive" ? "inactive" : existing.status
      });
    } else {
      apps.push(fresh);
    }
  }
  return CatalogSchema.parse({ ...current, apps });
}
async function runClientRefresh(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug) {
    const e = { code: "INVALID_INPUT", message: "Falta el slug. Uso: dd-cli client refresh <slug>" };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...e }));
    printErr(e.message);
    return 3;
  }
  const entry = getClient(slug);
  if (!entry) {
    const e = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${slug}" no registrado.`,
      recovery_hints: [`Registr\xE1 el cliente primero: dd-cli client new ${slug}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...e }));
    printErr(e.message);
    return 2;
  }
  const creds = getClientCredentials(slug);
  if (!creds) {
    const e = {
      code: "TOKEN_MISSING",
      message: `No hay credenciales API para "${slug}".`,
      recovery_hints: [`Agregalas: dd-cli register-client ${slug} --git-token=<PAT> --git-group=<grupo> --force`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(slug);
  if (!existsSync35(cacheDir)) {
    const e = {
      code: "CONTEXT_CACHE_MISSING",
      message: `Cache local no encontrada: ${cacheDir}`,
      recovery_hints: [`Sincroniz\xE1: dd-cli pull-context ${slug}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...e }));
    printErr(e.message);
    return 2;
  }
  const currentCatalog = loadCatalog(cacheDir) ?? CatalogSchema.parse({ apps: [] });
  if (!jsonMode) {
    console.log(bold(`
Refresh de ${slug}
`));
    printInfo(`Re-corriendo discovery contra ${creds.git_host}/${creds.git_group} ...`);
  }
  const provider = createProvider(creds);
  const tokenCheck = await provider.validateToken({ required_for: ["read"] });
  if (!tokenCheck.valid) {
    const e = {
      code: "TOKEN_INVALID",
      message: tokenCheck.message,
      context: { provider: provider.type },
      recovery_hints: [`Regener\xE1 el token: dd-cli register-client ${slug} --git-token=<nuevo> --force`]
    };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...e }));
    printErr(e.message);
    return 1;
  }
  let discovery;
  try {
    const repos = await provider.listGroupRepos();
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 20));
    const analyses = [];
    for (const meta of repos) {
      const lastActiveDays = meta.last_push ? Math.floor((Date.now() - new Date(meta.last_push).getTime()) / 864e5) : 9999;
      const veryInactive = meta.archived || lastActiveDays > 365;
      if (veryInactive) {
        analyses.push(analyzeRepo(meta, {}));
        continue;
      }
      const files = await readKeyFiles2(provider, provider.type === "gitlab" ? meta.id : meta.slug, meta.default_branch, concurrency);
      analyses.push(analyzeRepo(meta, files));
    }
    discovery = synthesizeDiscovery(analyses);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const errObj = {
      code: "NETWORK_ERROR",
      message: `Discovery fall\xF3: ${errMsg}`,
      context: { provider: provider.type },
      recovery_hints: ["Verific\xE1 conectividad y validez del token"]
    };
    if (jsonMode) emitJson(jsonError({ command: "client refresh", ...errObj }));
    printErr(errObj.message);
    return 1;
  }
  const freshApps = discovery.repos.map(discoveryRepoToCatalogApp);
  const diff = computeDiff(currentCatalog.apps, freshApps);
  const noChanges = diff.length === 0;
  if (!jsonMode) {
    console.log("");
    printOk(`Discovery completo (${discovery.repos.length} repos)`);
    printDim("  " + discovery.summary);
    console.log("");
    if (noChanges) {
      printOk("No hay cambios \u2014 el cat\xE1logo est\xE1 al d\xEDa.");
    } else {
      printInfo(`Diff (${diff.length} cambios):`);
      for (const d of diff) {
        if (d.change === "added") {
          console.log(`  + ${d.slug}  (${d.after?.type ?? "?"} \xB7 ${d.after?.auth_profile ?? "sin auth"})`);
        } else if (d.change === "removed") {
          console.log(`  - ${d.slug}`);
        } else {
          console.log(`  ~ ${d.slug}  (${d.changed_fields?.join(", ")})`);
        }
      }
    }
    console.log("");
  }
  let applied = false;
  if (opts.apply && !noChanges) {
    const merged = applyDiffToCatalog(currentCatalog, freshApps, diff);
    saveCatalog(cacheDir, merged);
    try {
      await runContextRender(cacheDir, { json: true });
    } catch {
    }
    applied = true;
    if (!jsonMode) {
      printOk("Cat\xE1logo actualizado en cache local.");
      printDim("  Para publicar: dd-cli client publish " + slug);
    }
  } else if (!noChanges && !jsonMode) {
    printInfo("Dry-run. Para aplicar: dd-cli client refresh " + slug + " --apply");
  }
  const existingState = readClientState(slug)?.state;
  let nextState;
  if (applied) {
    if (existingState === "READY" || existingState === "ACTIVE" || existingState === "NEEDS_REFRESH") {
      nextState = "DRAFT";
    }
  }
  recordCommandResult(slug, "client refresh", {
    success: true,
    state: nextState,
    nextSafe: applied ? `dd-cli client publish ${slug}` : null
  });
  const output = {
    slug,
    applied,
    discovery_summary: discovery.summary,
    diff,
    total_changes: diff.length,
    no_changes: noChanges
  };
  if (jsonMode) {
    emitJson(jsonSuccess("client refresh", output, applied ? `dd-cli client publish ${slug}` : null));
  }
  return 0;
}
var DISCOVERY_FILES2 = [
  "package.json",
  "composer.json",
  "pom.xml",
  "requirements.txt",
  "Gemfile",
  ".gitlab-ci.yml",
  ".github/workflows/ci.yml",
  "config/sso.php",
  "config/auth.php",
  "src/auth/index.ts",
  "src/main.ts",
  "app/Http/Kernel.php"
];
async function readKeyFiles2(provider, repoIdOrSlug, branch, concurrency) {
  const result = {};
  const queue = [...DISCOVERY_FILES2];
  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        result[file] = await provider.readFile(repoIdOrSlug, file, branch);
      } catch {
        result[file] = { path: file, content: "", found: false };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

// src/commands/client-onboard-dev.ts
import { execSync as execSync8 } from "child_process";
import { existsSync as existsSync36, mkdirSync as mkdirSync20, rmSync as rmSync4 } from "fs";
import * as path32 from "path";
import { input as input4, password as password2 } from "@inquirer/prompts";
var isTTY10 = process.stdout.isTTY;
function runGit6(cmd, cwd) {
  return execSync8(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function embedTokenInUrl2(url, token, provider) {
  try {
    const u = new URL(url);
    if (provider === "github") {
      u.username = "x-access-token";
      u.password = token;
    } else {
      u.username = "oauth2";
      u.password = token;
    }
    return u.toString();
  } catch {
    return url;
  }
}
async function runClientOnboardDev(slug, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    const e = {
      code: "INVALID_INPUT",
      message: "Falta el slug o no es kebab-case. Uso: dd-cli client onboard-dev <slug>"
    };
    if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...e }));
    printErr(e.message);
    return 3;
  }
  if (!jsonMode) console.log(bold(`
Setup local para ${slug}
`));
  let contextUrl = opts.contextUrl;
  let gitToken = opts.gitToken;
  if (!contextUrl && !isTTY10) {
    const e = {
      code: "INVALID_INPUT",
      message: "En modo no interactivo se necesita --context-url y --git-token.",
      recovery_hints: [
        `Ejemplo: dd-cli client onboard-dev ${slug} --context-url=https://... --git-token=glpat-...`
      ]
    };
    if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...e }));
    printErr(e.message);
    return 3;
  }
  if (!contextUrl) {
    contextUrl = await input4({
      message: "URL del context repo del cliente (te la pasa el consultor):",
      validate: (v) => /^https?:\/\//.test(v) || "Debe ser una URL http(s) al repo de contexto"
    });
  }
  if (!gitToken) {
    printInfo("Necesit\xE1s un PAT propio (NO el del consultor) con scope read-only:");
    printDim("  GitLab: read_repository");
    printDim("  GitHub: repo:read o public_repo si el repo es p\xFAblico");
    gitToken = await password2({
      message: "Tu token API (read-only):",
      mask: "*",
      validate: (v) => v.trim().length > 0 || "Es obligatorio"
    });
  }
  const provider = /github/i.test(contextUrl) ? "github" : "gitlab";
  const baseUrl = provider === "github" ? "https://api.github.com" : "https://gitlab.com";
  let group;
  try {
    const u = new URL(contextUrl);
    const parts = u.pathname.replace(/^\/|\.git$/g, "").split("/");
    group = parts[0] ?? "";
    if (!group) throw new Error("Sin group");
  } catch {
    const e = {
      code: "INVALID_INPUT",
      message: "No pude inferir el group/org desde la URL del context repo.",
      recovery_hints: ["Verific\xE1 que la URL tenga el formato https://<host>/<group>/<slug>-devflow-context.git"]
    };
    if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...e }));
    printErr(e.message);
    return 3;
  }
  const creds = {
    git_token: gitToken,
    git_host: provider,
    git_base_url: baseUrl,
    git_group: group
  };
  const providerInstance = createProvider(creds, { type: provider, base_url: baseUrl, group_or_org: group });
  if (!jsonMode) printInfo(`Validando token contra ${provider} / ${group} ...`);
  const tokenCheck = await providerInstance.validateToken({ required_for: ["read"] });
  if (!tokenCheck.valid) {
    const e = {
      code: "TOKEN_INVALID",
      message: tokenCheck.message,
      context: { provider, group },
      recovery_hints: ["Gener\xE1 un PAT con scope read-only en tu cuenta"]
    };
    if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...e }));
    printErr(e.message);
    return 1;
  }
  if (tokenCheck.scopes_missing.length > 0) {
    const e = {
      code: "TOKEN_INSUFFICIENT_SCOPE",
      message: `Al token le faltan scopes: ${tokenCheck.scopes_missing.join(", ")}`,
      context: {
        provider,
        scopes_present: tokenCheck.scopes_present,
        scopes_missing: tokenCheck.scopes_missing
      }
    };
    if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...e }));
    printErr(e.message);
    return 2;
  }
  if (!jsonMode) printOk(`Token v\xE1lido \u2014 usuario ${tokenCheck.user ?? "desconocido"}`);
  const cacheDir = getClientCacheDir(slug);
  const cloneUrl = embedTokenInUrl2(contextUrl, gitToken, provider);
  if (existsSync36(cacheDir)) {
    try {
      runGit6("git pull --ff-only", cacheDir);
      if (!jsonMode) printDim(`Cache local ya exist\xEDa, pull OK: ${cacheDir}`);
    } catch {
      if (!jsonMode) printWarn("Pull fall\xF3; re-clonando ...");
      rmSync4(cacheDir, { recursive: true, force: true });
    }
  }
  if (!existsSync36(cacheDir)) {
    const parentDir = path32.dirname(cacheDir);
    if (!existsSync36(parentDir)) mkdirSync20(parentDir, { recursive: true });
    try {
      runGit6(`git clone "${cloneUrl}" "${cacheDir}"`);
      if (!jsonMode) printOk(`Cache local: ${cacheDir}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const errObj = {
        code: "GIT_CLONE_FAILED",
        message: `git clone fall\xF3: ${errMsg}`,
        context: { url: contextUrl, cache_dir: cacheDir },
        recovery_hints: ["Verific\xE1 que el token tenga acceso al context repo"]
      };
      if (jsonMode) emitJson(jsonError({ command: "client onboard-dev", ...errObj }));
      printErr(errObj.message);
      return 1;
    }
  }
  let clientName = slug;
  try {
    const marker = loadContextRepoMarker(cacheDir);
    if (marker) clientName = marker.client.name;
  } catch {
  }
  registerClient({
    slug,
    name: clientName,
    context_url: contextUrl,
    local_cache: cacheDir,
    last_synced: (/* @__PURE__ */ new Date()).toISOString()
  });
  setClientCredentials(slug, creds);
  if (!jsonMode) printOk("Cliente registrado en esta m\xE1quina (~/.devflow/registry.yml + credentials.yml)");
  const skillsDir = getClaudeSkillsDir();
  const skillsInstalled = existsSync36(skillsDir);
  if (!skillsInstalled && !jsonMode) {
    printWarn("Las skills DevFlow IA NO est\xE1n instaladas en esta m\xE1quina.");
    printDim("  Para instalarlas: dd-cli skills install");
    printDim("  Para statusline:  dd-cli install");
  } else if (!jsonMode) {
    printOk("Skills DevFlow IA instaladas");
  }
  try {
    recordCommandResult(slug, "client onboard-dev", {
      success: true,
      state: "READY",
      nextSafe: `cd <repo-de-codigo> && dd-cli init --client=${slug}`
    });
  } catch {
  }
  const result = {
    slug,
    context_url: contextUrl,
    cache_dir: cacheDir,
    skills_installed: skillsInstalled,
    state: "ACTIVE"
  };
  if (jsonMode) {
    emitJson(jsonSuccess("client onboard-dev", result, `cd <repo-de-codigo> && dd-cli init --client=${slug}`));
  }
  console.log("");
  printOk(`${bold(clientName)} listo en esta m\xE1quina.`);
  console.log("");
  printInfo("Cuando vayas a programar:");
  printDim(`  cd <repo-de-codigo>`);
  printDim(`  dd-cli init --client=${slug}`);
  printDim(`  dd-cli start-session <HDU-id>`);
  return 0;
}

// src/commands/error-codes-cmd.ts
var EXIT_CODE_CATEGORIES = {
  1: "Operacional (red, permisos, archivo no encontrado)",
  2: "Precondici\xF3n no cumplida (configuraci\xF3n, registro)",
  3: "Validaci\xF3n (schema, input mal formado)"
};
async function runErrorCodes(opts = {}) {
  const jsonMode = isJsonMode(opts);
  const byExitCode = { 1: [], 2: [], 3: [] };
  for (const code of ERROR_CODES) {
    byExitCode[exitCodeFor(code)].push(code);
  }
  if (jsonMode) {
    emitJson(jsonSuccess("error-codes", {
      exit_codes: {
        0: "\xC9xito completo",
        1: EXIT_CODE_CATEGORIES[1],
        2: EXIT_CODE_CATEGORIES[2],
        3: EXIT_CODE_CATEGORIES[3]
      },
      total: ERROR_CODES.length,
      by_exit_code: byExitCode,
      codes: ERROR_CODES.map((code) => ({
        code,
        exit_code: exitCodeFor(code)
      }))
    }));
  }
  console.log("");
  console.log(bold("Convenci\xF3n de exit codes (R-4 del redise\xF1o)"));
  console.log("");
  console.log("  0  \xC9xito completo");
  for (const code of [1, 2, 3]) {
    console.log(`  ${code}  ${EXIT_CODE_CATEGORIES[code]}`);
  }
  console.log("");
  console.log(bold(`C\xF3digos de error estables (${ERROR_CODES.length})`));
  console.log("");
  console.log("Estos c\xF3digos son contrato \u2014 son consumidos por las skills");
  console.log("y por integraciones de CI. Estables entre versiones del CLI.");
  console.log("");
  for (const exitCode of [3, 2, 1]) {
    if (byExitCode[exitCode].length === 0) continue;
    console.log(bold(`  Exit ${exitCode} \u2014 ${EXIT_CODE_CATEGORIES[exitCode]}`));
    for (const code of byExitCode[exitCode]) {
      console.log(`    ${code}`);
    }
    console.log("");
  }
  printDim("Para output JSON: dd-cli error-codes --json");
  return 0;
}

// src/commands/hdu-cmd.ts
import { existsSync as existsSync37 } from "fs";
import { input as input5 } from "@inquirer/prompts";
var isTTY11 = process.stdout.isTTY;
function resolveCacheDir(clientSlug) {
  const entry = getClient(clientSlug);
  if (!entry) {
    return {
      ok: false,
      error: {
        code: "CLIENT_NOT_REGISTERED",
        message: `Cliente "${clientSlug}" no registrado en esta m\xE1quina.`,
        context: { slug: clientSlug }
      }
    };
  }
  const cacheDir = getClientCacheDir(clientSlug);
  if (!existsSync37(cacheDir)) {
    return {
      ok: false,
      error: {
        code: "CONTEXT_CACHE_MISSING",
        message: `Cache local no encontrada para "${clientSlug}".`,
        context: { slug: clientSlug, cache_dir: cacheDir }
      }
    };
  }
  return { ok: true, cacheDir };
}
function slugify2(title) {
  return title.toLowerCase().replace(/[áéíóúñ]/g, (c3) => ({ \u00E1: "a", \u00E9: "e", \u00ED: "i", \u00F3: "o", \u00FA: "u", \u00F1: "n" })[c3] ?? c3).replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
async function runHduNew(title, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!title || title.trim().length === 0) {
    const e = { code: "INVALID_INPUT", message: 'Falta el t\xEDtulo. Uso: dd-cli hdu new "<t\xEDtulo>" --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: "hdu new", ...e }));
    printErr(e.message);
    return 3;
  }
  if (!opts.client) {
    const e = { code: "INVALID_INPUT", message: 'Falta --client=<slug>. Uso: dd-cli hdu new "<t\xEDtulo>" --client=<slug>' };
    if (jsonMode) emitJson(jsonError({ command: "hdu new", ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: "hdu new", ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const { cacheDir } = r;
  const index = regenerateHduIndex(cacheDir);
  const nextId = `HDU-${index.next_hdu_id}`;
  const slug = slugify2(title);
  const filename = `${nextId}-${slug}.md`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const apps = opts.app ? [opts.app] : [];
  const devType = DEV_TYPES.includes(opts.devType ?? "") ? opts.devType : void 0;
  const hdu = {
    filename,
    frontmatter: HduFrontmatterSchema.parse({
      id: nextId,
      title,
      status: "draft",
      dev_type: devType,
      dev_type_locked: false,
      priority: opts.priority ?? "media",
      apps_affected: apps,
      assigned_to: opts.assignedTo ?? null,
      created_by: opts.createdBy ?? "unknown@local",
      created_at: now,
      approved_by: null,
      approved_at: null,
      sprint: null,
      tags: []
    }),
    body: `## Como
(perfil del usuario)

## Quiero
(qu\xE9 funcionalidad)

## Para
(qu\xE9 valor de negocio)

## Criterios de aceptaci\xF3n
- [ ] Dado X, cuando Y, entonces Z

## Notas t\xE9cnicas
(contexto para el dev)
`
  };
  saveHdu(cacheDir, hdu);
  appendTransition(cacheDir, {
    ts: now,
    hdu: nextId,
    from: null,
    to: "draft",
    by: opts.createdBy ?? "unknown@local",
    reason: "created",
    via: "cli"
  });
  regenerateHduIndex(cacheDir);
  if (jsonMode) {
    emitJson(jsonSuccess("hdu new", {
      id: nextId,
      title,
      filename,
      path: getHduFilePath(cacheDir, nextId, slug),
      status: "draft"
    }, `dd-cli hdu approve ${nextId} --client=${opts.client}`));
  }
  printOk(`HDU creada: ${bold(nextId)} \xB7 ${title}`);
  printDim(`  ${getHdusDir(cacheDir)}/${filename}`);
  console.log("");
  printInfo("Pr\xF3ximo: editar el archivo + dd-cli hdu approve cuando est\xE9 lista");
  return 0;
}
async function runHduList(opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!opts.client) {
    const e = { code: "INVALID_INPUT", message: "Falta --client=<slug>." };
    if (jsonMode) emitJson(jsonError({ command: "hdu list", ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: "hdu list", ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  let hdus = listHdus(r.cacheDir);
  if (opts.status) {
    if (!HDU_STATUSES.includes(opts.status)) {
      const e = { code: "INVALID_INPUT", message: `--status=${opts.status} no es v\xE1lido. Opciones: ${HDU_STATUSES.join(", ")}` };
      if (jsonMode) emitJson(jsonError({ command: "hdu list", ...e }));
      printErr(e.message);
      return 3;
    }
    hdus = hdus.filter((h) => h.frontmatter.status === opts.status);
  }
  if (opts.mine && opts.user) {
    hdus = hdus.filter((h) => h.frontmatter.assigned_to === opts.user);
  }
  if (jsonMode) {
    emitJson(jsonSuccess("hdu list", {
      client: opts.client,
      total: hdus.length,
      hdus: hdus.map((h) => ({
        id: h.frontmatter.id,
        title: h.frontmatter.title,
        status: h.frontmatter.status,
        priority: h.frontmatter.priority,
        assigned_to: h.frontmatter.assigned_to,
        apps_affected: h.frontmatter.apps_affected,
        dev_type: h.frontmatter.dev_type
      }))
    }));
  }
  console.log("");
  if (hdus.length === 0) {
    printDim("  (ninguna HDU)");
    return 0;
  }
  for (const h of hdus) {
    const fm = h.frontmatter;
    console.log(`  ${bold(fm.id.padEnd(10))} ${fm.status.padEnd(13)} ${fm.priority.padEnd(8)} ${fm.title}`);
    if (fm.apps_affected.length > 0 || fm.assigned_to) {
      const parts = [];
      if (fm.apps_affected.length > 0) parts.push(fm.apps_affected.join(", "));
      if (fm.assigned_to) parts.push(`\u2192 ${fm.assigned_to}`);
      printDim(`    ${parts.join(" \xB7 ")}`);
    }
  }
  console.log("");
  printDim(`  Total: ${hdus.length}`);
  return 0;
}
async function runHduShow(hduId, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!hduId || !opts.client) {
    const e = { code: "INVALID_INPUT", message: "Uso: dd-cli hdu show <HDU-id> --client=<slug>" };
    if (jsonMode) emitJson(jsonError({ command: "hdu show", ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: "hdu show", ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find((h) => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = {
      code: "HDU_NOT_FOUND",
      message: `HDU "${hduId}" no existe en el contexto de ${opts.client}.`,
      recovery_hints: [`Listar: dd-cli hdu list --client=${opts.client}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "hdu show", ...e }));
    printErr(e.message);
    return 2;
  }
  const transitions = readTransitions(r.cacheDir).filter((t) => t.hdu === hduId);
  if (jsonMode) {
    emitJson(jsonSuccess("hdu show", {
      ...hdu.frontmatter,
      body: hdu.body,
      transitions
    }));
  }
  const fm = hdu.frontmatter;
  console.log("");
  console.log(`  ${bold(fm.id)} \xB7 ${fm.title}`);
  console.log(`  ${fm.status.padEnd(13)} ${fm.priority.padEnd(8)} ${fm.dev_type ?? "(sin dev_type)"}`);
  if (fm.apps_affected.length > 0) printDim(`  apps: ${fm.apps_affected.join(", ")}`);
  if (fm.assigned_to) printDim(`  asignada a: ${fm.assigned_to}`);
  if (fm.sprint) printDim(`  sprint: ${fm.sprint}`);
  console.log("");
  console.log(hdu.body);
  if (transitions.length > 0) {
    console.log("");
    console.log(bold("  Historial:"));
    for (const t of transitions) {
      printDim(`    ${t.ts}  ${t.from ?? "(none)"} \u2192 ${t.to}  por ${t.by}${t.reason ? " \xB7 " + t.reason : ""}`);
    }
  }
  return 0;
}
async function transitionHdu(command, hduId, toStatus, opts, mutator) {
  const jsonMode = isJsonMode(opts);
  if (!hduId || !opts.client) {
    const e = { code: "INVALID_INPUT", message: `Uso: dd-cli ${command} <HDU-id> --client=<slug>` };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command, ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find((h) => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = {
      code: "HDU_NOT_FOUND",
      message: `HDU "${hduId}" no existe.`,
      recovery_hints: [`Listar: dd-cli hdu list --client=${opts.client}`]
    };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 2;
  }
  const fromStatus = hdu.frontmatter.status;
  if (fromStatus === toStatus) {
    if (jsonMode) {
      emitJson(jsonSuccess(command, { id: hduId, no_change: true, status: toStatus }));
    }
    printDim(`HDU ${hduId} ya est\xE1 en ${toStatus}, nada que hacer.`);
    return 0;
  }
  if (!canHduTransitionTo(fromStatus, toStatus)) {
    const e = {
      code: "INVALID_INPUT",
      message: `Transici\xF3n ilegal: ${fromStatus} \u2192 ${toStatus}. Legales desde ${fromStatus}: ${legalNextStatuses(fromStatus).join(", ")}.`,
      context: { from: fromStatus, to: toStatus, legal: legalNextStatuses(fromStatus) }
    };
    if (jsonMode) emitJson(jsonError({ command, ...e }));
    printErr(e.message);
    return 3;
  }
  hdu.frontmatter.status = toStatus;
  if (mutator) mutator(hdu);
  saveHdu(r.cacheDir, hdu);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  appendTransition(r.cacheDir, {
    ts: now,
    hdu: hduId,
    from: fromStatus,
    to: toStatus,
    by: opts.by ?? hdu.frontmatter.assigned_to ?? "unknown@local",
    reason: opts.reason ?? null,
    via: "cli"
  });
  regenerateHduIndex(r.cacheDir);
  if (jsonMode) {
    emitJson(jsonSuccess(command, {
      id: hduId,
      from: fromStatus,
      to: toStatus,
      status: toStatus
    }));
  }
  printOk(`${hduId}: ${fromStatus} \u2192 ${bold(toStatus)}`);
  return 0;
}
async function runHduStart(hduId, opts = {}) {
  return transitionHdu("hdu start", hduId, "in-progress", opts);
}
async function runHduReview(hduId, opts = {}) {
  return transitionHdu("hdu review", hduId, "in-review", opts);
}
async function runHduApprove(hduId, opts = {}) {
  return transitionHdu("hdu approve", hduId, "approved", opts, (hdu) => {
    hdu.frontmatter.approved_by = opts.by ?? hdu.frontmatter.approved_by;
    hdu.frontmatter.approved_at = (/* @__PURE__ */ new Date()).toISOString();
    if (opts.by) hdu.frontmatter.dev_type_source = "tech-lead-approval";
  });
}
async function runHduClose(hduId, opts = {}) {
  return transitionHdu("hdu close", hduId, "done", opts);
}
async function runHduCancel(hduId, opts = {}) {
  if (!opts.reason) {
    if (!isTTY11) {
      const e = { code: "INVALID_INPUT", message: "--reason es obligatorio para cancelar." };
      if (isJsonMode(opts)) emitJson(jsonError({ command: "hdu cancel", ...e }));
      printErr(e.message);
      return 3;
    }
    opts.reason = await input5({ message: "Raz\xF3n de cancelaci\xF3n:" });
  }
  return transitionHdu("hdu cancel", hduId, "cancelled", opts);
}
async function runHduAssign(hduId, opts) {
  const jsonMode = isJsonMode(opts);
  if (!hduId || !opts.client || !opts.to) {
    const e = { code: "INVALID_INPUT", message: "Uso: dd-cli hdu assign <HDU-id> --client=<slug> --to=<email>" };
    if (jsonMode) emitJson(jsonError({ command: "hdu assign", ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: "hdu assign", ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find((h) => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = { code: "HDU_NOT_FOUND", message: `HDU "${hduId}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: "hdu assign", ...e }));
    printErr(e.message);
    return 2;
  }
  const previous = hdu.frontmatter.assigned_to;
  hdu.frontmatter.assigned_to = opts.to;
  saveHdu(r.cacheDir, hdu);
  regenerateHduIndex(r.cacheDir);
  if (jsonMode) {
    emitJson(jsonSuccess("hdu assign", {
      id: hduId,
      previous_assignee: previous,
      assigned_to: opts.to
    }));
  }
  printOk(`${hduId} asignada a ${opts.to}${previous ? " (antes: " + previous + ")" : ""}`);
  return 0;
}
async function runHduClaim(hduId, opts) {
  return runHduAssign(hduId, { ...opts, to: opts.user });
}
async function runHduIndexCmd(opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!opts.client) {
    const e = { code: "INVALID_INPUT", message: "Falta --client=<slug>." };
    if (jsonMode) emitJson(jsonError({ command: "hdu index", ...e }));
    printErr(e.message);
    return 3;
  }
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: "hdu index", ...r.error }));
    printErr(r.error.message);
    return 2;
  }
  const index = regenerateHduIndex(r.cacheDir);
  if (jsonMode) {
    emitJson(jsonSuccess("hdu index", {
      client: opts.client,
      next_hdu_id: index.next_hdu_id,
      total_hdus: index.hdus.length,
      generated_at: index.generated_at
    }));
  }
  printOk(`_index.yml regenerado: ${index.hdus.length} HDUs, pr\xF3ximo ID: HDU-${index.next_hdu_id}`);
  return 0;
}

// src/commands/hdu-next.ts
import { existsSync as existsSync38 } from "fs";
var PRIORITY_SCORE = {
  "cr\xEDtica": 100,
  "alta": 50,
  "media": 20,
  "baja": 5
};
function recentAppsForUser(transitions, user, hdus) {
  const cutoff = Date.now() - 60 * 864e5;
  const recentHduIds = /* @__PURE__ */ new Set();
  for (const t of transitions) {
    if (t.by !== user) continue;
    if (new Date(t.ts).getTime() < cutoff) continue;
    recentHduIds.add(t.hdu);
  }
  const apps = /* @__PURE__ */ new Set();
  for (const h of hdus) {
    if (!recentHduIds.has(h.frontmatter.id)) continue;
    for (const a of h.frontmatter.apps_affected) apps.add(a);
  }
  return apps;
}
function lastClosedDevTypeForUser(transitions, user, hdus) {
  const sorted = [...transitions].sort((a, b) => b.ts.localeCompare(a.ts));
  for (const t of sorted) {
    if (t.to !== "done" || t.by !== user) continue;
    const h = hdus.find((x) => x.frontmatter.id === t.hdu);
    if (h?.frontmatter.dev_type) return h.frontmatter.dev_type;
  }
  return null;
}
function scoreHdu(hdu, ctx) {
  const fm = hdu.frontmatter;
  const priority = PRIORITY_SCORE[fm.priority];
  const app_match = fm.apps_affected.some((a) => ctx.userApps.has(a)) ? 15 : 0;
  const dev_type_continuity = fm.dev_type && fm.dev_type === ctx.lastDevType ? 10 : 0;
  const in_active_sprint = fm.sprint && ctx.activeSprint && fm.sprint === ctx.activeSprint ? 8 : 0;
  const ageDays = (Date.now() - new Date(fm.created_at).getTime()) / 864e5;
  const age = Math.min(20, Math.floor(ageDays / 5));
  return {
    priority,
    app_match,
    dev_type_continuity,
    in_active_sprint,
    age,
    total: priority + app_match + dev_type_continuity + in_active_sprint + age
  };
}
async function runHduNext(opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!opts.client) {
    const e = { code: "INVALID_INPUT", message: "Falta --client=<slug>." };
    if (jsonMode) emitJson(jsonError({ command: "hdu next", ...e }));
    printErr(e.message);
    return 3;
  }
  if (!opts.user) {
    const e = { code: "INVALID_INPUT", message: "Falta --user=<email>. El scoring necesita saber qu\xE9 dev est\xE1 consultando." };
    if (jsonMode) emitJson(jsonError({ command: "hdu next", ...e }));
    printErr(e.message);
    return 3;
  }
  const entry = getClient(opts.client);
  if (!entry) {
    const e = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${opts.client}" no registrado.`
    };
    if (jsonMode) emitJson(jsonError({ command: "hdu next", ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(opts.client);
  if (!existsSync38(cacheDir)) {
    const e = {
      code: "CONTEXT_CACHE_MISSING",
      message: `Cache local no encontrada para ${opts.client}.`
    };
    if (jsonMode) emitJson(jsonError({ command: "hdu next", ...e }));
    printErr(e.message);
    return 2;
  }
  const allHdus = listHdus(cacheDir);
  const transitions = readTransitions(cacheDir);
  const candidates = allHdus.filter((h) => {
    if (h.frontmatter.status !== "approved") return false;
    if (!h.frontmatter.assigned_to) return true;
    return h.frontmatter.assigned_to === opts.user;
  });
  if (candidates.length === 0) {
    if (jsonMode) {
      emitJson(jsonSuccess("hdu next", {
        client: opts.client,
        user: opts.user,
        candidates: 0,
        recommendation: null
      }));
    }
    printDim("  No hay HDUs aprobadas disponibles para vos.");
    printInfo("Para ver el backlog: dd-cli hdu list --client=" + opts.client + " --status=approved");
    return 0;
  }
  const userApps = recentAppsForUser(transitions, opts.user, allHdus);
  const lastDevType = lastClosedDevTypeForUser(transitions, opts.user, allHdus);
  const activeSprint = null;
  const ctx = { user: opts.user, userApps, lastDevType, activeSprint };
  const scored = candidates.map((hdu) => ({ hdu, breakdown: scoreHdu(hdu, ctx) })).sort((a, b) => b.breakdown.total - a.breakdown.total);
  const top = scored[0];
  if (jsonMode) {
    emitJson(jsonSuccess("hdu next", {
      client: opts.client,
      user: opts.user,
      candidates: scored.length,
      recommendation: {
        id: top.hdu.frontmatter.id,
        title: top.hdu.frontmatter.title,
        priority: top.hdu.frontmatter.priority,
        dev_type: top.hdu.frontmatter.dev_type,
        apps_affected: top.hdu.frontmatter.apps_affected,
        breakdown: top.breakdown
      },
      all_candidates: scored.map((s) => ({
        id: s.hdu.frontmatter.id,
        title: s.hdu.frontmatter.title,
        score: s.breakdown.total,
        breakdown: opts.explain ? s.breakdown : void 0
      }))
    }, `dd-cli hdu claim ${top.hdu.frontmatter.id} --client=${opts.client} --user=${opts.user}`));
  }
  const fm = top.hdu.frontmatter;
  console.log("");
  console.log(`Te sugiero: ${bold(fm.id)} \xB7 ${fm.title}`);
  printDim(`  prioridad: ${fm.priority}    dev_type: ${fm.dev_type ?? "(sin)"}`);
  if (fm.apps_affected.length > 0) printDim(`  apps: ${fm.apps_affected.join(", ")}`);
  console.log("");
  if (opts.explain) {
    console.log(bold("  Score breakdown:"));
    printDim(`    prioridad:              ${top.breakdown.priority}`);
    printDim(`    app match:              ${top.breakdown.app_match}`);
    printDim(`    continuidad dev_type:   ${top.breakdown.dev_type_continuity}`);
    printDim(`    sprint activo:          ${top.breakdown.in_active_sprint}`);
    printDim(`    antig\xFCedad:             ${top.breakdown.age}`);
    printDim(`    total:                  ${top.breakdown.total}`);
    console.log("");
    if (scored.length > 1) {
      console.log(bold(`  Otras ${scored.length - 1} candidatas:`));
      for (const s of scored.slice(1, 4)) {
        printDim(`    ${s.hdu.frontmatter.id} (${s.breakdown.total}): ${s.hdu.frontmatter.title}`);
      }
      console.log("");
    }
  }
  printInfo("Para arrancar:");
  printDim(`  dd-cli hdu claim ${fm.id} --client=${opts.client} --user=${opts.user}`);
  printDim(`  dd-cli start-session ${fm.id}`);
  return 0;
}

// src/commands/hdu-apply-merge.ts
import { execSync as execSync9 } from "child_process";
import { existsSync as existsSync39 } from "fs";
import * as path33 from "path";
function runGit7(cmd, cwd) {
  return execSync9(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function getChangedHdusFilesFromHead(repoRoot) {
  try {
    let cmd = "git diff --name-only HEAD~1 HEAD";
    try {
      runGit7("git rev-parse HEAD~1", repoRoot);
    } catch {
      cmd = "git diff --name-only HEAD";
    }
    const files = runGit7(cmd, repoRoot).split("\n").filter(Boolean);
    return files.filter((f) => f.startsWith("hdus/") && f.endsWith(".md") && !path33.basename(f).startsWith("_"));
  } catch {
    return [];
  }
}
function getCommitAuthorEmail(repoRoot) {
  try {
    return runGit7("git log -1 --format=%ae", repoRoot);
  } catch {
    return null;
  }
}
async function runHduApplyMerge(opts = {}) {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path33.resolve(opts.path ?? process.cwd());
  if (!existsSync39(getHdusDir(repoRoot))) {
    const e = {
      code: "CONTEXT_REPO_INVALID",
      message: `No hay hdus/ en ${repoRoot}. \xBFEst\xE1s en un context repo?`,
      recovery_hints: [`Valid\xE1: dd-cli context validate ${repoRoot}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "hdu apply-merge", ...e }));
    printErr(e.message);
    return 3;
  }
  const changed = getChangedHdusFilesFromHead(repoRoot);
  if (changed.length === 0) {
    if (jsonMode) {
      emitJson(jsonSuccess("hdu apply-merge", {
        repo_root: repoRoot,
        actions: [],
        applied: false,
        committed: false
      }));
    }
    printDim("No hay archivos hdus/*.md cambiados en HEAD.");
    return 0;
  }
  const allHdus = listHdus(repoRoot);
  const apply = !!opts.apply;
  const by = opts.by ?? getCommitAuthorEmail(repoRoot) ?? "ci@devflow-ia";
  const actions = [];
  for (const filename of changed) {
    const basename4 = path33.basename(filename);
    const hdu = allHdus.find((h) => h.filename === basename4);
    if (!hdu) {
      printDim(`  (skip) ${basename4} \u2014 no parsea como HDU`);
      continue;
    }
    const fromStatus = hdu.frontmatter.status;
    if (fromStatus !== "draft") {
      printDim(`  (skip) ${hdu.frontmatter.id} \u2014 ya est\xE1 en ${fromStatus}`);
      continue;
    }
    if (!canHduTransitionTo(fromStatus, "approved")) {
      continue;
    }
    actions.push({
      hdu_id: hdu.frontmatter.id,
      filename: basename4,
      from: fromStatus,
      to: "approved",
      applied: apply
    });
    if (apply) {
      hdu.frontmatter.status = "approved";
      hdu.frontmatter.approved_by = by;
      hdu.frontmatter.approved_at = (/* @__PURE__ */ new Date()).toISOString();
      if (!hdu.frontmatter.dev_type_locked && hdu.frontmatter.dev_type) {
        hdu.frontmatter.dev_type_locked = true;
        hdu.frontmatter.dev_type_source = "pr-merge";
      }
      saveHdu(repoRoot, hdu);
      appendTransition(repoRoot, {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        hdu: hdu.frontmatter.id,
        from: fromStatus,
        to: "approved",
        by,
        reason: "merge to main approved by code review",
        via: "pr-merge"
      });
    }
  }
  if (apply && actions.length > 0) {
    regenerateHduIndex(repoRoot);
  }
  let committed = false;
  if (apply && opts.commit && actions.length > 0) {
    try {
      runGit7("git add hdus/", repoRoot);
      try {
        runGit7("git config user.email", repoRoot);
      } catch {
        runGit7('git config user.email "ci@devflow-ia"', repoRoot);
      }
      try {
        runGit7("git config user.name", repoRoot);
      } catch {
        runGit7('git config user.name "DevFlow IA CI"', repoRoot);
      }
      const msg = `chore(hdus): apply post-merge transitions

${actions.map((a) => `- ${a.hdu_id}: ${a.from} \u2192 ${a.to}`).join("\n")}

Generado por dd-cli hdu apply-merge (S5-4).`;
      runGit7(`git -c commit.gpgsign=false commit -m "${msg.replace(/"/g, '\\"')}"`, repoRoot);
      runGit7("git push origin HEAD", repoRoot);
      committed = true;
    } catch (e) {
      if (jsonMode) {
        emitJson(jsonError({
          command: "hdu apply-merge",
          code: "GIT_PUSH_FAILED",
          message: `Push de transitions fall\xF3: ${e instanceof Error ? e.message : String(e)}`,
          context: { actions, applied: true, committed: false },
          recovery_hints: [
            "Verific\xE1 que el bot token tenga permisos de push a main",
            "Verific\xE1 branch protection (debe permitir bypass para el bot)"
          ]
        }));
      }
      printErr(`git push fall\xF3: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }
  if (jsonMode) {
    emitJson(jsonSuccess("hdu apply-merge", {
      repo_root: repoRoot,
      changed_files: changed,
      actions,
      applied: apply,
      committed
    }));
  }
  console.log("");
  console.log(bold(`HDU apply-merge en ${repoRoot}`));
  for (const a of actions) {
    const marker = a.applied ? printOk : printInfo;
    marker(`  ${a.hdu_id}: ${a.from} \u2192 ${a.to}${apply ? "" : " (dry-run)"}`);
  }
  if (actions.length === 0) printDim("  Nada para aplicar.");
  if (apply && opts.commit) {
    if (committed) printOk("Commit + push hechos.");
  } else if (actions.length > 0 && !apply) {
    console.log("");
    printDim("Para aplicar: dd-cli hdu apply-merge --apply --commit");
  }
  return 0;
}

// src/commands/stats-cmd.ts
import { existsSync as existsSync40 } from "fs";
function parsePeriodToMs(period) {
  if (period === "all") return null;
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  return Number.parseInt(match[1] ?? "0", 10) * 864e5;
}
function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
}
function p90(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}
function timelineForHdu(transitions, hduId) {
  const ts = transitions.filter((t) => t.hdu === hduId).sort((a, b) => a.ts.localeCompare(b.ts));
  let draft_at = null;
  let approved_at = null;
  let done_at = null;
  let cancelled_at = null;
  for (const t of ts) {
    const ms = new Date(t.ts).getTime();
    if (t.to === "draft" && !draft_at) draft_at = ms;
    if (t.to === "approved" && !approved_at) approved_at = ms;
    if (t.to === "done") done_at = ms;
    if (t.to === "cancelled") cancelled_at = ms;
  }
  return { draft_at, approved_at, done_at, cancelled_at, current_dev_type: null };
}
async function runStats(opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!opts.client) {
    const e = { code: "INVALID_INPUT", message: "Falta --client=<slug>." };
    if (jsonMode) emitJson(jsonError({ command: "stats", ...e }));
    printErr(e.message);
    return 3;
  }
  const entry = getClient(opts.client);
  if (!entry) {
    const e = {
      code: "CLIENT_NOT_REGISTERED",
      message: `Cliente "${opts.client}" no registrado.`
    };
    if (jsonMode) emitJson(jsonError({ command: "stats", ...e }));
    printErr(e.message);
    return 2;
  }
  const cacheDir = getClientCacheDir(opts.client);
  if (!existsSync40(cacheDir)) {
    const e = {
      code: "CONTEXT_CACHE_MISSING",
      message: `Cache local no encontrada para ${opts.client}.`
    };
    if (jsonMode) emitJson(jsonError({ command: "stats", ...e }));
    printErr(e.message);
    return 2;
  }
  const periodStr = opts.period ?? "30d";
  const periodMs = parsePeriodToMs(periodStr);
  if (periodStr !== "all" && periodMs === null) {
    const e = {
      code: "INVALID_INPUT",
      message: `--period=${periodStr} no es v\xE1lido. Us\xE1 Nd (ej: 30d) o 'all'.`
    };
    if (jsonMode) emitJson(jsonError({ command: "stats", ...e }));
    printErr(e.message);
    return 3;
  }
  const cutoffMs = periodMs ? Date.now() - periodMs : 0;
  const allHdus = listHdus(cacheDir);
  const transitions = readTransitions(cacheDir);
  const byStatus = {};
  for (const h of allHdus) {
    byStatus[h.frontmatter.status] = (byStatus[h.frontmatter.status] ?? 0) + 1;
  }
  const leadTimes = [];
  const cycleTimes = [];
  let closedInPeriod = 0;
  let cancelledInPeriod = 0;
  const mixCounts = {};
  const byAssignee = {};
  for (const h of allHdus) {
    const tl = timelineForHdu(transitions, h.frontmatter.id);
    const devType = h.frontmatter.dev_type;
    if (tl.done_at !== null && tl.done_at >= cutoffMs) {
      closedInPeriod++;
      if (devType) mixCounts[devType] = (mixCounts[devType] ?? 0) + 1;
      if (h.frontmatter.assigned_to) {
        byAssignee[h.frontmatter.assigned_to] = (byAssignee[h.frontmatter.assigned_to] ?? 0) + 1;
      }
      if (tl.draft_at !== null) {
        leadTimes.push((tl.done_at - tl.draft_at) / 864e5);
      }
      if (tl.approved_at !== null) {
        cycleTimes.push((tl.done_at - tl.approved_at) / 864e5);
      }
    }
    if (tl.cancelled_at !== null && tl.cancelled_at >= cutoffMs) {
      cancelledInPeriod++;
    }
  }
  const totalClosedOrCancelled = closedInPeriod + cancelledInPeriod;
  const cancellationRate = totalClosedOrCancelled === 0 ? 0 : cancelledInPeriod / totalClosedOrCancelled;
  const mixPct = {};
  for (const [dt, count] of Object.entries(mixCounts)) {
    mixPct[dt] = { count, pct: closedInPeriod === 0 ? 0 : count / closedInPeriod };
  }
  const metrics = {
    total_hdus: allHdus.length,
    by_status: byStatus,
    closed_in_period: closedInPeriod,
    cancelled_in_period: cancelledInPeriod,
    cancellation_rate: cancellationRate,
    lead_time_days: {
      median: median(leadTimes),
      p90: p90(leadTimes),
      samples: leadTimes.length
    },
    cycle_time_days: {
      median: median(cycleTimes),
      p90: p90(cycleTimes),
      samples: cycleTimes.length
    },
    mix_dev_type: mixPct
  };
  if (opts.by === "dev") metrics.by_assignee = byAssignee;
  if (jsonMode) {
    emitJson(jsonSuccess("stats", {
      client: opts.client,
      period: periodStr,
      ...metrics
    }));
  }
  console.log("");
  console.log(bold(`M\xE9tricas \u2014 ${opts.client} (per\xEDodo: ${periodStr})`));
  console.log("");
  console.log(bold("  Throughput"));
  console.log(`    cerradas:           ${closedInPeriod}`);
  console.log(`    canceladas:         ${cancelledInPeriod}`);
  console.log(`    cancellation rate:  ${(cancellationRate * 100).toFixed(1)}%`);
  console.log("");
  console.log(bold("  Estados actuales"));
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`    ${status.padEnd(13)} ${count}`);
  }
  console.log("");
  if (leadTimes.length > 0) {
    console.log(bold("  Lead time (d\xEDas)"));
    console.log(`    mediana / p90:      ${metrics.lead_time_days.median.toFixed(1)} / ${metrics.lead_time_days.p90.toFixed(1)}`);
    console.log(`    samples:            ${metrics.lead_time_days.samples}`);
    console.log("");
    console.log(bold("  Cycle time (d\xEDas)"));
    console.log(`    mediana / p90:      ${metrics.cycle_time_days.median.toFixed(1)} / ${metrics.cycle_time_days.p90.toFixed(1)}`);
    console.log(`    samples:            ${metrics.cycle_time_days.samples}`);
    console.log("");
  }
  if (Object.keys(mixPct).length > 0) {
    console.log(bold("  Mix dev_type (sobre las cerradas)"));
    for (const [dt, { count, pct }] of Object.entries(mixPct)) {
      console.log(`    ${dt.padEnd(22)} ${count}  (${(pct * 100).toFixed(0)}%)`);
    }
    console.log("");
  }
  if (opts.by === "dev" && Object.keys(byAssignee).length > 0) {
    console.log(bold("  Por dev"));
    for (const [email, count] of Object.entries(byAssignee)) {
      console.log(`    ${email.padEnd(30)} ${count}`);
    }
    console.log("");
  }
  printDim("Para JSON: dd-cli stats --client=" + opts.client + " --period=" + periodStr + " --json");
  return 0;
}

// src/commands/guide-cmd.ts
import { existsSync as existsSync41, readFileSync as readFileSync24 } from "fs";
import { spawnSync } from "child_process";
import * as path34 from "path";
import { fileURLToPath as fileURLToPath6 } from "url";
var TOPICS = {
  "hdu": "guia-hdu-flow.md",
  "hdus": "guia-hdu-flow.md",
  "onboarding": "guia-empresa.md",
  "dev": "guia-dev-cli.md"
};
function resolveDocsPath(filename) {
  try {
    const here = path34.dirname(fileURLToPath6(import.meta.url));
    const candidates = [
      path34.resolve(here, "../docs", filename),
      path34.resolve(here, "../../docs", filename),
      path34.resolve(here, "../../../docs", filename)
    ];
    for (const c3 of candidates) {
      if (existsSync41(c3)) return c3;
    }
  } catch {
  }
  return null;
}
async function runGuide(topic, opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!topic) {
    if (jsonMode) {
      emitJson(jsonError({
        command: "guide",
        code: "INVALID_INPUT",
        message: "Falta el topic. Uso: dd-cli guide <topic>",
        context: { available_topics: Object.keys(TOPICS) }
      }));
    }
    console.log("");
    console.log(bold("Gu\xEDas disponibles:"));
    for (const t of Object.keys(TOPICS)) {
      console.log(`  dd-cli guide ${t}`);
    }
    console.log("");
    return 3;
  }
  const filename = TOPICS[topic];
  if (!filename) {
    const e = {
      code: "INVALID_INPUT",
      message: `Topic "${topic}" no existe.`,
      context: { available_topics: Object.keys(TOPICS) },
      recovery_hints: [`Topics: ${Object.keys(TOPICS).join(", ")}`]
    };
    if (jsonMode) emitJson(jsonError({ command: "guide", ...e }));
    printErr(e.message);
    return 3;
  }
  const docPath = resolveDocsPath(filename);
  if (!docPath) {
    const e = {
      code: "CONFIG_MISSING",
      message: `No pude resolver el path de la gu\xEDa "${filename}".`,
      context: { filename },
      recovery_hints: ["Reinstal\xE1 el CLI o report\xE1 el bug"]
    };
    if (jsonMode) emitJson(jsonError({ command: "guide", ...e }));
    printErr(e.message);
    return 1;
  }
  const lessAvailable = process.stdout.isTTY && spawnSync("which", ["less"], { stdio: "ignore" }).status === 0;
  if (lessAvailable) {
    spawnSync("less", ["-R", docPath], { stdio: "inherit" });
    return 0;
  }
  const content = readFileSync24(docPath, "utf-8");
  process.stdout.write(content);
  if (!process.stdout.isTTY) return 0;
  console.log("");
  printDim("\u2014 fin de la gu\xEDa. Para paginar mejor, instal\xE1 `less`.");
  return 0;
}

// src/commands/today-cmd.ts
import { existsSync as existsSync42 } from "fs";
function ageInHours3(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}
async function runToday(opts = {}) {
  const jsonMode = isJsonMode(opts);
  const user = opts.user ?? null;
  const registry = loadRegistry();
  let activeSession = null;
  const projectRoot = findDevFlowProjectRoot();
  if (projectRoot) {
    try {
      const session = loadSession(projectRoot);
      if (session?.started_at && !session.ended_at) {
        const startedMs = new Date(session.started_at).getTime();
        const durationMin = Math.floor((Date.now() - startedMs) / 6e4);
        activeSession = {
          feature_id: session.feature_id ?? "unknown",
          dev_type: session.dev_type ?? "unknown",
          duration_minutes: durationMin,
          cwd: projectRoot
        };
      }
    } catch {
    }
  }
  const queue = [];
  for (const entry of Object.values(registry.clients)) {
    const cacheDir = getClientCacheDir(entry.slug);
    if (!existsSync42(cacheDir)) continue;
    let hdus;
    try {
      hdus = listHdus(cacheDir);
    } catch {
      continue;
    }
    for (const h of hdus) {
      const fm = h.frontmatter;
      if (fm.status !== "approved") continue;
      if (user && fm.assigned_to !== user) continue;
      if (!user && fm.assigned_to) continue;
      queue.push({
        id: fm.id,
        client: entry.slug,
        title: fm.title,
        priority: fm.priority,
        dev_type: fm.dev_type ?? null,
        apps_affected: fm.apps_affected
      });
    }
  }
  const priorityOrder = { "cr\xEDtica": 4, "alta": 3, "media": 2, "baja": 1 };
  queue.sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0));
  const alerts = [];
  for (const entry of Object.values(registry.clients)) {
    const lastSync = entry.last_synced;
    if (ageInHours3(lastSync) > 7 * 24) {
      alerts.push({
        level: "warn",
        message: `Contexto de ${entry.slug} stale (${Math.floor(ageInHours3(lastSync) / 24)}d sin sync)`,
        action: `dd-cli pull-context ${entry.slug}`
      });
    }
    if (user) {
      const cacheDir = getClientCacheDir(entry.slug);
      if (!existsSync42(cacheDir)) continue;
      let hdus;
      try {
        hdus = listHdus(cacheDir);
      } catch {
        continue;
      }
      for (const h of hdus) {
        if (h.frontmatter.status !== "in-progress") continue;
        if (h.frontmatter.assigned_to !== user) continue;
        alerts.push({
          level: "info",
          message: `${h.frontmatter.id} (${entry.slug}) en in-progress`,
          action: `dd-cli hdu show ${h.frontmatter.id} --client=${entry.slug}`
        });
      }
    }
  }
  const output = {
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0] ?? "",
    user,
    active_session: activeSession,
    queue,
    alerts
  };
  if (jsonMode) {
    emitJson(jsonSuccess("today", output));
  }
  console.log("");
  console.log(`  ${bold("Today")}    ${dim((/* @__PURE__ */ new Date()).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" }))}`);
  if (user) printDim(`  ${user}`);
  console.log("");
  if (activeSession) {
    console.log(bold("  SESI\xD3N ACTIVA"));
    const hrs = Math.floor(activeSession.duration_minutes / 60);
    const mins = activeSession.duration_minutes % 60;
    const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    console.log(`    ${devTypeBadge(activeSession.dev_type)} ${bold(activeSession.feature_id)}  ${dim("\xB7 " + durStr)}`);
    printDim(`    cwd: ${activeSession.cwd}`);
    console.log("");
  } else if (projectRoot) {
    printDim("  Sin sesi\xF3n activa en este repo (dd-cli start-session <HDU-id>)");
    console.log("");
  }
  if (queue.length > 0) {
    console.log(bold(`  TU QUEUE (${queue.length} HDUs aprobadas)`));
    for (const h of queue.slice(0, 10)) {
      const prio = h.priority.padEnd(8);
      console.log(`    ${bold(h.id.padEnd(10))} ${prio} ${dim(h.client.padEnd(15))} ${h.title}`);
    }
    if (queue.length > 10) printDim(`    ... y ${queue.length - 10} m\xE1s`);
    console.log("");
  } else if (user) {
    printDim("  Sin HDUs aprobadas asignadas a vos.");
    printInfo("  Para ver el backlog: dd-cli hdu list --client=<slug> --status=approved");
    console.log("");
  }
  if (alerts.length > 0) {
    console.log(bold("  ALERTAS"));
    for (const a of alerts) {
      const icon = a.level === "warn" ? warn("\u26A0") : a.level === "err" ? warn("\u2717") : ok("\xB7");
      console.log(`    ${icon} ${a.message}`);
      if (a.action) printDim(`       \u2192 ${a.action}`);
    }
    console.log("");
  }
  return 0;
}

// src/commands/inbox-cmd.ts
import { existsSync as existsSync43, mkdirSync as mkdirSync21, readFileSync as readFileSync25, appendFileSync as appendFileSync4, writeFileSync as writeFileSync18 } from "fs";
import * as path35 from "path";
import { z as z10 } from "zod";
var InboxEventSchema = z10.object({
  ts: z10.string(),
  client: z10.string().optional(),
  kind: z10.string(),
  // hdu_assigned | mr_merged | context_updated | etc.
  data: z10.record(z10.string(), z10.unknown()).default({}),
  read: z10.boolean().default(false),
  id: z10.string().optional()
  // generado al append si no viene
});
function getInboxPath() {
  return path35.join(getDevflowGlobalDir(), "inbox.jsonl");
}
function readInbox() {
  const p = getInboxPath();
  if (!existsSync43(p)) return [];
  return readFileSync25(p, "utf-8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
    try {
      return InboxEventSchema.parse(JSON.parse(l));
    } catch {
      return null;
    }
  }).filter((e) => e !== null);
}
function writeInbox(events) {
  const p = getInboxPath();
  const dir = path35.dirname(p);
  if (!existsSync43(dir)) mkdirSync21(dir, { recursive: true });
  const content = events.map((e) => JSON.stringify(InboxEventSchema.parse(e))).join("\n") + "\n";
  writeFileSync18(p, content, "utf-8");
}
function appendInboxEvent(event) {
  const p = getInboxPath();
  const dir = path35.dirname(p);
  if (!existsSync43(dir)) mkdirSync21(dir, { recursive: true });
  const full = InboxEventSchema.parse({
    ts: event.ts ?? (/* @__PURE__ */ new Date()).toISOString(),
    read: event.read ?? false,
    ...event
  });
  appendFileSync4(p, JSON.stringify(full) + "\n", "utf-8");
}
function purgeOld(events) {
  const retentionDays = Number(process.env.DEVFLOW_INBOX_RETENTION_DAYS ?? 30);
  const cutoff = Date.now() - retentionDays * 864e5;
  return events.filter((e) => !e.read || new Date(e.ts).getTime() >= cutoff);
}
function ageStr(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 6e4);
  if (min < 60) return `hace ${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  return `hace ${Math.floor(hr / 24)}d`;
}
async function runInbox(opts = {}) {
  const jsonMode = isJsonMode(opts);
  let events = readInbox();
  const before = events.length;
  events = purgeOld(events);
  if (events.length < before) {
    writeInbox(events);
  }
  const filtered = opts.all ? events : events.filter((e) => !e.read);
  if (jsonMode) {
    emitJson(jsonSuccess("inbox", {
      total: events.length,
      shown: filtered.length,
      unread: events.filter((e) => !e.read).length,
      events: filtered
    }));
  }
  console.log("");
  console.log(bold(`  \u{1F4EC} INBOX  (${filtered.length} ${opts.all ? "totales" : "sin leer"})`));
  console.log("");
  if (filtered.length === 0) {
    printDim("  No hay eventos.");
    return 0;
  }
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const tag = e.read ? dim("\xB7 ") : ok("\u25CF ");
    const kindStr = e.kind.padEnd(20);
    const clientStr = (e.client ?? "-").padEnd(12);
    console.log(`  ${tag}${ageStr(e.ts).padEnd(10)} ${dim(clientStr)} ${kindStr} ${formatEventData(e)}`);
  }
  if (opts.read) {
    const filteredIds = new Set(filtered.map((e, i) => `${e.ts}#${i}`));
    const updated = events.map((e, i) => {
      const key = `${e.ts}#${i}`;
      if (filteredIds.has(key)) {
        return { ...e, read: true };
      }
      return e;
    });
    writeInbox(updated);
    console.log("");
    printOk(`  ${filtered.length} marcados como le\xEDdos`);
  } else if (filtered.length > 0 && !opts.all) {
    console.log("");
    printDim("  Marcar como le\xEDdos: dd-cli inbox --read");
  }
  return 0;
}
function formatEventData(e) {
  switch (e.kind) {
    case "hdu_assigned": {
      const hdu = e.data["hdu"] ?? "?";
      const by = e.data["by"] ?? "?";
      return `${hdu} (por ${by})`;
    }
    case "mr_merged": {
      const hdu = e.data["hdu"] ?? "?";
      const mr = e.data["mr"] ?? "?";
      return `${hdu} (MR ${mr})`;
    }
    case "context_updated": {
      const news = e.data["new_apps"] ?? [];
      return news.length > 0 ? `+${news.length} apps nuevas` : "";
    }
    default:
      try {
        return JSON.stringify(e.data).slice(0, 60);
      } catch {
        return "";
      }
  }
}
async function runInboxAdd(opts = {}) {
  const jsonMode = isJsonMode(opts);
  if (!opts.kind) {
    const e = { code: "INVALID_INPUT", message: "Falta --kind. Uso: dd-cli inbox add --kind=<tipo> --client=<slug>" };
    if (jsonMode) emitJson(jsonError({ command: "inbox add", ...e }));
    printErr(e.message);
    return 3;
  }
  let data = {};
  if (opts.data) {
    try {
      data = JSON.parse(opts.data);
    } catch {
      const e = { code: "INVALID_INPUT", message: "--data debe ser JSON v\xE1lido." };
      if (jsonMode) emitJson(jsonError({ command: "inbox add", ...e }));
      printErr(e.message);
      return 3;
    }
  }
  appendInboxEvent({ kind: opts.kind, client: opts.client, data });
  if (jsonMode) {
    emitJson(jsonSuccess("inbox add", { kind: opts.kind, client: opts.client, data }));
  }
  printOk(`Evento agregado al inbox.`);
  printInfo("Para ver: dd-cli inbox");
  return 0;
}

// src/bin/dd-cli.ts
var program = new Command();
program.name("dd-cli").description("DevFlow IA \u2014 CLI oficial \xB7 bridge local entre Claude Code y la plataforma").version(CLI_VERSION);
program.command("init").description("Inicializa DevFlow IA en el proyecto actual (session + skills + hooks)").option("--client <slug>", "Conecta el repo a un cliente registrado y genera config.yml").option("--force", "Sobrescribe .devflow/ y settings si existen", false).option("--no-skills", "No instala las 19 skills bundleadas").option("--no-hooks", "No escribe .claude/settings.json con hooks").action(async (opts) => {
  try {
    if (!opts.force && isContextRepo(process.cwd())) {
      console.error("");
      console.error("Este directorio parece ser un context repo (tiene .devflow-context/).");
      console.error("No se debe ejecutar `dd-cli init` ac\xE1 \u2014 los context repos se generan");
      console.error("y mantienen v\xEDa /devflow-ia:client-onboard (Sprint 3) o");
      console.error("/devflow-ia:init-context.");
      console.error("");
      console.error("Si quer\xE9s validarlo en su lugar: dd-cli context validate");
      console.error("Si quer\xE9s forzar de todos modos: dd-cli init --force");
      process.exit(2);
    }
    if (opts.client) {
      const exitCode = await runInitClient(opts.client);
      process.exit(exitCode);
    } else {
      const exitCode = await runInit({
        force: opts.force,
        skipSkills: opts.skills === false,
        skipHooks: opts.hooks === false
      });
      process.exit(exitCode);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("health").description("Estado de salud del entorno: m\xE1quina, clientes registrados y proyecto actual").option("--client <slug>", "Chequea solo este cliente").option("--check-api", "Verifica conectividad a las APIs git (m\xE1s lento)", false).option("--json", "Output JSON para scripts", false).action(async (opts) => {
  try {
    process.exit(await runHealth({ client: opts.client, checkApi: opts.checkApi, json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("install").description("Configura la statusline DevFlow IA globalmente (~/.claude/settings.json)").option("--force", "Sobrescribe statusLine existente", false).action(async (opts) => {
  try {
    process.exit(await runInstall({ force: opts.force }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("uninstall").description("Remueve la statusline DevFlow IA del settings.json global").action(async () => {
  try {
    process.exit(await runUninstall());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("flow").description("Muestra el viaje completo del m\xE9todo para el dev_type activo (o uno hipot\xE9tico)").option("--type <type>", "dev_type a visualizar: greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa").option("--all", "Muestra resumen de los 5 dev_types", false).action((opts) => {
  try {
    process.exit(runFlow({ type: opts.type, all: opts.all }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("new-hdu <title>").alias("new-feature").description("[DEPRECATED \u2014 us\xE1 `dd-cli hdu new`] Crea una HDU desde el template y lanza Claude con /devflow-ia:design-hdu").option("--type <type>", "dev_type sugerido (Tech Lead confirma en design-hdu)").option("--no-claude", "No lanzar claude \u2014 solo crear el archivo", false).action(async (title, opts) => {
  console.error('\u26A0  `dd-cli new-hdu` est\xE1 deprecado. Us\xE1: dd-cli hdu new "<t\xEDtulo>" --client=<slug>');
  try {
    process.exit(await runNewHdu(title, { type: opts.type, noClaude: opts.claude === false }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
var hduCmd = program.command("hdu").description("Gesti\xF3n de HDUs en el context repo del cliente (Sprint 5).");
hduCmd.command("new <title>").description("Crea una HDU draft. Requiere --client=<slug>.").option("--client <slug>", "Slug del cliente cuyo context repo aloja la HDU").option("--app <slug>", "App afectada (apps_affected)").option("--priority <p>", "baja | media | alta | cr\xEDtica", "media").option("--dev-type <type>", "dev_type sugerido").option("--created-by <email>", "Email del PMO/creador").option("--assigned-to <email>", "Email del dev asignado (opcional)").option("--json", "Output JSON", false).action(async (title, opts) => {
  try {
    process.exit(await runHduNew(title, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("list").description("Lista HDUs del cliente.").option("--client <slug>", "Slug del cliente").option("--status <s>", "Filtrar por status (draft|approved|in-progress|in-review|done|cancelled)").option("--mine", "Solo HDUs asignadas al --user dado", false).option("--user <email>", "Email del dev (necesario con --mine)").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runHduList(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("show <id>").description("Muestra una HDU + su historial de transiciones.").option("--client <slug>", "Slug del cliente").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduShow(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("start <id>").description("Dev arranca a trabajar la HDU (approved \u2192 in-progress).").option("--client <slug>", "Slug del cliente").option("--by <email>", "Email del dev").option("--reason <r>", "Raz\xF3n opcional").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduStart(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("review <id>").description("Dev env\xEDa a code review (in-progress \u2192 in-review).").option("--client <slug>", "Slug del cliente").option("--by <email>", "Email del dev").option("--reason <r>", "Raz\xF3n opcional (ej: MR #43)").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduReview(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("approve <id>").description("Tech Lead aprueba la HDU (draft \u2192 approved).").option("--client <slug>", "Slug del cliente").option("--by <email>", "Email del Tech Lead que aprueba").option("--reason <r>", "Raz\xF3n opcional").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduApprove(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("close <id>").description("Cierra la HDU al mergear el PR del c\xF3digo (in-review \u2192 done).").option("--client <slug>", "Slug del cliente").option("--by <email>", "Email del dev que cierra").option("--reason <r>", "Raz\xF3n opcional").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduClose(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("cancel <id>").description("Cancela una HDU. --reason obligatorio.").option("--client <slug>", "Slug del cliente").option("--by <email>", "Email del actor").option("--reason <r>", "Raz\xF3n obligatoria").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduCancel(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("assign <id>").description("Asigna la HDU a un dev (Tech Lead).").option("--client <slug>", "Slug del cliente").option("--to <email>", "Email del dev asignado (obligatorio)").option("--by <email>", "Email del Tech Lead que asigna").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduAssign(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("claim <id>").description("Auto-asignaci\xF3n del dev (atajo de assign).").option("--client <slug>", "Slug del cliente").option("--user <email>", "Email del dev (obligatorio)").option("--json", "Output JSON", false).action(async (id, opts) => {
  try {
    process.exit(await runHduClaim(id, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("apply-merge").description("CI job: detecta hdus/*.md cambiados en HEAD y propaga draft \u2192 approved.").option("--path <dir>", "Path al context repo (default cwd)").option("--apply", "Persiste los cambios. Sin esto, dry-run.", false).option("--commit", "git add + commit + push despu\xE9s de aplicar (cuando --apply)", false).option("--by <email>", "Actor para el transitions log (default: autor del \xFAltimo commit)").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runHduApplyMerge(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("next").description("Sugiere la pr\xF3xima HDU para el dev (scoring).").option("--client <slug>", "Slug del cliente").option("--user <email>", "Email del dev").option("--explain", "Muestra breakdown del score", false).option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runHduNext(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
hduCmd.command("index").description("Regenera el _index.yml derivado.").option("--client <slug>", "Slug del cliente").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runHduIndexCmd(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("status").description("Muestra tu progreso en el flujo (narrativo por default)").option("--json", "Output JSON estructurado", false).option("--quiet", "Sin output; solo exit code", false).option("--raw", "Vista t\xE9cnica detallada (para debug)", false).action((opts) => {
  try {
    const exitCode = runStatus({ json: opts.json, quiet: opts.quiet, raw: opts.raw });
    process.exit(exitCode);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("register-client <slug>").description("Registra un cliente y clona su repo de contexto (~/.devflow/clients/<slug>/)").requiredOption("--context-url <url>", "URL del repo con el contexto del cliente (GitHub/GitLab)").option("--name <name>", "Nombre del cliente (opcional, se deduce de la URL)").option("--force", "Sobreescribir si ya est\xE1 registrado", false).option("--git-token <token>", "Personal Access Token para la API de Git (discovery autom\xE1tico)").option("--git-host <host>", "Plataforma git: gitlab | github | bitbucket (default: gitlab)", "gitlab").option("--git-group <group>", "Grupo u organizaci\xF3n a escanear (ej: iprsa-group)").option("--git-base-url <url>", "URL base del servidor git (para instancias self-hosted)").action(async (slug, opts) => {
  try {
    process.exit(await runRegisterClient(slug, {
      contextUrl: opts.contextUrl,
      name: opts.name,
      force: opts.force,
      gitToken: opts.gitToken,
      gitHost: opts.gitHost,
      gitGroup: opts.gitGroup,
      gitBaseUrl: opts.gitBaseUrl
    }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
var clientCmd = program.command("client").description("Gesti\xF3n de clientes registrados (Sprint 3 agregar\xE1 new/show/list/...)");
clientCmd.command("new <slug>").description("Onboarding inicial del cliente: registro + crea context repo + clone + state REGISTERED.").option("--name <name>", "Nombre completo del cliente (para modo non-interactive)").option("--provider <type>", "gitlab | github").option("--base-url <url>", "URL base del provider (default seg\xFAn provider)").option("--group <name>", "Group/Org del provider").option("--git-token <token>", "PAT con scope api/repo (sensible \u2014 preferir --git-token-env)").option("--no-branch-protection", "No aplicar branch protection (solo development)").option("--yes", "No pedir confirmaciones (CI / scripts)", false).option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientNew(slug, {
      name: opts.name,
      provider: opts.provider,
      baseUrl: opts.baseUrl,
      group: opts.group,
      gitToken: opts.gitToken,
      noBranchProtection: opts.branchProtection === false,
      yes: opts.yes,
      json: opts.json
    }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("migrate <slug>").description("Migra un cliente legacy al schema nuevo (stack.yml + catalog.yml).").option("--apply", "Aplica los cambios. Sin esto, dry-run.", false).option("--no-push", "No pushear al context repo, solo commit local.").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  const noPush = opts.push === false;
  try {
    process.exit(await runClientMigrate(slug, { apply: opts.apply, noPush, json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
var contextCmd = program.command("context").description("Operaciones sobre context repos del cliente (validate, render, ...)");
contextCmd.command("validate [path]").description("Valida la forma estructural del context repo (stack.yml, catalog, refs).").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (repoPath, opts) => {
  try {
    process.exit(await runContextValidate(repoPath, { json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
contextCmd.command("install-ci [path]").description("Provisiona el CI job para HDU transitions (S5-4). Detecta provider del marcador .context-repo.yml.").option("--force", "Sobreescribe si el archivo ya existe con contenido distinto.", false).option("--provider <type>", "Override del provider detectado (gitlab|github)").option("--json", "Output JSON", false).action(async (repoPath, opts) => {
  try {
    process.exit(await runContextInstallCi(repoPath, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
contextCmd.command("render [path]").description("Regenera las vistas markdown derivadas desde los YAMLs can\xF3nicos.").option("--force", "Reescribe aunque el contenido sea id\xE9ntico.", false).option("--dry-run", "No escribe, solo reporta qu\xE9 cambiar\xEDa.", false).option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (repoPath, opts) => {
  try {
    process.exit(await runContextRender(repoPath, { force: opts.force, dryRun: opts.dryRun, json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("show <slug>").description("Dashboard del cliente: stack, apps, profiles, \xFAltimo sync, acciones sugeridas.").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientShow(slug, { json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("list").description("Lista todos los clientes registrados con estado, apps y \xFAltimo sync.").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (opts) => {
  try {
    process.exit(await runClientList({ json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
var inboxCmd = program.command("inbox").description("Eventos asincr\xF3nicos del dev (HDU asignada, MR mergeado, etc).").option("--read", "Marca los listados como le\xEDdos", false).option("--all", "Muestra le\xEDdos + no-le\xEDdos", false).option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runInbox(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
inboxCmd.command("add").description("Agrega un evento al inbox (testing / scripts).").option("--kind <k>", "Tipo del evento (obligatorio)").option("--client <slug>", "Slug del cliente relacionado").option("--data <json>", "JSON string con data adicional").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runInboxAdd(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("today").description("Ritual matutino del dev: sesi\xF3n activa, queue de HDUs, alertas.").option("--user <email>", "Email del dev (filtra HDUs asignadas a vos)").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runToday(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("guide [topic]").description("Abre una gu\xEDa paginada en terminal. Topics: hdu, onboarding, dev.").option("--json", "Output JSON con el listado de topics", false).action(async (topic, opts) => {
  try {
    process.exit(await runGuide(topic, { json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("stats").description("M\xE9tricas de HDUs del cliente (lead time, throughput, mix dev_type).").option("--client <slug>", "Slug del cliente (obligatorio)").option("--period <p>", 'Per\xEDodo (Nd o "all"). Default 30d.', "30d").option("--by <axis>", "Agregar por dev|app|dev_type").option("--json", "Output JSON", false).action(async (opts) => {
  try {
    process.exit(await runStats(opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("error-codes").description("Lista los c\xF3digos de error estables y exit codes (R-4 del redise\xF1o).").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (opts) => {
  try {
    process.exit(await runErrorCodes({ json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("home").description("Dashboard del operador: tus clientes, sesi\xF3n activa, sistema.").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (opts) => {
  try {
    process.exit(await runHome({ json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("onboard-dev <slug>").description("Setup local para un dev nuevo: clona context repo + registra cliente. Token read-only.").option("--context-url <url>", "URL del context repo (te la pasa el consultor)").option("--git-token <token>", "PAT propio del dev con scope read-only").option("--yes", "No pedir confirmaciones", false).option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientOnboardDev(slug, {
      contextUrl: opts.contextUrl,
      gitToken: opts.gitToken,
      yes: opts.yes,
      json: opts.json
    }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("refresh <slug>").description("Re-corre discovery y muestra diff vs el cat\xE1logo actual. Idempotente; con --apply persiste.").option("--apply", "Persiste el diff al catalog.yml. Sin esto, dry-run.", false).option("--concurrency <n>", "Paralelismo de file reads (default 5).", (v) => Number.parseInt(v, 10)).option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientRefresh(slug, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("publish <slug>").description("Valida + commit + push del context repo. Avanza state \u2192 READY.").option("--no-push", "Solo commit local, no pushear al remoto.").option("--ignore-warnings", "Publica aunque context validate reporte warnings.", false).option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientPublish(slug, {
      noPush: opts.push === false,
      ignoreWarnings: opts.ignoreWarnings,
      json: opts.json
    }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
clientCmd.command("discover <slug>").description("Analiza los repos del cliente (API, sin clonar) y guarda discovery JSON.").option("--active-only", "Salta repos archivados / sin actividad.", false).option("--concurrency <n>", "Paralelismo de file reads (default 5).", (v) => Number.parseInt(v, 10)).option("--out <path>", "Path de salida del JSON. Default ~/.devflow/clients/<slug>.discovery.json").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  try {
    process.exit(await runClientDiscover(slug, opts));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("pull-context [slug]").description("Actualiza la cache local del contexto del cliente (git pull). Sin slug usa el .devflow/config.yml del CWD.").option("--client <slug>", "alias del slug posicional").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action((slug, opts) => {
  try {
    process.exit(runPullContext(slug ?? opts.client, { json: opts.json }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("watch").description("Barra de estado en tiempo real (levantar en pane separado, opcional)").option("--interval <segundos>", "Segundos entre actualizaciones", "5").option("--no-color", "Sin colores ANSI", false).action(async (opts) => {
  try {
    await runWatch({ intervalSeconds: parseInt(opts.interval), noColor: opts.color === false });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("reclassify").description("Cambia el dev_type de la sesi\xF3n activa (solo Tech Lead, post-lock)").requiredOption("--to <tipo>", "Nuevo dev_type: greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa").requiredOption("--reason <texto>", "Justificaci\xF3n del cambio (m\xEDnimo 30 caracteres)").action((opts) => {
  try {
    process.exit(runReclassifyCmd({ to: opts.to, reason: opts.reason }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("doctor").description("Verifica el entorno y las precondiciones del tipo activo").option("--for <tipo>", "Verificar precondiciones de un tipo espec\xEDfico (hipot\xE9tico)").action((opts) => {
  try {
    process.exit(runDoctorCmd({ forType: opts.for }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("help-ctx").description("Muestra comandos \xFAtiles seg\xFAn tu estado actual (m\xE1s \xFAtil que --help)").option("--all", "Muestra todos los comandos", false).action((opts) => {
  try {
    process.exit(runHelp({ all: opts.all }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("start-session <feature-id>").description("Inicia una sesi\xF3n de trabajo sobre una feature (interactivo)").option("--feature-name <name>", "Nombre de la feature (skipea pregunta)").option("--type <type>", "dev_type (skipea pregunta): greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa").option("--rationale <text>", "Justificaci\xF3n del tipo").option("--apps <list>", "Apps afectadas separadas por coma").option("-y, --yes", "Modo no-interactivo (requiere --feature-name --type --rationale)", false).action(async (featureId, opts) => {
  try {
    const exitCode = await runStartSession(featureId, {
      featureName: opts.featureName,
      type: opts.type,
      rationale: opts.rationale,
      apps: opts.apps,
      yes: opts.yes
    });
    process.exit(exitCode);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
var skills = program.command("skills").description("Gesti\xF3n de skills bundleadas");
skills.command("list").description("Lista skills instaladas con modelo y categor\xEDa").action(() => {
  try {
    process.exit(runSkillsList());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
skills.command("verify").description("Verifica integridad de skills con checksums").action(() => {
  try {
    process.exit(runSkillsVerify());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
skills.command("install").description("Instala o reinstala skills en ~/.claude/skills/devflow-ia/").option("--force", "Sobrescribe modificaciones locales", false).action(async (opts) => {
  try {
    process.exit(await runSkillsInstall({ force: opts.force }));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("heartbeat").description("Se\xF1al de vida \u2014 llamado autom\xE1ticamente por hooks de Claude Code").option("--silent", "Sin output (para uso en hooks)", false).option("--on-stop", "Indica que Claude Code cerr\xF3 (marca unclosed si no hab\xEDa end-session)", false).action(async (opts) => {
  try {
    await runHeartbeat({ silent: opts.silent, onStop: opts.onStop });
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
program.command("next").description("\xBFQu\xE9 tipeo ahora? Muestra el siguiente paso en una l\xEDnea").action(() => {
  try {
    process.exit(runNext());
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.command("statusline").description("Imprime 1 l\xEDnea para la statusLine de Claude Code (uso interno)").action(() => {
  try {
    const line = runStatusline();
    console.log(line);
    process.exit(0);
  } catch {
    console.log("DevFlow IA");
    process.exit(0);
  }
});
program.command("end-session").description("Cierra la sesi\xF3n actual y registra ended_at").option("--no-commit", "No hace commit ni push (solo cierra el estado local)", false).option("-m, --message <msg>", "Mensaje custom para el commit (cuando aplique)").action(async (opts) => {
  try {
    const exitCode = await runEndSession({
      noCommit: opts.commit === false,
      message: opts.message
    });
    process.exit(exitCode);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(10);
  }
});
program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(10);
});
//# sourceMappingURL=dd-cli.js.map