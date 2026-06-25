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
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

// ── Schema ────────────────────────────────────────────────────────────

export const ContextRepoSchema = z.object({
  kind: z.literal('context-repo'),
  schema_version: z.string().default('1.1'),
  client: z.object({
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
  }),
  provider: z.object({
    type: z.enum(['gitlab', 'github']),
    base_url: z.string().url(),
    group_or_org: z.string().min(1),
  }).optional(),
  generated_by: z.string().default('/devflow-ia:client-onboard'),
  last_generated_at: z.string(),
  cli_version: z.string(),
  discovery_source: z.object({
    type: z.literal('provider-api').default('provider-api'),
    ref: z.string().default('HEAD'),
  }).optional(),
  checksums: z.record(z.string(), z.string()).optional(),
});

export type ContextRepoMarker = z.infer<typeof ContextRepoSchema>;

// ── Paths ────────────────────────────────────────────────────────────

const MARKER_DIR = '.devflow-context';
const MARKER_FILENAME = '.context-repo.yml';

export function getContextRepoMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, MARKER_DIR, MARKER_FILENAME);
}

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
export function isContextRepo(repoRoot: string): boolean {
  if (existsSync(getContextRepoMarkerPath(repoRoot))) return true;

  const contextDir = path.join(repoRoot, MARKER_DIR);
  if (!existsSync(contextDir)) return false;

  // Cualquiera de estos archivos dentro de .devflow-context/ es prueba suficiente.
  const evidenceFiles = ['stack.yml', 'catalog.yml', 'app-catalog.md', 'client-assessment.md'];
  for (const f of evidenceFiles) {
    if (existsSync(path.join(contextDir, f))) return true;
  }

  // Heurística legacy: tiene .devflow-context/ pero no .devflow/config.yml
  const projectConfig = path.join(repoRoot, '.devflow', 'config.yml');
  return !existsSync(projectConfig);
}

// ── I/O ──────────────────────────────────────────────────────────────

export function loadContextRepoMarker(repoRoot: string): ContextRepoMarker | null {
  const p = getContextRepoMarkerPath(repoRoot);
  if (!existsSync(p)) return null;

  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = ContextRepoSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`.context-repo.yml inválido en ${p}:\n${result.error.message}`);
  }
  return result.data;
}

export function saveContextRepoMarker(repoRoot: string, marker: ContextRepoMarker): void {
  const dir = path.join(repoRoot, MARKER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const validated = ContextRepoSchema.parse(marker);
  const yamlStr = yaml.dump(validated, { indent: 2, lineWidth: 120 });
  writeFileSync(getContextRepoMarkerPath(repoRoot), yamlStr, 'utf-8');
}
