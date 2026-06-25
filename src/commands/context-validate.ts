/**
 * `dd-cli context validate [path]` — linter del context repo (S2-4).
 *
 * Verifica forma estructural:
 *   1. Hay marcador `.devflow-context/.context-repo.yml` con schema válido.
 *   2. `.devflow-context/stack.yml` existe y pasa StackConfigSchema.
 *   3. `.devflow-context/catalog.yml` (o legacy `app-catalog.md`) parsea OK.
 *   4. Referencias internas: cada `auth_profile` y `ci_cd_profile` del catálogo
 *      apunta a un archivo existente en `auth-profiles/` y `cicd-profiles/`.
 *
 * Útil para CI del context repo y como precondición de `dd-cli client publish`
 * (Sprint 3).
 *
 * Output JSON estructurado bajo D-8.
 */
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { loadContextRepoMarker, isContextRepo, getContextRepoMarkerPath } from '../types/context-repo.js';
import { loadStackConfig, hasStackConfig, getStackConfigPath } from '../types/stack-config.js';
import { loadCatalog, hasCatalog, getCatalogYamlPath, getCatalogMarkdownPath } from '../types/catalog.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ContextValidateOpts extends JsonModeOpts {}

interface Finding {
  level: 'ok' | 'warn' | 'err';
  rule: string;
  message: string;
  hint?: string;
}

function authProfilesAvailable(repoRoot: string): Set<string> {
  const dir = path.join(repoRoot, '.devflow-context', 'auth-profiles');
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter(f => f.endsWith('.md') || f.endsWith('.yml'))
      .map(f => f.replace(/\.(md|yml)$/, ''))
  );
}

function cicdProfilesAvailable(repoRoot: string): Set<string> {
  const dir = path.join(repoRoot, '.devflow-context', 'cicd-profiles');
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter(f => f.endsWith('.yml'))
      .map(f => f.replace(/\.yml$/, ''))
  );
}

export function validateContextRepo(repoRoot: string): Finding[] {
  const findings: Finding[] = [];

  // 1. ¿Es un context repo? (heurística + marcador)
  if (!isContextRepo(repoRoot)) {
    findings.push({
      level: 'err',
      rule: 'is-context-repo',
      message: 'El directorio no parece ser un context repo (no hay .devflow-context/).',
      hint: 'Corré /devflow-ia:client-onboard para inicializarlo (Sprint 3).',
    });
    return findings;
  }

  // 2. Marcador `.context-repo.yml`
  const markerPath = getContextRepoMarkerPath(repoRoot);
  if (!existsSync(markerPath)) {
    findings.push({
      level: 'warn',
      rule: 'context-repo-marker',
      message: '.devflow-context/.context-repo.yml no encontrado (legacy).',
      hint: 'Será generado al pasar por /devflow-ia:client-onboard o dd-cli client publish.',
    });
  } else {
    try {
      const marker = loadContextRepoMarker(repoRoot);
      if (marker) {
        findings.push({
          level: 'ok',
          rule: 'context-repo-marker',
          message: `Marcador OK — cliente "${marker.client.slug}", schema v${marker.schema_version}`,
        });
      }
    } catch (e) {
      findings.push({
        level: 'err',
        rule: 'context-repo-marker',
        message: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e),
        hint: 'Revisá el YAML del marcador.',
      });
    }
  }

  // 3. stack.yml
  if (!hasStackConfig(repoRoot)) {
    findings.push({
      level: 'warn',
      rule: 'stack-config',
      message: '.devflow-context/stack.yml no encontrado.',
      hint: 'Si es un context repo legacy, corré: dd-cli client migrate <slug> --apply',
    });
  } else {
    try {
      const stack = loadStackConfig(repoRoot);
      if (stack) {
        findings.push({
          level: 'ok',
          rule: 'stack-config',
          message: `stack.yml OK — ${stack.stack.backend_framework} + ${stack.stack.frontend_framework}`,
        });
      }
    } catch (e) {
      findings.push({
        level: 'err',
        rule: 'stack-config',
        message: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e),
        hint: `Revisá ${getStackConfigPath(repoRoot)}`,
      });
    }
  }

  // 4. catalog
  if (!hasCatalog(repoRoot)) {
    findings.push({
      level: 'warn',
      rule: 'catalog',
      message: 'No hay catalog.yml ni app-catalog.md',
      hint: 'Corré /devflow-ia:init-context para poblarlo.',
    });
  } else {
    try {
      const catalog = loadCatalog(repoRoot);
      const apps = catalog?.apps ?? [];
      findings.push({
        level: 'ok',
        rule: 'catalog',
        message: `catalog OK — ${apps.length} apps`,
      });

      // 5. Referencias auth y ci_cd
      const authAvailable = authProfilesAvailable(repoRoot);
      const cicdAvailable = cicdProfilesAvailable(repoRoot);

      for (const app of apps) {
        if (app.auth_profile && !authAvailable.has(app.auth_profile)) {
          findings.push({
            level: 'warn',
            rule: 'app-auth-ref',
            message: `App "${app.slug}" referencia auth_profile "${app.auth_profile}" que no existe en auth-profiles/`,
            hint: `Agregá auth-profiles/${app.auth_profile}.md`,
          });
        }
        if (app.ci_cd_profile && app.ci_cd_profile !== '[por-confirmar]'
            && !cicdAvailable.has(app.ci_cd_profile)) {
          findings.push({
            level: 'warn',
            rule: 'app-cicd-ref',
            message: `App "${app.slug}" referencia ci_cd_profile "${app.ci_cd_profile}" que no existe en cicd-profiles/`,
            hint: `Agregá cicd-profiles/${app.ci_cd_profile}.yml`,
          });
        }
      }

      // Si hay solo .md y no .yml, sugerir migración (no error)
      if (!existsSync(getCatalogYamlPath(repoRoot)) && existsSync(getCatalogMarkdownPath(repoRoot))) {
        findings.push({
          level: 'warn',
          rule: 'catalog-format',
          message: 'Catálogo en markdown legacy (app-catalog.md).',
          hint: `Migrá a YAML canónico: dd-cli context render (o dd-cli client migrate)`,
        });
      }
    } catch (e) {
      findings.push({
        level: 'err',
        rule: 'catalog',
        message: e instanceof Error ? (e.message.split('\n')[0] ?? e.message) : String(e),
      });
    }
  }

  return findings;
}

export async function runContextValidate(repoPathArg: string | undefined, opts: ContextValidateOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path.resolve(repoPathArg ?? process.cwd());

  if (!existsSync(repoRoot)) {
    const err = {
      code: 'INVALID_INPUT' as const,
      message: `El path "${repoRoot}" no existe.`,
      recovery_hints: ['Corré desde un context repo o pasá un path válido.'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context validate', ...err }));
    printErr(err.message);
    return 3;
  }

  const findings = validateContextRepo(repoRoot);
  const errors = findings.filter(f => f.level === 'err');
  const warnings = findings.filter(f => f.level === 'warn');
  const oks = findings.filter(f => f.level === 'ok');

  if (jsonMode) {
    emitJson(jsonSuccess('context validate', {
      repo_root: repoRoot,
      findings,
      summary: {
        ok: oks.length,
        warnings: warnings.length,
        errors: errors.length,
      },
      passed: errors.length === 0,
    }));
  }

  // Output humano
  console.log('');
  console.log(bold(`Validación del context repo: ${repoRoot}`));
  console.log('');
  for (const f of findings) {
    if (f.level === 'ok') printOk(`  ${f.rule}: ${f.message}`);
    else if (f.level === 'warn') printWarn(`  ${f.rule}: ${f.message}`);
    else printErr(`  ${f.rule}: ${f.message}`);
    if (f.hint) printDim(`     → ${f.hint}`);
  }
  console.log('');
  if (errors.length === 0 && warnings.length === 0) {
    printOk('Context repo válido.');
  } else if (errors.length === 0) {
    printInfo(`${oks.length} OK · ${warnings.length} warnings · 0 errores`);
  } else {
    printErr(`${oks.length} OK · ${warnings.length} warnings · ${errors.length} errores`);
  }
  return errors.length === 0 ? 0 : 3;
}
