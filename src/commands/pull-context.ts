/**
 * `dd-cli pull-context [slug]`
 *
 * Actualiza la cache local del contexto del cliente.
 * Hace git pull en ~/.devflow/clients/<slug>/
 *
 * B-2 fix — acepta `slug` como argumento posicional opcional.
 *   Sin arg: lee `.devflow/config.yml` del CWD (comportamiento anterior).
 *   Con arg: usa el registry (~/.devflow/registry.yml) — funciona desde cualquier dir.
 *
 * Lo usa el dev cuando el Tech Lead avisa que hay actualizaciones
 * en el catálogo de apps, auth profiles o CI/CD profiles.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '../utils/paths.js';
import { loadProjectConfig } from '../types/project-config.js';
import { getClient, getClientCacheDir, updateLastSynced } from '../types/registry.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { recordCommandResult } from '../utils/client-state.js';

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function runPullContext(slugArg?: string, opts?: JsonModeOpts): number {
  const jsonMode = isJsonMode(opts);
  let slug: string;
  let context_url: string;
  let appSlugFromLocalConfig: string | undefined;

  if (slugArg) {
    // Modo explícito — buscar en el registry global
    const entry = getClient(slugArg);
    if (!entry) {
      if (jsonMode) {
        emitJson(jsonError({
          command: 'pull-context',
          code: 'CLIENT_NOT_REGISTERED',
          message: `Cliente "${slugArg}" no registrado en ~/.devflow/registry.yml.`,
          context: { slug: slugArg },
          recovery_hints: [
            `Registrá el cliente: dd-cli register-client ${slugArg} --context-url=<url>`,
            'O abrí Claude Code y ejecutá /devflow-ia:client-onboard para onboarding completo',
          ],
          next_safe_command: `dd-cli register-client ${slugArg} --context-url=<url>`,
        }));
      }
      printErr(`Cliente "${slugArg}" no registrado en ~/.devflow/registry.yml.`);
      printInfo('Primero registra el cliente:');
      printDim(`  dd-cli register-client ${slugArg} --context-url=<url>`);
      return 2;
    }
    slug = entry.slug;
    context_url = entry.context_url;
  } else {
    // Modo implícito — leer config.yml del proyecto en CWD
    const projectRoot = getProjectRoot();
    const config = loadProjectConfig(projectRoot);
    if (!config) {
      if (jsonMode) {
        emitJson(jsonError({
          command: 'pull-context',
          code: 'PROJECT_NOT_INITIALIZED',
          message: 'No se encontró .devflow/config.yml en este proyecto.',
          context: { cwd: projectRoot },
          recovery_hints: [
            'Conectá el repo al cliente: dd-cli init --client=<slug>',
            'O sync explícito sin estar en un repo: dd-cli pull-context <slug>',
          ],
          next_safe_command: 'dd-cli init --client=<slug>',
        }));
      }
      printErr('No se encontró .devflow/config.yml en este proyecto.');
      printInfo('Opciones:');
      printDim('  • Conectar el repo al cliente: dd-cli init --client=<slug>');
      printDim('  • Sync explícito sin estar en un repo: dd-cli pull-context <slug>');
      return 2;
    }
    slug = config.client.slug;
    context_url = config.client.context_url;
    appSlugFromLocalConfig = config.app.slug;
  }

  const cacheDir = getClientCacheDir(slug);

  if (!jsonMode) {
    console.log(bold(`\nActualizando contexto del cliente: ${slug}\n`));
    printDim(`  Cache: ${cacheDir}`);
    printDim(`  Fuente: ${context_url}`);
    console.log('');
  }

  // Si no hay cache, clonar
  if (!existsSync(cacheDir)) {
    if (!jsonMode) printInfo('Cache local no encontrada. Clonando...');
    try {
      mkdirSync(path.dirname(cacheDir), { recursive: true });
      execSync(`git clone "${context_url}" "${cacheDir}"`, { stdio: 'pipe' });
      updateLastSynced(slug);
      recordCommandResult(slug, 'pull-context', { success: true });
      if (jsonMode) {
        emitJson(jsonSuccess('pull-context', {
          slug,
          action: 'cloned',
          cache_dir: cacheDir,
          context_url,
        }));
      }
      printOk('Contexto clonado correctamente');
      return 0;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const jsonErr = {
        code: 'GIT_CLONE_FAILED' as const,
        message: `Error al clonar contexto del cliente: ${errMsg}`,
        context: { slug, context_url, cache_dir: cacheDir },
        recovery_hints: [
          'Verificá que tenés acceso al repo del contexto',
          `Validá el token del cliente: dd-cli health --client=${slug}`,
        ],
      };
      recordCommandResult(slug, 'pull-context', { success: false, error: jsonErr });
      if (jsonMode) {
        emitJson(jsonError({ command: 'pull-context', ...jsonErr }));
      }
      printErr(`Error al clonar: ${errMsg}`);
      printDim('  Verifica que tienes acceso al repo del contexto.');
      return 1;
    }
  }

  // Obtener estado antes del pull
  let beforeHash = '';
  try {
    beforeHash = runGit('git rev-parse HEAD', cacheDir);
  } catch { /* ignorar */ }

  // Pull
  try {
    const pullOutput = runGit('git pull', cacheDir);

    if (pullOutput.includes('Already up to date')) {
      updateLastSynced(slug);
      recordCommandResult(slug, 'pull-context', { success: true });
      if (jsonMode) {
        emitJson(jsonSuccess('pull-context', {
          slug,
          action: 'already-up-to-date',
          cache_dir: cacheDir,
        }));
      }
      printOk('El contexto ya está actualizado — no hay cambios');
      return 0;
    }

    updateLastSynced(slug);

    // Recolectar cambios recibidos
    let commits: string[] = [];
    if (beforeHash) {
      try {
        const log = runGit(`git log ${beforeHash}..HEAD --oneline`, cacheDir);
        if (log) commits = log.split('\n');
      } catch { /* ignorar */ }
    }

    // Detectar cambios en la app del repo actual
    let appCatalogChanged = false;
    if (appSlugFromLocalConfig) {
      try {
        const diff = runGit(
          `git diff ${beforeHash}..HEAD -- .devflow-context/app-catalog.md`,
          cacheDir
        );
        appCatalogChanged =
          diff.includes(`+| ${appSlugFromLocalConfig}`) ||
          diff.includes(`-| ${appSlugFromLocalConfig}`);
      } catch { /* ignorar */ }
    }

    recordCommandResult(slug, 'pull-context', { success: true });
    if (jsonMode) {
      emitJson(jsonSuccess('pull-context', {
        slug,
        action: 'pulled',
        commits_count: commits.length,
        commits,
        app_catalog_changed_for: appCatalogChanged ? appSlugFromLocalConfig : null,
      }));
    }

    printOk('Contexto actualizado');
    if (commits.length > 0) {
      console.log('');
      printDim('Cambios recibidos:');
      commits.forEach(l => printDim(`  ${l}`));
    }
    if (appCatalogChanged && appSlugFromLocalConfig) {
      console.log('');
      printWarn(`La entrada de "${appSlugFromLocalConfig}" en app-catalog.md cambió.`);
      printInfo('Revisa si necesitas actualizar .devflow/config.yml');
    }

    return 0;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const jsonErr = {
      code: 'GIT_PULL_FAILED' as const,
      message: `Error al actualizar contexto: ${errMsg}`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [
        'Verificá tu conexión y acceso al repo del contexto',
        `Re-validá el token: dd-cli health --client=${slug}`,
        `Si la cache está corrupta: dd-cli register-client ${slug} --context-url=${context_url} --force`,
      ],
    };
    recordCommandResult(slug, 'pull-context', { success: false, error: jsonErr });
    if (jsonMode) {
      emitJson(jsonError({ command: 'pull-context', ...jsonErr }));
    }
    printErr(`Error al actualizar: ${errMsg}`);
    printDim('  Verifica tu conexión y acceso al repo del contexto.');
    return 1;
  }
}
