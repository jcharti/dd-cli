// src/types/dev-type.ts
var DEV_TYPES = [
  "greenfield",
  "brownfield-feature",
  "brownfield-refactor",
  "modernizacion",
  "integracion-externa"
];
var APP_ORIGINS = ["greenfield-app", "legacy-app", "external-app"];
function isDevType(value) {
  return typeof value === "string" && DEV_TYPES.includes(value);
}
function isAppOrigin(value) {
  return typeof value === "string" && APP_ORIGINS.includes(value);
}
function isBrownfield(type) {
  return type === "brownfield-feature" || type === "brownfield-refactor";
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
      const ok = fileExists(".ai/REPO-CONTEXT.md");
      return {
        rule_id: "REQUIRE_REPO_CONTEXT_MD",
        passed: ok,
        severity: "block",
        message: ok ? ".ai/REPO-CONTEXT.md presente" : `Esta HDU es ${session.dev_type} y requiere mapeo del repo existente. Ejecuta \`/init-repo-context\` antes de \`/new-spec\`.`
      };
    }
  },
  REQUIRE_BASELINE_MD: {
    id: "REQUIRE_BASELINE_MD",
    applies_to: ["brownfield-refactor"],
    severity: "block",
    evaluate: ({ session }) => {
      const ok = session.baseline_path !== null;
      return {
        rule_id: "REQUIRE_BASELINE_MD",
        passed: ok,
        severity: "block",
        message: ok ? `.ai/BASELINE-* presente (${session.baseline_path})` : "Refactor sin baseline no garantiza no-regresi\xF3n. Ejecuta `/capture-baseline <modulo>` antes de `/new-spec`. Si no hay tests previos, el skill registra el caso expl\xEDcitamente."
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
      const ok = session.legacy_system !== null && session.legacy_system.trim() !== "";
      return {
        rule_id: "REQUIRE_LEGACY_SYSTEM_FIELD",
        passed: ok,
        severity: "block",
        message: ok ? `legacy_system: ${session.legacy_system}` : "Modernizaci\xF3n requiere identificar el sistema legacy a reemplazar. Complet\xE1 el campo `legacy_system` en la HDU."
      };
    }
  },
  REQUIRE_VENDOR_FIELD: {
    id: "REQUIRE_VENDOR_FIELD",
    applies_to: ["integracion-externa"],
    severity: "block",
    evaluate: ({ session }) => {
      const v = session.vendor;
      const ok = v !== null && typeof v.name === "string" && v.name.length > 0 && typeof v.api_version === "string" && v.api_version.length > 0;
      return {
        rule_id: "REQUIRE_VENDOR_FIELD",
        passed: ok,
        severity: "block",
        message: ok ? `vendor: ${v.name} v${v.api_version}` : "Integraci\xF3n externa requiere identificar el vendor y la versi\xF3n de API. Complet\xE1 los campos `vendor` en la HDU."
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
      const ok = session.dev_type !== null;
      return {
        rule_id: "MOVE_TO_SPRINT_REQUIRES_DEV_TYPE",
        passed: ok,
        severity: "block",
        message: ok ? `dev_type: ${session.dev_type}` : "Esta HDU no tiene dev_type definido. Volver al portal de negocio o pedir al PMO que lo complete antes de planificar."
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
function isDevFlowProject(startDir = process.cwd()) {
  return findDevFlowProjectRoot(startDir) !== null;
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
function getHeartbeatLogPath(projectRoot) {
  return path3.join(projectRoot, ".devflow", "heartbeat.log");
}
function getClaudeHome() {
  return path3.join(os.homedir(), ".claude");
}
function getClaudeSkillsDir() {
  return path3.join(getClaudeHome(), "commands", "devflow-ia");
}
function getClaudeCommandsDir() {
  return path3.join(getClaudeHome(), "commands");
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
  } catch (err) {
    throw new SessionIOError(`No se pudo leer ${sessionPath}`, err);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    throw new SessionIOError(`session.json no es JSON v\xE1lido`, err);
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
function formatJson(output) {
  return JSON.stringify(output, null, 2);
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
function getClientCacheDir(slug) {
  return path4.join(getDevflowGlobalDir(), "clients", slug);
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
export {
  APP_ORIGINS,
  CLIENT_STATES,
  CLI_VERSION,
  ClientStateSchema,
  DEV_TYPES,
  DevTypeSchema,
  DevTypeSourceSchema,
  ERROR_CODES,
  FlowStateSchema,
  GitHubProvider,
  GitLabProvider,
  NotImplementedError,
  PROVIDERS,
  ProviderError,
  RULES,
  SessionIOError,
  SessionStateSchema,
  createInitialSession,
  createProvider,
  detectFlowState,
  emitJson,
  enforcementRuleIdsForDevType,
  evaluateRules,
  exitCodeFor,
  findDevFlowProjectRoot,
  formatDoctorOutput,
  formatJson,
  getClaudeCommandsDir,
  getClaudeGlobalSettingsPath,
  getClaudeHome,
  getClaudeSkillsDir,
  getClientStatePath,
  getDevflowDir,
  getHeartbeatLogPath,
  getProjectClaudeDir,
  getProjectClaudeSettingsPath,
  getProjectRoot,
  getSessionPath,
  hasSession,
  inferProviderType,
  isAppOrigin,
  isBrownfield,
  isClaudeCodeInstalled,
  isDevFlowProject,
  isDevType,
  isJsonMode,
  jsonError,
  jsonSuccess,
  loadSession,
  partition,
  readClientState,
  recordCommandResult,
  requiresBaseline,
  requiresRepoContext,
  rulesForDevType,
  saveSession,
  suggestedNextStep,
  updateClientState,
  writeClientState
};
//# sourceMappingURL=index.js.map