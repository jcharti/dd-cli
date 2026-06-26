/**
 * `dd-cli context install-ci [path]` (S5-4) — provisiona el CI job de HDU
 * transitions en el context repo del cliente.
 *
 * Detecta el provider desde `.context-repo.yml`:
 *   - gitlab  → copia templates/ci/gitlab-hdu-transitions.yml
 *               como ./.gitlab-ci.yml (o lo mergea si ya existe)
 *   - github  → copia templates/ci/github-hdu-transitions.yml
 *               como ./.github/workflows/hdu-transitions.yml
 *
 * Idempotente: si el archivo ya existe con el mismo contenido, no hace nada.
 * Si existe con contenido distinto, avisa y propone --force.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContextRepoMarker, isContextRepo } from '../types/context-repo.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printWarn, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface ContextInstallCiOpts extends JsonModeOpts {
  force?: boolean;
  provider?: 'gitlab' | 'github';  // override de detección automática
}

function resolveTemplatePath(filename: string): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../templates/ci', filename),
      path.resolve(here, '../../templates/ci', filename),
      path.resolve(here, '../../../templates/ci', filename),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch { /* */ }
  return null;
}

interface InstallResult {
  provider: 'gitlab' | 'github';
  target_path: string;
  template_path: string;
  action: 'written' | 'unchanged' | 'conflict' | 'overwritten';
}

export async function runContextInstallCi(repoPathArg: string | undefined, opts: ContextInstallCiOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path.resolve(repoPathArg ?? process.cwd());

  if (!existsSync(repoRoot) || !isContextRepo(repoRoot)) {
    const e = {
      code: 'CONTEXT_REPO_INVALID' as const,
      message: `${repoRoot} no parece ser un context repo.`,
      recovery_hints: ['Validá: dd-cli context validate'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context install-ci', ...e }));
    printErr(e.message);
    return 3;
  }

  // Detectar provider
  let provider: 'gitlab' | 'github' | undefined = opts.provider;
  if (!provider) {
    const marker = loadContextRepoMarker(repoRoot);
    provider = marker?.provider?.type;
  }
  if (!provider) {
    const e = {
      code: 'CONFIG_MISSING' as const,
      message: 'No pude detectar el provider del context repo.',
      recovery_hints: [
        'Asegurate que .devflow-context/.context-repo.yml tenga el campo provider',
        'O pasalo explícito: dd-cli context install-ci --provider=gitlab|github',
      ],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context install-ci', ...e }));
    printErr(e.message);
    return 2;
  }

  // Elegir template + target path
  const templateFilename = provider === 'gitlab'
    ? 'gitlab-hdu-transitions.yml'
    : 'github-hdu-transitions.yml';
  const targetRelPath = provider === 'gitlab'
    ? '.gitlab-ci.yml'
    : '.github/workflows/hdu-transitions.yml';
  const targetPath = path.join(repoRoot, targetRelPath);

  const templatePath = resolveTemplatePath(templateFilename);
  if (!templatePath) {
    const e = {
      code: 'CONFIG_MISSING' as const,
      message: `Template "${templateFilename}" no se encuentra en la instalación del CLI.`,
      recovery_hints: ['Reinstalá el CLI o reportá el bug'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'context install-ci', ...e }));
    printErr(e.message);
    return 1;
  }

  const templateContent = readFileSync(templatePath, 'utf-8');

  // Detectar acción
  let action: InstallResult['action'];
  if (!existsSync(targetPath)) {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, templateContent, 'utf-8');
    action = 'written';
  } else {
    const current = readFileSync(targetPath, 'utf-8');
    if (current === templateContent) {
      action = 'unchanged';
    } else if (opts.force) {
      writeFileSync(targetPath, templateContent, 'utf-8');
      action = 'overwritten';
    } else {
      action = 'conflict';
    }
  }

  const result: InstallResult = {
    provider,
    target_path: targetPath,
    template_path: templatePath,
    action,
  };

  if (jsonMode) {
    emitJson(jsonSuccess('context install-ci', result, action === 'conflict' ? `dd-cli context install-ci ${repoPathArg ?? ''} --force` : null));
  }

  console.log('');
  console.log(bold(`CI install — provider: ${provider}`));
  switch (action) {
    case 'written':
      printOk(`Escrito: ${targetPath}`);
      break;
    case 'unchanged':
      printDim(`Sin cambios: ${targetPath} ya está al día`);
      break;
    case 'overwritten':
      printOk(`Sobreescrito: ${targetPath}`);
      break;
    case 'conflict':
      printWarn(`Conflicto: ${targetPath} ya existe con contenido distinto`);
      printInfo('Para sobreescribir: dd-cli context install-ci --force');
      printInfo('Para mergearlo a mano: ver ' + templatePath);
      return 2;
  }

  if (action === 'written' || action === 'overwritten') {
    console.log('');
    printInfo('Próximos pasos:');
    printDim(`  1. Commit + push el archivo: cd ${repoRoot} && git add ${targetRelPath} && git commit -m "ci: install HDU transitions" && git push`);
    printDim(`  2. Configurar el bot token en el provider:`);
    if (provider === 'gitlab') {
      printDim('     GitLab → Project Settings → CI/CD → Variables → HDU_BOT_TOKEN (write_repository)');
    } else {
      printDim('     GitHub → Settings → Secrets and variables → Actions → HDU_BOT_TOKEN (repo)');
    }
    printDim(`  3. Ver la guía completa: ${resolveTemplatePath('README.md') ?? 'templates/ci/README.md'}`);
  }
  return 0;
}
