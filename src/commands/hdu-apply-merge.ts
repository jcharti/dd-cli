/**
 * `dd-cli hdu apply-merge` (S5-4) — propaga transiciones HDU al mergear PR.
 *
 * Diseñado para correr DENTRO del context repo en un CI job (post-merge a main).
 *
 * Flujo:
 *   1. Detecta archivos hdus/*.md cambiados en el último commit (HEAD).
 *   2. Para cada uno, lee la HDU.
 *   3. Si status === 'draft' → cambia a 'approved' (lógica H-3 del rediseño:
 *      el merge a main equivale a aprobación del Tech Lead).
 *   4. Si la HDU venía con `dev_type_locked: false`, lo lockea con
 *      `dev_type_source: pr-merge`.
 *   5. Append a _transitions.jsonl con via: pr-merge + by del autor del commit.
 *   6. Regenera _index.yml.
 *   7. Si --commit, hace commit + push de los cambios.
 *
 * En `dry-run` (default): muestra qué haría pero no toca disco.
 *
 * NO requiere registry/credentials (corre en CI con el clone fresco).
 * Toma --path para apuntar al root del context repo (default cwd).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  listHdus, saveHdu, appendTransition, regenerateHduIndex,
  canHduTransitionTo, getHdusDir, type HduStatus,
} from '../types/hdu.js';
import { isJsonMode, emitJson, jsonSuccess, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printOk, printErr, printInfo, printDim, bold } from '../utils/output.js';

export interface HduApplyMergeOpts extends JsonModeOpts {
  path?: string;            // root del context repo, default cwd
  apply?: boolean;          // sin esto, dry-run
  commit?: boolean;         // commit + push de los cambios (cuando --apply)
  by?: string;              // actor del CI, default 'ci@devflow-ia'
}

interface ApplyAction {
  hdu_id: string;
  filename: string;
  from: HduStatus;
  to: HduStatus;
  applied: boolean;
}

function runGit(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function getChangedHdusFilesFromHead(repoRoot: string): string[] {
  try {
    // Diff entre HEAD y HEAD^1 (último commit). Si no hay HEAD^ (initial commit),
    // listar todos los archivos del repo.
    let cmd = 'git diff --name-only HEAD~1 HEAD';
    try {
      runGit('git rev-parse HEAD~1', repoRoot);
    } catch {
      cmd = 'git diff --name-only HEAD';
    }
    const files = runGit(cmd, repoRoot).split('\n').filter(Boolean);
    return files.filter(f => f.startsWith('hdus/') && f.endsWith('.md') && !path.basename(f).startsWith('_'));
  } catch {
    return [];
  }
}

function getCommitAuthorEmail(repoRoot: string): string | null {
  try {
    return runGit('git log -1 --format=%ae', repoRoot);
  } catch {
    return null;
  }
}

export async function runHduApplyMerge(opts: HduApplyMergeOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);
  const repoRoot = path.resolve(opts.path ?? process.cwd());

  if (!existsSync(getHdusDir(repoRoot))) {
    const e = {
      code: 'CONTEXT_REPO_INVALID' as const,
      message: `No hay hdus/ en ${repoRoot}. ¿Estás en un context repo?`,
      recovery_hints: [`Validá: dd-cli context validate ${repoRoot}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'hdu apply-merge', ...e }));
    printErr(e.message);
    return 3;
  }

  const changed = getChangedHdusFilesFromHead(repoRoot);

  if (changed.length === 0) {
    if (jsonMode) {
      emitJson(jsonSuccess('hdu apply-merge', {
        repo_root: repoRoot,
        actions: [],
        applied: false,
        committed: false,
      }));
    }
    printDim('No hay archivos hdus/*.md cambiados en HEAD.');
    return 0;
  }

  const allHdus = listHdus(repoRoot);
  const apply = !!opts.apply;
  const by = opts.by ?? getCommitAuthorEmail(repoRoot) ?? 'ci@devflow-ia';
  const actions: ApplyAction[] = [];

  for (const filename of changed) {
    const basename = path.basename(filename);
    const hdu = allHdus.find(h => h.filename === basename);
    if (!hdu) {
      printDim(`  (skip) ${basename} — no parsea como HDU`);
      continue;
    }
    const fromStatus = hdu.frontmatter.status;
    if (fromStatus !== 'draft') {
      printDim(`  (skip) ${hdu.frontmatter.id} — ya está en ${fromStatus}`);
      continue;
    }

    if (!canHduTransitionTo(fromStatus, 'approved')) {
      // No debería ocurrir desde draft → approved es legal, pero guard.
      continue;
    }

    actions.push({
      hdu_id: hdu.frontmatter.id,
      filename: basename,
      from: fromStatus,
      to: 'approved',
      applied: apply,
    });

    if (apply) {
      hdu.frontmatter.status = 'approved';
      hdu.frontmatter.approved_by = by;
      hdu.frontmatter.approved_at = new Date().toISOString();
      if (!hdu.frontmatter.dev_type_locked && hdu.frontmatter.dev_type) {
        hdu.frontmatter.dev_type_locked = true;
        hdu.frontmatter.dev_type_source = 'pr-merge';
      }
      saveHdu(repoRoot, hdu);
      appendTransition(repoRoot, {
        ts: new Date().toISOString(),
        hdu: hdu.frontmatter.id,
        from: fromStatus,
        to: 'approved',
        by,
        reason: 'merge to main approved by code review',
        via: 'pr-merge',
      });
    }
  }

  if (apply && actions.length > 0) {
    regenerateHduIndex(repoRoot);
  }

  let committed = false;
  if (apply && opts.commit && actions.length > 0) {
    try {
      runGit('git add hdus/', repoRoot);
      // Configurar git user si no está (caso CI fresh checkout)
      try { runGit('git config user.email', repoRoot); }
      catch { runGit('git config user.email "ci@devflow-ia"', repoRoot); }
      try { runGit('git config user.name', repoRoot); }
      catch { runGit('git config user.name "DevFlow IA CI"', repoRoot); }

      const msg = `chore(hdus): apply post-merge transitions

${actions.map(a => `- ${a.hdu_id}: ${a.from} → ${a.to}`).join('\n')}

Generado por dd-cli hdu apply-merge (S5-4).`;
      runGit(`git -c commit.gpgsign=false commit -m "${msg.replace(/"/g, '\\"')}"`, repoRoot);
      runGit('git push origin HEAD', repoRoot);
      committed = true;
    } catch (e) {
      if (jsonMode) {
        emitJson(jsonError({
          command: 'hdu apply-merge',
          code: 'GIT_PUSH_FAILED',
          message: `Push de transitions falló: ${e instanceof Error ? e.message : String(e)}`,
          context: { actions, applied: true, committed: false },
          recovery_hints: [
            'Verificá que el bot token tenga permisos de push a main',
            'Verificá branch protection (debe permitir bypass para el bot)',
          ],
        }));
      }
      printErr(`git push falló: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  if (jsonMode) {
    emitJson(jsonSuccess('hdu apply-merge', {
      repo_root: repoRoot,
      changed_files: changed,
      actions,
      applied: apply,
      committed,
    }));
  }

  console.log('');
  console.log(bold(`HDU apply-merge en ${repoRoot}`));
  for (const a of actions) {
    const marker = a.applied ? printOk : printInfo;
    marker(`  ${a.hdu_id}: ${a.from} → ${a.to}${apply ? '' : ' (dry-run)'}`);
  }
  if (actions.length === 0) printDim('  Nada para aplicar.');
  if (apply && opts.commit) {
    if (committed) printOk('Commit + push hechos.');
  } else if (actions.length > 0 && !apply) {
    console.log('');
    printDim('Para aplicar: dd-cli hdu apply-merge --apply --commit');
  }
  return 0;
}
