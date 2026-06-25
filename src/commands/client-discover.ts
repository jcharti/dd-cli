/**
 * `dd-cli client discover <slug>` — motor de discovery expuesto (S2-1).
 *
 * Resuelve A-1 del rediseño: la skill `/init-context` reimplementaba con
 * curl + LLM lo que ya estaba en `src/discovery/pattern-detector.ts` (210
 * LoC probadas). Ahora la skill consume este comando vía JSON; el costo
 * por onboarding cae ~10x en tokens y los outputs son reproducibles.
 *
 * Flujo:
 *   1. Lee credentials del cliente.
 *   2. Construye GitProvider (S1-8).
 *   3. Lista repos del group/org.
 *   4. Para cada repo activo: lee archivos clave via API (sin clonar).
 *   5. analyzeRepo → RepoAnalysis por cada uno.
 *   6. synthesizeDiscovery → DiscoveryResult consolidado.
 *   7. Guarda JSON en ~/.devflow/clients/<slug>.discovery.json
 *   8. Actualiza state.json: REGISTERED → DISCOVERED.
 *
 * D-1/A-1 del rediseño. Decisión D-8: este comando es kernel — la skill
 * `/devflow-ia:client-onboard` lo invoca por debajo y narra al humano.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import ora from 'ora';
import { getClient, getDevflowGlobalDir } from '../types/registry.js';
import { getClientCredentials } from '../types/credentials.js';
import { createProvider } from '../providers/factory.js';
import type { GitProvider, RepoMeta, FileContent } from '../providers/types.js';
import { analyzeRepo, synthesizeDiscovery, type RepoAnalysis, type DiscoveryResult } from '../discovery/pattern-detector.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { recordCommandResult } from '../utils/client-state.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientDiscoverOpts extends JsonModeOpts {
  /** Si está, salta repos archivados/sin actividad reciente. */
  activeOnly?: boolean;
  /** Concurrencia para read-file paralelo. Default 5. */
  concurrency?: number;
  /** Output path custom. Default ~/.devflow/clients/<slug>.discovery.json */
  out?: string;
}

/**
 * Archivos que el detector pattern-detector.ts consulta para cada repo.
 * Mantener sincronizado con `detectStack` / `detectAuth` / `detectCiStages`.
 */
const DISCOVERY_FILES: string[] = [
  // stack
  'package.json',
  'composer.json',
  'pom.xml',
  'requirements.txt',
  'Gemfile',
  // ci/cd
  '.gitlab-ci.yml',
  '.github/workflows/ci.yml',
  // auth detection necesita ver código, pero leer todo es caro;
  // tomamos config/sso.php y src/auth/index.ts como muestras representativas
  'config/sso.php',
  'config/auth.php',
  'src/auth/index.ts',
  'src/main.ts',
  'app/Http/Kernel.php',
];

/**
 * Lee los archivos clave de un repo con concurrencia limitada.
 * Retorna un dict { path → FileContent }.
 */
async function readKeyFiles(
  provider: GitProvider,
  repoIdOrSlug: string | number,
  branch: string,
  concurrency: number
): Promise<Record<string, FileContent>> {
  const result: Record<string, FileContent> = {};
  const queue = [...DISCOVERY_FILES];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        result[file] = await provider.readFile(repoIdOrSlug, file, branch);
      } catch {
        result[file] = { path: file, content: '', found: false };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

interface DiscoverOutput {
  slug: string;
  provider: GitProvider['type'];
  group_or_org: string;
  generated_at: string;
  discovery: DiscoveryResult;
  saved_to: string;
}

function getDiscoveryPath(slug: string, override?: string): string {
  if (override) return path.resolve(override);
  return path.join(getDevflowGlobalDir(), 'clients', `${slug}.discovery.json`);
}

export async function runClientDiscover(slug: string, opts: ClientDiscoverOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug. Uso: dd-cli client discover <slug>',
      recovery_hints: ['Listá clientes registrados: dd-cli health'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client discover', ...err }));
    printErr(err.message);
    return 3;
  }

  const entry = getClient(slug);
  if (!entry) {
    const err = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${slug}" no registrado.`,
      context: { slug },
      recovery_hints: [
        `Registrá el cliente: dd-cli register-client ${slug} --context-url=<url> --git-token=<PAT> --git-group=<grupo>`,
      ],
      next_safe_command: `dd-cli register-client ${slug} --context-url=<url>`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'client discover', ...err }));
    printErr(err.message);
    return 2;
  }

  const creds = getClientCredentials(slug);
  if (!creds) {
    const err = {
      code: 'TOKEN_MISSING' as const,
      message: `No hay credenciales API para "${slug}".`,
      context: { slug },
      recovery_hints: [
        `Agregá las credenciales: dd-cli register-client ${slug} --context-url=${entry.context_url} --git-token=<PAT> --git-group=<grupo> --force`,
      ],
      next_safe_command: `dd-cli register-client ${slug} --git-token=<PAT> --git-group=<grupo> --force`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'client discover', ...err }));
    printErr(err.message);
    return 2;
  }

  const provider = createProvider(creds);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 20));
  const outPath = getDiscoveryPath(slug, opts.out);

  const spinner = jsonMode ? null : ora({ text: `Analizando repos de ${provider.type}/${provider.group_or_org} ...`, isSilent: false }).start();

  try {
    // 1. Validar token con scopes mínimos para read
    const tokenCheck = await provider.validateToken({ required_for: ['read'] });
    if (!tokenCheck.valid) {
      spinner?.fail('Token inválido');
      const err = {
        code: 'TOKEN_INVALID' as const,
        message: tokenCheck.message,
        context: { provider: provider.type, user: tokenCheck.user },
        recovery_hints: [
          `Regenerá el token: dd-cli register-client ${slug} --git-token=<nuevo> --force`,
        ],
      };
      recordCommandResult(slug, 'client discover', { success: false, error: err });
      if (jsonMode) emitJson(jsonError({ command: 'client discover', ...err }));
      printErr(tokenCheck.message);
      return 1;
    }

    // 2. Listar repos
    const repos = await provider.listGroupRepos();
    if (spinner) spinner.text = `Encontrados ${repos.length} repos. Analizando archivos clave ...`;

    // 3. Filtrar inactivos opcionales (siempre los analizamos pero el flag
    //    sirve para acelerar; por default sí los traemos para reportar correctamente)
    const candidates = opts.activeOnly
      ? repos.filter(r => !r.archived)
      : repos;

    // 4. Para cada repo, leer archivos clave + analizar
    const analyses: RepoAnalysis[] = [];
    let processed = 0;
    for (const meta of candidates) {
      // Repos archivados o muy inactivos → análisis liviano (sin file reads)
      const lastPushDate = meta.last_push ? new Date(meta.last_push) : null;
      const lastActiveDays = lastPushDate
        ? Math.floor((Date.now() - lastPushDate.getTime()) / 86_400_000)
        : 9999;
      const veryInactive = meta.archived || lastActiveDays > 365;

      const files = veryInactive
        ? {}
        : await readKeyFiles(provider, identifierFor(provider, meta), meta.default_branch, concurrency);

      analyses.push(analyzeRepo(meta, files));
      processed++;
      if (spinner) spinner.text = `Analizando repos ... ${processed}/${candidates.length}`;
    }

    // 5. Sintetizar
    const discovery = synthesizeDiscovery(analyses);

    // 6. Guardar JSON inspeccionable
    const output: DiscoverOutput = {
      slug,
      provider: provider.type,
      group_or_org: provider.group_or_org,
      generated_at: new Date().toISOString(),
      discovery,
      saved_to: outPath,
    };
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');

    // 7. Update state
    recordCommandResult(slug, 'client discover', {
      success: true,
      state: 'DISCOVERED',
      nextSafe: `dd-cli client migrate ${slug} --apply  # si es legacy`,
    });

    spinner?.succeed(`Discovery completo (${analyses.length} repos)`);

    if (jsonMode) {
      emitJson(jsonSuccess('client discover', output, `dd-cli client migrate ${slug}`));
    }

    // Resumen humano
    console.log('');
    console.log(bold(`Discovery para ${slug}`));
    console.log(dimLine(`  Provider:     ${provider.type} @ ${provider.base_url}`));
    console.log(dimLine(`  Group/Org:    ${provider.group_or_org}`));
    console.log(dimLine(`  Repos:        ${discovery.repos.length} total · ${discovery.active_repos} activos · ${discovery.inactive_repos} inactivos`));
    if (discovery.auth_profiles_detected.length > 0) {
      console.log(dimLine(`  Auth:         ${discovery.auth_profiles_detected.join(', ')}`));
    }
    if (discovery.templates_detected.length > 0) {
      console.log(dimLine(`  Templates:    ${discovery.templates_detected.join(', ')}`));
    }
    if (discovery.portal_shell) {
      console.log(dimLine(`  Portal shell: ${discovery.portal_shell}`));
    }
    if (discovery.mfes.length > 0) {
      console.log(dimLine(`  MFEs:         ${discovery.mfes.length} (${discovery.mfes.slice(0, 5).join(', ')}${discovery.mfes.length > 5 ? '...' : ''})`));
    }
    if (discovery.dbs_detected.length > 0) {
      console.log(dimLine(`  DBs:          ${discovery.dbs_detected.join(', ')}`));
    }
    console.log('');
    printInfo(`JSON guardado: ${outPath}`);
    printDim('  Consumible por skills, CI y la app web futura.');
    console.log('');
    printInfo('Próximo paso:');
    printDim(`  dd-cli client migrate ${slug}      # si tiene contexto legacy`);
    printDim(`  /devflow-ia:client-onboard         # publicar context repo nuevo (Sprint 3)`);
    return 0;
  } catch (e) {
    spinner?.fail('Discovery falló');
    const errMsg = e instanceof Error ? e.message : String(e);
    const err = {
      code: 'NETWORK_ERROR' as const,
      message: `Error durante discovery: ${errMsg}`,
      context: { slug, provider: provider.type },
      recovery_hints: [
        'Verificá conectividad y validez del token',
        `Validá scopes: dd-cli health --check-api --client=${slug}`,
      ],
    };
    recordCommandResult(slug, 'client discover', { success: false, error: err });
    if (jsonMode) emitJson(jsonError({ command: 'client discover', ...err }));
    printErr(err.message);
    return 1;
  }
}

/**
 * GitLab identifica repos por ID numérico o por path codificado.
 * GitHub usa el slug. Devolvemos el identificador correcto.
 */
function identifierFor(provider: GitProvider, meta: RepoMeta): string | number {
  if (provider.type === 'gitlab') return meta.id;
  return meta.slug;
}

function dimLine(s: string): string {
  // Usa la misma convención de output.ts pero acá la queremos simple.
  return s;
}
