/**
 * Tests del motor de discovery (S2-1).
 * El comando `dd-cli client discover` es un wrapper sobre estas funciones —
 * sus tests viven acá para garantizar el contrato sin tocar APIs externas.
 */
import { describe, it, expect } from 'vitest';
import { analyzeRepo, synthesizeDiscovery } from './pattern-detector.js';
import type { RepoMeta, FileContent } from '../providers/types.js';

function meta(over: Partial<RepoMeta> = {}): RepoMeta {
  return {
    id: 1,
    slug: 'some-repo',
    name: 'some-repo',
    description: '',
    url: 'https://gitlab.com/g/some-repo',
    ssh_url: 'git@gitlab.com:g/some-repo.git',
    default_branch: 'main',
    last_push: new Date().toISOString(),
    language: null,
    size_kb: 100,
    topics: [],
    archived: false,
    ci_config_path: null,
    ...over,
  };
}

function file(path: string, content: string): FileContent {
  return { path, content, found: true };
}

describe('analyzeRepo', () => {
  it('detecta stack Laravel desde composer.json', () => {
    const composer = JSON.stringify({
      require: { php: '^8.2', 'laravel/framework': '^12.0' },
    });
    const result = analyzeRepo(meta({ slug: 'portal-web' }), {
      'composer.json': file('composer.json', composer),
    });
    expect(result.stack.language).toBe('php');
    expect(result.stack.framework).toBe('laravel');
    expect(result.stack.php_version).toBe('8.2');
    expect(result.stack.db).toBe('eloquent');
  });

  it('detecta stack NestJS desde package.json', () => {
    const pkg = JSON.stringify({
      dependencies: { '@nestjs/core': '^10.0', '@nestjs/typeorm': '^10.0', pg: '^8' },
      engines: { node: '20.x' },
    });
    const result = analyzeRepo(meta({ slug: 'auth-bff' }), {
      'package.json': file('package.json', pkg),
    });
    expect(result.stack.language).toBe('typescript/javascript');
    expect(result.stack.framework).toBe('nestjs');
    expect(result.stack.node_version).toBe('20.x');
    expect(result.app_type).toBe('bff');
  });

  it('detecta auth oauth2-oidc desde código que menciona keycloak', () => {
    const result = analyzeRepo(meta({ slug: 'core-auth' }), {
      'src/main.ts': file('src/main.ts', 'import { KeycloakConnect } from "keycloak-connect";'),
    });
    expect(result.auth_pattern).toBe('oauth2-oidc');
  });

  it('detecta auth custom-jwt cuando hay tymon/jwt-auth', () => {
    const result = analyzeRepo(meta({ slug: 'api-toku' }), {
      'composer.json': file('composer.json', JSON.stringify({
        require: { 'tymon/jwt-auth': '^2.0' },
      })),
    });
    expect(result.auth_pattern).toBe('custom-jwt');
  });

  it('detecta ci_stages desde .gitlab-ci.yml', () => {
    const ci = `stages:
  - build
  - test
  - deploy-qa
  - deploy-prod
`;
    const result = analyzeRepo(meta(), { '.gitlab-ci.yml': file('.gitlab-ci.yml', ci) });
    expect(result.ci_stages).toEqual(['build', 'test', 'deploy-qa', 'deploy-prod']);
  });

  it('detecta repo template por slug', () => {
    expect(analyzeRepo(meta({ slug: 'laravel-fullstack-template' }), {}).is_template).toBe(true);
    expect(analyzeRepo(meta({ slug: 'angular-starter' }), {}).is_template).toBe(true);
    expect(analyzeRepo(meta({ slug: 'mapa-cementerio' }), {}).is_template).toBe(false);
  });

  it('detecta portal shell desde single-spa en package.json', () => {
    const pkg = JSON.stringify({ dependencies: { 'single-spa': '^6' } });
    const result = analyzeRepo(meta({ slug: 'portal-shell' }), {
      'package.json': file('package.json', pkg),
    });
    expect(result.is_portal_shell).toBe(true);
    // single-spa también clasifica como frontend-mfe → is_mfe true.
    // Esto es esperado: el shell también es MFE-aware.
    expect(result.is_mfe).toBe(true);
  });

  it('repos sin single-spa ni "mfe" en slug NO se marcan como mfe', () => {
    const result = analyzeRepo(meta({ slug: 'plain-frontend' }), {
      'package.json': file('package.json', JSON.stringify({ dependencies: { react: '^18' } })),
    });
    expect(result.is_mfe).toBe(false);
  });

  it('marca inactive si last_push > 365 días', () => {
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const result = analyzeRepo(meta({ last_push: longAgo }), {});
    expect(result.inactive).toBe(true);
  });

  it('marca inactive si está archivado, sin importar last_push', () => {
    const result = analyzeRepo(meta({ archived: true, last_push: new Date().toISOString() }), {});
    expect(result.inactive).toBe(true);
  });
});

describe('synthesizeDiscovery', () => {
  it('agrupa por auth pattern y descarta unknowns', () => {
    const result = synthesizeDiscovery([
      analyzeRepo(meta({ slug: 'a' }), { 'src/main.ts': file('src/main.ts', 'keycloak') }),
      analyzeRepo(meta({ slug: 'b' }), { 'src/main.ts': file('src/main.ts', 'keycloak') }),
      analyzeRepo(meta({ slug: 'c' }), {}),  // unknown
    ]);
    expect(result.auth_profiles_detected).toEqual(['oauth2-oidc']);
    expect(result.repos).toHaveLength(3);
  });

  it('cuenta active vs inactive correctamente', () => {
    const longAgo = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    const result = synthesizeDiscovery([
      analyzeRepo(meta({ slug: 'a', last_push: recent }), {}),
      analyzeRepo(meta({ slug: 'b', last_push: recent }), {}),
      analyzeRepo(meta({ slug: 'c', last_push: longAgo }), {}),
    ]);
    expect(result.active_repos).toBe(2);
    expect(result.inactive_repos).toBe(1);
  });

  it('summary es legible y menciona contadores', () => {
    const result = synthesizeDiscovery([
      analyzeRepo(meta({ slug: 'a' }), {}),
    ]);
    expect(result.summary).toMatch(/1 repos en total/);
    expect(result.summary).toMatch(/1 activos/);
  });

  it('detecta templates y portal shell agregados', () => {
    const result = synthesizeDiscovery([
      analyzeRepo(meta({ slug: 'laravel-fullstack-template' }), {}),
      analyzeRepo(meta({ slug: 'portal-shell' }), {
        'package.json': file('package.json', JSON.stringify({ dependencies: { 'single-spa': '^6' } })),
      }),
    ]);
    expect(result.templates_detected).toContain('laravel-fullstack-template');
    expect(result.portal_shell).toBe('portal-shell');
  });
});
