/**
 * Lógica del flag `--client=<slug>` de `dd-cli init`.
 *
 * Cuando un Tech Lead crea una app nueva y quiere conectarla a un cliente:
 *   dd-cli init --client=iprsa
 *
 * Flujo:
 *   1. Busca el cliente en ~/.devflow/registry.yml
 *   2. Actualiza la cache local del contexto
 *   3. Lee el app-catalog para mostrar apps existentes
 *   4. Pregunta qué app es este repo (o si es una nueva)
 *   5. Genera .devflow/config.yml
 *   6. Ejecuta el init normal (skills, hooks, CLAUDE.md)
 */
import { existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { select, input, confirm } from '@inquirer/prompts';
import {
  getClient,
  getClientCacheDir,
  updateLastSynced,
} from '../types/registry.js';
import {
  buildProjectConfig,
  saveProjectConfig,
  hasProjectConfig,
  APP_TYPES,
  APP_ORIGINS,
  type AppType,
  type AppOrigin,
} from '../types/project-config.js';
import { loadCatalog, type CatalogApp } from '../types/catalog.js';
import { DEV_TYPES, type DevType } from '../types/dev-type.js';
import { getProjectRoot } from '../utils/paths.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';
import { runInit } from './init.js';

const isTTY = process.stdout.isTTY;

/**
 * Forma reducida que el flujo interactivo necesita.
 * Si el ci_cd_profile vino como null (skill viejo emitía boolean), marcamos
 * con [por-confirmar] para que el dev lo complete después via dd-cli gaps.
 *
 * S1-2: el parseo del catálogo vive ahora en `loadCatalog`, que prefiere
 * `catalog.yml` canónico y cae a `app-catalog.md` (backward-compat) si
 * solo existe el viejo.
 */
interface AppCatalogEntry {
  slug: string;
  type: string;
  auth_profile: string;
  ci_cd_profile: string;
  app_origin: string;
  preferred_dev_types: string[];
}

function toEntry(app: CatalogApp): AppCatalogEntry {
  return {
    slug: app.slug,
    type: app.type,
    auth_profile: app.auth_profile ?? '',
    ci_cd_profile: app.ci_cd_profile ?? '[por-confirmar]',
    app_origin: app.app_origin,
    preferred_dev_types: app.preferred_dev_types,
  };
}

function syncCache(slug: string, contextUrl: string): boolean {
  const cacheDir = getClientCacheDir(slug);
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(path.dirname(cacheDir), { recursive: true });
      execSync(`git clone "${contextUrl}" "${cacheDir}"`, { stdio: 'pipe' });
    } else {
      execSync('git pull', { cwd: cacheDir, stdio: 'pipe' });
    }
    updateLastSynced(slug);
    return true;
  } catch {
    return false;
  }
}

export async function runInitClient(clientSlug: string): Promise<number> {
  const projectRoot = getProjectRoot();

  console.log(bold(`\nConectando repo al cliente: ${clientSlug}\n`));

  // 1. Buscar cliente en registry
  const clientEntry = getClient(clientSlug);
  if (!clientEntry) {
    printErr(`Cliente "${clientSlug}" no registrado en esta máquina.`);
    printInfo(`Primero registra el cliente:`);
    printDim(`  dd-cli register-client ${clientSlug} --context-url=<github-url>`);
    return 2;
  }

  // 2. Actualizar cache del contexto
  printInfo(`Actualizando contexto de ${clientSlug}...`);
  const synced = syncCache(clientSlug, clientEntry.context_url);
  if (synced) {
    printOk(`Cache actualizada`);
  } else {
    printWarn(`No se pudo actualizar la cache. Usando versión local.`);
  }

  const cacheDir = getClientCacheDir(clientSlug);
  const catalog = loadCatalog(cacheDir);
  const existingApps: AppCatalogEntry[] = catalog?.apps.map(toEntry) ?? [];

  // 3. ¿Qué app es este repo?
  let selectedApp: AppCatalogEntry | null = null;
  let isNewApp = false;

  if (existingApps.length > 0) {
    console.log('');
    const choices = [
      ...existingApps.map(a => ({
        name: `${a.slug.padEnd(35)} ${a.type.padEnd(15)} ${a.auth_profile}`,
        value: a.slug,
      })),
      { name: '+ Esta es una app nueva (no está en el catálogo todavía)', value: '__new__' },
    ];

    const chosen = await select({
      message: '¿Qué app del catálogo es este repo?',
      choices,
    });

    if (chosen === '__new__') {
      isNewApp = true;
    } else {
      selectedApp = existingApps.find(a => a.slug === chosen) ?? null;
    }
  } else {
    printWarn(`No se encontró app-catalog en el contexto del cliente.`);
    isNewApp = true;
  }

  // 4. Si es nueva, pedir datos
  let appSlug: string;
  let appType: AppType;
  let authProfile: string;
  let ciCdProfile: string;
  let appOrigin: AppOrigin;
  let preferredDevTypes: DevType[];

  if (selectedApp) {
    appSlug = selectedApp.slug;
    appType = (APP_TYPES.includes(selectedApp.type as AppType) ? selectedApp.type : 'bff') as AppType;
    authProfile = selectedApp.auth_profile;
    ciCdProfile = selectedApp.ci_cd_profile;
    appOrigin = (APP_ORIGINS.includes(selectedApp.app_origin as AppOrigin)
      ? selectedApp.app_origin
      : 'legacy-app') as AppOrigin;
    preferredDevTypes = selectedApp.preferred_dev_types.filter(
      t => DEV_TYPES.includes(t as DevType)
    ) as DevType[];

    console.log('');
    printDim(`  App:         ${appSlug}`);
    printDim(`  Tipo:        ${appType}`);
    printDim(`  Auth:        ${authProfile}`);
    printDim(`  CI/CD:       ${ciCdProfile}`);
    printDim(`  Origen:      ${appOrigin}`);
  } else {
    // App nueva — pedir datos
    console.log('');
    printInfo('Registrando nueva app en el contexto del cliente:');

    appSlug = await input({
      message: 'Slug de la app (kebab-case):',
      default: path.basename(projectRoot),
      validate: (v) => /^[a-z0-9-]+$/.test(v) || 'Debe ser kebab-case (solo minúsculas, números y guiones)',
    });

    appType = await select<AppType>({
      message: 'Tipo de app:',
      choices: APP_TYPES.map(t => ({ name: t, value: t })),
      default: 'bff',
    });

    authProfile = await input({
      message: 'Auth profile (debe existir en .devflow-context/auth-profiles/):',
      default: 'custom-jwt',
    });

    ciCdProfile = await input({
      message: 'CI/CD profile (debe existir en .devflow-context/cicd-profiles/):',
      default: 'gitlab-laravel-k8s',
    });

    appOrigin = await select<AppOrigin>({
      message: 'Origen del codebase:',
      choices: [
        { name: 'legacy-app   — código existente con historial', value: 'legacy-app' },
        { name: 'greenfield-app — app nueva sin código previo', value: 'greenfield-app' },
        { name: 'external-app — repositorio de tercero (solo lectura)', value: 'external-app' },
      ],
      default: 'legacy-app',
    });

    preferredDevTypes = [];
  }

  // 5. Verificar si ya hay config.yml
  if (hasProjectConfig(projectRoot)) {
    const overwrite = await confirm({
      message: 'Ya existe .devflow/config.yml. ¿Sobreescribir?',
      default: false,
    });
    if (!overwrite) {
      printInfo('Manteniendo config.yml existente. Continuando con el setup...');
    }
  }

  // 6. Generar .devflow/config.yml
  const config = buildProjectConfig({
    clientSlug,
    clientName: clientEntry.name,
    contextUrl: clientEntry.context_url,
    appSlug,
    appType,
    authProfile,
    ciCdProfile,
    appOrigin,
    preferredDevTypes,
  });

  saveProjectConfig(projectRoot, config);
  printOk(`.devflow/config.yml generado`);
  printDim(`  ↳ Commitear este archivo para que otros devs lo usen`);

  console.log('');

  // 7. Ejecutar init normal (skills, hooks, CLAUDE.md)
  const initResult = await runInit({ force: false, skipSkills: false, skipHooks: false });

  if (initResult === 0) {
    console.log('');
    printOk(`Repo "${appSlug}" conectado al cliente "${clientSlug}"`);
    printDim(`  Commitea .devflow/config.yml para que cualquier dev pueda usar dd-cli init`);
  }

  return initResult;
}
