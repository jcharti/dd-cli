/**
 * Tests de consistencia de versión (S4-7, resuelve A-2 del rediseño).
 *
 * El bug histórico: CLI_VERSION estaba hardcoded en src/index.ts y derivaba
 * del package.json al bumpear. Ahora se lee dinámicamente desde el package.json;
 * estos tests garantizan que el contrato se mantenga.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, '../package.json');
const skillsDir = path.resolve(here, '../skills');

describe('CLI_VERSION', () => {
  it('coincide con package.json', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });

  it('es semver válido', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it('no es el fallback "0.0.0-unknown"', () => {
    expect(CLI_VERSION).not.toBe('0.0.0-unknown');
  });
});

describe('skills bundle', () => {
  function countSkillsRecursive(dir: string, exclude: Set<string> = new Set()): number {
    if (!existsSync(dir)) return 0;
    let count = 0;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        count += countSkillsRecursive(full, exclude);
      } else if (entry.endsWith('.md') && !exclude.has(entry)) {
        count++;
      }
    }
    return count;
  }

  // Archivos meta que el bundler ignora
  const META = new Set(['AUDIT.md', 'CUSTOMIZATION.md', 'ENFORCEMENT.md', 'DISENO_INIT_CONTEXT.md', 'PLAN.md']);

  it('skills/ contiene al menos 20 skills bundled', () => {
    if (!existsSync(skillsDir)) {
      // En CI puede que no exista — saltar
      return;
    }
    const count = countSkillsRecursive(skillsDir, META);
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('dist/skills/ existe después de build:full y coincide con source', () => {
    const distSkills = path.resolve(here, '../dist/skills');
    if (!existsSync(distSkills) || !existsSync(skillsDir)) {
      // Sin build no se puede verificar — saltar (CI corre tests antes del build)
      return;
    }
    const sourceCount = countSkillsRecursive(skillsDir, META);
    const distCount = countSkillsRecursive(distSkills, META);
    expect(distCount).toBe(sourceCount);
  });
});
