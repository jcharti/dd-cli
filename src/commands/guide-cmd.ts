/**
 * `dd-cli guide <topic>` (S5-11) — abre una guía paginada en terminal.
 *
 * Topics soportados:
 *   hdu        — flujo completo de HDUs (S5-11)
 *   onboarding — flujo de onboarding de cliente
 *
 * Resuelve la doc del path en runtime (busca en dist/docs/ o ../docs/).
 * Usa `less` si está disponible; si no, dumpea con paginación naïve.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJsonMode, emitJson, jsonError, type JsonModeOpts } from '../utils/json-output.js';
import { printErr, printDim, bold } from '../utils/output.js';

export interface GuideOpts extends JsonModeOpts {}

const TOPICS: Record<string, string> = {
  'hdu': 'guia-hdu-flow.md',
  'hdus': 'guia-hdu-flow.md',
  'onboarding': 'guia-empresa.md',
  'dev': 'guia-dev-cli.md',
};

function resolveDocsPath(filename: string): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../docs', filename),
      path.resolve(here, '../../docs', filename),
      path.resolve(here, '../../../docs', filename),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } catch {
    // fallback
  }
  return null;
}

export async function runGuide(topic: string | undefined, opts: GuideOpts = {}): Promise<number> {
  const jsonMode = isJsonMode(opts);

  if (!topic) {
    if (jsonMode) {
      emitJson(jsonError({
        command: 'guide',
        code: 'INVALID_INPUT',
        message: 'Falta el topic. Uso: dd-cli guide <topic>',
        context: { available_topics: Object.keys(TOPICS) },
      }));
    }
    console.log('');
    console.log(bold('Guías disponibles:'));
    for (const t of Object.keys(TOPICS)) {
      console.log(`  dd-cli guide ${t}`);
    }
    console.log('');
    return 3;
  }

  const filename = TOPICS[topic];
  if (!filename) {
    const e = {
      code: 'INVALID_INPUT' as const,
      message: `Topic "${topic}" no existe.`,
      context: { available_topics: Object.keys(TOPICS) },
      recovery_hints: [`Topics: ${Object.keys(TOPICS).join(', ')}`],
    };
    if (jsonMode) emitJson(jsonError({ command: 'guide', ...e }));
    printErr(e.message);
    return 3;
  }

  const docPath = resolveDocsPath(filename);
  if (!docPath) {
    const e = {
      code: 'CONFIG_MISSING' as const,
      message: `No pude resolver el path de la guía "${filename}".`,
      context: { filename },
      recovery_hints: ['Reinstalá el CLI o reportá el bug'],
    };
    if (jsonMode) emitJson(jsonError({ command: 'guide', ...e }));
    printErr(e.message);
    return 1;
  }

  // Si hay TTY y less está disponible, pasar el archivo a less.
  // Si no, dumpear directo (útil para CI / scripts / vista rápida).
  const lessAvailable = process.stdout.isTTY && spawnSync('which', ['less'], { stdio: 'ignore' }).status === 0;

  if (lessAvailable) {
    spawnSync('less', ['-R', docPath], { stdio: 'inherit' });
    return 0;
  }

  // Fallback: dump al stdout
  const content = readFileSync(docPath, 'utf-8');
  process.stdout.write(content);
  if (!process.stdout.isTTY) return 0;
  console.log('');
  printDim('— fin de la guía. Para paginar mejor, instalá `less`.');
  return 0;
}
