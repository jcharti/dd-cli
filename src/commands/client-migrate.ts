/**
 * `dd-cli client migrate <slug>` — migra un cliente legacy al schema nuevo (S1-10).
 *
 * Detecta los formatos viejos en la cache del cliente y los convierte a los
 * canónicos:
 *   .devflow/config.yml (master legacy)  →  .devflow-context/stack.yml  (S1-1)
 *   .devflow-context/app-catalog.md       →  .devflow-context/catalog.yml (S1-2)
 *
 * Default: dry-run (muestra el plan). Con `--apply`:
 *   1. Backup automático en ~/.devflow/clients/<slug>.bak-<ts>/
 *   2. Aplica los cambios en la cache local
 *   3. Stage + commit + push al context repo
 *
 * Backward-compat: el comando es idempotente. Si el cliente ya está migrado,
 * reporta "nothing to do" y termina con éxito.
 *
 * D-10 del Apéndice D del doc rediseño.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { getClient, getClientCacheDir } from '../types/registry.js';
import {
  loadStackConfig,
  saveStackConfig,
  hasStackConfig,
  looksLikeLegacyMasterConfig,
  StackConfigSchema,
} from '../types/stack-config.js';
import {
  loadCatalog,
  saveCatalog,
  hasCatalog,
  getCatalogYamlPath,
  getCatalogMarkdownPath,
  CatalogSchema,
} from '../types/catalog.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { recordCommandResult } from '../utils/client-state.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ClientMigrateOpts extends JsonModeOpts {
  apply?: boolean;
  noPush?: boolean;
}

interface MigrationStep {
  type:
    | 'create-stack-yml-from-legacy-config'
    | 'create-catalog-yml-from-markdown'
    | 'noop-already-migrated'
    | 'noop-nothing-to-migrate';
  description: string;
  from?: string;
  to?: string;
  details?: Record<string, unknown>;
}

interface MigrationPlan {
  slug: string;
  cache_dir: string;
  steps: MigrationStep[];
  backup_dir?: string;
  applied: boolean;
  pushed: boolean;
}

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Construye un StackConfig nuevo desde un objeto YAML "master legacy".
 * Best-effort: campos faltantes usan defaults razonables o quedan en
 * `[por-confirmar]` para que el dev los complete después.
 */
function buildStackFromLegacyMaster(slug: string, legacy: Record<string, unknown>): unknown {
  const legacyStack = (legacy['stack'] as Record<string, unknown>) ?? {};
  // La sección "client" del legacy puede llamarse `client:` o `project:` (caso IPRSA).
  const legacyClient =
    (legacy['client'] as Record<string, unknown>) ??
    (legacy['project'] as Record<string, unknown>) ??
    {};

  const s = (obj: Record<string, unknown>, key: string, fallback = ''): string => {
    const v = obj[key];
    return typeof v === 'string' ? v : fallback;
  };
  const n = (obj: Record<string, unknown>, key: string): number | null => {
    const v = obj[key];
    return typeof v === 'number' ? v : null;
  };

  const databases = Array.isArray(legacyStack['databases'])
    ? (legacyStack['databases'] as string[])
    : (s(legacyStack, 'database') ? [s(legacyStack, 'database')] : ['[por-confirmar]']);

  // Mapeo de campos `client_*` (legacy) → `*` (nuevo)
  const clientSlug = s(legacyClient, 'client_slug') || s(legacyClient, 'slug') || slug;
  const clientName = s(legacyClient, 'client_name') || s(legacyClient, 'name') || slug;
  const industry = s(legacyClient, 'industry');
  const teamSize = n(legacyClient, 'team_size');
  const primaryContact = s(legacyClient, 'primary_contact');

  return {
    schema_version: '1.0' as const,
    client: {
      slug: clientSlug,
      name: clientName,
      industry: industry || null,
      team_size: teamSize,
      primary_contact: primaryContact || null,
    },
    stack: {
      backend_framework: s(legacyStack, 'backend_framework', '[por-confirmar]'),
      frontend_framework: s(legacyStack, 'frontend_framework', '[por-confirmar]'),
      databases,
      infra: s(legacyStack, 'infra', '[por-confirmar]'),
      k8s_namespaces: (legacyStack['k8s_namespaces'] as Record<string, string>) ?? undefined,
      cicd_platform: s(legacyStack, 'cicd_platform', s(legacyStack, 'ci_cd_platform', '[por-confirmar]')),
      identity_provider: s(legacyStack, 'identity_provider') || null,
      container_registry: s(legacyStack, 'container_registry') || null,
      base_domain: s(legacyStack, 'base_domain') || null,
    },
    naming: (legacy['naming'] as object | undefined) ?? {},
    defaults: (legacy['defaults'] as object | undefined) ?? {},
    templates: (legacy['templates'] as object | undefined) ?? {},
    devflow: (legacy['devflow'] as object | undefined) ?? {},
  };
}

function planMigration(cacheDir: string, slug: string): MigrationStep[] {
  const steps: MigrationStep[] = [];

  // 1. stack.yml — si ya existe, no hay nada que hacer en master config
  const legacyMasterPath = path.join(cacheDir, '.devflow', 'config.yml');
  const stackYmlExists = hasStackConfig(cacheDir);

  if (!stackYmlExists && existsSync(legacyMasterPath)) {
    try {
      const raw = readFileSync(legacyMasterPath, 'utf-8');
      const parsed = yaml.load(raw);
      if (looksLikeLegacyMasterConfig(parsed)) {
        const next = buildStackFromLegacyMaster(slug, parsed as Record<string, unknown>);
        // Validar que el shape construido pasa el schema (early fail)
        StackConfigSchema.parse(next);
        steps.push({
          type: 'create-stack-yml-from-legacy-config',
          description: 'Generar .devflow-context/stack.yml desde .devflow/config.yml (legacy master)',
          from: '.devflow/config.yml',
          to: '.devflow-context/stack.yml',
        });
      }
    } catch (e) {
      // Si el parse o el schema falla, no agregamos el step pero lo reportamos
      steps.push({
        type: 'noop-nothing-to-migrate',
        description: `No se pudo derivar stack.yml desde .devflow/config.yml: ${
          e instanceof Error ? e.message.split('\n')[0] : String(e)
        }`,
      });
    }
  }

  // 2. catalog.yml — si no existe pero hay app-catalog.md, lo migramos
  const catalogYmlExists = existsSync(getCatalogYamlPath(cacheDir));
  const catalogMdExists = existsSync(getCatalogMarkdownPath(cacheDir));

  if (!catalogYmlExists && catalogMdExists) {
    try {
      const catalog = loadCatalog(cacheDir); // ya soporta el parse del md
      const validated = CatalogSchema.parse(catalog ?? { apps: [] });
      steps.push({
        type: 'create-catalog-yml-from-markdown',
        description: `Generar .devflow-context/catalog.yml desde app-catalog.md (${validated.apps.length} apps)`,
        from: '.devflow-context/app-catalog.md',
        to: '.devflow-context/catalog.yml',
        details: { app_count: validated.apps.length },
      });
    } catch (e) {
      steps.push({
        type: 'noop-nothing-to-migrate',
        description: `No se pudo derivar catalog.yml desde app-catalog.md: ${
          e instanceof Error ? e.message.split('\n')[0] : String(e)
        }`,
      });
    }
  }

  if (steps.length === 0) {
    // Decidir si "ya migrado" o "nothing to migrate"
    if (stackYmlExists && (catalogYmlExists || !catalogMdExists)) {
      steps.push({
        type: 'noop-already-migrated',
        description: 'El cliente ya usa el schema nuevo — nada que migrar',
      });
    } else if (!hasCatalog(cacheDir) && !existsSync(legacyMasterPath)) {
      steps.push({
        type: 'noop-nothing-to-migrate',
        description: 'Context repo vacío o incompleto — corré /devflow-ia:init-context primero',
      });
    }
  }

  return steps;
}

function applyMigration(cacheDir: string, slug: string, steps: MigrationStep[]): void {
  for (const step of steps) {
    if (step.type === 'create-stack-yml-from-legacy-config') {
      const raw = readFileSync(path.join(cacheDir, '.devflow', 'config.yml'), 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown>;
      const next = buildStackFromLegacyMaster(slug, parsed);
      const config = StackConfigSchema.parse(next);
      saveStackConfig(cacheDir, config);
    }
    if (step.type === 'create-catalog-yml-from-markdown') {
      const catalog = loadCatalog(cacheDir);
      if (catalog) saveCatalog(cacheDir, catalog);
    }
  }
}

function makeBackup(cacheDir: string, slug: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = `${path.dirname(cacheDir)}/${slug}.bak-${ts}`;
  cpSync(cacheDir, backupDir, { recursive: true });
  return backupDir;
}

function commitAndPush(cacheDir: string, slug: string, steps: MigrationStep[], noPush: boolean): boolean {
  try {
    const filesTouched = steps
      .filter(s => s.to)
      .map(s => s.to!)
      .join(' ');
    if (!filesTouched) return false;

    runGit(`git add ${filesTouched}`, cacheDir);

    // ¿Hay algo realmente staged? (puede que el archivo ya esté gitignoreado o vacío)
    let status = '';
    try { status = runGit('git diff --cached --stat', cacheDir); } catch { /* */ }
    if (!status.trim()) return false;

    runGit(
      `git commit -m "chore: migrate ${slug} to dd-cli v0.6 schemas\n\n${steps.map(s => '- ' + s.description).join('\n')}\n\nGenerado por dd-cli client migrate"`,
      cacheDir
    );

    if (!noPush) {
      try { runGit('git push origin HEAD', cacheDir); }
      catch { return false; }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function runClientMigrate(slug: string, opts: ClientMigrateOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!slug) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: 'Falta el slug del cliente. Uso: dd-cli client migrate <slug>',
      recovery_hints: ['Ejecutá: dd-cli client list para ver los registrados'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client migrate', ...err }));
    printErr(err.message);
    return 3;
  }

  const entry = getClient(slug);
  if (!entry) {
    const err = {
      code: 'CLIENT_NOT_REGISTERED' as const,
      message: `Cliente "${slug}" no registrado en ~/.devflow/registry.yml.`,
      context: { slug },
      recovery_hints: [
        `Registrá el cliente primero: dd-cli register-client ${slug} --context-url=<url>`,
      ],
      next_safe_command: `dd-cli register-client ${slug} --context-url=<url>`,
    };
    if (jsonMode) emitJson(jsonError({ command: 'client migrate', ...err }));
    printErr(err.message);
    return 2;
  }

  const cacheDir = getClientCacheDir(slug);
  if (!existsSync(cacheDir)) {
    const err = {
      code: 'CONTEXT_CACHE_MISSING' as const,
      message: `Cache local no encontrada en ${cacheDir}.`,
      context: { slug, cache_dir: cacheDir },
      recovery_hints: [`Sincronizá: dd-cli pull-context ${slug}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'client migrate', ...err }));
    printErr(err.message);
    return 2;
  }

  // Plan
  const steps = planMigration(cacheDir, slug);
  const apply = !!opts.apply;
  const noPush = !!opts.noPush;

  const plan: MigrationPlan = {
    slug,
    cache_dir: cacheDir,
    steps,
    applied: false,
    pushed: false,
  };

  const hasWork = steps.some(s => s.type !== 'noop-already-migrated' && s.type !== 'noop-nothing-to-migrate');

  if (!apply || !hasWork) {
    // Dry-run o nada que hacer
    if (jsonMode) {
      emitJson(jsonSuccess('client migrate', plan, hasWork
        ? `dd-cli client migrate ${slug} --apply`
        : null));
    }
    console.log(bold(`\nPlan de migración para ${slug}\n`));
    printDim(`  Cache: ${cacheDir}`);
    console.log('');
    for (const step of steps) {
      const marker = step.type.startsWith('noop') ? printDim : printOk;
      marker(`  ${step.description}`);
    }
    if (hasWork && !apply) {
      console.log('');
      printInfo('Para aplicar: dd-cli client migrate ' + slug + ' --apply');
    }
    recordCommandResult(slug, 'client migrate', { success: true });
    return 0;
  }

  // Apply
  try {
    const backupDir = makeBackup(cacheDir, slug);
    plan.backup_dir = backupDir;
    if (!jsonMode) printDim(`  ✓ Backup en ${backupDir}`);

    applyMigration(cacheDir, slug, steps);
    plan.applied = true;
    if (!jsonMode) printOk('Migración aplicada en la cache local');

    plan.pushed = commitAndPush(cacheDir, slug, steps, noPush);
    if (!jsonMode) {
      if (plan.pushed) printOk('Commit + push al context repo');
      else if (noPush) printInfo('--no-push activo, commit local sin push');
      else printWarn('No se pudo pushear (revisá permisos del token)');
    }

    recordCommandResult(slug, 'client migrate', { success: true, state: 'READY' });

    if (jsonMode) {
      emitJson(jsonSuccess('client migrate', plan, `dd-cli health --client=${slug}`));
    }
    console.log('');
    printOk('Migración completada');
    printInfo(`Verificá: dd-cli health --client=${slug}`);
    return 0;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const errObj = {
      code: 'INTERNAL_ERROR' as const,
      message: `Error durante la migración: ${errMsg}`,
      context: { slug, cache_dir: cacheDir, backup_dir: plan.backup_dir },
      recovery_hints: [
        plan.backup_dir ? `Restaurá desde el backup: rm -rf ${cacheDir} && mv ${plan.backup_dir} ${cacheDir}` : '',
        `Reportá el bug con el output de: dd-cli client migrate ${slug} --json`,
      ].filter(Boolean),
    };
    recordCommandResult(slug, 'client migrate', { success: false, error: errObj });
    if (jsonMode) emitJson(jsonError({ command: 'client migrate', ...errObj }));
    printErr(errObj.message);
    return 1;
  }
}
