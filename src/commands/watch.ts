/**
 * `dd-cli watch [--interval N]`
 *
 * Barra de estado de 3 líneas en el pane actual. Refresh configurable.
 * Corre hasta Ctrl+C, que restaura el cursor limpiamente.
 *
 * Línea 1: feature + spec activa
 * Línea 2: tasks + duración + modo
 * Línea 3: tipo + próximo paso o anomalía
 *
 * Referencia: dd-cli-spec.md §3.4 · wireframes/cli-ux-decisiones.md §Superficie 1
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot, getDevflowDir } from '../utils/paths.js';
import { loadSession } from '../utils/session-io.js';
import { detectFlowState } from '../flow-state/detect.js';
import { getStageContext } from '../flow-state/flow-stages.js';
import { evaluateRules, partition } from '../enforcement/evaluator.js';
import { devTypeBadge } from '../utils/output.js';

export interface WatchOptions {
  intervalSeconds?: number;
  noColor?: boolean;
}

const isTTY = process.stdout.isTTY;

const c = {
  reset:   '\x1b[0m',
  bold:    (s: string) => isTTY ? `\x1b[1m${s}\x1b[0m` : s,
  green:   (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  cyan:    (s: string) => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  dim:     (s: string) => isTTY ? `\x1b[90m${s}\x1b[0m` : s,
  yellow:  (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
};

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return '?';
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

function progressBar(done: number, total: number, width = 12): string {
  if (total === 0) return '─'.repeat(width);
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function activeChangeName(projectRoot: string): string | null {
  try {
    const changes = path.join(projectRoot, 'openspec', 'changes');
    if (!existsSync(changes)) return null;
    const entries = readdirSync(changes).filter((e: string) => {
      return statSync(path.join(changes, e)).isDirectory() &&
             existsSync(path.join(changes, e, 'tasks.md'));
    });
    return entries[0] ?? null;
  } catch { return null; }
}

function countTasks(projectRoot: string, changeName: string): { done: number; total: number } {
  try {
    const content = readFileSync(path.join(projectRoot, 'openspec', 'changes', changeName, 'tasks.md'), 'utf-8');
    const total = (content.match(/^- \[[ x]\]/gm) ?? []).length;
    const done  = (content.match(/^- \[x\]/gm) ?? []).length;
    return { done, total };
  } catch { return { done: 0, total: 0 }; }
}

function renderLines(projectRoot: string): string[] {
  const W = 78; // ancho de la caja

  let session;
  try {
    session = loadSession(projectRoot);
  } catch { return buildBox(['DevFlow IA', 'sin sesión'], W); }

  if (!session || !session.started_at) {
    return buildBox([
      `${c.bold('DevFlow IA')}  ·  sin sesión activa`,
      `Ejecuta: ${c.cyan('dd-cli start-session <HDU-id>')}`,
      '',
    ], W);
  }

  const flowState = detectFlowState({ projectRoot, session });
  const ctx = session.dev_type ? getStageContext(session, flowState) : null;
  const feature = `${session.feature_id ?? '?'} · ${session.feature_name ?? ''}`;

  // Línea 1 — contexto
  const changeName = activeChangeName(projectRoot);
  const specPart = changeName ? `spec: ${c.cyan(changeName)}` : c.dim('spec: pendiente');
  const line1 = `${c.bold('DevFlow IA')} ${c.dim('│')} ${feature} ${c.dim('│')} ${specPart}`;

  // Línea 2 — progreso
  const duration = formatDuration(session.started_at);
  const mode = session.mode === 'platform' ? `${c.green('●')} platform` : c.dim('local');
  let taskPart = c.dim('tasks: —');
  if (changeName) {
    const { done, total } = countTasks(projectRoot, changeName);
    const bar = progressBar(done, total);
    taskPart = `tasks: ${c.green(bar)}  ${done}/${total}`;
  }
  const line2 = `${taskPart}  ${c.dim('│')}  ${c.yellow('⏱')} ${duration}  ${c.dim('│')}  ${mode}`;

  // Línea 3 — tipo + next step o anomalía
  const badge = devTypeBadge(session.dev_type);
  const results = evaluateRules({ projectRoot, session });
  const { blockers } = partition(results);
  let line3: string;

  if (blockers.length > 0) {
    const hint = extractHint(blockers[0]!.message);
    line3 = `${badge}  ${c.yellow('⚠')} ${hint}`;
  } else if (ctx?.currentStage) {
    const step = `paso ${ctx.currentIndex}/${ctx.total}: ${ctx.currentStage.id}`;
    const next = ctx.nextStage ? ` ${c.dim('→')} ${ctx.nextStage.id}` : '';
    line3 = `${badge}  ${c.dim(step)}${next}`;
  } else {
    line3 = `${badge}  ${c.dim(flowState)}`;
  }

  return buildBox([line1, line2, line3], W);
}

function extractHint(msg: string): string {
  if (msg.includes('REPO-CONTEXT')) return c.cyan('/init-repo-context');
  if (msg.includes('BASELINE'))     return c.cyan('/capture-baseline');
  if (msg.includes('legacy_system')) return 'completa legacy_system en HDU';
  if (msg.includes('vendor'))        return 'completa vendor en HDU';
  return 'precondición pendiente';
}

function buildBox(lines: string[], width: number): string[] {
  const hr = '═'.repeat(width);
  const out: string[] = [`╔${hr}╗`];
  for (const line of lines) {
    const visible = stripAnsi(line);
    const pad = Math.max(0, width - visible.length - 2);
    out.push(`║ ${line}${' '.repeat(pad)} ║`);
  }
  out.push(`╚${hr}╝`);
  return out;
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export async function runWatch(opts: WatchOptions = {}): Promise<void> {
  const interval = (opts.intervalSeconds ?? 5) * 1000;
  const projectRoot = getProjectRoot();

  if (!isTTY) {
    // Sin TTY — modo CI, imprimir una vez y salir
    renderLines(projectRoot).forEach(l => console.log(l));
    return;
  }

  // Ocultar cursor
  process.stdout.write('\x1B[?25l');

  const cleanup = (): void => {
    process.stdout.write('\x1B[?25h\n'); // restaurar cursor
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  let firstRender = true;
  const LINE_COUNT = 5; // 3 contenido + 2 bordes

  const render = (): void => {
    const lines = renderLines(projectRoot);
    if (!firstRender) {
      // Subir N líneas y sobreescribir
      process.stdout.write(`\x1B[${LINE_COUNT}A\r`);
    }
    lines.forEach(l => process.stdout.write(l + '\n'));
    firstRender = false;
  };

  render();
  const timer = setInterval(render, interval);

  // Mantener proceso vivo
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => { clearInterval(timer); cleanup(); resolve(); });
  });
}
