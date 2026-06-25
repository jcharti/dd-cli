/**
 * Tests del marcador y heurística de context repo (S2-3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  ContextRepoSchema,
  isContextRepo,
  loadContextRepoMarker,
  saveContextRepoMarker,
  getContextRepoMarkerPath,
} from './context-repo.js';

describe('ContextRepoSchema', () => {
  it('acepta marcador mínimo válido', () => {
    const r = ContextRepoSchema.safeParse({
      kind: 'context-repo',
      client: { slug: 'iprsa', name: 'IPRSA' },
      last_generated_at: new Date().toISOString(),
      cli_version: '0.6.0',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza kind != "context-repo"', () => {
    const r = ContextRepoSchema.safeParse({
      kind: 'code-repo',
      client: { slug: 'x', name: 'X' },
      last_generated_at: 'x',
      cli_version: '0.6.0',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza slug con mayúsculas', () => {
    const r = ContextRepoSchema.safeParse({
      kind: 'context-repo',
      client: { slug: 'BadSlug', name: 'X' },
      last_generated_at: 'x',
      cli_version: '0.6.0',
    });
    expect(r.success).toBe(false);
  });

  it('acepta provider opcional con cualquiera de los dos types', () => {
    for (const type of ['gitlab', 'github'] as const) {
      const r = ContextRepoSchema.safeParse({
        kind: 'context-repo',
        client: { slug: 'foo', name: 'Foo' },
        provider: { type, base_url: 'https://gitlab.com', group_or_org: 'foo' },
        last_generated_at: 'x',
        cli_version: '0.6.0',
      });
      expect(r.success).toBe(true);
    }
  });
});

describe('isContextRepo', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ctxrepo-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('false cuando no hay nada DevFlow', () => {
    expect(isContextRepo(tmpRoot)).toBe(false);
  });

  it('false para un repo de código (.devflow/config.yml sin .devflow-context/)', () => {
    mkdirSync(path.join(tmpRoot, '.devflow'));
    writeFileSync(path.join(tmpRoot, '.devflow/config.yml'), 'client:\n', 'utf-8');
    expect(isContextRepo(tmpRoot)).toBe(false);
  });

  it('true cuando hay marcador canónico', () => {
    mkdirSync(path.join(tmpRoot, '.devflow-context'));
    writeFileSync(getContextRepoMarkerPath(tmpRoot), 'kind: context-repo\n', 'utf-8');
    expect(isContextRepo(tmpRoot)).toBe(true);
  });

  it('true post-migración (stack.yml presente, .devflow/config.yml legacy coexiste)', () => {
    mkdirSync(path.join(tmpRoot, '.devflow'));
    writeFileSync(path.join(tmpRoot, '.devflow/config.yml'), 'project:\n', 'utf-8');
    mkdirSync(path.join(tmpRoot, '.devflow-context'));
    writeFileSync(path.join(tmpRoot, '.devflow-context/stack.yml'), 'client:\n', 'utf-8');
    expect(isContextRepo(tmpRoot)).toBe(true);
  });

  it('true pre-migración: catalog.md o catalog.yml', () => {
    mkdirSync(path.join(tmpRoot, '.devflow-context'));
    writeFileSync(path.join(tmpRoot, '.devflow-context/app-catalog.md'), '# x\n', 'utf-8');
    expect(isContextRepo(tmpRoot)).toBe(true);
  });

  it('true heurística legacy: .devflow-context/ sin .devflow/config.yml', () => {
    mkdirSync(path.join(tmpRoot, '.devflow-context'));
    writeFileSync(path.join(tmpRoot, '.devflow-context/algo.md'), 'x', 'utf-8');
    expect(isContextRepo(tmpRoot)).toBe(true);
  });
});

describe('marker I/O', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'ctxrepo-io-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('save + load round-trip', () => {
    const marker = ContextRepoSchema.parse({
      kind: 'context-repo' as const,
      client: { slug: 'iprsa', name: 'Inmobiliaria Reñaca S.A.' },
      provider: { type: 'gitlab' as const, base_url: 'https://gitlab.com', group_or_org: 'iprsa-group' },
      last_generated_at: '2026-06-24T15:30:00Z',
      cli_version: '0.6.0',
    });
    saveContextRepoMarker(tmpRoot, marker);
    const loaded = loadContextRepoMarker(tmpRoot);
    expect(loaded?.client.slug).toBe('iprsa');
    expect(loaded?.provider?.type).toBe('gitlab');
    expect(loaded?.cli_version).toBe('0.6.0');
  });

  it('loadContextRepoMarker tira con mensaje claro si YAML inválido', () => {
    mkdirSync(path.join(tmpRoot, '.devflow-context'));
    writeFileSync(getContextRepoMarkerPath(tmpRoot), 'kind: wrong\n', 'utf-8');
    expect(() => loadContextRepoMarker(tmpRoot)).toThrow(/inválido/);
  });

  it('loadContextRepoMarker retorna null si no existe', () => {
    expect(loadContextRepoMarker(tmpRoot)).toBeNull();
  });
});
