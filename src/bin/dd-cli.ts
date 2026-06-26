/**
 * dd-cli — binario principal.
 * Dispatcher con commander hacia los comandos.
 */
import { Command } from 'commander';
import { CLI_VERSION } from '../index.js';
import { runInit } from '../commands/init.js';
import { runStatus } from '../commands/status-cmd.js';
import { runEndSession } from '../commands/end-session.js';
import { runStatusline } from '../commands/statusline.js';
import { runStartSession } from '../commands/start-session-cmd.js';
import { runNext } from '../commands/next-cmd.js';
import { runHeartbeat } from '../commands/heartbeat.js';
import { runSkillsList, runSkillsVerify, runSkillsInstall } from '../commands/skills-cmd.js';
import { runHelp } from '../commands/help-cmd.js';
import { runReclassifyCmd } from '../commands/reclassify-cmd.js';
import { runRegisterClient } from '../commands/register-client.js';
import { runInitClient } from '../commands/init-client.js';
import { runPullContext } from '../commands/pull-context.js';
import { runDoctorCmd } from '../commands/doctor-cmd.js';
import { runWatch } from '../commands/watch.js';
import { runInstall, runUninstall } from '../commands/install-cmd.js';
import { runFlow } from '../commands/flow-cmd.js';
import { runNewHdu } from '../commands/new-hdu-cmd.js';
import { runHealth } from '../commands/health-cmd.js';
import { runClientMigrate } from '../commands/client-migrate.js';
import { runClientDiscover } from '../commands/client-discover.js';
import { runContextValidate } from '../commands/context-validate.js';
import { runContextRender } from '../commands/context-render.js';
import { runContextInstallCi } from '../commands/context-install-ci.js';
import { runClientNew } from '../commands/client-new.js';
import { runClientPublish } from '../commands/client-publish.js';
import { runClientShow } from '../commands/client-show.js';
import { runClientList, runHome } from '../commands/client-list.js';
import { runClientRefresh } from '../commands/client-refresh.js';
import { runClientOnboardDev } from '../commands/client-onboard-dev.js';
import { runClientCompare } from '../commands/client-compare.js';
import { runErrorCodes } from '../commands/error-codes-cmd.js';
import {
  runHduNew, runHduList, runHduShow,
  runHduStart, runHduReview, runHduApprove, runHduClose, runHduCancel,
  runHduAssign, runHduClaim, runHduPin, runHduIndexCmd,
} from '../commands/hdu-cmd.js';
import { runHduNext } from '../commands/hdu-next.js';
import { runHduApplyMerge } from '../commands/hdu-apply-merge.js';
import { runStats } from '../commands/stats-cmd.js';
import {
  runSprintNew, runSprintShow, runSprintAdd, runSprintRemove,
  runSprintClose, runSprintBurndown,
} from '../commands/sprint-cmd.js';
import { runGuide } from '../commands/guide-cmd.js';
import { runToday } from '../commands/today-cmd.js';
import { runInbox, runInboxAdd } from '../commands/inbox-cmd.js';
import {
  runTelemetryEnable, runTelemetryDisable,
  runTelemetryStatus, runTelemetryReport, runTelemetryPurge,
} from '../commands/telemetry-cmd.js';
import { isContextRepo } from '../types/context-repo.js';
import { recordTelemetry, hashUser, isTelemetryEnabled } from '../utils/telemetry.js';

const program = new Command();

program
  .name('dd-cli')
  .description('DevFlow IA — CLI oficial · bridge local entre Claude Code y la plataforma')
  .version(CLI_VERSION);

// ── Telemetría: hook global (S7-1) ─────────────────────────────────
// Captura el comando, tiempo y exit code de cada invocación si la
// telemetría está habilitada. NO-OP si está OFF (chequeo barato).
//
// Como cada `action` llama `process.exit()`, usamos preAction para
// guardar t0 y patcheamos `process.exit` para grabar antes de salir.
const __telemetryStarted: { ts: number; command: string; args: Record<string, unknown> } = {
  ts: 0, command: '', args: {},
};
program.hook('preAction', (thisCommand, actionCommand) => {
  if (!isTelemetryEnabled()) return;
  __telemetryStarted.ts = Date.now();
  // Reconstruir el path del comando (ej: "client publish")
  const parts: string[] = [];
  let cur: Command | null = actionCommand;
  while (cur && cur.name() && cur.name() !== 'dd-cli') {
    parts.unshift(cur.name());
    cur = cur.parent;
  }
  __telemetryStarted.command = parts.join(' ');
  // Args sanitizados — sólo nombres de flags, no sus values (puede haber secrets)
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actionCommand.opts())) {
    // Sólo booleanos pasan, el resto se marca como "set/unset"
    if (typeof v === 'boolean') flags[k] = v;
    else if (v === undefined || v === null) flags[k] = false;
    else flags[k] = true;  // valor presente pero no graba el valor real
  }
  __telemetryStarted.args = flags;
});

// Wrap process.exit para grabar el exit code
const __origExit = process.exit.bind(process);
process.exit = ((code?: number) => {
  if (__telemetryStarted.ts > 0 && isTelemetryEnabled()) {
    try {
      // Detectar email del user si --by o --user están seteados
      const args = __telemetryStarted.args;
      const userEmail = process.env.GIT_AUTHOR_EMAIL ?? process.env.USER_EMAIL ?? null;
      recordTelemetry({
        command: __telemetryStarted.command,
        exit_code: code ?? 0,
        duration_ms: Date.now() - __telemetryStarted.ts,
        args,
        user_hash: hashUser(userEmail),
      });
    } catch { /* no romper exit */ }
    __telemetryStarted.ts = 0;  // single-shot
  }
  return __origExit(code);
}) as typeof process.exit;

program
  .command('init')
  .description('Inicializa DevFlow IA en el proyecto actual (session + skills + hooks)')
  .option('--client <slug>', 'Conecta el repo a un cliente registrado y genera config.yml')
  .option('--force', 'Sobrescribe .devflow/ y settings si existen', false)
  .option('--no-skills', 'No instala las 19 skills bundleadas')
  .option('--no-hooks', 'No escribe .claude/settings.json con hooks')
  .action(async (opts) => {
    try {
      // S2-3: si estamos en un context repo, abortar con mensaje útil.
      if (!opts.force && isContextRepo(process.cwd())) {
        console.error('');
        console.error('Este directorio parece ser un context repo (tiene .devflow-context/).');
        console.error('No se debe ejecutar `dd-cli init` acá — los context repos se generan');
        console.error('y mantienen vía /devflow-ia:client-onboard (Sprint 3) o');
        console.error('/devflow-ia:init-context.');
        console.error('');
        console.error('Si querés validarlo en su lugar: dd-cli context validate');
        console.error('Si querés forzar de todos modos: dd-cli init --force');
        process.exit(2);
      }
      if (opts.client) {
        // Modo --client: conectar repo a cliente + init completo
        const exitCode = await runInitClient(opts.client);
        process.exit(exitCode);
      } else {
        const exitCode = await runInit({
          force: opts.force,
          skipSkills: opts.skills === false,
          skipHooks: opts.hooks === false,
        });
        process.exit(exitCode);
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

program
  .command('health')
  .description('Estado de salud del entorno: máquina, clientes registrados y proyecto actual')
  .option('--client <slug>', 'Chequea solo este cliente')
  .option('--check-api', 'Verifica conectividad a las APIs git (más lento)', false)
  .option('--json', 'Output JSON para scripts', false)
  .action(async (opts) => {
    try { process.exit(await runHealth({ client: opts.client, checkApi: opts.checkApi, json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('install')
  .description('Configura la statusline DevFlow IA globalmente (~/.claude/settings.json)')
  .option('--force', 'Sobrescribe statusLine existente', false)
  .action(async (opts) => {
    try { process.exit(await runInstall({ force: opts.force })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('uninstall')
  .description('Remueve la statusline DevFlow IA del settings.json global')
  .action(async () => {
    try { process.exit(await runUninstall()); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('flow')
  .description('Muestra el viaje completo del método para el dev_type activo (o uno hipotético)')
  .option('--type <type>', 'dev_type a visualizar: greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa')
  .option('--all', 'Muestra resumen de los 5 dev_types', false)
  .action((opts) => {
    try { process.exit(runFlow({ type: opts.type, all: opts.all })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('new-hdu <title>')
  .alias('new-feature')
  .description('[DEPRECATED — usá `dd-cli hdu new`] Crea una HDU desde el template y lanza Claude con /devflow-ia:design-hdu')
  .option('--type <type>', 'dev_type sugerido (Tech Lead confirma en design-hdu)')
  .option('--no-claude', 'No lanzar claude — solo crear el archivo', false)
  .action(async (title, opts) => {
    console.error('⚠  `dd-cli new-hdu` está deprecado. Usá: dd-cli hdu new "<título>" --client=<slug>');
    try {
      process.exit(await runNewHdu(title, { type: opts.type, noClaude: opts.claude === false }));
    } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Namespace `hdu` — Sprint 5 (S5-2)
const hduCmd = program
  .command('hdu')
  .description('Gestión de HDUs en el context repo del cliente (Sprint 5).');

hduCmd
  .command('new <title>')
  .description('Crea una HDU draft. Requiere --client=<slug>.')
  .option('--client <slug>', 'Slug del cliente cuyo context repo aloja la HDU')
  .option('--app <slug>', 'App afectada (apps_affected)')
  .option('--priority <p>', 'baja | media | alta | crítica', 'media')
  .option('--dev-type <type>', 'dev_type sugerido')
  .option('--created-by <email>', 'Email del PMO/creador')
  .option('--assigned-to <email>', 'Email del dev asignado (opcional)')
  .option('--direct', 'S7-7: crear directamente como approved (hotfix). Requiere --reason.', false)
  .option('--reason <r>', 'Razón obligatoria si se usa --direct')
  .option('--json', 'Output JSON', false)
  .action(async (title: string, opts: any) => {
    try { process.exit(await runHduNew(title, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('list')
  .description('Lista HDUs del cliente.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--status <s>', 'Filtrar por status (draft|approved|in-progress|in-review|done|cancelled)')
  .option('--mine', 'Solo HDUs asignadas al --user dado', false)
  .option('--user <email>', 'Email del dev (necesario con --mine)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runHduList(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('show <id>')
  .description('Muestra una HDU + su historial de transiciones.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduShow(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('start <id>')
  .description('Dev arranca a trabajar la HDU (approved → in-progress).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--by <email>', 'Email del dev')
  .option('--reason <r>', 'Razón opcional')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduStart(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('review <id>')
  .description('Dev envía a code review (in-progress → in-review).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--by <email>', 'Email del dev')
  .option('--reason <r>', 'Razón opcional (ej: MR #43)')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduReview(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('approve <id>')
  .description('Tech Lead aprueba la HDU (draft → approved).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--by <email>', 'Email del Tech Lead que aprueba')
  .option('--reason <r>', 'Razón opcional')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduApprove(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('close <id>')
  .description('Cierra la HDU al mergear el PR del código (in-review → done).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--by <email>', 'Email del dev que cierra')
  .option('--reason <r>', 'Razón opcional')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduClose(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('cancel <id>')
  .description('Cancela una HDU. --reason obligatorio.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--by <email>', 'Email del actor')
  .option('--reason <r>', 'Razón obligatoria')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduCancel(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('assign <id>')
  .description('Asigna la HDU a un dev (Tech Lead).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--to <email>', 'Email del dev asignado (obligatorio)')
  .option('--by <email>', 'Email del Tech Lead que asigna')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduAssign(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('claim <id>')
  .description('Auto-asignación del dev (atajo de assign).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--user <email>', 'Email del dev (obligatorio)')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduClaim(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('pin <id>')
  .description('S7-7: Tech Lead pinnea HDU a un dev sobreescribiendo el scoring. Requiere --reason.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--to <email>', 'Email del dev pinneado (obligatorio)')
  .option('--by <email>', 'Email del Tech Lead que pinnea (obligatorio)')
  .option('--reason <r>', 'Razón del pin (obligatoria — queda en audit)')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runHduPin(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('apply-merge')
  .description('CI job: detecta hdus/*.md cambiados en HEAD y propaga draft → approved.')
  .option('--path <dir>', 'Path al context repo (default cwd)')
  .option('--apply', 'Persiste los cambios. Sin esto, dry-run.', false)
  .option('--commit', 'git add + commit + push después de aplicar (cuando --apply)', false)
  .option('--by <email>', 'Actor para el transitions log (default: autor del último commit)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runHduApplyMerge(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('next')
  .description('Sugiere la próxima HDU para el dev (scoring).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--user <email>', 'Email del dev')
  .option('--explain', 'Muestra breakdown del score', false)
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runHduNext(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

hduCmd
  .command('index')
  .description('Regenera el _index.yml derivado.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runHduIndexCmd(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('status')
  .description('Muestra tu progreso en el flujo (narrativo por default)')
  .option('--json', 'Output JSON estructurado', false)
  .option('--quiet', 'Sin output; solo exit code', false)
  .option('--raw', 'Vista técnica detallada (para debug)', false)
  .action((opts) => {
    try {
      const exitCode = runStatus({ json: opts.json, quiet: opts.quiet, raw: opts.raw });
      process.exit(exitCode);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

program
  .command('register-client <slug>')
  .description('Registra un cliente y clona su repo de contexto (~/.devflow/clients/<slug>/)')
  .requiredOption('--context-url <url>', 'URL del repo con el contexto del cliente (GitHub/GitLab)')
  .option('--name <name>', 'Nombre del cliente (opcional, se deduce de la URL)')
  .option('--force', 'Sobreescribir si ya está registrado', false)
  .option('--git-token <token>', 'Personal Access Token para la API de Git (discovery automático)')
  .option('--git-host <host>', 'Plataforma git: gitlab | github | bitbucket (default: gitlab)', 'gitlab')
  .option('--git-group <group>', 'Grupo u organización a escanear (ej: iprsa-group)')
  .option('--git-base-url <url>', 'URL base del servidor git (para instancias self-hosted)')
  .action(async (slug, opts) => {
    try {
      process.exit(await runRegisterClient(slug, {
        contextUrl: opts.contextUrl,
        name: opts.name,
        force: opts.force,
        gitToken: opts.gitToken,
        gitHost: opts.gitHost,
        gitGroup: opts.gitGroup,
        gitBaseUrl: opts.gitBaseUrl,
      }));
    }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Comando estructurado `client` — Sprint 3 lo extiende con new/show/list/etc.
// Acá sólo agregamos `migrate` (S1-10) — los demás llegan en Sprint 3.
const clientCmd = program
  .command('client')
  .description('Gestión de clientes registrados (Sprint 3 agregará new/show/list/...)');

clientCmd
  .command('new <slug>')
  .description('Onboarding inicial del cliente: registro + crea context repo + clone + state REGISTERED.')
  .option('--name <name>', 'Nombre completo del cliente (para modo non-interactive)')
  .option('--provider <type>', 'gitlab | github')
  .option('--base-url <url>', 'URL base del provider (default según provider)')
  .option('--group <name>', 'Group/Org del provider')
  .option('--git-token <token>', 'PAT con scope api/repo (sensible — preferir --git-token-env)')
  .option('--no-branch-protection', 'No aplicar branch protection (solo development)')
  .option('--yes', 'No pedir confirmaciones (CI / scripts)', false)
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: any) => {
    try {
      process.exit(await runClientNew(slug, {
        name: opts.name,
        provider: opts.provider,
        baseUrl: opts.baseUrl,
        group: opts.group,
        gitToken: opts.gitToken,
        noBranchProtection: opts.branchProtection === false,
        yes: opts.yes,
        json: opts.json,
      }));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

clientCmd
  .command('migrate <slug>')
  .description('Migra un cliente legacy al schema nuevo (stack.yml + catalog.yml).')
  .option('--apply', 'Aplica los cambios. Sin esto, dry-run.', false)
  .option('--no-push', 'No pushear al context repo, solo commit local.')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: { apply?: boolean; push?: boolean; json?: boolean }) => {
    // commander: `.option('--no-push')` setea opts.push = false cuando se usa --no-push
    const noPush = opts.push === false;
    try { process.exit(await runClientMigrate(slug, { apply: opts.apply, noPush, json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Namespace `context` — opera sobre el context repo del CWD (no sobre clientes
// registrados). Útil para CI del context repo y precondición de `client publish`.
const contextCmd = program
  .command('context')
  .description('Operaciones sobre context repos del cliente (validate, render, ...)');

contextCmd
  .command('validate [path]')
  .description('Valida la forma estructural del context repo (stack.yml, catalog, refs).')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (repoPath: string | undefined, opts: { json?: boolean }) => {
    try { process.exit(await runContextValidate(repoPath, { json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

contextCmd
  .command('install-ci [path]')
  .description('Provisiona el CI job para HDU transitions (S5-4). Detecta provider del marcador .context-repo.yml.')
  .option('--force', 'Sobreescribe si el archivo ya existe con contenido distinto.', false)
  .option('--provider <type>', 'Override del provider detectado (gitlab|github)')
  .option('--json', 'Output JSON', false)
  .action(async (repoPath: string | undefined, opts: any) => {
    try { process.exit(await runContextInstallCi(repoPath, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

contextCmd
  .command('render [path]')
  .description('Regenera las vistas markdown derivadas desde los YAMLs canónicos.')
  .option('--force', 'Reescribe aunque el contenido sea idéntico.', false)
  .option('--dry-run', 'No escribe, solo reporta qué cambiaría.', false)
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (repoPath: string | undefined, opts: { force?: boolean; dryRun?: boolean; json?: boolean }) => {
    try { process.exit(await runContextRender(repoPath, { force: opts.force, dryRun: opts.dryRun, json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

clientCmd
  .command('show <slug>')
  .description('Dashboard del cliente: stack, apps, profiles, último sync, acciones sugeridas.')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: { json?: boolean }) => {
    try { process.exit(await runClientShow(slug, { json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

clientCmd
  .command('compare <slugA> <slugB>')
  .description('S7-4: compara dos clientes en stack/auth/cicd/apps. Útil para alinear patrones cross-cliente.')
  .option('--aspect <a>', 'stack | auth | cicd | apps | all', 'all')
  .option('--json', 'Output JSON', false)
  .action(async (slugA: string, slugB: string, opts: any) => {
    try { process.exit(await runClientCompare(slugA, slugB, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

clientCmd
  .command('list')
  .description('Lista todos los clientes registrados con estado, apps y último sync.')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (opts: { json?: boolean }) => {
    try { process.exit(await runClientList({ json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Namespace `telemetry` — opt-in local (S7-1 / R-5)
const telemetryCmd = program
  .command('telemetry')
  .description('Telemetría local opt-in (default OFF, sin push remoto).');

telemetryCmd
  .command('enable')
  .description('Habilita telemetría local. Requiere --local explícito.')
  .option('--local', 'Confirma scope local (obligatorio).', false)
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runTelemetryEnable(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

telemetryCmd
  .command('disable')
  .description('Deshabilita telemetría. Los eventos existentes se preservan.')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runTelemetryDisable(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

telemetryCmd
  .command('status')
  .description('Estado de la telemetría + total de eventos.')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runTelemetryStatus(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

telemetryCmd
  .command('report')
  .description('Reporte de uso (por comando, exit code, errores).')
  .option('--period <p>', 'Período (Nd o "all"). Default 30d.', '30d')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runTelemetryReport(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

telemetryCmd
  .command('purge')
  .description('Borra todos los eventos de telemetría.')
  .option('--yes', 'No pedir confirmación.', false)
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runTelemetryPurge(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Namespace `inbox` — eventos asincrónicos del dev (S6-8)
const inboxCmd = program
  .command('inbox')
  .description('Eventos asincrónicos del dev (HDU asignada, MR mergeado, etc).')
  .option('--read', 'Marca los listados como leídos', false)
  .option('--all', 'Muestra leídos + no-leídos', false)
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runInbox(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

inboxCmd
  .command('add')
  .description('Agrega un evento al inbox (testing / scripts).')
  .option('--kind <k>', 'Tipo del evento (obligatorio)')
  .option('--client <slug>', 'Slug del cliente relacionado')
  .option('--data <json>', 'JSON string con data adicional')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runInboxAdd(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('today')
  .description('Ritual matutino del dev: sesión activa, queue de HDUs, alertas.')
  .option('--user <email>', 'Email del dev (filtra HDUs asignadas a vos)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runToday(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('guide [topic]')
  .description('Abre una guía paginada en terminal. Topics: hdu, onboarding, dev.')
  .option('--json', 'Output JSON con el listado de topics', false)
  .action(async (topic: string | undefined, opts: { json?: boolean }) => {
    try { process.exit(await runGuide(topic, { json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

// Namespace `sprint` (S7-5)
const sprintCmd = program
  .command('sprint')
  .description('Gestión de sprints (S7-5): planificación + tracking sobre HDUs.');

sprintCmd
  .command('new')
  .description('Crea un sprint nuevo (auto-incremento de ID).')
  .option('--client <slug>', 'Slug del cliente (obligatorio)')
  .option('--duration <d>', 'Duración (default 14d)', '14d')
  .option('--start <date>', 'Fecha de inicio YYYY-MM-DD (default hoy)')
  .option('--goal <g>', 'Objetivo del sprint')
  .option('--created-by <email>', 'Email del Tech Lead')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runSprintNew(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

sprintCmd
  .command('show')
  .description('Muestra el sprint actual + sus HDUs con status. --id para mostrar uno específico.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--id <id>', 'Sprint específico (default: current)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runSprintShow(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

sprintCmd
  .command('add <hduId>')
  .description('Agrega una HDU al sprint actual (o al --sprint=<id> dado).')
  .option('--client <slug>', 'Slug del cliente')
  .option('--sprint <id>', 'Sprint específico (default: current)')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runSprintAdd(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

sprintCmd
  .command('remove <hduId>')
  .description('Remueve una HDU del sprint.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--sprint <id>', 'Sprint específico (default: current)')
  .option('--json', 'Output JSON', false)
  .action(async (id: string, opts: any) => {
    try { process.exit(await runSprintRemove(id, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

sprintCmd
  .command('close')
  .description('Cierra el sprint. Muestra el % de completion.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--id <id>', 'Sprint específico (default: current)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runSprintClose(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

sprintCmd
  .command('burndown')
  .description('Burndown ASCII del sprint actual.')
  .option('--client <slug>', 'Slug del cliente')
  .option('--sprint <id>', 'Sprint específico (default: current)')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runSprintBurndown(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('stats')
  .description('Métricas de HDUs del cliente (lead time, throughput, mix dev_type).')
  .option('--client <slug>', 'Slug del cliente (obligatorio)')
  .option('--period <p>', 'Período (Nd o "all"). Default 30d.', '30d')
  .option('--by <axis>', 'Agregar por dev|app|dev_type')
  .option('--json', 'Output JSON', false)
  .action(async (opts: any) => {
    try { process.exit(await runStats(opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('error-codes')
  .description('Lista los códigos de error estables y exit codes (R-4 del rediseño).')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (opts: { json?: boolean }) => {
    try { process.exit(await runErrorCodes({ json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('home')
  .description('Dashboard del operador: tus clientes, sesión activa, sistema.')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (opts: { json?: boolean }) => {
    try { process.exit(await runHome({ json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

clientCmd
  .command('onboard-dev <slug>')
  .description('Setup local para un dev nuevo: clona context repo + registra cliente. Token read-only.')
  .option('--context-url <url>', 'URL del context repo (te la pasa el consultor)')
  .option('--git-token <token>', 'PAT propio del dev con scope read-only')
  .option('--yes', 'No pedir confirmaciones', false)
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: any) => {
    try {
      process.exit(await runClientOnboardDev(slug, {
        contextUrl: opts.contextUrl,
        gitToken: opts.gitToken,
        yes: opts.yes,
        json: opts.json,
      }));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

clientCmd
  .command('refresh <slug>')
  .description('Re-corre discovery y muestra diff vs el catálogo actual. Idempotente; con --apply persiste.')
  .option('--apply', 'Persiste el diff al catalog.yml. Sin esto, dry-run.', false)
  .option('--concurrency <n>', 'Paralelismo de file reads (default 5).', (v) => Number.parseInt(v, 10))
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: { apply?: boolean; concurrency?: number; json?: boolean }) => {
    try { process.exit(await runClientRefresh(slug, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

clientCmd
  .command('publish <slug>')
  .description('Valida + commit + push del context repo. Avanza state → READY.')
  .option('--no-push', 'Solo commit local, no pushear al remoto.')
  .option('--ignore-warnings', 'Publica aunque context validate reporte warnings.', false)
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: any) => {
    try {
      process.exit(await runClientPublish(slug, {
        noPush: opts.push === false,
        ignoreWarnings: opts.ignoreWarnings,
        json: opts.json,
      }));
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

clientCmd
  .command('discover <slug>')
  .description('Analiza los repos del cliente (API, sin clonar) y guarda discovery JSON.')
  .option('--active-only', 'Salta repos archivados / sin actividad.', false)
  .option('--concurrency <n>', 'Paralelismo de file reads (default 5).', (v) => Number.parseInt(v, 10))
  .option('--out <path>', 'Path de salida del JSON. Default ~/.devflow/clients/<slug>.discovery.json')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action(async (slug: string, opts: { activeOnly?: boolean; concurrency?: number; out?: string; json?: boolean }) => {
    try { process.exit(await runClientDiscover(slug, opts)); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('pull-context [slug]')
  .description('Actualiza la cache local del contexto del cliente (git pull). Sin slug usa el .devflow/config.yml del CWD.')
  .option('--client <slug>', 'alias del slug posicional')
  .option('--json', 'Output JSON estructurado (S1-9 / D-7/D-8)', false)
  .action((slug: string | undefined, opts: { client?: string; json?: boolean }) => {
    try { process.exit(runPullContext(slug ?? opts.client, { json: opts.json })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('watch')
  .description('Barra de estado en tiempo real (levantar en pane separado, opcional)')
  .option('--interval <segundos>', 'Segundos entre actualizaciones', '5')
  .option('--no-color', 'Sin colores ANSI', false)
  .action(async (opts) => {
    try { await runWatch({ intervalSeconds: parseInt(opts.interval), noColor: opts.color === false }); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('reclassify')
  .description('Cambia el dev_type de la sesión activa (solo Tech Lead, post-lock)')
  .requiredOption('--to <tipo>', 'Nuevo dev_type: greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa')
  .requiredOption('--reason <texto>', 'Justificación del cambio (mínimo 30 caracteres)')
  .action((opts) => {
    try { process.exit(runReclassifyCmd({ to: opts.to, reason: opts.reason })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('doctor')
  .description('Verifica el entorno y las precondiciones del tipo activo')
  .option('--for <tipo>', 'Verificar precondiciones de un tipo específico (hipotético)')
  .action((opts) => {
    try { process.exit(runDoctorCmd({ forType: opts.for })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('help-ctx')
  .description('Muestra comandos útiles según tu estado actual (más útil que --help)')
  .option('--all', 'Muestra todos los comandos', false)
  .action((opts) => {
    try { process.exit(runHelp({ all: opts.all })); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('start-session <feature-id>')
  .description('Inicia una sesión de trabajo sobre una feature (interactivo)')
  .option('--feature-name <name>', 'Nombre de la feature (skipea pregunta)')
  .option('--type <type>', 'dev_type (skipea pregunta): greenfield | brownfield-feature | brownfield-refactor | modernizacion | integracion-externa')
  .option('--rationale <text>', 'Justificación del tipo')
  .option('--apps <list>', 'Apps afectadas separadas por coma')
  .option('-y, --yes', 'Modo no-interactivo (requiere --feature-name --type --rationale)', false)
  .action(async (featureId, opts) => {
    try {
      const exitCode = await runStartSession(featureId, {
        featureName: opts.featureName,
        type: opts.type,
        rationale: opts.rationale,
        apps: opts.apps,
        yes: opts.yes,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

const skills = program.command('skills').description('Gestión de skills bundleadas');
skills.command('list').description('Lista skills instaladas con modelo y categoría')
  .action(() => { try { process.exit(runSkillsList()); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); } });
skills.command('verify').description('Verifica integridad de skills con checksums')
  .action(() => { try { process.exit(runSkillsVerify()); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); } });
skills.command('install').description('Instala o reinstala skills en ~/.claude/skills/devflow-ia/')
  .option('--force', 'Sobrescribe modificaciones locales', false)
  .action(async (opts) => { try { process.exit(await runSkillsInstall({ force: opts.force })); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); } });

program
  .command('heartbeat')
  .description('Señal de vida — llamado automáticamente por hooks de Claude Code')
  .option('--silent', 'Sin output (para uso en hooks)', false)
  .option('--on-stop', 'Indica que Claude Code cerró (marca unclosed si no había end-session)', false)
  .action(async (opts) => {
    try {
      await runHeartbeat({ silent: opts.silent, onStop: opts.onStop });
      process.exit(0);
    } catch {
      // Nunca falla
      process.exit(0);
    }
  });

program
  .command('next')
  .description('¿Qué tipeo ahora? Muestra el siguiente paso en una línea')
  .action(() => {
    try { process.exit(runNext()); }
    catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
  });

program
  .command('statusline')
  .description('Imprime 1 línea para la statusLine de Claude Code (uso interno)')
  .action(() => {
    try {
      const line = runStatusline();
      console.log(line);
      process.exit(0);
    } catch {
      // Nunca falla — la statusline debe ser robusta
      console.log('DevFlow IA');
      process.exit(0);
    }
  });

program
  .command('end-session')
  .description('Cierra la sesión actual y registra ended_at')
  .option('--no-commit', 'No hace commit ni push (solo cierra el estado local)', false)
  .option('-m, --message <msg>', 'Mensaje custom para el commit (cuando aplique)')
  .action(async (opts) => {
    try {
      const exitCode = await runEndSession({
        noCommit: opts.commit === false,
        message: opts.message,
      });
      process.exit(exitCode);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(10);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(10);
});
