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

// src/index.ts
var CLI_VERSION = "0.2.0";
export {
  APP_ORIGINS,
  CLI_VERSION,
  DEV_TYPES,
  DevTypeSchema,
  DevTypeSourceSchema,
  FlowStateSchema,
  RULES,
  SessionIOError,
  SessionStateSchema,
  createInitialSession,
  detectFlowState,
  enforcementRuleIdsForDevType,
  evaluateRules,
  formatDoctorOutput,
  getClaudeCommandsDir,
  getClaudeHome,
  getClaudeSkillsDir,
  getDevflowDir,
  getHeartbeatLogPath,
  getProjectClaudeDir,
  getProjectClaudeSettingsPath,
  getProjectRoot,
  getSessionPath,
  hasSession,
  isAppOrigin,
  isBrownfield,
  isClaudeCodeInstalled,
  isDevType,
  loadSession,
  partition,
  requiresBaseline,
  requiresRepoContext,
  rulesForDevType,
  saveSession,
  suggestedNextStep
};
//# sourceMappingURL=index.js.map