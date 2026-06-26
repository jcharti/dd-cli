#!/usr/bin/env node
/**
 * bundle-skills.js — copia las 19 skills a dist/skills/ y genera skills.checksums.
 *
 * Estrategia de resolución del directorio fuente:
 *   1. ../skills/  (hermano del cli-package/, monorepo Digital-Dev)
 *   2. No encontrado → error
 *
 * Archivos excluidos (meta, no son skills):
 *   AUDIT.md, CUSTOMIZATION.md, ENFORCEMENT.md, DISENO_INIT_CONTEXT.md, PLAN.md
 */
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const META_FILES = new Set([
  'AUDIT.md', 'CUSTOMIZATION.md', 'ENFORCEMENT.md',
  'DISENO_INIT_CONTEXT.md', 'PLAN.md',
]);

function findSkillsSource() {
  // 1. Buscar en el propio repo (standalone — producción)
  const local = path.resolve(__dirname, '..', 'skills');
  if (existsSync(local)) return local;

  // 2. Buscar en la estructura del monorepo Digital-Dev (desarrollo)
  const monorepo = path.resolve(__dirname, '..', '..', 'skills');
  if (existsSync(monorepo)) return monorepo;

  console.error('✗ No se encontró el directorio skills/');
  console.error(`  Buscado en: ${local}`);
  console.error(`  Buscado en: ${monorepo}`);
  process.exit(1);
}

function sha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function copyTree(srcDir, destDir, checksums, relBase = '') {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

  for (const entry of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    const st = statSync(srcPath);

    if (st.isDirectory()) {
      copyTree(srcPath, destPath, checksums, path.join(relBase, entry));
    } else if (entry.endsWith('.md') && !META_FILES.has(entry)) {
      copyFileSync(srcPath, destPath);
      const relPath = path.join(relBase, entry);
      checksums[relPath] = sha256(srcPath);
    }
  }
}

const src = findSkillsSource();
const dest = path.resolve(__dirname, '..', 'dist', 'skills');
const checksumsPath = path.resolve(__dirname, '..', 'skills.checksums');

const checksums = {};
copyTree(src, dest, checksums);

const skillCount = Object.keys(checksums).length;
writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n');

console.log(`✓ ${skillCount} skills copiadas → dist/skills/`);
console.log(`✓ skills.checksums generado`);

// S5-11: copiar también docs/ a dist/docs/ para que `dd-cli guide` los
// resuelva en runtime (los busca relativos al dist/ por defecto).
const docsSrc = path.resolve(__dirname, '..', 'docs');
if (existsSync(docsSrc)) {
  const docsDest = path.resolve(__dirname, '..', 'dist', 'docs');
  if (!existsSync(docsDest)) mkdirSync(docsDest, { recursive: true });
  let docsCount = 0;
  for (const entry of readdirSync(docsSrc)) {
    const srcP = path.join(docsSrc, entry);
    if (statSync(srcP).isFile() && entry.endsWith('.md')) {
      copyFileSync(srcP, path.join(docsDest, entry));
      docsCount++;
    }
  }
  console.log(`✓ ${docsCount} guías copiadas → dist/docs/`);
}
