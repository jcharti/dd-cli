/**
 * Tests E2E de los providers (S4-6) — mock HTTP con MSW.
 *
 * Cubren contratos críticos del GitProvider (S1-8) y del motor de discovery
 * (S2-1) sin pegarle a GitLab/GitHub reales:
 *   1. validateToken devuelve user, scopes, is_admin con shape estable.
 *   2. listGroupRepos mapea respuestas del provider a RepoMeta unificado.
 *   3. readFile decodifica base64 correctamente.
 *   4. analyzeRepo + synthesizeDiscovery sobre fixtures predecibles.
 *   5. Errores HTTP (401, 403, 404) tiran ProviderError con shape estable.
 *
 * Estos tests previenen regresiones cuando refactoreemos providers o discovery.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { GitLabProvider } from '../providers/gitlab.js';
import { GitHubProvider } from '../providers/github.js';
import { analyzeRepo, synthesizeDiscovery } from '../discovery/pattern-detector.js';
import { ProviderError } from '../providers/types.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const GITLAB_PAT_SELF = {
  user_id: 1001,
  scopes: ['read_api', 'api', 'write_repository'],
};

const GITLAB_USER = {
  id: 1001,
  username: 'jorge.chartier',
};

const GITLAB_GROUP = {
  id: 42,
  full_path: 'iprsa-group',
};

const GITLAB_GROUP_MEMBERS = [
  { username: 'jorge.chartier', access_level: 50 },  // Owner
];

const GITLAB_REPO_LIST = [
  {
    id: 100, path: 'portal-web', name: 'Portal Web',
    description: 'Portal de clientes',
    http_url_to_repo: 'https://gitlab.com/iprsa-group/portal-web.git',
    ssh_url_to_repo: 'git@gitlab.com:iprsa-group/portal-web.git',
    default_branch: 'main',
    last_activity_at: new Date().toISOString(),
    statistics: { repository_size: 5_120 },
    topics: ['portal'],
    archived: false,
    ci_config_path: null,
  },
  {
    id: 101, path: 'core-auth', name: 'Core Auth',
    description: 'Auth service',
    http_url_to_repo: 'https://gitlab.com/iprsa-group/core-auth.git',
    ssh_url_to_repo: 'git@gitlab.com:iprsa-group/core-auth.git',
    default_branch: 'main',
    last_activity_at: new Date().toISOString(),
    statistics: { repository_size: 2_048 },
    topics: ['auth'],
    archived: false,
    ci_config_path: null,
  },
];

function gitlabFile(content: string) {
  return {
    content: Buffer.from(content, 'utf-8').toString('base64'),
    encoding: 'base64',
  };
}

const GITHUB_USER = { login: 'jorgechartier' };
const GITHUB_REPO_LIST = [
  {
    id: 200, name: 'auth-bff', full_name: 'acme-corp/auth-bff',
    description: 'BFF de auth',
    clone_url: 'https://github.com/acme-corp/auth-bff.git',
    ssh_url: 'git@github.com:acme-corp/auth-bff.git',
    default_branch: 'main',
    pushed_at: new Date().toISOString(),
    language: 'TypeScript',
    size: 1_024,
    topics: ['nestjs', 'auth'],
    archived: false,
  },
];

// ── Server ──────────────────────────────────────────────────────────

const server = setupServer(
  // ── GitLab ─────────────────────────────────────────────────────
  http.get('https://gitlab.com/api/v4/personal_access_tokens/self', () =>
    HttpResponse.json(GITLAB_PAT_SELF)
  ),
  http.get('https://gitlab.com/api/v4/users/1001', () =>
    HttpResponse.json(GITLAB_USER)
  ),
  http.get('https://gitlab.com/api/v4/groups/iprsa-group', () =>
    HttpResponse.json(GITLAB_GROUP)
  ),
  http.get('https://gitlab.com/api/v4/groups/iprsa-group/members/all', () =>
    HttpResponse.json(GITLAB_GROUP_MEMBERS)
  ),
  http.get('https://gitlab.com/api/v4/groups/iprsa-group/projects', () =>
    HttpResponse.json(GITLAB_REPO_LIST)
  ),
  http.get('https://gitlab.com/api/v4/projects/100/repository/files/package.json', () =>
    HttpResponse.json(gitlabFile(JSON.stringify({
      dependencies: { '@angular/core': '17.0.0' },
      engines: { node: '20.x' },
    })))
  ),
  http.get('https://gitlab.com/api/v4/projects/101/repository/files/composer.json', () =>
    HttpResponse.json(gitlabFile(JSON.stringify({
      require: { php: '^8.2', 'laravel/framework': '^12.0', 'tymon/jwt-auth': '^2.0' },
    })))
  ),
  // 404 para los archivos que no existen
  http.get(/\/api\/v4\/projects\/\d+\/repository\/files\/.+/, () =>
    HttpResponse.json({ message: 'File not found' }, { status: 404 })
  ),

  // ── GitHub ─────────────────────────────────────────────────────
  http.get('https://api.github.com/user', () =>
    HttpResponse.json(GITHUB_USER, {
      headers: { 'x-oauth-scopes': 'repo, admin:repo_hook' },
    })
  ),
  http.get('https://api.github.com/orgs/acme-corp/memberships/jorgechartier', () =>
    HttpResponse.json({ role: 'admin', state: 'active' })
  ),
  http.get('https://api.github.com/orgs/acme-corp/repos', () =>
    HttpResponse.json(GITHUB_REPO_LIST)
  ),
  http.get('https://api.github.com/repos/acme-corp/auth-bff/contents/package.json', () =>
    HttpResponse.json({
      content: Buffer.from(JSON.stringify({
        dependencies: { '@nestjs/core': '10.0.0', 'jsonwebtoken': '9.0.0' },
      }), 'utf-8').toString('base64'),
      encoding: 'base64',
    })
  ),
  http.get(/\/repos\/acme-corp\/.+\/contents\/.+/, () =>
    HttpResponse.json({ message: 'Not Found' }, { status: 404 })
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ── Tests: GitLabProvider ────────────────────────────────────────────

describe('GitLabProvider (mocked)', () => {
  const provider = new GitLabProvider({
    base_url: 'https://gitlab.com',
    group: 'iprsa-group',
    token: 'glpat-test-token',
  });

  it('validateToken devuelve shape estable con scopes_present y is_admin', async () => {
    const result = await provider.validateToken({ required_for: ['read', 'create_repo'] });
    expect(result.valid).toBe(true);
    expect(result.user).toBe('jorge.chartier');
    expect(result.scopes_present).toContain('api');
    expect(result.scopes_present).toContain('read_api');
    expect(result.scopes_missing).toHaveLength(0);
    expect(result.is_admin_of_group).toBe(true);
  });

  it('validateToken reporta scopes_missing si falta alguno', async () => {
    server.use(
      http.get('https://gitlab.com/api/v4/personal_access_tokens/self', () =>
        HttpResponse.json({ user_id: 1001, scopes: ['read_api'] })  // no tiene `api`
      )
    );
    const result = await provider.validateToken({ required_for: ['create_repo'] });
    expect(result.valid).toBe(true);
    expect(result.scopes_missing).toContain('api');
  });

  it('listGroupRepos mapea respuestas a RepoMeta unificado', async () => {
    const repos = await provider.listGroupRepos();
    expect(repos).toHaveLength(2);
    expect(repos[0]?.slug).toBe('portal-web');
    expect(repos[0]?.url).toBe('https://gitlab.com/iprsa-group/portal-web.git');
    expect(repos[0]?.default_branch).toBe('main');
    expect(repos[0]?.size_kb).toBe(5_120);
    expect(repos[1]?.slug).toBe('core-auth');
  });

  it('readFile decodifica base64 correctamente', async () => {
    const file = await provider.readFile(100, 'package.json');
    expect(file.found).toBe(true);
    expect(JSON.parse(file.content).dependencies['@angular/core']).toBe('17.0.0');
  });

  it('readFile retorna found: false en 404 sin tirar excepción', async () => {
    const file = await provider.readFile(100, 'no-existe.json');
    expect(file.found).toBe(false);
    expect(file.content).toBe('');
  });

  it('listGroupRepos tira ProviderError en 401', async () => {
    server.use(
      http.get('https://gitlab.com/api/v4/groups/iprsa-group/projects', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      )
    );
    await expect(provider.listGroupRepos()).rejects.toThrow(ProviderError);
  });
});

// ── Tests: GitHubProvider ────────────────────────────────────────────

describe('GitHubProvider (mocked)', () => {
  const provider = new GitHubProvider({
    base_url: 'https://api.github.com',
    org: 'acme-corp',
    token: 'ghp-test-token',
  });

  it('validateToken parsea x-oauth-scopes del header', async () => {
    const result = await provider.validateToken({ required_for: ['read'] });
    expect(result.valid).toBe(true);
    expect(result.user).toBe('jorgechartier');
    expect(result.scopes_present).toEqual(['repo', 'admin:repo_hook']);
    expect(result.is_admin_of_group).toBe(true);
  });

  it('validateToken con fine-grained PAT (sin x-oauth-scopes) no marca missing', async () => {
    server.use(
      http.get('https://api.github.com/user', () =>
        HttpResponse.json(GITHUB_USER) // sin header
      )
    );
    const result = await provider.validateToken({ required_for: ['create_repo'] });
    expect(result.valid).toBe(true);
    expect(result.scopes_present).toEqual([]);
    expect(result.scopes_missing).toEqual([]);  // fine-grained → no marcamos missing
    expect(result.message).toContain('fine-grained');
  });

  it('listGroupRepos mapea respuestas de GitHub', async () => {
    const repos = await provider.listGroupRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]?.slug).toBe('auth-bff');
    expect(repos[0]?.language).toBe('TypeScript');
    expect(repos[0]?.url).toBe('https://github.com/acme-corp/auth-bff.git');
  });

  it('readFile decodifica base64 de GitHub correctamente', async () => {
    const file = await provider.readFile('auth-bff', 'package.json');
    expect(file.found).toBe(true);
    expect(JSON.parse(file.content).dependencies['@nestjs/core']).toBe('10.0.0');
  });
});

// ── Tests: discovery end-to-end con fixtures ─────────────────────────

describe('Discovery end-to-end (mocked providers)', () => {
  it('GitLab: detecta stack Laravel + JWT en core-auth', async () => {
    const provider = new GitLabProvider({
      base_url: 'https://gitlab.com',
      group: 'iprsa-group',
      token: 'glpat-test-token',
    });
    const repos = await provider.listGroupRepos();
    const coreAuth = repos.find(r => r.slug === 'core-auth')!;
    const composer = await provider.readFile(coreAuth.id, 'composer.json');
    const analysis = analyzeRepo(coreAuth, { 'composer.json': composer });
    expect(analysis.stack.framework).toBe('laravel');
    expect(analysis.stack.php_version).toBe('8.2');
    expect(analysis.auth_pattern).toBe('custom-jwt');  // tymon/jwt-auth
  });

  it('GitLab: detecta stack Angular en portal-web', async () => {
    const provider = new GitLabProvider({
      base_url: 'https://gitlab.com',
      group: 'iprsa-group',
      token: 'glpat-test-token',
    });
    const repos = await provider.listGroupRepos();
    const portal = repos.find(r => r.slug === 'portal-web')!;
    const pkg = await provider.readFile(portal.id, 'package.json');
    const analysis = analyzeRepo(portal, { 'package.json': pkg });
    expect(analysis.stack.framework).toBe('angular');
    expect(analysis.stack.node_version).toBe('20.x');
    expect(analysis.app_type).toBe('frontend-app');
  });

  it('GitHub: synthesizeDiscovery sobre fixtures produce DiscoveryResult coherente', async () => {
    const provider = new GitHubProvider({
      base_url: 'https://api.github.com',
      org: 'acme-corp',
      token: 'ghp-test-token',
    });
    const repos = await provider.listGroupRepos();
    const analyses = [];
    for (const repo of repos) {
      const pkg = await provider.readFile(repo.slug, 'package.json');
      analyses.push(analyzeRepo(repo, { 'package.json': pkg }));
    }
    const discovery = synthesizeDiscovery(analyses);
    expect(discovery.active_repos).toBe(1);
    expect(discovery.repos[0]?.auth_pattern).toBe('custom-jwt');  // jsonwebtoken detectado
    expect(discovery.summary).toContain('1 repos en total');
  });
});
