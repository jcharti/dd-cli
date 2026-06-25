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

const program = new Command();

program
  .name('dd-cli')
  .description('DevFlow IA — CLI oficial · bridge local entre Claude Code y la plataforma')
  .version(CLI_VERSION);

program
  .command('init')
  .description('Inicializa DevFlow IA en el proyecto actual (session + skills + hooks)')
  .option('--client <slug>', 'Conecta el repo a un cliente registrado y genera config.yml')
  .option('--force', 'Sobrescribe .devflow/ y settings si existen', false)
  .option('--no-skills', 'No instala las 19 skills bundleadas')
  .option('--no-hooks', 'No escribe .claude/settings.json con hooks')
  .action(async (opts) => {
    try {
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
  .description('Crea una HDU desde el template y lanza Claude con /devflow-ia:design-hdu')
  .option('--type <type>', 'dev_type sugerido (Tech Lead confirma en design-hdu)')
  .option('--no-claude', 'No lanzar claude — solo crear el archivo', false)
  .action(async (title, opts) => {
    try {
      process.exit(await runNewHdu(title, { type: opts.type, noClaude: opts.claude === false }));
    } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(10); }
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
