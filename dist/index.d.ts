import { z } from 'zod';

/**
 * Tipos de desarrollo soportados por DevFlow IA.
 * Enum cerrado — agregar tipo requiere bump minor del CLI + actualización de
 * ENFORCEMENT.md y de las skills.
 *
 * Referencia: _Empresa/Productos/DevFlow-IA/MAPA_METODO.md §5.1
 */
declare const DEV_TYPES: readonly ["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"];
type DevType = (typeof DEV_TYPES)[number];
/**
 * Origen del valor de dev_type. Se guarda en session.json para audit-log.
 */
type DevTypeSource = 'business-brief' | 'tech-lead-approval' | 'inherited' | 'reclassify';
/**
 * Metadata completa del dev_type asociada a una feature.
 * Vive en HDU.dev_type_meta y se replica en session.json al start-session.
 */
interface DevTypeMeta {
    dev_type: DevType;
    dev_type_subtype: string | null;
    dev_type_source: DevTypeSource;
    dev_type_rationale: string;
    dev_type_locked: boolean;
    dev_type_locked_at: string | null;
    dev_type_reclassified_from?: DevType;
}
/**
 * Origen del codebase de una app. Diferente de dev_type (que vive en la HDU).
 * Vive en app-catalog.md.
 */
declare const APP_ORIGINS: readonly ["greenfield-app", "legacy-app", "external-app"];
type AppOrigin = (typeof APP_ORIGINS)[number];
/**
 * Type guards
 */
declare function isDevType(value: unknown): value is DevType;
declare function isAppOrigin(value: unknown): value is AppOrigin;
/**
 * Helpers de categorización
 */
declare function isBrownfield(type: DevType): boolean;
declare function requiresRepoContext(type: DevType): boolean;
declare function requiresBaseline(type: DevType): boolean;

/**
 * Schema de .devflow/session.json — validado con zod.
 *
 * Referencia: manual-implementacion/dd-cli-spec.md §4
 */

declare const DevTypeSchema: z.ZodEnum<["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"]>;
declare const DevTypeSourceSchema: z.ZodEnum<["business-brief", "tech-lead-approval", "inherited", "reclassify"]>;
declare const FlowStateSchema: z.ZodEnum<["not_started", "started", "repo_mapped", "baseline_ready", "spec_ready", "change_active", "ended"]>;
type FlowState = z.infer<typeof FlowStateSchema>;
declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    status: z.ZodEnum<["pending", "in_progress", "done", "blocked"]>;
    completed_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "in_progress" | "done" | "blocked";
    id: string;
    name: string;
    completed_at: string | null;
}, {
    status: "pending" | "in_progress" | "done" | "blocked";
    id: string;
    name: string;
    completed_at: string | null;
}>;
type Task = z.infer<typeof TaskSchema>;
declare const BlockerSchema: z.ZodObject<{
    task_id: z.ZodString;
    reason: z.ZodString;
    reported_at: z.ZodString;
    resolved_at: z.ZodNullable<z.ZodString>;
    resolution: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    task_id: string;
    reason: string;
    reported_at: string;
    resolved_at: string | null;
    resolution: string | null;
}, {
    task_id: string;
    reason: string;
    reported_at: string;
    resolved_at: string | null;
    resolution: string | null;
}>;
type Blocker = z.infer<typeof BlockerSchema>;
declare const AnomalySchema: z.ZodObject<{
    type: z.ZodEnum<["stale_session", "long_open_session", "stuck_in_started", "no_spec_after_30min", "missing_repo_context", "missing_baseline"]>;
    detected_at: z.ZodString;
    acknowledged: z.ZodBoolean;
    details: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
    detected_at: string;
    acknowledged: boolean;
    details: string;
}, {
    type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
    detected_at: string;
    acknowledged: boolean;
    details: string;
}>;
type Anomaly = z.infer<typeof AnomalySchema>;
declare const VendorSchema: z.ZodObject<{
    name: z.ZodString;
    api_version: z.ZodString;
    docs_url: z.ZodOptional<z.ZodString>;
    sandbox_url: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    api_version: string;
    docs_url?: string | undefined;
    sandbox_url?: string | undefined;
}, {
    name: string;
    api_version: string;
    docs_url?: string | undefined;
    sandbox_url?: string | undefined;
}>;
type Vendor = z.infer<typeof VendorSchema>;
declare const SessionStateSchema: z.ZodObject<{
    feature_id: z.ZodNullable<z.ZodString>;
    feature_name: z.ZodNullable<z.ZodString>;
    session_id: z.ZodString;
    started_at: z.ZodNullable<z.ZodString>;
    ended_at: z.ZodNullable<z.ZodString>;
    last_heartbeat: z.ZodNullable<z.ZodString>;
    mode: z.ZodEnum<["local", "platform"]>;
    platform_url: z.ZodNullable<z.ZodString>;
    unclosed: z.ZodDefault<z.ZodBoolean>;
    dev_type: z.ZodNullable<z.ZodEnum<["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"]>>;
    dev_type_subtype: z.ZodNullable<z.ZodString>;
    dev_type_source: z.ZodEnum<["business-brief", "tech-lead-approval", "inherited", "reclassify"]>;
    dev_type_rationale: z.ZodString;
    dev_type_locked: z.ZodDefault<z.ZodBoolean>;
    dev_type_locked_at: z.ZodNullable<z.ZodString>;
    dev_type_reclassified_from: z.ZodOptional<z.ZodNullable<z.ZodEnum<["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"]>>>;
    apps_affected: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    repo_context_path: z.ZodNullable<z.ZodString>;
    baseline_path: z.ZodNullable<z.ZodString>;
    legacy_system: z.ZodNullable<z.ZodString>;
    vendor: z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        api_version: z.ZodString;
        docs_url: z.ZodOptional<z.ZodString>;
        sandbox_url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        api_version: string;
        docs_url?: string | undefined;
        sandbox_url?: string | undefined;
    }, {
        name: string;
        api_version: string;
        docs_url?: string | undefined;
        sandbox_url?: string | undefined;
    }>>;
    enforcement_rules: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    flow_state: z.ZodEnum<["not_started", "started", "repo_mapped", "baseline_ready", "spec_ready", "change_active", "ended"]>;
    active_change: z.ZodNullable<z.ZodString>;
    tasks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        status: z.ZodEnum<["pending", "in_progress", "done", "blocked"]>;
        completed_at: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        status: "pending" | "in_progress" | "done" | "blocked";
        id: string;
        name: string;
        completed_at: string | null;
    }, {
        status: "pending" | "in_progress" | "done" | "blocked";
        id: string;
        name: string;
        completed_at: string | null;
    }>, "many">>;
    blockers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        task_id: z.ZodString;
        reason: z.ZodString;
        reported_at: z.ZodString;
        resolved_at: z.ZodNullable<z.ZodString>;
        resolution: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        task_id: string;
        reason: string;
        reported_at: string;
        resolved_at: string | null;
        resolution: string | null;
    }, {
        task_id: string;
        reason: string;
        reported_at: string;
        resolved_at: string | null;
        resolution: string | null;
    }>, "many">>;
    rag_context_snapshot: z.ZodNullable<z.ZodArray<z.ZodString, "many">>;
    anomalies: z.ZodDefault<z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["stale_session", "long_open_session", "stuck_in_started", "no_spec_after_30min", "missing_repo_context", "missing_baseline"]>;
        detected_at: z.ZodString;
        acknowledged: z.ZodBoolean;
        details: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
        detected_at: string;
        acknowledged: boolean;
        details: string;
    }, {
        type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
        detected_at: string;
        acknowledged: boolean;
        details: string;
    }>, "many">>;
    cli_version: z.ZodString;
    schema_version: z.ZodLiteral<2>;
}, "strip", z.ZodTypeAny, {
    feature_id: string | null;
    feature_name: string | null;
    session_id: string;
    started_at: string | null;
    ended_at: string | null;
    last_heartbeat: string | null;
    mode: "local" | "platform";
    platform_url: string | null;
    unclosed: boolean;
    dev_type: "greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa" | null;
    dev_type_subtype: string | null;
    dev_type_source: "business-brief" | "tech-lead-approval" | "inherited" | "reclassify";
    dev_type_rationale: string;
    dev_type_locked: boolean;
    dev_type_locked_at: string | null;
    apps_affected: string[];
    repo_context_path: string | null;
    baseline_path: string | null;
    legacy_system: string | null;
    vendor: {
        name: string;
        api_version: string;
        docs_url?: string | undefined;
        sandbox_url?: string | undefined;
    } | null;
    enforcement_rules: string[];
    flow_state: "not_started" | "started" | "repo_mapped" | "baseline_ready" | "spec_ready" | "change_active" | "ended";
    active_change: string | null;
    tasks: {
        status: "pending" | "in_progress" | "done" | "blocked";
        id: string;
        name: string;
        completed_at: string | null;
    }[];
    blockers: {
        task_id: string;
        reason: string;
        reported_at: string;
        resolved_at: string | null;
        resolution: string | null;
    }[];
    rag_context_snapshot: string[] | null;
    anomalies: {
        type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
        detected_at: string;
        acknowledged: boolean;
        details: string;
    }[];
    cli_version: string;
    schema_version: 2;
    dev_type_reclassified_from?: "greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa" | null | undefined;
}, {
    feature_id: string | null;
    feature_name: string | null;
    session_id: string;
    started_at: string | null;
    ended_at: string | null;
    last_heartbeat: string | null;
    mode: "local" | "platform";
    platform_url: string | null;
    dev_type: "greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa" | null;
    dev_type_subtype: string | null;
    dev_type_source: "business-brief" | "tech-lead-approval" | "inherited" | "reclassify";
    dev_type_rationale: string;
    dev_type_locked_at: string | null;
    repo_context_path: string | null;
    baseline_path: string | null;
    legacy_system: string | null;
    vendor: {
        name: string;
        api_version: string;
        docs_url?: string | undefined;
        sandbox_url?: string | undefined;
    } | null;
    flow_state: "not_started" | "started" | "repo_mapped" | "baseline_ready" | "spec_ready" | "change_active" | "ended";
    active_change: string | null;
    rag_context_snapshot: string[] | null;
    cli_version: string;
    schema_version: 2;
    unclosed?: boolean | undefined;
    dev_type_locked?: boolean | undefined;
    dev_type_reclassified_from?: "greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa" | null | undefined;
    apps_affected?: string[] | undefined;
    enforcement_rules?: string[] | undefined;
    tasks?: {
        status: "pending" | "in_progress" | "done" | "blocked";
        id: string;
        name: string;
        completed_at: string | null;
    }[] | undefined;
    blockers?: {
        task_id: string;
        reason: string;
        reported_at: string;
        resolved_at: string | null;
        resolution: string | null;
    }[] | undefined;
    anomalies?: {
        type: "stale_session" | "long_open_session" | "stuck_in_started" | "no_spec_after_30min" | "missing_repo_context" | "missing_baseline";
        detected_at: string;
        acknowledged: boolean;
        details: string;
    }[] | undefined;
}>;
type SessionState = z.infer<typeof SessionStateSchema>;
/**
 * Estado inicial al `dd-cli init` — sin sesión activa.
 */
declare function createInitialSession(cliVersion: string): SessionState;

interface DetectFlowStateOptions {
    projectRoot: string;
    session: SessionState;
}
/**
 * Detecta el flow_state vigente leyendo session.json + filesystem.
 * Es la fuente de verdad: el dev NO actualiza flow_state manualmente.
 */
declare function detectFlowState({ projectRoot, session, }: DetectFlowStateOptions): FlowState;
/**
 * Devuelve el siguiente paso esperado dado (flow_state, dev_type).
 * Usado por `dd-cli status` y `dd-cli watch`.
 *
 * Referencia: dd-cli-spec.md §5 (tabla "Mensajes contextuales por estado y dev_type")
 */
declare function suggestedNextStep(flowState: FlowState, devType: SessionState['dev_type']): string;

/**
 * Catálogo de enforcement rules.
 *
 * Cada regla aplica a un subset de dev_type y la evalúa una o más skills.
 *
 * Referencia: skills/ENFORCEMENT.md (14 reglas documentadas)
 */

type Severity = 'block' | 'warn' | 'audit';
interface EvaluationContext {
    projectRoot: string;
    session: SessionState;
    fileExists: (relPath: string) => boolean;
}
interface EvaluationResult {
    rule_id: string;
    passed: boolean;
    severity: Severity;
    message: string;
}
interface EnforcementRule {
    id: string;
    applies_to: DevType[];
    severity: Severity;
    evaluate(ctx: EvaluationContext): EvaluationResult;
}
declare const RULES: Record<string, EnforcementRule>;
/**
 * Devuelve las reglas aplicables a un dev_type dado.
 */
declare function rulesForDevType(devType: DevType): EnforcementRule[];
/**
 * Genera los enforcement_rules[] para meter en session.json.
 * El CLI los persiste y las skills los leen para saber qué chequear.
 */
declare function enforcementRuleIdsForDevType(devType: DevType): string[];

interface EvaluateOptions {
    projectRoot: string;
    session: SessionState;
    /** Si se pasa, solo evalúa estas reglas. Si no, usa todas las que aplican al dev_type. */
    ruleIds?: string[];
}
/**
 * Evalúa las reglas aplicables al dev_type de la sesión (o el subset indicado).
 * Devuelve resultado por regla — el caller decide qué hacer con block/warn/audit.
 */
declare function evaluateRules({ projectRoot, session, ruleIds, }: EvaluateOptions): EvaluationResult[];
/**
 * Particiona los resultados por severidad.
 */
declare function partition(results: EvaluationResult[]): {
    blockers: EvaluationResult[];
    warnings: EvaluationResult[];
    audits: EvaluationResult[];
};
/**
 * Formatea los resultados como output para `dd-cli doctor --for=<type>`.
 */
declare function formatDoctorOutput(results: EvaluationResult[], devType: SessionState['dev_type']): string;

/**
 * Detecta el root del proyecto actual.
 * Estrategia: buscar `.devflow/` ascendiendo, o si no existe, buscar `package.json` / `.git`.
 */
declare function getProjectRoot(startDir?: string): string;
declare function getSessionPath(projectRoot: string): string;
declare function getDevflowDir(projectRoot: string): string;
declare function getHeartbeatLogPath(projectRoot: string): string;
/**
 * Path donde Claude Code lee skills y settings.
 */
declare function getClaudeHome(): string;
declare function getClaudeSkillsDir(): string;
declare function getClaudeCommandsDir(): string;
declare function getProjectClaudeDir(projectRoot: string): string;
declare function getProjectClaudeSettingsPath(projectRoot: string): string;
/**
 * Verifica que Claude Code esté instalado (existe `~/.claude/`).
 */
declare function isClaudeCodeInstalled(): boolean;

declare class SessionIOError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
/**
 * Lee y valida session.json. Devuelve null si no existe.
 * Lanza SessionIOError si el archivo existe pero es inválido.
 */
declare function loadSession(projectRoot: string): SessionState | null;
/**
 * Persiste session.json. Crea .devflow/ si no existe.
 */
declare function saveSession(projectRoot: string, session: SessionState): void;
/**
 * Devuelve true si .devflow/session.json existe.
 */
declare function hasSession(projectRoot: string): boolean;

/**
 * @devflow-ia/cli — exports públicos.
 * Permite que otras herramientas (skills, tests, plataforma) consuman
 * la lógica core sin invocar el binario.
 */

declare const CLI_VERSION = "0.2.0";

export { APP_ORIGINS, type Anomaly, type AppOrigin, type Blocker, CLI_VERSION, DEV_TYPES, type DetectFlowStateOptions, type DevType, type DevTypeMeta, DevTypeSchema, type DevTypeSource, DevTypeSourceSchema, type EnforcementRule, type EvaluateOptions, type EvaluationContext, type EvaluationResult, type FlowState, FlowStateSchema, RULES, SessionIOError, type SessionState, SessionStateSchema, type Severity, type Task, type Vendor, createInitialSession, detectFlowState, enforcementRuleIdsForDevType, evaluateRules, formatDoctorOutput, getClaudeCommandsDir, getClaudeHome, getClaudeSkillsDir, getDevflowDir, getHeartbeatLogPath, getProjectClaudeDir, getProjectClaudeSettingsPath, getProjectRoot, getSessionPath, hasSession, isAppOrigin, isBrownfield, isClaudeCodeInstalled, isDevType, loadSession, partition, requiresBaseline, requiresRepoContext, rulesForDevType, saveSession, suggestedNextStep };
