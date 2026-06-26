var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/index.ts
import { readFileSync as readFileSync12 } from "fs";
import * as path13 from "path";
import { fileURLToPath } from "url";

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
function nextNaturalState(from) {
  if (from === void 0) return "REGISTERED";
  const happyPath = {
    REGISTERED: "DISCOVERED",
    DISCOVERED: "DRAFT",
    DRAFT: "READY",
    READY: "ACTIVE",
    ACTIVE: "ACTIVE",
    NEEDS_REFRESH: "DRAFT"
  };
  return happyPath[from];
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

// src/utils/audit.ts
import { createHash } from "crypto";
var HEADER_PREFIX = "# \u2500\u2500 DevFlow IA audit header \u2500\u2500";
var HEADER_SUFFIX = "# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500";
function sha256Body(body) {
  return createHash("sha256").update(body.trimEnd() + "\n").digest("hex");
}
function buildAuditHeader(opts) {
  const ts = opts.generated_at ?? (/* @__PURE__ */ new Date()).toISOString();
  const checksum = sha256Body(opts.body);
  return [
    HEADER_PREFIX,
    `# Generated by: ${opts.generated_by}`,
    `# Generated at: ${ts}`,
    `# CLI version:  ${opts.cli_version}`,
    `# Checksum:     sha256:${checksum}`,
    HEADER_SUFFIX,
    ""
  ].join("\n");
}
function parseAuditedFile(content) {
  const startIdx = content.indexOf(HEADER_PREFIX);
  if (startIdx === -1) {
    const bodyChecksum2 = sha256Body(content);
    return {
      header: null,
      body: content,
      body_checksum: bodyChecksum2,
      matches_checksum: false
    };
  }
  const endIdx = content.indexOf(HEADER_SUFFIX, startIdx);
  if (endIdx === -1) {
    return {
      header: null,
      body: content,
      body_checksum: sha256Body(content),
      matches_checksum: false
    };
  }
  const headerBlock = content.slice(startIdx, endIdx + HEADER_SUFFIX.length);
  const afterHeader = content.slice(endIdx + HEADER_SUFFIX.length);
  const body = afterHeader.startsWith("\n") ? afterHeader.slice(1) : afterHeader;
  const getField = (label) => {
    const m = headerBlock.match(new RegExp(`^#\\s+${label}:\\s+(.+)$`, "m"));
    return m?.[1]?.trim() ?? null;
  };
  const checksumRaw = getField("Checksum");
  const checksum = checksumRaw?.replace(/^sha256:/, "") ?? "";
  const header = {
    generated_by: getField("Generated by") ?? "unknown",
    generated_at: getField("Generated at") ?? "",
    cli_version: getField("CLI version") ?? "",
    checksum
  };
  const bodyChecksum = sha256Body(body);
  return {
    header,
    body,
    body_checksum: bodyChecksum,
    matches_checksum: checksum === bodyChecksum && checksum.length > 0
  };
}
function writeWithAudit(opts) {
  const header = buildAuditHeader(opts);
  return header + opts.body;
}
function isAuditedAndUnmodified(content) {
  const parsed = parseAuditedFile(content);
  return parsed.header !== null && parsed.matches_checksum;
}
function wasManuallyEdited(content) {
  const parsed = parseAuditedFile(content);
  return parsed.header !== null && !parsed.matches_checksum;
}

// src/types/stack-config.ts
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
  const audited = parseAuditedFile(raw);
  const yamlContent = audited.header ? audited.body : raw;
  const parsed = yaml2.load(yamlContent);
  const result = StackConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`stack.yml inv\xE1lido en ${p}:
${result.error.message}`);
  }
  return result.data;
}
function saveStackConfig(contextRepoRoot, config, opts = {}) {
  const stackDir = path6.join(contextRepoRoot, STACK_DIR);
  if (!existsSync7(stackDir)) mkdirSync4(stackDir, { recursive: true });
  const validated = StackConfigSchema.parse(config);
  const yamlStr = yaml2.dump(validated, { indent: 2, lineWidth: 120 });
  const content = opts.generated_by && opts.cli_version ? writeWithAudit({
    generated_by: opts.generated_by,
    cli_version: opts.cli_version,
    body: yamlStr
  }) : yamlStr;
  writeFileSync4(getStackConfigPath(contextRepoRoot), content, "utf-8");
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
var APP_ORIGINS2 = ["greenfield-app", "legacy-app", "external-app"];
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
    app_origin: z5.enum(APP_ORIGINS2).default("legacy-app"),
    preferred_dev_types: z5.array(z5.enum(DEV_TYPES)).default([])
  }),
  devflow: z5.object({
    mode: z5.enum(["local", "platform"]).default("local"),
    platform_url: z5.string().url().nullable().default(null)
  }).default({ mode: "local", platform_url: null })
});

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
  app_origin: z6.enum(APP_ORIGINS2).default("legacy-app"),
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
    const audited = parseAuditedFile(raw);
    const yamlContent = audited.header ? audited.body : raw;
    const parsed = yaml4.load(yamlContent);
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
function saveCatalog(contextRepoRoot, catalog, opts = {}) {
  const dir = path8.join(contextRepoRoot, CATALOG_DIR);
  if (!existsSync9(dir)) mkdirSync6(dir, { recursive: true });
  const validated = CatalogSchema.parse(catalog);
  const yamlStr = yaml4.dump(validated, { indent: 2, lineWidth: 120 });
  const content = opts.generated_by && opts.cli_version ? writeWithAudit({
    generated_by: opts.generated_by,
    cli_version: opts.cli_version,
    body: yamlStr
  }) : yamlStr;
  writeFileSync6(getCatalogYamlPath(contextRepoRoot), content, "utf-8");
}
function parseMarkdownCatalog(content) {
  const stripBackticks = (s) => s.replace(/^`+/, "").replace(/`+$/, "").trim();
  const looksLikeBoolean = (s) => /^(sí|si|no|yes|true|false|✓|✗|—|-)?$/i.test(s.trim());
  const apps = [];
  for (const line of content.split("\n")) {
    if (!/^\|\s*[`a-z0-9]/i.test(line)) continue;
    if (/^\|\s*-+/.test(line)) continue;
    const cols = line.split("|").map((c) => stripBackticks(c.trim())).filter(Boolean);
    if (cols.length < 4) continue;
    const firstCol = (cols[0] ?? "").toLowerCase();
    if (firstCol === "slug" || firstCol === "app") continue;
    const slug = cols[0] ?? "";
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    const rawType = cols[1] ?? "";
    const type = APP_TYPES.includes(rawType) ? rawType : "bff";
    const rawOrigin = cols[2] ?? "legacy-app";
    const app_origin = APP_ORIGINS2.includes(rawOrigin) ? rawOrigin : "legacy-app";
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
function loadHduIndex(contextRepoRoot) {
  const p = getHduIndexPath(contextRepoRoot);
  if (!existsSync11(p)) {
    return HduIndexSchema.parse({
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      hdus: []
    });
  }
  const raw = readFileSync9(p, "utf-8");
  const parsed = yaml6.load(raw);
  const result = HduIndexSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`_index.yml inv\xE1lido en ${p}:
${result.error.message}`);
  }
  return result.data;
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
  const nextHduId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const index = {
    schema_version: "1.0",
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    next_hdu_id: nextHduId,
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

// src/utils/telemetry.ts
import { existsSync as existsSync12, mkdirSync as mkdirSync9, readFileSync as readFileSync10, writeFileSync as writeFileSync9, appendFileSync as appendFileSync2, statSync as statSync3 } from "fs";
import { createHash as createHash2 } from "crypto";
import * as path11 from "path";
import * as yaml7 from "js-yaml";
import { z as z9 } from "zod";
var TelemetryConfigSchema = z9.object({
  enabled: z9.boolean().default(false),
  scope: z9.literal("local").default("local"),
  // futuro: 'remote' cuando exista plataforma
  enabled_at: z9.string().nullable().default(null)
});
var TelemetryEventSchema = z9.object({
  ts: z9.string(),
  command: z9.string(),
  exit_code: z9.number().int(),
  duration_ms: z9.number().int().nonnegative(),
  args: z9.record(z9.string(), z9.unknown()).optional(),
  user_hash: z9.string().optional(),
  // 8-char sha256 del email (si disponible)
  client_slug: z9.string().optional(),
  error_code: z9.string().optional()
  // código del JSON error si hubo
});
function getTelemetryConfigPath() {
  return path11.join(getDevflowGlobalDir(), "telemetry.config.yml");
}
function getTelemetryEventsPath() {
  return path11.join(getDevflowGlobalDir(), "telemetry.jsonl");
}
function loadTelemetryConfig() {
  const p = getTelemetryConfigPath();
  if (!existsSync12(p)) {
    return TelemetryConfigSchema.parse({});
  }
  try {
    const raw = readFileSync10(p, "utf-8");
    const parsed = yaml7.load(raw);
    return TelemetryConfigSchema.parse(parsed);
  } catch {
    return TelemetryConfigSchema.parse({});
  }
}
function saveTelemetryConfig(config) {
  const p = getTelemetryConfigPath();
  const dir = path11.dirname(p);
  if (!existsSync12(dir)) mkdirSync9(dir, { recursive: true });
  const validated = TelemetryConfigSchema.parse(config);
  writeFileSync9(p, yaml7.dump(validated, { indent: 2 }), "utf-8");
}
function isTelemetryEnabled() {
  return loadTelemetryConfig().enabled;
}
function hashUser(email) {
  if (!email) return void 0;
  return createHash2("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 8);
}
var SECRET_PATTERNS = [
  /^(git[-_]?token|token|secret|password|pwd|key|api[-_]?key|pat)$/i
];
function sanitizeArgs(args) {
  if (!args) return void 0;
  const safe = {};
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_PATTERNS.some((p) => p.test(k))) {
      safe[k] = "[redacted]";
    } else if (typeof v === "string" && (v.startsWith("glpat-") || v.startsWith("ghp_") || v.startsWith("github_pat_"))) {
      safe[k] = "[redacted-token]";
    } else if (typeof v === "string" && v.length > 100) {
      safe[k] = v.slice(0, 80) + "...[truncated]";
    } else {
      safe[k] = v;
    }
  }
  return safe;
}
function recordTelemetry(event) {
  if (!isTelemetryEnabled()) return;
  const p = getTelemetryEventsPath();
  const dir = path11.dirname(p);
  if (!existsSync12(dir)) mkdirSync9(dir, { recursive: true });
  const full = TelemetryEventSchema.parse({
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    ...event,
    args: sanitizeArgs(event.args)
  });
  try {
    appendFileSync2(p, JSON.stringify(full) + "\n", "utf-8");
  } catch {
  }
}
function readTelemetryEvents() {
  const p = getTelemetryEventsPath();
  if (!existsSync12(p)) return [];
  return readFileSync10(p, "utf-8").split("\n").filter((l) => l.trim().length > 0).map((l) => {
    try {
      return TelemetryEventSchema.parse(JSON.parse(l));
    } catch {
      return null;
    }
  }).filter((e) => e !== null);
}
function computeTelemetryStats(events) {
  const byCmd = {};
  const byExit = {};
  const byErr = {};
  const byDay = {};
  let totalDuration = 0;
  for (const e of events) {
    byCmd[e.command] = (byCmd[e.command] ?? 0) + 1;
    byExit[String(e.exit_code)] = (byExit[String(e.exit_code)] ?? 0) + 1;
    if (e.error_code) byErr[e.error_code] = (byErr[e.error_code] ?? 0) + 1;
    const day = e.ts.split("T")[0] ?? "";
    byDay[day] = (byDay[day] ?? 0) + 1;
    totalDuration += e.duration_ms;
  }
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const oldest = sorted[0]?.ts ?? null;
  const newest = sorted[sorted.length - 1]?.ts ?? null;
  const p = getTelemetryEventsPath();
  const fileSize = existsSync12(p) ? statSync3(p).size : 0;
  return {
    total_events: events.length,
    by_command: byCmd,
    by_exit_code: byExit,
    by_error_code: byErr,
    avg_duration_ms: events.length === 0 ? 0 : Math.round(totalDuration / events.length),
    events_per_day: byDay,
    active_days: Object.keys(byDay).length,
    file_size_bytes: fileSize,
    oldest_event: oldest,
    newest_event: newest
  };
}

// src/types/sprint.ts
import { z as z10 } from "zod";
import { existsSync as existsSync13, mkdirSync as mkdirSync10, readFileSync as readFileSync11, writeFileSync as writeFileSync10, readdirSync as readdirSync2 } from "fs";
import * as path12 from "path";
import * as yaml8 from "js-yaml";
var SprintCapacitySchema = z10.object({
  total: z10.number().int().nonnegative(),
  // días-dev
  by_dev_type: z10.record(z10.enum(DEV_TYPES), z10.number().int().nonnegative()).default({})
});
var SprintSchema = z10.object({
  schema_version: z10.literal("1.0").default("1.0"),
  id: z10.string().regex(/^SPRINT-\d+$/, "Debe ser SPRINT-NN"),
  client: z10.string(),
  start: z10.string(),
  // YYYY-MM-DD
  end: z10.string(),
  capacity: SprintCapacitySchema.optional(),
  hdus: z10.array(z10.string()).default([]),
  // HDU IDs
  goal: z10.string().nullable().default(null),
  created_by: z10.string().email().optional(),
  created_at: z10.string().optional()
});
var SprintCurrentSchema = z10.object({
  client: z10.string(),
  current_sprint: z10.string()
  // SPRINT-NN
});
var SPRINTS_DIR = "sprints";
var CURRENT_FILE = "_current.yml";
function getSprintsDir(contextRepoRoot) {
  return path12.join(contextRepoRoot, SPRINTS_DIR);
}
function getSprintPath(contextRepoRoot, id) {
  return path12.join(getSprintsDir(contextRepoRoot), `${id}.yml`);
}
function getSprintCurrentPath(contextRepoRoot) {
  return path12.join(getSprintsDir(contextRepoRoot), CURRENT_FILE);
}
function loadSprint(contextRepoRoot, id) {
  const p = getSprintPath(contextRepoRoot, id);
  if (!existsSync13(p)) return null;
  const raw = readFileSync11(p, "utf-8");
  const parsed = yaml8.load(raw);
  const result = SprintSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${id}.yml inv\xE1lido en ${p}:
${result.error.message}`);
  }
  return result.data;
}
function saveSprint(contextRepoRoot, sprint) {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync13(dir)) mkdirSync10(dir, { recursive: true });
  const validated = SprintSchema.parse(sprint);
  writeFileSync10(getSprintPath(contextRepoRoot, sprint.id), yaml8.dump(validated, { indent: 2 }), "utf-8");
}
function loadCurrentSprint(contextRepoRoot) {
  const p = getSprintCurrentPath(contextRepoRoot);
  if (!existsSync13(p)) return null;
  const raw = readFileSync11(p, "utf-8");
  const parsed = yaml8.load(raw);
  const result = SprintCurrentSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}
function saveCurrentSprint(contextRepoRoot, current) {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync13(dir)) mkdirSync10(dir, { recursive: true });
  writeFileSync10(getSprintCurrentPath(contextRepoRoot), yaml8.dump(current, { indent: 2 }), "utf-8");
}
function clearCurrentSprint(contextRepoRoot) {
  const p = getSprintCurrentPath(contextRepoRoot);
  if (existsSync13(p)) {
    const fs = __require("fs");
    fs.unlinkSync(p);
  }
}
function listSprints(contextRepoRoot) {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync13(dir)) return [];
  const files = readdirSync2(dir).filter((f) => /^SPRINT-\d+\.yml$/.test(f));
  return files.map((f) => {
    try {
      return loadSprint(contextRepoRoot, f.replace(/\.yml$/, ""));
    } catch {
      return null;
    }
  }).filter((s) => s !== null);
}
function nextSprintId(contextRepoRoot) {
  const sprints = listSprints(contextRepoRoot);
  const ids = sprints.map((s) => s.id.match(/^SPRINT-(\d+)$/)).filter((m) => m !== null).map((m) => Number.parseInt(m[1] ?? "0", 10));
  const next = ids.length === 0 ? 1 : Math.max(...ids) + 1;
  return `SPRINT-${next}`;
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
    const here = path13.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path13.resolve(here, "../package.json"),
      path13.resolve(here, "../../package.json"),
      path13.resolve(here, "../../../package.json")
    ];
    for (const c of candidates) {
      try {
        const pkg = JSON.parse(readFileSync12(c, "utf-8"));
        if (typeof pkg.version === "string") return pkg.version;
      } catch {
      }
    }
  } catch {
  }
  return "0.0.0-unknown";
}
var CLI_VERSION = readPkgVersion();
export {
  APP_ORIGINS,
  APP_ROLES,
  APP_STATUSES,
  CLIENT_STATES,
  CLI_VERSION,
  CatalogAppSchema,
  CatalogSchema,
  ClientStateSchema,
  ContextRepoSchema,
  DEV_TYPES,
  DefaultsSchema,
  DevTypeSchema,
  DevTypeSourceSchema,
  ERROR_CODES,
  FlowStateSchema,
  GitHubProvider,
  GitLabProvider,
  HDU_PRIORITIES,
  HDU_STATUSES,
  HduFrontmatterSchema,
  HduIndexEntrySchema,
  HduIndexSchema,
  HduTransitionSchema,
  NamingSchema,
  NotImplementedError,
  PROVIDERS,
  ProviderError,
  RULES,
  SessionIOError,
  SessionStateSchema,
  SprintCapacitySchema,
  SprintCurrentSchema,
  SprintSchema,
  StackConfigSchema,
  StackDevflowSchema,
  StackInfraSchema,
  StackTemplatesSchema,
  TelemetryConfigSchema,
  TelemetryEventSchema,
  appendTransition,
  buildAuditHeader,
  canHduTransitionTo,
  canTransitionTo,
  clearCurrentSprint,
  computeTelemetryStats,
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
  getCatalogMarkdownPath,
  getCatalogYamlPath,
  getClaudeCommandsDir,
  getClaudeGlobalSettingsPath,
  getClaudeHome,
  getClaudeSkillsDir,
  getClientStatePath,
  getContextRepoMarkerPath,
  getDevflowDir,
  getHduFilePath,
  getHduIndexPath,
  getHduTransitionsPath,
  getHdusDir,
  getHeartbeatLogPath,
  getProjectClaudeDir,
  getProjectClaudeSettingsPath,
  getProjectRoot,
  getSessionPath,
  getSprintCurrentPath,
  getSprintPath,
  getSprintsDir,
  getStackConfigPath,
  getTelemetryConfigPath,
  getTelemetryEventsPath,
  hasCatalog,
  hasSession,
  hasStackConfig,
  hashUser,
  inferProviderType,
  isAppOrigin,
  isAuditedAndUnmodified,
  isBrownfield,
  isClaudeCodeInstalled,
  isContextRepo,
  isDevFlowProject,
  isDevType,
  isJsonMode,
  isTelemetryEnabled,
  jsonError,
  jsonSuccess,
  legalNextStatuses,
  listHdus,
  listSprints,
  loadCatalog,
  loadContextRepoMarker,
  loadCurrentSprint,
  loadHdu,
  loadHduIndex,
  loadSession,
  loadSprint,
  loadStackConfig,
  loadTelemetryConfig,
  looksLikeLegacyMasterConfig,
  nextNaturalState,
  nextSprintId,
  parseAuditedFile,
  parseHduFile,
  parseMarkdownCatalog,
  partition,
  readClientState,
  readTelemetryEvents,
  readTransitions,
  recordCommandResult,
  recordTelemetry,
  regenerateHduIndex,
  renderCatalogMarkdown,
  requiresBaseline,
  requiresRepoContext,
  rulesForDevType,
  sanitizeArgs,
  saveCatalog,
  saveContextRepoMarker,
  saveCurrentSprint,
  saveHdu,
  saveHduIndex,
  saveSession,
  saveSprint,
  saveStackConfig,
  saveTelemetryConfig,
  serializeHdu,
  sha256Body,
  suggestedCommandFor,
  suggestedNextStep,
  updateClientState,
  wasManuallyEdited,
  writeClientState,
  writeWithAudit
};
//# sourceMappingURL=index.js.map