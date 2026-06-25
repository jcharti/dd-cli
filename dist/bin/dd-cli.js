#!/usr/bin/env node
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/bin/dd-cli.ts
import { Command } from "commander";

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
function updateClientState(slug, patch) {
  const existing = readClientState(slug);
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
  // ── Write side (Sprint 3 stubs) ──────────────────────────────────
  async createRepo(_opts) {
    throw new NotImplementedError("gitlab", "createRepo");
  }
  async setBranchProtection(_repo, _rules) {
    throw new NotImplementedError("gitlab", "setBranchProtection");
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
  // ── Write side (Sprint 3 stubs) ──────────────────────────────────
  async createRepo(_opts) {
    throw new NotImplementedError("github", "createRepo");
  }
  async setBranchProtection(_repo, _rules) {
    throw new NotImplementedError("github", "setBranchProtection");
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
var CLI_VERSION = "0.5.1";

// src/commands/init.ts
import { existsSync as existsSync10, readFileSync as readFileSync8, writeFileSync as writeFileSync7, mkdirSync as mkdirSync7, readdirSync, statSync as statSync3, copyFileSync, rmSync } from "fs";
import * as path9 from "path";
import { fileURLToPath } from "url";

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
  const here = path9.dirname(fileURLToPath(import.meta.url));
  const bundled = path9.resolve(here, "..", "..", "skills");
  if (existsSync10(bundled)) return bundled;
  const monorepo = path9.resolve(here, "..", "..", "..", "skills");
  if (existsSync10(monorepo)) return monorepo;
  return null;
}
function copySkillsTree(srcDir, destDir) {
  if (!existsSync10(destDir)) mkdirSync7(destDir, { recursive: true });
  const copied = [];
  const entries = readdirSync(srcDir);
  for (const entry of entries) {
    const srcPath = path9.join(srcDir, entry);
    const destPath = path9.join(destDir, entry);
    const st = statSync3(srcPath);
    if (st.isDirectory()) {
      copied.push(...copySkillsTree(srcPath, destPath));
    } else if (st.isFile() && entry.endsWith(".md") && !META_FILES.has(entry)) {
      copyFileSync(srcPath, destPath);
      copied.push(path9.relative(destDir, destPath));
    }
  }
  return copied;
}
function writeSkillsVersion() {
  const skillsDir = getClaudeSkillsDir();
  writeFileSync7(path9.join(skillsDir, ".version"), `${CLI_VERSION}
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
  const claudeMdPath = path9.join(projectRoot, "CLAUDE.md");
  if (!existsSync10(claudeMdPath) || opts.force) {
    const here = path9.dirname(fileURLToPath(import.meta.url));
    const templatePath = path9.resolve(here, "..", "..", "templates", "CLAUDE.md.template");
    if (existsSync10(templatePath)) {
      const projectName = path9.basename(projectRoot);
      let content = readFileSync8(templatePath, "utf-8");
      content = content.replaceAll("{{PROJECT_NAME}}", projectName);
      content = content.replaceAll("{{STACK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{INFRA}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{BACKEND_FRAMEWORK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{FRONTEND_FRAMEWORK}}", "Completar en CLAUDE.md");
      content = content.replaceAll("{{DB}}", "Completar en CLAUDE.md");
      writeFileSync7(claudeMdPath, content, "utf-8");
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
  const sessionExists = existsSync10(sessionPath);
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
    if (!existsSync10(projectClaudeDir)) {
      mkdirSync7(projectClaudeDir, { recursive: true });
    }
    const settingsPath = getProjectClaudeSettingsPath(projectRoot);
    let existing = {};
    if (existsSync10(settingsPath)) {
      try {
        existing = JSON.parse(readFileSync8(settingsPath, "utf-8"));
      } catch {
        if (!opts.force) {
          printErr(`.claude/settings.json existe pero no es JSON v\xE1lido \u2014 usa --force para sobrescribir`);
          return 2;
        }
      }
    }
    const merged = buildSettingsJson(existing);
    writeFileSync7(settingsPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    printOk(`Hooks configurados en .claude/settings.json`);
  } else {
    printDim(`  (skip hooks)`);
  }
  if (existsSync10(path9.join(projectRoot, "CLAUDE.md"))) {
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
import { existsSync as existsSync11, readFileSync as readFileSync9, writeFileSync as writeFileSync8 } from "fs";
import * as path10 from "path";
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
  const logPath = path10.join(getDevflowDir(projectRoot), "transitions.log");
  const ackPath = path10.join(getDevflowDir(projectRoot), "transitions.ack");
  if (!existsSync11(logPath)) return null;
  const lines = readFileSync9(logPath, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  const lastAck = existsSync11(ackPath) ? readFileSync9(ackPath, "utf-8").trim() : "";
  if (lastAck === lastLine) return null;
  writeFileSync8(ackPath, lastLine, "utf-8");
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
import { z as z7 } from "zod";
import { existsSync as existsSync12, readFileSync as readFileSync10, writeFileSync as writeFileSync9, chmodSync } from "fs";
import * as path11 from "path";
import * as yaml5 from "js-yaml";
var GitHostSchema = z7.enum(["gitlab", "github", "bitbucket", "azure"]);
var ClientCredentialsSchema = z7.object({
  git_token: z7.string().min(1),
  git_host: GitHostSchema.default("gitlab"),
  git_base_url: z7.string().url().default("https://gitlab.com"),
  git_group: z7.string().min(1)
  // grupo/org a escanear
});
var CredentialsFileSchema = z7.object({
  clients: z7.record(z7.string(), ClientCredentialsSchema).default({})
});
function getCredentialsPath() {
  return path11.join(getDevflowGlobalDir(), "credentials.yml");
}
function loadCredentials() {
  const p = getCredentialsPath();
  if (!existsSync12(p)) return { clients: {} };
  const raw = readFileSync10(p, "utf-8");
  const parsed = yaml5.load(raw);
  const result = CredentialsFileSchema.safeParse(parsed ?? {});
  if (!result.success) throw new Error(`credentials.yml inv\xE1lido:
${result.error.message}`);
  return result.data;
}
function saveCredentials(creds) {
  const p = getCredentialsPath();
  const validated = CredentialsFileSchema.parse(creds);
  const yamlStr = yaml5.dump(validated, { indent: 2 });
  writeFileSync9(p, yamlStr, { encoding: "utf-8", mode: 384 });
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
function buildStartSessionState(input3, cliVersion, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  const warnings = [];
  if (input3.mode === "local" && !input3.devType) {
    warnings.push(
      "Modo local sin dev_type especificado. Se requiere flag --type=<tipo> o entrevista interactiva (no implementada en este stub)."
    );
  }
  if (input3.mode === "platform" && !input3.devType) {
    warnings.push(
      "Modo platform: llamar primero devflow_get_feature() para obtener dev_type"
    );
  }
  const enforcementRules = input3.devType ? enforcementRuleIdsForDevType(input3.devType) : [];
  const session = {
    feature_id: input3.featureId,
    feature_name: input3.featureName ?? null,
    session_id: `sess-${now()}`,
    started_at: now(),
    ended_at: null,
    last_heartbeat: now(),
    mode: input3.mode,
    platform_url: null,
    unclosed: false,
    dev_type: input3.devType ?? null,
    dev_type_subtype: input3.devTypeSubtype ?? null,
    dev_type_source: input3.mode === "platform" ? "tech-lead-approval" : "business-brief",
    dev_type_rationale: input3.devTypeRationale ?? "",
    dev_type_locked: false,
    // LOCK ocurre en /new-spec → devflow_save_spec
    dev_type_locked_at: null,
    apps_affected: input3.appsAffected ?? [],
    repo_context_path: null,
    baseline_path: null,
    legacy_system: input3.legacySystem ?? null,
    vendor: input3.vendor ?? null,
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
import { existsSync as existsSync13, appendFileSync, mkdirSync as mkdirSync8 } from "fs";
import * as path12 from "path";
function log(msg, silent) {
  if (!silent) console.log(msg);
}
function safeLog(projectRoot, line) {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync13(dir)) mkdirSync8(dir, { recursive: true });
    appendFileSync(path12.join(dir, "heartbeat.log"), line + "\n", "utf-8");
  } catch {
  }
}
function safeLogTransition(projectRoot, from, to) {
  try {
    const dir = getDevflowDir(projectRoot);
    if (!existsSync13(dir)) mkdirSync8(dir, { recursive: true });
    const line = `${(/* @__PURE__ */ new Date()).toISOString()}  flow_state: ${from} \u2192 ${to}`;
    appendFileSync(path12.join(dir, "transitions.log"), line + "\n", "utf-8");
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
import { existsSync as existsSync14, readdirSync as readdirSync2, statSync as statSync4, readFileSync as readFileSync11 } from "fs";
import { createHash } from "crypto";
import * as path13 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
var __dirname = path13.dirname(fileURLToPath2(import.meta.url));
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
  const content = readFileSync11(filePath);
  return createHash("sha256").update(content).digest("hex");
}
function collectSkills(dir, relBase = "") {
  const skills2 = [];
  if (!existsSync14(dir)) return skills2;
  for (const entry of readdirSync2(dir)) {
    const fullPath = path13.join(dir, entry);
    const st = statSync4(fullPath);
    if (st.isDirectory()) {
      skills2.push(...collectSkills(fullPath, path13.join(relBase, entry)));
    } else if (entry.endsWith(".md") && !META_FILES2.has(entry)) {
      const content = readFileSync11(fullPath, "utf-8");
      const fm = parseFrontmatter(content);
      skills2.push({
        relPath: path13.join(relBase, entry),
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
  const pkgRoot = path13.resolve(__dirname, "..", "..");
  const candidate = path13.join(pkgRoot, "skills.checksums");
  return existsSync14(candidate) ? candidate : null;
}
function loadChecksums() {
  const p = resolveChecksumsPath();
  if (!p) return {};
  try {
    return JSON.parse(readFileSync11(p, "utf-8"));
  } catch {
    return {};
  }
}
function runSkillsList() {
  const skillsDir = getClaudeSkillsDir();
  if (!existsSync14(skillsDir)) {
    printWarn(`Skills no instaladas en ${skillsDir}`);
    printDim(`  Ejecuta: dd-cli init`);
    return 1;
  }
  const versionFile = path13.join(skillsDir, ".version");
  const version = existsSync14(versionFile) ? readFileSync11(versionFile, "utf-8").trim() : "?";
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
    const actual = sha256File(path13.join(skillsDir, s.relPath));
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
import { appendFileSync as appendFileSync2 } from "fs";
import * as path14 from "path";

// src/commands/reclassify.ts
var MIN_REASON_CHARS = 30;
function reclassify(input3) {
  if (input3.session.mode !== "platform") {
    return {
      ok: false,
      error: "NOT_PLATFORM_MODE",
      message: "Reclasificaci\xF3n solo permitida en modo platform. El audit-log requiere persistencia server-side."
    };
  }
  if (!input3.session.started_at) {
    return {
      ok: false,
      error: "NO_SESSION",
      message: "No hay sesi\xF3n activa para reclasificar."
    };
  }
  if (input3.reason.trim().length < MIN_REASON_CHARS) {
    return {
      ok: false,
      error: "REASON_TOO_SHORT",
      message: `Justificaci\xF3n requiere al menos ${MIN_REASON_CHARS} caracteres.`
    };
  }
  if (input3.callerRole !== "tech-lead" && input3.callerRole !== "admin") {
    return {
      ok: false,
      error: "INSUFFICIENT_ROLE",
      message: "Solo Tech Lead o admin pueden reclassify despu\xE9s del lock."
    };
  }
  if (input3.session.dev_type === input3.newType) {
    return {
      ok: false,
      error: "SAME_TYPE",
      message: `El tipo ya es ${input3.newType}. Nada que reclasificar.`
    };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updated = {
    ...input3.session,
    dev_type: input3.newType,
    dev_type_subtype: null,
    // reset al cambiar tipo
    dev_type_source: "reclassify",
    dev_type_rationale: input3.reason,
    dev_type_locked: true,
    dev_type_locked_at: now,
    dev_type_reclassified_from: input3.session.dev_type ?? void 0,
    // Recalcular enforcement_rules
    enforcement_rules: enforcementRuleIdsForDevType(input3.newType)
  };
  return {
    ok: true,
    updatedSession: updated,
    message: `Reclasificaci\xF3n aplicada: ${input3.session.dev_type} \u2192 ${input3.newType}. La plataforma generar\xE1 audit-log y evaluar\xE1 delta de lead-time.`
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
    appendFileSync2(path14.join(getDevflowDir(projectRoot), "audit.log"), auditLine + "\n", "utf-8");
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
import { existsSync as existsSync16, mkdirSync as mkdirSync9, readFileSync as readFileSync13, rmSync as rmSync2 } from "fs";
import * as path15 from "path";
import * as yaml6 from "js-yaml";
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
  const stackYmlPath = path15.join(cacheDir, ".devflow-context", "stack.yml");
  if (existsSync16(stackYmlPath)) {
    try {
      const parsed = yaml6.load(readFileSync13(stackYmlPath, "utf-8"));
      const client = parsed?.client;
      const name = client?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
    }
  }
  const contextRepoYmlPath = path15.join(cacheDir, ".devflow-context", ".context-repo.yml");
  if (existsSync16(contextRepoYmlPath)) {
    try {
      const parsed = yaml6.load(readFileSync13(contextRepoYmlPath, "utf-8"));
      const client = parsed?.client;
      const name = client?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {
    }
  }
  for (const filename of ["CLAUDE.md", "README.md"]) {
    const mdPath = path15.join(cacheDir, filename);
    if (existsSync16(mdPath)) {
      try {
        const content = readFileSync13(mdPath, "utf-8");
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
  const parentDir = path15.dirname(cacheDir);
  if (!existsSync16(parentDir)) mkdirSync9(parentDir, { recursive: true });
  if (existsSync16(cacheDir) && opts.force) {
    printDim(`  Sobreescribiendo cache existente en ${cacheDir}`);
    rmSync2(cacheDir, { recursive: true, force: true });
  }
  if (!existsSync16(cacheDir)) {
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
  if (!existsSync16(cacheDir)) {
    printWarn(`Cache local no encontrada. Clonando de nuevo...`);
    try {
      const parentDir = path15.dirname(cacheDir);
      if (!existsSync16(parentDir)) mkdirSync9(parentDir, { recursive: true });
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
import { existsSync as existsSync17 } from "fs";
import * as path16 from "path";
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
    if (!existsSync17(cacheDir)) {
      const { mkdirSync: mkdirSync15 } = __require("fs");
      mkdirSync15(path16.dirname(cacheDir), { recursive: true });
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
      default: path16.basename(projectRoot),
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
import { existsSync as existsSync18, mkdirSync as mkdirSync10 } from "fs";
import * as path17 from "path";
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
  if (!existsSync18(cacheDir)) {
    if (!jsonMode) printInfo("Cache local no encontrada. Clonando...");
    try {
      mkdirSync10(path17.dirname(cacheDir), { recursive: true });
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
import { existsSync as existsSync19 } from "fs";

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
  if (existsSync19(skillsDir)) {
    printOk(`Skills instaladas en ${skillsDir}`);
  } else {
    printWarn(`Skills no instaladas`);
    printDim(`  Ejecuta: dd-cli init`);
  }
  const settingsPath = `${projectRoot}/.claude/settings.json`;
  if (existsSync19(settingsPath)) {
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
import { existsSync as existsSync20, readFileSync as readFileSync14 } from "fs";
import * as path18 from "path";
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
    const changes = path18.join(projectRoot, "openspec", "changes");
    if (!existsSync20(changes)) return null;
    const { readdirSync: readdirSync5, statSync: statSync5 } = __require("fs");
    const entries = readdirSync5(changes).filter((e) => {
      return statSync5(path18.join(changes, e)).isDirectory() && existsSync20(path18.join(changes, e, "tasks.md"));
    });
    return entries[0] ?? null;
  } catch {
    return null;
  }
}
function countTasks(projectRoot, changeName) {
  try {
    const content = readFileSync14(path18.join(projectRoot, "openspec", "changes", changeName, "tasks.md"), "utf-8");
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
  await new Promise((resolve6) => {
    process.on("SIGINT", () => {
      clearInterval(timer);
      cleanup();
      resolve6();
    });
  });
}

// src/commands/install-cmd.ts
import { existsSync as existsSync21, mkdirSync as mkdirSync11, readFileSync as readFileSync15, writeFileSync as writeFileSync10 } from "fs";
import * as path19 from "path";
var STATUSLINE_COMMAND = "dd-cli statusline";
function readGlobalSettings() {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync21(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync15(settingsPath, "utf-8"));
  } catch {
    throw new Error(
      `${settingsPath} existe pero no es JSON v\xE1lido. Corr\xEDgelo manualmente o usa --force.`
    );
  }
}
function writeGlobalSettings(settings) {
  const settingsPath = getClaudeGlobalSettingsPath();
  const dir = path19.dirname(settingsPath);
  if (!existsSync21(dir)) mkdirSync11(dir, { recursive: true });
  writeFileSync10(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
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
  if (!existsSync21(getClaudeGlobalSettingsPath())) {
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
import { existsSync as existsSync23, mkdirSync as mkdirSync12, readdirSync as readdirSync3, writeFileSync as writeFileSync11 } from "fs";
import * as path21 from "path";

// src/utils/templates.ts
import { existsSync as existsSync22, readFileSync as readFileSync16 } from "fs";
import * as path20 from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
function resolveTemplatesDir() {
  const here = path20.dirname(fileURLToPath3(import.meta.url));
  const bundled = path20.resolve(here, "..", "..", "templates");
  if (existsSync22(bundled)) return bundled;
  const monorepo = path20.resolve(here, "..", "..", "..", "templates");
  if (existsSync22(monorepo)) return monorepo;
  return null;
}
function getTemplatePath(name) {
  const dir = resolveTemplatesDir();
  if (!dir) return null;
  const full = path20.join(dir, name);
  return existsSync22(full) ? full : null;
}
function renderTemplate(templatePath, vars) {
  let content = readFileSync16(templatePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

// src/commands/new-hdu-cmd.ts
var HDU_DIR = path21.join("docs", "hdus");
function slugify(title) {
  return title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "").slice(0, 60);
}
function pad(n) {
  return n.toString().padStart(3, "0");
}
function nextHduId(hduDir) {
  if (!existsSync23(hduDir)) return "001";
  const entries = readdirSync3(hduDir).filter((f) => f.endsWith(".md"));
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
  const hduDir = path21.join(projectRoot, HDU_DIR);
  if (!existsSync23(hduDir)) mkdirSync12(hduDir, { recursive: true });
  const id = nextHduId(hduDir);
  const slug = slugify(title.trim());
  const fileName = `HDU-${id}-${slug}.md`;
  const hduPath = path21.join(hduDir, fileName);
  const hduPathRel = path21.relative(projectRoot, hduPath);
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
  if (existsSync23(hduPath)) {
    printErr(`Ya existe ${hduPathRel}. Cambia el t\xEDtulo o borra el archivo.`);
    return 1;
  }
  writeFileSync11(hduPath, content, "utf-8");
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
import { existsSync as existsSync24, readFileSync as readFileSync17 } from "fs";
import * as path22 from "path";
import { readdirSync as readdirSync4 } from "fs";
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
function checkSkills() {
  const skillsDir = getClaudeSkillsDir();
  if (!existsSync24(skillsDir)) {
    return { status: "err", detail: `no instaladas \u2014 ejecuta: dd-cli init o dd-cli skills install` };
  }
  const versionFile = path22.join(skillsDir, ".version");
  if (!existsSync24(versionFile)) {
    return { status: "warn", detail: `instaladas, sin versi\xF3n registrada` };
  }
  const installed = readFileSync17(versionFile, "utf-8").trim();
  if (installed !== CLI_VERSION) {
    return { status: "warn", detail: `v${installed} instalada, v${CLI_VERSION} disponible \u2014 ejecuta: dd-cli skills install` };
  }
  const skills2 = existsSync24(skillsDir) ? readdirSync4(skillsDir).filter((f) => f.endsWith(".md")).length : 0;
  return { status: "ok", detail: `${skills2} skills \xB7 v${installed}` };
}
function checkStatusline() {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync24(settingsPath)) {
    return { status: "warn", detail: `no configurada \u2014 ejecuta: dd-cli install` };
  }
  try {
    const settings = JSON.parse(readFileSync17(settingsPath, "utf-8"));
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
  if (!existsSync24(entry.local_cache)) {
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
import { existsSync as existsSync25, readFileSync as readFileSync18, cpSync } from "fs";
import * as path23 from "path";
import * as yaml7 from "js-yaml";
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
  const legacyMasterPath = path23.join(cacheDir, ".devflow", "config.yml");
  const stackYmlExists = hasStackConfig(cacheDir);
  if (!stackYmlExists && existsSync25(legacyMasterPath)) {
    try {
      const raw = readFileSync18(legacyMasterPath, "utf-8");
      const parsed = yaml7.load(raw);
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
  const catalogYmlExists = existsSync25(getCatalogYamlPath(cacheDir));
  const catalogMdExists = existsSync25(getCatalogMarkdownPath(cacheDir));
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
    } else if (!hasCatalog(cacheDir) && !existsSync25(legacyMasterPath)) {
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
      const raw = readFileSync18(path23.join(cacheDir, ".devflow", "config.yml"), "utf-8");
      const parsed = yaml7.load(raw);
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
  const backupDir = `${path23.dirname(cacheDir)}/${slug}.bak-${ts}`;
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
  if (!existsSync25(cacheDir)) {
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
import { mkdirSync as mkdirSync14, writeFileSync as writeFileSync13 } from "fs";
import * as path24 from "path";
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
  if (override) return path24.resolve(override);
  return path24.join(getDevflowGlobalDir(), "clients", `${slug}.discovery.json`);
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
    mkdirSync14(path24.dirname(outPath), { recursive: true });
    writeFileSync13(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
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

// src/bin/dd-cli.ts
var program = new Command();
program.name("dd-cli").description("DevFlow IA \u2014 CLI oficial \xB7 bridge local entre Claude Code y la plataforma").version(CLI_VERSION);
program.command("init").description("Inicializa DevFlow IA en el proyecto actual (session + skills + hooks)").option("--client <slug>", "Conecta el repo a un cliente registrado y genera config.yml").option("--force", "Sobrescribe .devflow/ y settings si existen", false).option("--no-skills", "No instala las 19 skills bundleadas").option("--no-hooks", "No escribe .claude/settings.json con hooks").action(async (opts) => {
  try {
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
program.command("new-hdu <title>").alias("new-feature").description("Crea una HDU desde el template y lanza Claude con /devflow-ia:design-hdu").option("--type <type>", "dev_type sugerido (Tech Lead confirma en design-hdu)").option("--no-claude", "No lanzar claude \u2014 solo crear el archivo", false).action(async (title, opts) => {
  try {
    process.exit(await runNewHdu(title, { type: opts.type, noClaude: opts.claude === false }));
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
clientCmd.command("migrate <slug>").description("Migra un cliente legacy al schema nuevo (stack.yml + catalog.yml).").option("--apply", "Aplica los cambios. Sin esto, dry-run.", false).option("--no-push", "No pushear al context repo, solo commit local.").option("--json", "Output JSON estructurado (S1-9 / D-7/D-8)", false).action(async (slug, opts) => {
  const noPush = opts.push === false;
  try {
    process.exit(await runClientMigrate(slug, { apply: opts.apply, noPush, json: opts.json }));
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