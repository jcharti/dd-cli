/**
 * `dd-cli health` — estado de salud del entorno DevFlow IA.
 *
 * Chequea 3 capas:
 *   1. Máquina:   CLI version, statusline, Claude Code, skills
 *   2. Clientes:  registro, credenciales, contexto clonado, último sync
 *   3. Proyecto:  init hecho, cliente conectado, sesión activa
 *
 * Flags:
 *   --client <slug>   chequea solo ese cliente
 *   --check-api       prueba la conexión a la API git (lento, off by default)
 *   --json            output JSON para scripts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getClaudeHome,
  getClaudeGlobalSettingsPath,
  getClaudeSkillsDir,
  findDevFlowProjectRoot,
  isClaudeCodeInstalled,
} from '../utils/paths.js';
import { loadRegistry } from '../types/registry.js';
import { loadCredentials } from '../types/credentials.js';
import { loadProjectConfig } from '../types/project-config.js';
import { loadCatalog, hasCatalog } from '../types/catalog.js';
import { loadSession } from '../utils/session-io.js';
import { CLI_VERSION } from '../index.js';
import { isJsonMode, jsonSuccess, emitJson } from '../utils/json-output.js';
import {
  bold, ok, warn, err, dim, info, devTypeBadge,
  printOk, printWarn, printErr, printInfo, printDim,
} from '../utils/output.js';

export interface HealthOptions {
  client?: string;
  checkApi?: boolean;
  json?: boolean;
}

// ── Helpers de display ─────────────────────────────────────────────

function check(label: string, status: 'ok' | 'warn' | 'err' | 'skip', detail: string): void {
  const icons = { ok: ok('✓'), warn: warn('⚠'), err: err('✗'), skip: dim('·') };
  const icon = icons[status];
  const labelPad = label.padEnd(16);
  console.log(`  ${icon}  ${labelPad}${detail}`);
}

function header(title: string): void {
  console.log('');
  console.log(bold(`  ${title}`));
  console.log(dim('  ' + '─'.repeat(52)));
}

function formatAge(isoDate: string | null): string {
  if (!isoDate) return 'nunca sincronizado';
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

// ── Chequeo de skills ──────────────────────────────────────────────

/**
 * S4-7: cuenta skills recursivamente (incluye opsx/* y futuros subdirectorios).
 * Antes contaba sólo top-level — reportaba "16 skills" cuando hay 22.
 */
function countSkills(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        count += countSkills(full);
      } else if (entry.endsWith('.md')) {
        count++;
      }
    } catch { /* skip */ }
  }
  return count;
}

function checkSkills(): { status: 'ok' | 'warn' | 'err'; detail: string } {
  const skillsDir = getClaudeSkillsDir();
  if (!existsSync(skillsDir)) {
    return { status: 'err', detail: `no instaladas — ejecuta: dd-cli init o dd-cli skills install` };
  }
  const versionFile = path.join(skillsDir, '.version');
  if (!existsSync(versionFile)) {
    return { status: 'warn', detail: `instaladas, sin versión registrada` };
  }
  const installed = readFileSync(versionFile, 'utf-8').trim();
  if (installed !== CLI_VERSION) {
    return { status: 'warn', detail: `v${installed} instalada, v${CLI_VERSION} disponible — ejecuta: dd-cli skills install` };
  }
  const skills = countSkills(skillsDir);
  return { status: 'ok', detail: `${skills} skills · v${installed}` };
}

// ── Chequeo de statusline global ──────────────────────────────────

function checkStatusline(): { status: 'ok' | 'warn'; detail: string } {
  const settingsPath = getClaudeGlobalSettingsPath();
  if (!existsSync(settingsPath)) {
    return { status: 'warn', detail: `no configurada — ejecuta: dd-cli install` };
  }
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const sl = settings.statusLine as { type?: string; command?: string } | undefined;
    if (sl?.type === 'command' && sl.command === 'dd-cli statusline') {
      return { status: 'ok', detail: `activa en ${settingsPath}` };
    }
    return { status: 'warn', detail: `settings.json existe pero statusLine no es de DevFlow IA — ejecuta: dd-cli install` };
  } catch {
    return { status: 'warn', detail: `settings.json inválido` };
  }
}

// ── Chequeo de cliente ─────────────────────────────────────────────

interface ClientHealth {
  slug: string;
  status: 'ok' | 'warn' | 'err';
  issues: string[];
  details: Record<string, string>;
}

function checkClient(slug: string): ClientHealth {
  const registry = loadRegistry();
  const creds = loadCredentials();
  const entry = registry.clients[slug];
  const issues: string[] = [];
  const details: Record<string, string> = {};

  if (!entry) {
    return { slug, status: 'err', issues: ['no registrado — ejecuta: dd-cli register-client'], details };
  }

  // Contexto clonado
  if (!existsSync(entry.local_cache)) {
    issues.push(`contexto no clonado en ${entry.local_cache}`);
  } else {
    details['contexto'] = entry.local_cache;

    // App catalog (S1-2: loadCatalog soporta yml canónico + md legacy)
    if (hasCatalog(entry.local_cache)) {
      try {
        const catalog = loadCatalog(entry.local_cache);
        const appCount = catalog?.apps.length ?? 0;
        details['app catalog'] = `${appCount} apps catalogadas`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push(`catalog inválido — ${msg.split('\n')[0]}`);
      }
    } else {
      issues.push('catalog no encontrado — ejecuta /devflow-ia:init-context');
    }
  }

  // Credenciales
  const clientCreds = creds.clients[slug];
  if (!clientCreds) {
    issues.push('sin credenciales API — agrega --git-token al register-client');
    details['API'] = 'sin credenciales';
  } else {
    details['API'] = `${clientCreds.git_host} · ${clientCreds.git_group}`;
  }

  // Última sync
  const age = formatAge(entry.last_synced ?? null);
  const ageMs = entry.last_synced ? Date.now() - new Date(entry.last_synced).getTime() : Infinity;
  const stale = ageMs > 7 * 24 * 60 * 60 * 1000;
  details['última sync'] = age;
  if (stale) issues.push(`contexto desactualizado (${age}) — ejecuta: dd-cli pull-context`);

  const status = issues.length === 0 ? 'ok' : issues.some(i => i.includes('no clonado') || i.includes('no registrado')) ? 'err' : 'warn';
  return { slug, status, issues, details };
}

// ── Chequeo de proyecto actual ─────────────────────────────────────

interface ProjectHealth {
  isDevFlow: boolean;
  projectRoot?: string;
  connectedClient?: string;
  sessionStatus?: string;
}

function checkProject(): ProjectHealth {
  const projectRoot = findDevFlowProjectRoot();
  if (!projectRoot) return { isDevFlow: false };

  // Leer config para cliente conectado — usar loadProjectConfig (B-4 fix)
  let connectedClient: string | undefined;
  try {
    const cfg = loadProjectConfig(projectRoot);
    connectedClient = cfg?.client.slug;
  } catch {
    // Schema inválido — dejar undefined; problema se ve en otra capa
  }

  // Sesión
  let sessionStatus = 'sin sesión activa';
  try {
    const session = loadSession(projectRoot);
    if (session?.started_at && !session.ended_at) {
      const feature = session.feature_id ?? '?';
      const type = session.dev_type ?? '?';
      sessionStatus = `sesión activa · ${feature} · ${devTypeBadge(type)}`;
    } else if (session?.ended_at) {
      sessionStatus = `sesión cerrada · ${session.feature_id ?? '?'}`;
    }
  } catch { /* */ }

  return { isDevFlow: true, projectRoot, connectedClient, sessionStatus };
}

// ── Comando principal ──────────────────────────────────────────────

export async function runHealth(opts: HealthOptions = {}): Promise<number> {
  const registry = loadRegistry();
  const clientSlugs = opts.client
    ? [opts.client]
    : Object.keys(registry.clients);

  // ── JSON mode (S1-9 contrato) ──────────────────────────────────────
  // Bajo D-7/D-8, este es el output que las skills consumen.
  // Estructura estable; agregar campos al final, no renombrar.
  if (isJsonMode(opts)) {
    const slCheck = checkStatusline();
    const skillsCheck = checkSkills();
    const claudeInstalled = isClaudeCodeInstalled();
    const proj = checkProject();
    const clients = clientSlugs.map(slug => {
      const h = checkClient(slug);
      const entry = registry.clients[slug];
      return {
        slug: h.slug,
        status: h.status,
        registered: !!entry,
        context_cache: entry?.local_cache ?? null,
        last_synced: entry?.last_synced ?? null,
        details: h.details,
        issues: h.issues,
      };
    });
    const anyClientErr = clients.some(c => c.status === 'err');
    const overall =
      slCheck.status !== 'ok' || skillsCheck.status !== 'ok' || anyClientErr || clientSlugs.length === 0
        ? (anyClientErr ? 'err' : 'warn')
        : 'ok';

    emitJson(jsonSuccess('health', {
      cli_version: CLI_VERSION,
      machine: {
        cli: { status: 'ok' as const, version: CLI_VERSION },
        statusline: slCheck,
        claude_code: { installed: claudeInstalled, home: getClaudeHome() },
        skills: skillsCheck,
      },
      clients,
      project: {
        is_devflow: proj.isDevFlow,
        project_root: proj.projectRoot ?? null,
        connected_client: proj.connectedClient ?? null,
        session_status: proj.sessionStatus ?? null,
      },
      overall,
    }));
  }

  console.log('');
  console.log(bold('DevFlow IA — Estado del entorno'));
  console.log(dim(`  v${CLI_VERSION} · ${new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}`));

  // ── Capa 1: Máquina ───────────────────────────────────────────
  header('MÁQUINA');

  check('CLI', 'ok', `v${CLI_VERSION}`);

  const slCheck = checkStatusline();
  check('Statusline', slCheck.status, slCheck.detail);

  if (!isClaudeCodeInstalled()) {
    check('Claude Code', 'err', `no detectado en ${getClaudeHome()}`);
  } else {
    check('Claude Code', 'ok', `${getClaudeHome()}`);
  }

  const skillsCheck = checkSkills();
  check('Skills', skillsCheck.status, skillsCheck.detail);

  // ── Capa 2: Clientes ──────────────────────────────────────────
  header(`CLIENTES REGISTRADOS (${clientSlugs.length})`);

  if (clientSlugs.length === 0) {
    console.log(`  ${warn('⚠')}  Ningún cliente registrado.`);
    console.log(dim(`     Ejecuta: dd-cli register-client <slug> --context-url=<url>`));
  }

  let anyClientErr = false;
  for (const slug of clientSlugs) {
    const health = checkClient(slug);
    const icon = health.status === 'ok' ? ok('✓') : health.status === 'warn' ? warn('⚠') : err('✗');
    console.log('');
    console.log(`  ${icon}  ${bold(slug)}`);
    for (const [key, val] of Object.entries(health.details)) {
      console.log(dim(`       ${key.padEnd(14)}${val}`));
    }
    for (const issue of health.issues) {
      console.log(`       ${warn('→')} ${issue}`);
    }
    if (health.status === 'err') anyClientErr = true;
  }

  // ── Capa 3: Proyecto actual ───────────────────────────────────
  header('PROYECTO ACTUAL');

  const proj = checkProject();
  if (!proj.isDevFlow) {
    check('Proyecto', 'skip', `no es un proyecto DevFlow IA (sin .devflow/)`);
    console.log(dim(`     Si quieres inicializar: dd-cli init [--client=<slug>]`));
  } else {
    check('Proyecto', 'ok', proj.projectRoot ?? '');
    if (proj.connectedClient) {
      const clientOk = registry.clients[proj.connectedClient] !== undefined;
      check('Cliente', clientOk ? 'ok' : 'warn', proj.connectedClient + (clientOk ? '' : ' (no registrado en esta máquina)'));
    } else {
      check('Cliente', 'warn', 'no conectado — considera: dd-cli init --client=<slug>');
    }
    check('Sesión', proj.sessionStatus?.startsWith('sesión activa') ? 'ok' : 'skip', proj.sessionStatus ?? '');
  }

  // ── Resumen ────────────────────────────────────────────────────
  console.log('');

  const hasIssues = slCheck.status !== 'ok' || skillsCheck.status !== 'ok' || anyClientErr || clientSlugs.length === 0;
  if (!hasIssues) {
    console.log(`  ${ok('✓')}  ${bold('Todo listo.')} Puedes arrancar con: dd-cli start-session <HDU-id>`);
  } else {
    printInfo('Hay configuraciones pendientes. Revisa los ⚠ y ✗ arriba.');
    console.log(dim('  dd-cli health --check-api  para verificar la conexión a las APIs git'));
  }
  console.log('');

  return hasIssues ? 1 : 0;
}
