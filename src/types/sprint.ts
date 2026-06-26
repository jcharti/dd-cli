/**
 * Sprints como YAML simple (S7-5 / H-5 del rediseño).
 *
 * Vive en `<cliente>-devflow-context/sprints/`:
 *   _current.yml         apunta al sprint activo
 *   SPRINT-NN.yml        un YAML por sprint (lista de HDU IDs + capacity + fechas)
 *   SPRINT-NN-NN.yml     históricos
 *
 * Apéndice B.8 + B.9 del doc rediseño.
 *
 * Decisión: implementación mínima viable v0.7. El scoring por dev_type
 * en hdu next ya considera membership en sprint (S5-3); este módulo solo
 * gestiona el YAML.
 */
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { DEV_TYPES } from './dev-type.js';

// ── Schema ────────────────────────────────────────────────────────────

export const SprintCapacitySchema = z.object({
  total: z.number().int().nonnegative(),       // días-dev
  by_dev_type: z.record(z.enum(DEV_TYPES), z.number().int().nonnegative()).default({}),
});

export const SprintSchema = z.object({
  schema_version: z.literal('1.0').default('1.0'),
  id: z.string().regex(/^SPRINT-\d+$/, 'Debe ser SPRINT-NN'),
  client: z.string(),
  start: z.string(),                            // YYYY-MM-DD
  end: z.string(),
  capacity: SprintCapacitySchema.optional(),
  hdus: z.array(z.string()).default([]),         // HDU IDs
  goal: z.string().nullable().default(null),
  created_by: z.string().email().optional(),
  created_at: z.string().optional(),
});
export type Sprint = z.infer<typeof SprintSchema>;

export const SprintCurrentSchema = z.object({
  client: z.string(),
  current_sprint: z.string(),                    // SPRINT-NN
});
export type SprintCurrent = z.infer<typeof SprintCurrentSchema>;

// ── Paths ────────────────────────────────────────────────────────────

const SPRINTS_DIR = 'sprints';
const CURRENT_FILE = '_current.yml';

export function getSprintsDir(contextRepoRoot: string): string {
  return path.join(contextRepoRoot, SPRINTS_DIR);
}

export function getSprintPath(contextRepoRoot: string, id: string): string {
  return path.join(getSprintsDir(contextRepoRoot), `${id}.yml`);
}

export function getSprintCurrentPath(contextRepoRoot: string): string {
  return path.join(getSprintsDir(contextRepoRoot), CURRENT_FILE);
}

// ── I/O ──────────────────────────────────────────────────────────────

export function loadSprint(contextRepoRoot: string, id: string): Sprint | null {
  const p = getSprintPath(contextRepoRoot, id);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = SprintSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${id}.yml inválido en ${p}:\n${result.error.message}`);
  }
  return result.data;
}

export function saveSprint(contextRepoRoot: string, sprint: Sprint): void {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const validated = SprintSchema.parse(sprint);
  writeFileSync(getSprintPath(contextRepoRoot, sprint.id), yaml.dump(validated, { indent: 2 }), 'utf-8');
}

export function loadCurrentSprint(contextRepoRoot: string): SprintCurrent | null {
  const p = getSprintCurrentPath(contextRepoRoot);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf-8');
  const parsed = yaml.load(raw);
  const result = SprintCurrentSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export function saveCurrentSprint(contextRepoRoot: string, current: SprintCurrent): void {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSprintCurrentPath(contextRepoRoot), yaml.dump(current, { indent: 2 }), 'utf-8');
}

export function clearCurrentSprint(contextRepoRoot: string): void {
  const p = getSprintCurrentPath(contextRepoRoot);
  if (existsSync(p)) {
    const fs = require('node:fs') as typeof import('node:fs');
    fs.unlinkSync(p);
  }
}

export function listSprints(contextRepoRoot: string): Sprint[] {
  const dir = getSprintsDir(contextRepoRoot);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(f => /^SPRINT-\d+\.yml$/.test(f));
  return files
    .map(f => {
      try {
        return loadSprint(contextRepoRoot, f.replace(/\.yml$/, ''));
      } catch {
        return null;
      }
    })
    .filter((s): s is Sprint => s !== null);
}

export function nextSprintId(contextRepoRoot: string): string {
  const sprints = listSprints(contextRepoRoot);
  const ids = sprints
    .map(s => s.id.match(/^SPRINT-(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => Number.parseInt(m[1] ?? '0', 10));
  const next = ids.length === 0 ? 1 : Math.max(...ids) + 1;
  return `SPRINT-${next}`;
}
