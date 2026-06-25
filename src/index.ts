/**
 * @devflow-ia/cli — exports públicos.
 * Permite que otras herramientas (skills, tests, plataforma) consuman
 * la lógica core sin invocar el binario.
 */
export * from './types/dev-type.js';
export * from './types/session.js';
export * from './flow-state/detect.js';
export * from './enforcement/rules.js';
export * from './enforcement/evaluator.js';
export * from './utils/paths.js';
export * from './utils/session-io.js';

// Contrato JSON (S1-9, D-7/D-8 Parte 3) — consumido por skills, CI, tests.
export * from './utils/error-codes.js';
export * from './utils/json-output.js';
export * from './utils/client-state.js';

// StackConfig (S1-1 / B.3 Apéndice) — master config del cliente en context repo.
export * from './types/stack-config.js';

// Catalog (S1-2 / B.2 Apéndice) — YAML canónico de apps, markdown derivado.
export * from './types/catalog.js';

// ContextRepo (S2-3 / B.1 Apéndice) — marcador del context repo + auditoría.
export * from './types/context-repo.js';

// Provider abstraction (S1-8 / D-6 Parte 3) — GitLab + GitHub unificados.
export * from './providers/types.js';
export { GitLabProvider } from './providers/gitlab.js';
export { GitHubProvider } from './providers/github.js';
export { createProvider, inferProviderType } from './providers/factory.js';

export const CLI_VERSION = '0.5.1';
