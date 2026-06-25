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
/**
 * Busca `.devflow/session.json` ascendiendo desde `startDir` y retorna el root.
 * NO confunde con `~/.devflow/` (config global del CLI), ya que solo se considera
 * "proyecto DevFlow" si tiene `session.json`.
 *
 * Retorna null si no hay proyecto DevFlow en la jerarquía.
 *
 * Útil para statusline + install (debemos saber si estamos REALMENTE dentro de un
 * proyecto DevFlow o en un repo cualquiera).
 */
declare function findDevFlowProjectRoot(startDir?: string): string | null;
/**
 * `true` si el path indicado (o cwd por default) está dentro de un proyecto DevFlow IA.
 */
declare function isDevFlowProject(startDir?: string): boolean;
/**
 * Path del settings.json GLOBAL de Claude Code (~/.claude/settings.json).
 */
declare function getClaudeGlobalSettingsPath(): string;
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
 * Códigos de error estables del CLI.
 *
 * Contrato bajo D-7 (sección 4.8) y D-8 (Parte 3) del rediseño:
 * los códigos son estables entre versiones y las skills + Claude los
 * mapean a recovery hints conversacionales. Agregar códigos nuevos
 * al final de la lista correspondiente; no renombrar ni reusar.
 *
 * Convención: SCREAMING_SNAKE_CASE. Prefijo por dominio cuando aplica.
 */
declare const ERROR_CODES: readonly ["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"];
type ErrorCode = (typeof ERROR_CODES)[number];
/**
 * Mapeo de exit code por dominio (referencia R-4 del doc).
 *   0 = éxito
 *   1 = error operacional (red, permisos, archivo no encontrado)
 *   2 = error de configuración / precondición no cumplida
 *   3 = error de schema / validación
 */
declare function exitCodeFor(code: ErrorCode): 1 | 2 | 3;

/**
 * Contrato JSON estructurado del CLI (S1-9, D-7 Parte 3, D-8 Parte 3).
 *
 * Toda salida `--json` o con env `DEVFLOW_CLAUDE_MODE=1` cumple este shape.
 * Lo consumen:
 *   - Las skills (vía Claude leyendo el JSON entre invocaciones).
 *   - CI / scripts / power users.
 *   - Tests E2E.
 *
 * Diseño:
 *   - `cli_version` permite a la skill saber con qué versión está hablando.
 *   - `code` (en errores) es estable; ver `error-codes.ts`.
 *   - `recovery_hints` están en español y siempre incluyen un comando concreto.
 *   - `next_safe_command` sugiere el siguiente paso seguro (puede ser null si terminó).
 */

interface JsonSuccess<T = unknown> {
    status: 'success';
    command: string;
    cli_version: string;
    data: T;
    next_safe_command?: string | null;
}
interface JsonError {
    status: 'error';
    command: string;
    cli_version: string;
    code: ErrorCode;
    message: string;
    context?: Record<string, unknown>;
    recovery_hints?: string[];
    next_safe_command?: string | null;
}
type JsonOutput<T = unknown> = JsonSuccess<T> | JsonError;
interface JsonModeOpts {
    json?: boolean;
}
/**
 * Detecta si el comando debe emitir JSON estructurado.
 * Triggers: flag `--json` (explícito) o env `DEVFLOW_CLAUDE_MODE=1` (Claude lo setea).
 */
declare function isJsonMode(opts?: JsonModeOpts): boolean;
/**
 * Emite output JSON y termina con exit code apropiado.
 * Para éxito: exit 0. Para error: exit code según `exitCodeFor(code)`.
 *
 * No retorna — termina el proceso. Si se necesita lógica post-output,
 * usar `formatJson` directamente.
 */
declare function emitJson<T>(output: JsonOutput<T>): never;
/**
 * Variante que sólo formatea, sin terminar el proceso.
 * Útil para tests o cuando hay limpieza pendiente.
 */
declare function formatJson<T>(output: JsonOutput<T>): string;
declare function jsonSuccess<T>(command: string, data: T, nextSafeCommand?: string | null): JsonSuccess<T>;
declare function jsonError(opts: {
    command: string;
    code: ErrorCode;
    message: string;
    context?: Record<string, unknown>;
    recovery_hints?: string[];
    next_safe_command?: string | null;
}): JsonError;

/**
 * State.json por cliente — fuente que Claude lee entre invocaciones
 * (D-7 Parte 3 / D-8 Parte 3 del rediseño).
 *
 * Vive en `~/.devflow/clients/<slug>/state.json` y se actualiza después
 * de cada comando que muta state del cliente. La skill `/devflow-ia:client-onboard`
 * y `/devflow-ia:troubleshoot` lo consumen para saber dónde estamos.
 *
 * Las máquinas de estado seguibles son las de D-3 / sección 4.0:
 *   REGISTERED → DISCOVERED → DRAFT → READY → ACTIVE → NEEDS_REFRESH
 */

declare const CLIENT_STATES: readonly ["REGISTERED", "DISCOVERED", "DRAFT", "READY", "ACTIVE", "NEEDS_REFRESH"];
declare const PROVIDERS: readonly ["gitlab", "github"];
declare const ClientStateSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<"1.0">>;
    slug: z.ZodString;
    state: z.ZodEnum<["REGISTERED", "DISCOVERED", "DRAFT", "READY", "ACTIVE", "NEEDS_REFRESH"]>;
    provider: z.ZodOptional<z.ZodEnum<["gitlab", "github"]>>;
    last_command: z.ZodString;
    last_command_at: z.ZodString;
    last_error: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        code: z.ZodEnum<["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"]>;
        message: z.ZodString;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        recovery_hints: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        code: z.ZodEnum<["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"]>;
        message: z.ZodString;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        recovery_hints: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        code: z.ZodEnum<["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"]>;
        message: z.ZodString;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        recovery_hints: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>>>;
    draft_path: z.ZodOptional<z.ZodString>;
    open_gaps: z.ZodOptional<z.ZodNumber>;
    next_safe_command: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    schema_version: "1.0";
    slug: string;
    state: "REGISTERED" | "DISCOVERED" | "DRAFT" | "READY" | "ACTIVE" | "NEEDS_REFRESH";
    last_command: string;
    last_command_at: string;
    last_error: z.objectOutputType<{
        code: z.ZodEnum<["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"]>;
        message: z.ZodString;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        recovery_hints: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough"> | null;
    next_safe_command?: string | null | undefined;
    provider?: "gitlab" | "github" | undefined;
    draft_path?: string | undefined;
    open_gaps?: number | undefined;
}, {
    slug: string;
    state: "REGISTERED" | "DISCOVERED" | "DRAFT" | "READY" | "ACTIVE" | "NEEDS_REFRESH";
    last_command: string;
    last_command_at: string;
    schema_version?: "1.0" | undefined;
    next_safe_command?: string | null | undefined;
    provider?: "gitlab" | "github" | undefined;
    last_error?: z.objectInputType<{
        code: z.ZodEnum<["INTERNAL_ERROR", "NOT_IMPLEMENTED", "INVALID_INPUT", "PERMISSION_DENIED", "NETWORK_ERROR", "PROJECT_NOT_INITIALIZED", "CONFIG_INVALID", "CONFIG_MISSING", "CLIENT_NOT_REGISTERED", "CLIENT_ALREADY_REGISTERED", "CONTEXT_CACHE_MISSING", "CONTEXT_CACHE_STALE", "CONTEXT_REPO_EMPTY", "REGISTRY_INVALID", "TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_INSUFFICIENT_SCOPE", "PROVIDER_NOT_SUPPORTED", "GIT_CLONE_FAILED", "GIT_PULL_FAILED", "GIT_PUSH_FAILED", "CATALOG_PARSE_ERROR", "CATALOG_NOT_FOUND", "CONTEXT_REPO_INVALID", "STACK_CONFIG_MISSING", "SESSION_NOT_STARTED", "SESSION_ALREADY_ACTIVE", "SESSION_INVALID", "PRECONDITION_NOT_MET", "HDU_NOT_FOUND", "HDU_ID_COLLISION", "HDU_ALREADY_CLAIMED"]>;
        message: z.ZodString;
        context: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        recovery_hints: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough"> | null | undefined;
    draft_path?: string | undefined;
    open_gaps?: number | undefined;
}>;
type ClientState = z.infer<typeof ClientStateSchema>;
declare function getClientStatePath(slug: string): string;
declare function readClientState(slug: string): ClientState | null;
declare function writeClientState(state: ClientState): void;
/**
 * Actualiza el state.json del cliente fusionando un patch sobre el estado actual.
 * Si no existe, requiere `state` y `slug` mínimos en el patch para inicializar.
 */
declare function updateClientState(slug: string, patch: Partial<Omit<ClientState, 'slug'>>): ClientState;
/**
 * Conveniencia: registra el resultado de un comando.
 * Llamar al final de cada comando que muta state.
 */
declare function recordCommandResult(slug: string, command: string, result: {
    success: true;
    state?: ClientState['state'];
    nextSafe?: string | null;
} | {
    success: false;
    error: NonNullable<ClientState['last_error']>;
    nextSafe?: string | null;
}): void;

/**
 * Schema de `.devflow-context/stack.yml` — master config del cliente (S1-1).
 *
 * Resuelve D-6 de Parte 1 del rediseño y la decisión arquitectónica central:
 * dos schemas distintos compartían `.devflow/config.yml`. Ahora:
 *   - `.devflow/config.yml`           → ProjectConfig (identidad repo↔cliente)
 *   - `.devflow-context/stack.yml`    → StackConfig (master config del cliente)
 *
 * Vive en el context repo. Lo escribe `/devflow-ia:client-onboard` (Sprint 3)
 * y `dd-cli client migrate` (S1-10). Lo leen las skills, el `init-client`
 * para defaults, y el dashboard `client show`.
 *
 * Apéndice B.3 del doc rediseño.
 */

declare const StackInfraSchema: z.ZodObject<{
    backend_framework: z.ZodString;
    frontend_framework: z.ZodString;
    databases: z.ZodArray<z.ZodString, "many">;
    infra: z.ZodString;
    k8s_namespaces: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    cicd_platform: z.ZodString;
    identity_provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    container_registry: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    base_domain: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    backend_framework: string;
    frontend_framework: string;
    databases: string[];
    infra: string;
    cicd_platform: string;
    identity_provider: string | null;
    container_registry: string | null;
    base_domain: string | null;
    k8s_namespaces?: Record<string, string> | undefined;
}, {
    backend_framework: string;
    frontend_framework: string;
    databases: string[];
    infra: string;
    cicd_platform: string;
    k8s_namespaces?: Record<string, string> | undefined;
    identity_provider?: string | null | undefined;
    container_registry?: string | null | undefined;
    base_domain?: string | null | undefined;
}>;
declare const NamingSchema: z.ZodObject<{
    feature_id_pattern: z.ZodDefault<z.ZodString>;
    branch_pattern: z.ZodDefault<z.ZodString>;
    spec_filename: z.ZodDefault<z.ZodString>;
    epic_filename: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    feature_id_pattern: string;
    branch_pattern: string;
    spec_filename: string;
    epic_filename: string;
}, {
    feature_id_pattern?: string | undefined;
    branch_pattern?: string | undefined;
    spec_filename?: string | undefined;
    epic_filename?: string | undefined;
}>;
declare const DefaultsSchema: z.ZodObject<{
    acceptance_format: z.ZodDefault<z.ZodEnum<["gherkin", "checklist", "narrative"]>>;
    story_format: z.ZodDefault<z.ZodEnum<["como-quiero-para", "user-story", "free"]>>;
    sprint_duration_weeks: z.ZodDefault<z.ZodNumber>;
    main_branch: z.ZodDefault<z.ZodString>;
    qa_branch: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    acceptance_format: "gherkin" | "checklist" | "narrative";
    story_format: "como-quiero-para" | "user-story" | "free";
    sprint_duration_weeks: number;
    main_branch: string;
    qa_branch: string;
}, {
    acceptance_format?: "gherkin" | "checklist" | "narrative" | undefined;
    story_format?: "como-quiero-para" | "user-story" | "free" | undefined;
    sprint_duration_weeks?: number | undefined;
    main_branch?: string | undefined;
    qa_branch?: string | undefined;
}>;
declare const StackTemplatesSchema: z.ZodObject<{
    fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
declare const StackDevflowSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["local", "platform"]>>;
    url: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    mode: "local" | "platform";
    url: string | null;
}, {
    mode?: "local" | "platform" | undefined;
    url?: string | null | undefined;
}>;
declare const StackConfigSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<"1.0">>;
    client: z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        industry: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        team_size: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        primary_contact: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        slug: string;
        industry: string | null;
        team_size: number | null;
        primary_contact: string | null;
    }, {
        name: string;
        slug: string;
        industry?: string | null | undefined;
        team_size?: number | null | undefined;
        primary_contact?: string | null | undefined;
    }>;
    stack: z.ZodObject<{
        backend_framework: z.ZodString;
        frontend_framework: z.ZodString;
        databases: z.ZodArray<z.ZodString, "many">;
        infra: z.ZodString;
        k8s_namespaces: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        cicd_platform: z.ZodString;
        identity_provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        container_registry: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        base_domain: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        backend_framework: string;
        frontend_framework: string;
        databases: string[];
        infra: string;
        cicd_platform: string;
        identity_provider: string | null;
        container_registry: string | null;
        base_domain: string | null;
        k8s_namespaces?: Record<string, string> | undefined;
    }, {
        backend_framework: string;
        frontend_framework: string;
        databases: string[];
        infra: string;
        cicd_platform: string;
        k8s_namespaces?: Record<string, string> | undefined;
        identity_provider?: string | null | undefined;
        container_registry?: string | null | undefined;
        base_domain?: string | null | undefined;
    }>;
    naming: z.ZodDefault<z.ZodObject<{
        feature_id_pattern: z.ZodDefault<z.ZodString>;
        branch_pattern: z.ZodDefault<z.ZodString>;
        spec_filename: z.ZodDefault<z.ZodString>;
        epic_filename: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        feature_id_pattern: string;
        branch_pattern: string;
        spec_filename: string;
        epic_filename: string;
    }, {
        feature_id_pattern?: string | undefined;
        branch_pattern?: string | undefined;
        spec_filename?: string | undefined;
        epic_filename?: string | undefined;
    }>>;
    defaults: z.ZodDefault<z.ZodObject<{
        acceptance_format: z.ZodDefault<z.ZodEnum<["gherkin", "checklist", "narrative"]>>;
        story_format: z.ZodDefault<z.ZodEnum<["como-quiero-para", "user-story", "free"]>>;
        sprint_duration_weeks: z.ZodDefault<z.ZodNumber>;
        main_branch: z.ZodDefault<z.ZodString>;
        qa_branch: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        acceptance_format: "gherkin" | "checklist" | "narrative";
        story_format: "como-quiero-para" | "user-story" | "free";
        sprint_duration_weeks: number;
        main_branch: string;
        qa_branch: string;
    }, {
        acceptance_format?: "gherkin" | "checklist" | "narrative" | undefined;
        story_format?: "como-quiero-para" | "user-story" | "free" | undefined;
        sprint_duration_weeks?: number | undefined;
        main_branch?: string | undefined;
        qa_branch?: string | undefined;
    }>>;
    templates: z.ZodDefault<z.ZodObject<{
        fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>;
    devflow: z.ZodDefault<z.ZodObject<{
        mode: z.ZodDefault<z.ZodEnum<["local", "platform"]>>;
        url: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        mode: "local" | "platform";
        url: string | null;
    }, {
        mode?: "local" | "platform" | undefined;
        url?: string | null | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    schema_version: "1.0";
    client: {
        name: string;
        slug: string;
        industry: string | null;
        team_size: number | null;
        primary_contact: string | null;
    };
    stack: {
        backend_framework: string;
        frontend_framework: string;
        databases: string[];
        infra: string;
        cicd_platform: string;
        identity_provider: string | null;
        container_registry: string | null;
        base_domain: string | null;
        k8s_namespaces?: Record<string, string> | undefined;
    };
    naming: {
        feature_id_pattern: string;
        branch_pattern: string;
        spec_filename: string;
        epic_filename: string;
    };
    defaults: {
        acceptance_format: "gherkin" | "checklist" | "narrative";
        story_format: "como-quiero-para" | "user-story" | "free";
        sprint_duration_weeks: number;
        main_branch: string;
        qa_branch: string;
    };
    templates: {
        fullstack: string | null;
        api: string | null;
    } & {
        [k: string]: unknown;
    };
    devflow: {
        mode: "local" | "platform";
        url: string | null;
    };
}, {
    client: {
        name: string;
        slug: string;
        industry?: string | null | undefined;
        team_size?: number | null | undefined;
        primary_contact?: string | null | undefined;
    };
    stack: {
        backend_framework: string;
        frontend_framework: string;
        databases: string[];
        infra: string;
        cicd_platform: string;
        k8s_namespaces?: Record<string, string> | undefined;
        identity_provider?: string | null | undefined;
        container_registry?: string | null | undefined;
        base_domain?: string | null | undefined;
    };
    schema_version?: "1.0" | undefined;
    naming?: {
        feature_id_pattern?: string | undefined;
        branch_pattern?: string | undefined;
        spec_filename?: string | undefined;
        epic_filename?: string | undefined;
    } | undefined;
    defaults?: {
        acceptance_format?: "gherkin" | "checklist" | "narrative" | undefined;
        story_format?: "como-quiero-para" | "user-story" | "free" | undefined;
        sprint_duration_weeks?: number | undefined;
        main_branch?: string | undefined;
        qa_branch?: string | undefined;
    } | undefined;
    templates?: z.objectInputType<{
        fullstack: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        api: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    devflow?: {
        mode?: "local" | "platform" | undefined;
        url?: string | null | undefined;
    } | undefined;
}>;
type StackConfig = z.infer<typeof StackConfigSchema>;
declare function getStackConfigPath(contextRepoRoot: string): string;
declare function hasStackConfig(contextRepoRoot: string): boolean;
declare function loadStackConfig(contextRepoRoot: string): StackConfig | null;
declare function saveStackConfig(contextRepoRoot: string, config: StackConfig): void;
/**
 * Heurística para detectar el config.yml "master" legacy.
 *
 * El ProjectConfig nuevo (.devflow/config.yml) tiene `client + app + devflow`.
 * El master legacy (también `.devflow/config.yml` pero en context repo) tiene
 * `project + naming + defaults + stack + devflow + templates`.
 *
 * Si vemos `stack` o `project` en el top-level, asumimos legacy.
 */
declare function looksLikeLegacyMasterConfig(parsed: unknown): boolean;

/**
 * Schema de `.devflow-context/catalog.yml` — catálogo de apps del cliente (S1-2).
 *
 * Resuelve A-4 del rediseño: "la fuente de verdad del catálogo es markdown,
 * frágil por diseño". Migramos a YAML canónico; el markdown queda como vista
 * derivada que se regenera con `dd-cli context render` (Sprint 2 S2-5).
 *
 * Apéndice B.2 del doc rediseño.
 *
 * Backward-compat: si el catálogo es markdown viejo (app-catalog.md),
 * `loadCatalog` lo parsea con el hot-fix de B-1 y produce el mismo shape.
 */

declare const APP_STATUSES: readonly ["prod", "qa", "dev", "deprecated", "inactive", "empty", "unknown"];
type AppStatus = (typeof APP_STATUSES)[number];
declare const APP_ROLES: readonly ["provider", "consumer", "portal", "standalone", "data-layer", "integration", "unknown"];
type AppRole = (typeof APP_ROLES)[number];
declare const CatalogAppSchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["microservice", "bff", "api-rest", "frontend-app", "frontend-mfe", "worker", "library"]>;
    role: z.ZodDefault<z.ZodEnum<["provider", "consumer", "portal", "standalone", "data-layer", "integration", "unknown"]>>;
    auth_profile: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    ci_cd_profile: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    branch: z.ZodDefault<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["prod", "qa", "dev", "deprecated", "inactive", "empty", "unknown"]>>;
    app_origin: z.ZodDefault<z.ZodEnum<["greenfield-app", "legacy-app", "external-app"]>>;
    template_origin: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    preferred_dev_types: z.ZodDefault<z.ZodArray<z.ZodEnum<["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"]>, "many">>;
    tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
    status: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty";
    name: string;
    slug: string;
    auth_profile: string | null;
    ci_cd_profile: string | null;
    app_origin: "greenfield-app" | "legacy-app" | "external-app";
    preferred_dev_types: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[];
    role: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration";
    repo: string | null;
    branch: string;
    template_origin: string | null;
    tags: string[];
    notes: string | null;
}, {
    type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
    name: string;
    slug: string;
    status?: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty" | undefined;
    auth_profile?: string | null | undefined;
    ci_cd_profile?: string | null | undefined;
    app_origin?: "greenfield-app" | "legacy-app" | "external-app" | undefined;
    preferred_dev_types?: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[] | undefined;
    role?: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration" | undefined;
    repo?: string | null | undefined;
    branch?: string | undefined;
    template_origin?: string | null | undefined;
    tags?: string[] | undefined;
    notes?: string | null | undefined;
}>;
type CatalogApp = z.infer<typeof CatalogAppSchema>;
declare const CatalogSchema: z.ZodObject<{
    schema_version: z.ZodDefault<z.ZodLiteral<"1.0">>;
    apps: z.ZodDefault<z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
        type: z.ZodEnum<["microservice", "bff", "api-rest", "frontend-app", "frontend-mfe", "worker", "library"]>;
        role: z.ZodDefault<z.ZodEnum<["provider", "consumer", "portal", "standalone", "data-layer", "integration", "unknown"]>>;
        auth_profile: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        ci_cd_profile: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        repo: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        branch: z.ZodDefault<z.ZodString>;
        status: z.ZodDefault<z.ZodEnum<["prod", "qa", "dev", "deprecated", "inactive", "empty", "unknown"]>>;
        app_origin: z.ZodDefault<z.ZodEnum<["greenfield-app", "legacy-app", "external-app"]>>;
        template_origin: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        preferred_dev_types: z.ZodDefault<z.ZodArray<z.ZodEnum<["greenfield", "brownfield-feature", "brownfield-refactor", "modernizacion", "integracion-externa"]>, "many">>;
        tags: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
        status: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty";
        name: string;
        slug: string;
        auth_profile: string | null;
        ci_cd_profile: string | null;
        app_origin: "greenfield-app" | "legacy-app" | "external-app";
        preferred_dev_types: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[];
        role: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration";
        repo: string | null;
        branch: string;
        template_origin: string | null;
        tags: string[];
        notes: string | null;
    }, {
        type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
        name: string;
        slug: string;
        status?: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty" | undefined;
        auth_profile?: string | null | undefined;
        ci_cd_profile?: string | null | undefined;
        app_origin?: "greenfield-app" | "legacy-app" | "external-app" | undefined;
        preferred_dev_types?: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[] | undefined;
        role?: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration" | undefined;
        repo?: string | null | undefined;
        branch?: string | undefined;
        template_origin?: string | null | undefined;
        tags?: string[] | undefined;
        notes?: string | null | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    schema_version: "1.0";
    apps: {
        type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
        status: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty";
        name: string;
        slug: string;
        auth_profile: string | null;
        ci_cd_profile: string | null;
        app_origin: "greenfield-app" | "legacy-app" | "external-app";
        preferred_dev_types: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[];
        role: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration";
        repo: string | null;
        branch: string;
        template_origin: string | null;
        tags: string[];
        notes: string | null;
    }[];
}, {
    schema_version?: "1.0" | undefined;
    apps?: {
        type: "microservice" | "bff" | "api-rest" | "frontend-app" | "frontend-mfe" | "worker" | "library";
        name: string;
        slug: string;
        status?: "unknown" | "prod" | "qa" | "dev" | "deprecated" | "inactive" | "empty" | undefined;
        auth_profile?: string | null | undefined;
        ci_cd_profile?: string | null | undefined;
        app_origin?: "greenfield-app" | "legacy-app" | "external-app" | undefined;
        preferred_dev_types?: ("greenfield" | "brownfield-feature" | "brownfield-refactor" | "modernizacion" | "integracion-externa")[] | undefined;
        role?: "unknown" | "provider" | "consumer" | "portal" | "standalone" | "data-layer" | "integration" | undefined;
        repo?: string | null | undefined;
        branch?: string | undefined;
        template_origin?: string | null | undefined;
        tags?: string[] | undefined;
        notes?: string | null | undefined;
    }[] | undefined;
}>;
type Catalog = z.infer<typeof CatalogSchema>;
declare function getCatalogYamlPath(contextRepoRoot: string): string;
declare function getCatalogMarkdownPath(contextRepoRoot: string): string;
declare function hasCatalog(contextRepoRoot: string): boolean;
/**
 * Lee el catálogo del context repo.
 * Prefiere catalog.yml; si no existe, parsea app-catalog.md (backward-compat).
 * Retorna null si no hay ninguno.
 */
declare function loadCatalog(contextRepoRoot: string): Catalog | null;
declare function saveCatalog(contextRepoRoot: string, catalog: Catalog): void;
/**
 * Parsea el markdown legacy `app-catalog.md` al shape de Catalog.
 *
 * Schema del skill /init-context (8 columnas):
 *   | slug | tipo | app_origin | auth-profile | repo | ci_cd | estado | preferred_dev_types |
 *
 * El hot-fix de B-1 ya tolera backticks. Acá generalizamos al parser
 * canónico y los campos faltantes (name, role, etc.) usan defaults.
 *
 * NOTA: la columna 5 (ci_cd) del skill viejo era boolean (Sí/No), no el
 * nombre del profile. Si parece boolean, marcamos `ci_cd_profile: null`
 * para que el cliente lo complete via `dd-cli client gaps --resolve`.
 */
declare function parseMarkdownCatalog(content: string): CatalogApp[];
/**
 * Regenera el markdown derivado desde el YAML canónico.
 * Lo invocará `dd-cli context render` en Sprint 2. Acá ya queda la lógica
 * porque depende del schema y conviene tenerla en el mismo módulo.
 */
declare function renderCatalogMarkdown(catalog: Catalog): string;

/**
 * Schema de `.devflow-context/.context-repo.yml` (S2-3 + S2-4).
 *
 * Marcador del context repo + metadata de auditoría. Resuelve A-3
 * del rediseño: "Falta el contrato de context repo" — antes no había
 * forma de distinguir un context repo de un repo de código.
 *
 * Apéndice B.1 del doc rediseño.
 *
 * Lo escribe la skill `/devflow-ia:client-onboard` (Sprint 3) y
 * `dd-cli client publish`. Lo lee `dd-cli init` para abortar con
 * mensaje útil si alguien intenta tratar un context repo como
 * repo de código. Lo lee `dd-cli context validate` para auditoría.
 */

declare const ContextRepoSchema: z.ZodObject<{
    kind: z.ZodLiteral<"context-repo">;
    schema_version: z.ZodDefault<z.ZodString>;
    client: z.ZodObject<{
        slug: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        slug: string;
    }, {
        name: string;
        slug: string;
    }>;
    provider: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<["gitlab", "github"]>;
        base_url: z.ZodString;
        group_or_org: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "gitlab" | "github";
        base_url: string;
        group_or_org: string;
    }, {
        type: "gitlab" | "github";
        base_url: string;
        group_or_org: string;
    }>>;
    generated_by: z.ZodDefault<z.ZodString>;
    last_generated_at: z.ZodString;
    cli_version: z.ZodString;
    discovery_source: z.ZodOptional<z.ZodObject<{
        type: z.ZodDefault<z.ZodLiteral<"provider-api">>;
        ref: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "provider-api";
        ref: string;
    }, {
        type?: "provider-api" | undefined;
        ref?: string | undefined;
    }>>;
    checksums: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    cli_version: string;
    schema_version: string;
    client: {
        name: string;
        slug: string;
    };
    kind: "context-repo";
    generated_by: string;
    last_generated_at: string;
    provider?: {
        type: "gitlab" | "github";
        base_url: string;
        group_or_org: string;
    } | undefined;
    discovery_source?: {
        type: "provider-api";
        ref: string;
    } | undefined;
    checksums?: Record<string, string> | undefined;
}, {
    cli_version: string;
    client: {
        name: string;
        slug: string;
    };
    kind: "context-repo";
    last_generated_at: string;
    schema_version?: string | undefined;
    provider?: {
        type: "gitlab" | "github";
        base_url: string;
        group_or_org: string;
    } | undefined;
    generated_by?: string | undefined;
    discovery_source?: {
        type?: "provider-api" | undefined;
        ref?: string | undefined;
    } | undefined;
    checksums?: Record<string, string> | undefined;
}>;
type ContextRepoMarker = z.infer<typeof ContextRepoSchema>;
declare function getContextRepoMarkerPath(repoRoot: string): string;
/**
 * Detecta si un directorio es un context repo.
 *
 * Lógica (orden):
 *   1. Marcador canónico: `.devflow-context/.context-repo.yml`.
 *   2. Forma post-migración (S1-10): existe `.devflow-context/stack.yml` —
 *      sin importar qué tenga `.devflow/config.yml` (puede tener el master
 *      legacy todavía por backward-compat).
 *   3. Forma pre-migración: hay `.devflow-context/app-catalog.md` o `catalog.yml`.
 *   4. Heurística legacy pura: tiene `.devflow-context/` y no hay
 *      `.devflow/config.yml` (típico cuando solo se corrió `init-context` viejo
 *      sin `init` previo).
 *
 * Usá esto para que `dd-cli init` aborte con mensaje útil.
 */
declare function isContextRepo(repoRoot: string): boolean;
declare function loadContextRepoMarker(repoRoot: string): ContextRepoMarker | null;
declare function saveContextRepoMarker(repoRoot: string, marker: ContextRepoMarker): void;

/**
 * GitProvider — abstracción provider-agnóstica (D-6 Parte 3 del rediseño).
 *
 * Soporta GitLab (cloud + self-hosted) y GitHub (cloud + Enterprise) detrás
 * de la misma interface. `pattern-detector.ts` y la skill `/client-onboard`
 * reciben un `GitProvider` ya construido — no saben qué proveedor es.
 *
 * Bitbucket / Azure DevOps quedan para v2 con la misma interface.
 *
 * Scope v1 (Sprint 1):
 *   - validateToken / listGroupRepos / readFile / readFirstFound  → implementados.
 *   - createRepo / setBranchProtection / createPullRequest / configureWebhook
 *     → stubs que tiran NOT_IMPLEMENTED. Se completan en Sprint 3 (`client new`).
 */
type ProviderType = 'gitlab' | 'github';
interface RepoMeta {
    id: string | number;
    slug: string;
    name: string;
    description: string;
    url: string;
    ssh_url: string;
    default_branch: string;
    last_push: string;
    language: string | null;
    size_kb: number;
    topics: string[];
    archived: boolean;
    ci_config_path: string | null;
}
interface FileContent {
    path: string;
    content: string;
    found: boolean;
}
interface TokenValidation {
    valid: boolean;
    user: string | null;
    scopes_present: string[];
    scopes_missing: string[];
    is_admin_of_group: boolean | null;
    message: string;
}
interface ValidateTokenOpts {
    /**
     * Operaciones que el caller quiere validar. El provider calcula qué scopes
     * mínimos requiere cada una y reporta los que faltan.
     */
    required_for?: Array<'read' | 'write' | 'create_repo' | 'branch_protection' | 'webhook'>;
}
interface CreateRepoOpts {
    name: string;
    description?: string;
    visibility?: 'private' | 'internal' | 'public';
    default_branch?: string;
    initialize_with_readme?: boolean;
}
interface BranchProtectionRules {
    branch: string;
    require_pull_request?: boolean;
    required_approvals?: number;
    allow_force_push?: boolean;
}
interface CreatePullRequestOpts {
    source_branch: string;
    target_branch: string;
    title: string;
    body: string;
}
interface PullRequestRef {
    number: number;
    url: string;
}
interface WebhookOpts {
    url: string;
    events: string[];
    secret?: string;
}
interface GitProvider {
    readonly type: ProviderType;
    readonly base_url: string;
    readonly group_or_org: string;
    validateToken(opts?: ValidateTokenOpts): Promise<TokenValidation>;
    listGroupRepos(): Promise<RepoMeta[]>;
    readFile(repoIdOrSlug: string | number, filePath: string, ref?: string): Promise<FileContent>;
    readFirstFound(repoIdOrSlug: string | number, candidates: string[], ref?: string): Promise<FileContent>;
    createRepo?(opts: CreateRepoOpts): Promise<RepoMeta>;
    setBranchProtection?(repoIdOrSlug: string | number, rules: BranchProtectionRules): Promise<void>;
    createPullRequest?(repoIdOrSlug: string | number, opts: CreatePullRequestOpts): Promise<PullRequestRef>;
    configureWebhook?(repoIdOrSlug: string | number, opts: WebhookOpts): Promise<void>;
}
declare class ProviderError extends Error {
    readonly cause?: {
        provider: ProviderType;
        status?: number;
        body?: string;
    } | undefined;
    constructor(message: string, cause?: {
        provider: ProviderType;
        status?: number;
        body?: string;
    } | undefined);
}
declare class NotImplementedError extends ProviderError {
    constructor(provider: ProviderType, feature: string);
}

/**
 * GitLabProvider — implementación de GitProvider para GitLab cloud y self-hosted.
 *
 * Scope: API v4 (https://docs.gitlab.com/ee/api/).
 * Auth: PAT con header PRIVATE-TOKEN.
 *
 * Permisos esperados (ver sección 4.7 del doc rediseño):
 *   read_api          listGroupRepos + readFile
 *   api               createRepo + setBranchProtection + createPullRequest + configureWebhook
 *   write_repository  push (incluido en `api`)
 */

interface GitLabProviderOpts {
    base_url: string;
    group: string;
    token: string;
}
declare class GitLabProvider implements GitProvider {
    readonly type: ProviderType;
    readonly base_url: string;
    readonly group_or_org: string;
    private readonly token;
    constructor(opts: GitLabProviderOpts);
    private request;
    /**
     * Mapeo de operación → scopes mínimos requeridos (sección 4.7).
     * GitLab `api` incluye casi todo; `read_api` es solo lectura.
     */
    private requiredScopesFor;
    validateToken(opts?: ValidateTokenOpts): Promise<TokenValidation>;
    listGroupRepos(): Promise<RepoMeta[]>;
    readFile(repoIdOrSlug: string | number, filePath: string, ref?: string): Promise<FileContent>;
    readFirstFound(repoIdOrSlug: string | number, candidates: string[], ref?: string): Promise<FileContent>;
    createRepo(_opts: CreateRepoOpts): Promise<RepoMeta>;
    setBranchProtection(_repo: string | number, _rules: BranchProtectionRules): Promise<void>;
    createPullRequest(_repo: string | number, _opts: CreatePullRequestOpts): Promise<PullRequestRef>;
    configureWebhook(_repo: string | number, _opts: WebhookOpts): Promise<void>;
}

/**
 * GitHubProvider — implementación de GitProvider para GitHub cloud y Enterprise.
 *
 * Scope: REST API v3 (https://docs.github.com/en/rest).
 * Auth: PAT classic con Authorization Bearer (también compatible con
 *       fine-grained PAT).
 *
 * Permisos esperados (ver sección 4.7 del doc rediseño):
 *   Classic PAT:        repo, admin:repo_hook (para webhooks)
 *   Fine-grained PAT:   Contents:Read/Write, Pull requests:Write,
 *                       Administration:Write (branch protection + crear repo),
 *                       Webhooks:Write
 */

interface GitHubProviderOpts {
    base_url: string;
    org: string;
    token: string;
}
declare class GitHubProvider implements GitProvider {
    readonly type: ProviderType;
    readonly base_url: string;
    readonly group_or_org: string;
    private readonly token;
    constructor(opts: GitHubProviderOpts);
    private request;
    /**
     * GitHub Classic PAT: la API devuelve scopes en el header `x-oauth-scopes`.
     * Fine-grained PAT: el header viene vacío (los permisos son por-repo),
     * en ese caso reportamos `scopes_present: []` y dejamos que el caller
     * intente la operación — fallará con 403 si no tiene permiso.
     */
    private requiredScopesFor;
    validateToken(opts?: ValidateTokenOpts): Promise<TokenValidation>;
    listGroupRepos(): Promise<RepoMeta[]>;
    readFile(repoIdOrSlug: string | number, filePath: string, ref?: string): Promise<FileContent>;
    readFirstFound(repoIdOrSlug: string | number, candidates: string[], ref?: string): Promise<FileContent>;
    createRepo(_opts: CreateRepoOpts): Promise<RepoMeta>;
    setBranchProtection(_repo: string | number, _rules: BranchProtectionRules): Promise<void>;
    createPullRequest(_repo: string | number, _opts: CreatePullRequestOpts): Promise<PullRequestRef>;
    configureWebhook(_repo: string | number, _opts: WebhookOpts): Promise<void>;
}

/**
 * Schema de ~/.devflow/credentials.yml — credenciales git por cliente.
 *
 * Archivo con permisos 600 (solo lectura del usuario).
 * NUNCA se commitea. Separado de registry.yml para seguridad.
 */

declare const GitHostSchema: z.ZodEnum<["gitlab", "github", "bitbucket", "azure"]>;
type GitHost = z.infer<typeof GitHostSchema>;
declare const ClientCredentialsSchema: z.ZodObject<{
    git_token: z.ZodString;
    git_host: z.ZodDefault<z.ZodEnum<["gitlab", "github", "bitbucket", "azure"]>>;
    git_base_url: z.ZodDefault<z.ZodString>;
    git_group: z.ZodString;
}, "strip", z.ZodTypeAny, {
    git_token: string;
    git_host: "gitlab" | "github" | "bitbucket" | "azure";
    git_base_url: string;
    git_group: string;
}, {
    git_token: string;
    git_group: string;
    git_host?: "gitlab" | "github" | "bitbucket" | "azure" | undefined;
    git_base_url?: string | undefined;
}>;
type ClientCredentials = z.infer<typeof ClientCredentialsSchema>;

/**
 * Factory para construir un GitProvider desde las credenciales del cliente.
 *
 * El caller no decide qué provider construir — sólo entrega las credenciales
 * y obtiene la interface unificada. Cumple D-6 Parte 3 del rediseño.
 *
 * Detección del provider:
 *   1. Si `creds.git_host` está seteado, gana.
 *   2. Si no, inferir desde `git_base_url`:
 *        contiene "github" → github
 *        else              → gitlab
 *
 * El registry / context-repo.yml también pueden guardar `provider` explícito
 * y pasarlo acá — eso es el caso preferido (sin inferencia).
 */

interface CreateProviderOverrides {
    type?: ProviderType;
    base_url?: string;
    group_or_org?: string;
}
/**
 * Construye un GitProvider concreto desde las credenciales registradas.
 * Por defecto usa los campos de `creds`; los overrides permiten ajustar
 * (útil para tests y para `client new` cuando el cliente no está aún en el registry).
 */
declare function createProvider(creds: ClientCredentials, overrides?: CreateProviderOverrides): GitProvider;
declare function inferProviderType(host: GitHost | undefined, baseUrl: string): ProviderType;

/**
 * @devflow-ia/cli — exports públicos.
 * Permite que otras herramientas (skills, tests, plataforma) consuman
 * la lógica core sin invocar el binario.
 */

declare const CLI_VERSION = "0.5.1";

export { APP_ORIGINS, APP_ROLES, APP_STATUSES, type Anomaly, type AppOrigin, type AppRole, type AppStatus, type Blocker, type BranchProtectionRules, CLIENT_STATES, CLI_VERSION, type Catalog, type CatalogApp, CatalogAppSchema, CatalogSchema, type ClientState, ClientStateSchema, type ContextRepoMarker, ContextRepoSchema, type CreatePullRequestOpts, type CreateRepoOpts, DEV_TYPES, DefaultsSchema, type DetectFlowStateOptions, type DevType, type DevTypeMeta, DevTypeSchema, type DevTypeSource, DevTypeSourceSchema, ERROR_CODES, type EnforcementRule, type ErrorCode, type EvaluateOptions, type EvaluationContext, type EvaluationResult, type FileContent, type FlowState, FlowStateSchema, GitHubProvider, GitLabProvider, type GitProvider, type JsonError, type JsonModeOpts, type JsonOutput, type JsonSuccess, NamingSchema, NotImplementedError, PROVIDERS, ProviderError, type ProviderType, type PullRequestRef, RULES, type RepoMeta, SessionIOError, type SessionState, SessionStateSchema, type Severity, type StackConfig, StackConfigSchema, StackDevflowSchema, StackInfraSchema, StackTemplatesSchema, type Task, type TokenValidation, type ValidateTokenOpts, type Vendor, type WebhookOpts, createInitialSession, createProvider, detectFlowState, emitJson, enforcementRuleIdsForDevType, evaluateRules, exitCodeFor, findDevFlowProjectRoot, formatDoctorOutput, formatJson, getCatalogMarkdownPath, getCatalogYamlPath, getClaudeCommandsDir, getClaudeGlobalSettingsPath, getClaudeHome, getClaudeSkillsDir, getClientStatePath, getContextRepoMarkerPath, getDevflowDir, getHeartbeatLogPath, getProjectClaudeDir, getProjectClaudeSettingsPath, getProjectRoot, getSessionPath, getStackConfigPath, hasCatalog, hasSession, hasStackConfig, inferProviderType, isAppOrigin, isBrownfield, isClaudeCodeInstalled, isContextRepo, isDevFlowProject, isDevType, isJsonMode, jsonError, jsonSuccess, loadCatalog, loadContextRepoMarker, loadSession, loadStackConfig, looksLikeLegacyMasterConfig, parseMarkdownCatalog, partition, readClientState, recordCommandResult, renderCatalogMarkdown, requiresBaseline, requiresRepoContext, rulesForDevType, saveCatalog, saveContextRepoMarker, saveSession, saveStackConfig, suggestedNextStep, updateClientState, writeClientState };
