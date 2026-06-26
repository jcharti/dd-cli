/**
 * Namespace `dd-cli sprint` (S7-5) — gestión de sprints sobre el context
 * repo del cliente.
 *
 * Sub-comandos v0.7 (mínimo viable):
 *   sprint new --client=<slug> --duration=14d [--goal="..."]
 *   sprint show [--client=<slug>] [--id=<SPRINT-N>]
 *   sprint add <HDU-id> [--sprint=<SPRINT-N>]
 *   sprint remove <HDU-id> [--sprint=<SPRINT-N>]
 *   sprint close [--id=<SPRINT-N>]
 *   sprint burndown [--sprint=<SPRINT-N>]
 *
 * El scoring de hdu next ya considera membership en sprint activo
 * (factor 8 puntos) — esto solo gestiona el YAML.
 */
import { existsSync } from 'node:fs';
import { getClient, getClientCacheDir } from '../types/registry.js';
import {
  loadSprint, saveSprint, listSprints, nextSprintId,
  loadCurrentSprint, saveCurrentSprint,
  SprintSchema, type Sprint,
} from '../types/sprint.js';
import { listHdus, readTransitions } from '../types/hdu.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface SprintBaseOpts extends JsonModeOpts {
  client?: string;
}

function resolveCacheDir(slug?: string): { ok: true; cacheDir: string; slug: string } | { ok: false; err: { code: 'INVALID_INPUT' | 'CLIENT_NOT_REGISTERED' | 'CONTEXT_CACHE_MISSING'; message: string } } {
  if (!slug) {
    return { ok: false, err: { code: 'INVALID_INPUT', message: 'Falta --client=<slug>.' } };
  }
  const entry = getClient(slug);
  if (!entry) {
    return { ok: false, err: { code: 'CLIENT_NOT_REGISTERED', message: `Cliente "${slug}" no registrado.` } };
  }
  const cacheDir = getClientCacheDir(slug);
  if (!existsSync(cacheDir)) {
    return { ok: false, err: { code: 'CONTEXT_CACHE_MISSING', message: `Cache local no encontrada para "${slug}".` } };
  }
  return { ok: true, cacheDir, slug };
}

function parseDurationDays(d: string): number | null {
  const m = d.match(/^(\d+)d$/);
  return m ? Number.parseInt(m[1] ?? '0', 10) : null;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return (date.toISOString().split('T')[0] ?? dateStr);
}

// ── sprint new ──────────────────────────────────────────────────────

export interface SprintNewOpts extends SprintBaseOpts {
  duration?: string;        // ej: 14d
  goal?: string;
  start?: string;            // YYYY-MM-DD, default hoy
  createdBy?: string;
}

export async function runSprintNew(opts: SprintNewOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'sprint new', ...r.err }));
    printErr(r.err.message);
    return r.err.code === 'INVALID_INPUT' ? 3 : 2;
  }

  const duration = opts.duration ?? '14d';
  const days = parseDurationDays(duration);
  if (days === null || days <= 0) {
    const e = { code: 'INVALID_INPUT' as const, message: `--duration=${duration} inválido. Usá formato Nd (ej: 14d).` };
    if (jsonMode) emitJson(jsonError({ command: 'sprint new', ...e }));
    printErr(e.message);
    return 3;
  }

  const start = opts.start ?? new Date().toISOString().split('T')[0] ?? '';
  const end = addDays(start, days);
  const id = nextSprintId(r.cacheDir);

  const sprint: Sprint = SprintSchema.parse({
    id,
    client: r.slug,
    start,
    end,
    hdus: [],
    goal: opts.goal ?? null,
    created_by: opts.createdBy,
    created_at: new Date().toISOString(),
  });

  saveSprint(r.cacheDir, sprint);
  // Set como current
  saveCurrentSprint(r.cacheDir, { client: r.slug, current_sprint: id });

  if (jsonMode) {
    emitJson(jsonSuccess('sprint new', { id, start, end, duration_days: days }));
  }

  printOk(`Sprint ${bold(id)} creado para ${r.slug}.`);
  printDim(`  rango:  ${start} → ${end}  (${days} días)`);
  if (opts.goal) printDim(`  goal:   ${opts.goal}`);
  printDim(`  current_sprint apuntando a ${id}`);
  return 0;
}

// ── sprint show ─────────────────────────────────────────────────────

export interface SprintShowOpts extends SprintBaseOpts {
  id?: string;             // si no se pasa, usa el current
}

export async function runSprintShow(opts: SprintShowOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'sprint show', ...r.err }));
    printErr(r.err.message);
    return r.err.code === 'INVALID_INPUT' ? 3 : 2;
  }

  let id = opts.id;
  if (!id) {
    const current = loadCurrentSprint(r.cacheDir);
    if (!current) {
      if (jsonMode) emitJson(jsonSuccess('sprint show', { current_sprint: null, sprint: null }));
      printDim('  Sin sprint actual. Creá uno: dd-cli sprint new --client=' + r.slug);
      return 0;
    }
    id = current.current_sprint;
  }

  const sprint = loadSprint(r.cacheDir, id);
  if (!sprint) {
    const e = { code: 'INVALID_INPUT' as const, message: `Sprint "${id}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: 'sprint show', ...e }));
    printErr(e.message);
    return 3;
  }

  // Status de cada HDU del sprint
  const hdus = listHdus(r.cacheDir);
  const hduStatus = sprint.hdus.map(hduId => {
    const h = hdus.find(x => x.frontmatter.id === hduId);
    return {
      id: hduId,
      title: h?.frontmatter.title ?? '(no encontrada)',
      status: h?.frontmatter.status ?? 'unknown',
      assigned_to: h?.frontmatter.assigned_to ?? null,
    };
  });

  if (jsonMode) {
    emitJson(jsonSuccess('sprint show', { ...sprint, hdus_detail: hduStatus }));
  }

  console.log('');
  console.log(`  ${bold(sprint.id)}    ${bold(sprint.client)}`);
  printDim(`  rango:  ${sprint.start} → ${sprint.end}`);
  if (sprint.goal) printDim(`  goal:   ${sprint.goal}`);
  console.log('');
  console.log(bold(`  HDUs (${hduStatus.length})`));
  if (hduStatus.length === 0) {
    printDim('  (ninguna asignada al sprint todavía)');
  } else {
    for (const h of hduStatus) {
      const assignee = h.assigned_to ? ` → ${h.assigned_to}` : '';
      console.log(`    ${bold(h.id.padEnd(10))} ${h.status.padEnd(13)} ${h.title}${assignee}`);
    }
  }
  return 0;
}

// ── sprint add / remove ─────────────────────────────────────────────

export interface SprintAddOpts extends SprintBaseOpts {
  sprint?: string;          // si no se pasa, usa current
}

export async function runSprintAdd(hduId: string, opts: SprintAddOpts = {}): Promise<number> {
  return mutateSprintHdus('add', hduId, opts);
}

export async function runSprintRemove(hduId: string, opts: SprintAddOpts = {}): Promise<number> {
  return mutateSprintHdus('remove', hduId, opts);
}

async function mutateSprintHdus(action: 'add' | 'remove', hduId: string, opts: SprintAddOpts): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: `sprint ${action}`, ...r.err }));
    printErr(r.err.message);
    return r.err.code === 'INVALID_INPUT' ? 3 : 2;
  }
  if (!hduId) {
    const e = { code: 'INVALID_INPUT' as const, message: `Uso: dd-cli sprint ${action} <HDU-id> --client=<slug> [--sprint=<SPRINT-N>]` };
    if (jsonMode) emitJson(jsonError({ command: `sprint ${action}`, ...e }));
    printErr(e.message);
    return 3;
  }

  let sprintId = opts.sprint;
  if (!sprintId) {
    const current = loadCurrentSprint(r.cacheDir);
    if (!current) {
      const e = { code: 'INVALID_INPUT' as const, message: 'No hay sprint activo. Pasá --sprint=<id> o creá uno: dd-cli sprint new.' };
      if (jsonMode) emitJson(jsonError({ command: `sprint ${action}`, ...e }));
      printErr(e.message);
      return 3;
    }
    sprintId = current.current_sprint;
  }

  const sprint = loadSprint(r.cacheDir, sprintId);
  if (!sprint) {
    const e = { code: 'INVALID_INPUT' as const, message: `Sprint "${sprintId}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: `sprint ${action}`, ...e }));
    printErr(e.message);
    return 3;
  }

  // Validar que la HDU exista
  const hdus = listHdus(r.cacheDir);
  const hdu = hdus.find(h => h.frontmatter.id === hduId);
  if (!hdu) {
    const e = { code: 'HDU_NOT_FOUND' as const, message: `HDU "${hduId}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: `sprint ${action}`, ...e }));
    printErr(e.message);
    return 2;
  }

  const wasIn = sprint.hdus.includes(hduId);
  if (action === 'add') {
    if (wasIn) {
      printDim(`  ${hduId} ya estaba en ${sprintId}.`);
      return 0;
    }
    sprint.hdus.push(hduId);
    // También actualizar el frontmatter de la HDU
    hdu.frontmatter.sprint = sprintId;
  } else {
    if (!wasIn) {
      printDim(`  ${hduId} no estaba en ${sprintId}.`);
      return 0;
    }
    sprint.hdus = sprint.hdus.filter(id => id !== hduId);
    if (hdu.frontmatter.sprint === sprintId) {
      hdu.frontmatter.sprint = null;
    }
  }
  saveSprint(r.cacheDir, sprint);
  // Persistir cambio en la HDU
  const { saveHdu } = await import('../types/hdu.js');
  saveHdu(r.cacheDir, hdu);

  if (jsonMode) {
    emitJson(jsonSuccess(`sprint ${action}`, { sprint: sprintId, hdu: hduId, total_hdus: sprint.hdus.length }));
  }

  printOk(`${action === 'add' ? 'Agregada' : 'Removida'} ${bold(hduId)} ${action === 'add' ? 'al' : 'del'} ${bold(sprintId)} (${sprint.hdus.length} HDUs total).`);
  return 0;
}

// ── sprint close ────────────────────────────────────────────────────

export interface SprintCloseOpts extends SprintBaseOpts {
  id?: string;
}

export async function runSprintClose(opts: SprintCloseOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'sprint close', ...r.err }));
    printErr(r.err.message);
    return r.err.code === 'INVALID_INPUT' ? 3 : 2;
  }

  let id = opts.id;
  if (!id) {
    const current = loadCurrentSprint(r.cacheDir);
    if (!current) {
      const e = { code: 'INVALID_INPUT' as const, message: 'No hay sprint activo para cerrar.' };
      if (jsonMode) emitJson(jsonError({ command: 'sprint close', ...e }));
      printErr(e.message);
      return 3;
    }
    id = current.current_sprint;
  }

  const sprint = loadSprint(r.cacheDir, id);
  if (!sprint) {
    const e = { code: 'INVALID_INPUT' as const, message: `Sprint "${id}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: 'sprint close', ...e }));
    printErr(e.message);
    return 3;
  }

  // Calcular cierre: HDUs done + open al cerrar
  const hdus = listHdus(r.cacheDir);
  const hdusInSprint = hdus.filter(h => sprint.hdus.includes(h.frontmatter.id));
  const done = hdusInSprint.filter(h => h.frontmatter.status === 'done').length;
  const open = hdusInSprint.length - done;

  // Limpiar current si apuntaba a este
  const current = loadCurrentSprint(r.cacheDir);
  if (current && current.current_sprint === id) {
    // Sin sprint nuevo, dejar archivo intacto pero "vaciar" el campo current
    // Mejor: borrar para que loadCurrentSprint retorne null
    const { clearCurrentSprint } = await import('../types/sprint.js');
    clearCurrentSprint(r.cacheDir);
  }

  if (jsonMode) {
    emitJson(jsonSuccess('sprint close', {
      id,
      hdus_total: hdusInSprint.length,
      hdus_done: done,
      hdus_open: open,
      completion_rate: hdusInSprint.length === 0 ? 0 : done / hdusInSprint.length,
    }));
  }

  console.log('');
  printOk(`${bold(id)} cerrado.`);
  console.log('');
  console.log(bold('  Cierre'));
  console.log(`    HDUs total:     ${hdusInSprint.length}`);
  console.log(`    cerradas:       ${done}`);
  console.log(`    abiertas:       ${open}`);
  if (hdusInSprint.length > 0) {
    console.log(`    completion:     ${((done / hdusInSprint.length) * 100).toFixed(0)}%`);
  }
  console.log('');
  return 0;
}

// ── sprint burndown ─────────────────────────────────────────────────

export interface SprintBurndownOpts extends SprintBaseOpts {
  sprint?: string;
}

export async function runSprintBurndown(opts: SprintBurndownOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const r = resolveCacheDir(opts.client);
  if (!r.ok) {
    if (jsonMode) emitJson(jsonError({ command: 'sprint burndown', ...r.err }));
    printErr(r.err.message);
    return r.err.code === 'INVALID_INPUT' ? 3 : 2;
  }

  let id = opts.sprint;
  if (!id) {
    const current = loadCurrentSprint(r.cacheDir);
    if (!current) {
      const e = { code: 'INVALID_INPUT' as const, message: 'No hay sprint activo.' };
      if (jsonMode) emitJson(jsonError({ command: 'sprint burndown', ...e }));
      printErr(e.message);
      return 3;
    }
    id = current.current_sprint;
  }

  const sprint = loadSprint(r.cacheDir, id);
  if (!sprint) {
    const e = { code: 'INVALID_INPUT' as const, message: `Sprint "${id}" no existe.` };
    if (jsonMode) emitJson(jsonError({ command: 'sprint burndown', ...e }));
    printErr(e.message);
    return 3;
  }

  const startMs = new Date(sprint.start).getTime();
  const endMs = new Date(sprint.end).getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));

  // Para cada día del sprint, contar HDUs done hasta esa fecha
  const transitions = readTransitions(r.cacheDir);
  const totalHdus = sprint.hdus.length;
  const burndown: Array<{ day: number; date: string; remaining: number; ideal: number }> = [];

  for (let d = 0; d <= totalDays; d++) {
    const cutoff = startMs + d * 86_400_000;
    let doneCount = 0;
    for (const hduId of sprint.hdus) {
      const lastDone = transitions
        .filter(t => t.hdu === hduId && t.to === 'done')
        .map(t => new Date(t.ts).getTime())
        .filter(ts => ts <= cutoff)
        .pop();
      if (lastDone) doneCount++;
    }
    const remaining = totalHdus - doneCount;
    const ideal = totalDays === 0 ? 0 : Math.max(0, totalHdus - Math.round((totalHdus * d) / totalDays));
    burndown.push({
      day: d,
      date: (new Date(cutoff).toISOString().split('T')[0] ?? ''),
      remaining,
      ideal,
    });
  }

  if (jsonMode) {
    emitJson(jsonSuccess('sprint burndown', {
      sprint: id,
      total_days: totalDays,
      total_hdus: totalHdus,
      burndown,
    }));
  }

  console.log('');
  console.log(`  ${bold(`Burndown ${id}`)}    ${sprint.start} → ${sprint.end}`);
  console.log('');
  console.log(`  HDUs total: ${totalHdus}`);
  console.log('');
  if (totalHdus === 0) {
    printDim('  (sprint sin HDUs)');
    return 0;
  }
  // Render ASCII simple
  const maxBarLen = 30;
  console.log(bold(`  día   fecha       remaining  ideal`));
  for (const point of burndown) {
    const barLen = Math.round((point.remaining / totalHdus) * maxBarLen);
    const bar = '█'.repeat(Math.max(0, barLen));
    const idealMarker = '·'.repeat(Math.max(0, Math.round((point.ideal / totalHdus) * maxBarLen)));
    console.log(`  ${point.day.toString().padStart(3)}   ${point.date}  ${bar.padEnd(maxBarLen)} ${point.remaining.toString().padStart(2)} / ideal ${point.ideal}`);
  }
  console.log('');
  return 0;
}
