/**
 * @devflow-ia/cli — exports públicos.
 * Permite que otras herramientas (skills, tests, plataforma) consuman
 * la lógica core sin invocar el binario.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * S4-7: lee la versión dinámicamente del package.json.
 * Resuelve A-2 del rediseño: antes había `CLI_VERSION = '0.5.1'`
 * hardcoded que drifteaba del package.json cuando se bumpeaba.
 *
 * Busca el package.json relativo a este módulo. Soporta:
 *   - dev (src/index.ts)      → ../package.json
 *   - prod build (dist/...)   → ../package.json
 *   - bundled (dist/bin/...)  → ../../package.json
 */
function readPkgVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../package.json'),
      path.resolve(here, '../../package.json'),
      path.resolve(here, '../../../package.json'),
    ];
    for (const c of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(c, 'utf-8')) as { version?: string };
        if (typeof pkg.version === 'string') return pkg.version;
      } catch { /* try next */ }
    }
  } catch { /* fallback */ }
  return '0.0.0-unknown';
}

export const CLI_VERSION = readPkgVersion();
