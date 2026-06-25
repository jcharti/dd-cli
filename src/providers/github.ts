/**
 * GitHubProvider — implementación de GitProvider para GitHub cloud y Enterprise.
 *
 * Scope: REST API v3 (https://docs.github.com/en/rest).
 * Auth: PAT classic con Authorization Bearer (también compatible con
 *       fine-grained PAT).
 *
 * Permisos esperados (ver sección 4.7 del doc rediseño):
 *   Classic PAT:        repo, admin:repo_hook (para webhooks)
 *   Fine-grained PAT:   Contents:Read/Write, Pull requests:Write,
 *                       Administration:Write (branch protection + crear repo),
 *                       Webhooks:Write
 */
import type {
  GitProvider,
  ProviderType,
  RepoMeta,
  FileContent,
  TokenValidation,
  ValidateTokenOpts,
  CreateRepoOpts,
  BranchProtectionRules,
  CreatePullRequestOpts,
  PullRequestRef,
  WebhookOpts,
} from './types.js';
import { ProviderError, NotImplementedError } from './types.js';

export interface GitHubProviderOpts {
  base_url: string;              // ej: https://api.github.com o https://github.empresa.com/api/v3
  org: string;                   // org o user
  token: string;
}

export class GitHubProvider implements GitProvider {
  readonly type: ProviderType = 'github';
  readonly base_url: string;
  readonly group_or_org: string;
  private readonly token: string;

  constructor(opts: GitHubProviderOpts) {
    this.base_url = opts.base_url.replace(/\/$/, '');
    this.group_or_org = opts.org;
    this.token = opts.token;
  }

  // ── HTTP helpers ──────────────────────────────────────────────────

  private async request(
    endpoint: string,
    params: Record<string, string> = {},
    init?: RequestInit
  ): Promise<{ json: unknown; headers: Headers }> {
    const url = new URL(`${this.base_url}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `GitHub API ${response.status} en ${endpoint}: ${body.slice(0, 300)}`,
        { provider: 'github', status: response.status, body }
      );
    }
    return { json: await response.json(), headers: response.headers };
  }

  // ── validateToken ─────────────────────────────────────────────────

  /**
   * GitHub Classic PAT: la API devuelve scopes en el header `x-oauth-scopes`.
   * Fine-grained PAT: el header viene vacío (los permisos son por-repo),
   * en ese caso reportamos `scopes_present: []` y dejamos que el caller
   * intente la operación — fallará con 403 si no tiene permiso.
   */
  private requiredScopesFor(op: NonNullable<ValidateTokenOpts['required_for']>[number]): string[] {
    switch (op) {
      case 'read':              return ['repo']; // o public_repo si público
      case 'write':             return ['repo'];
      case 'create_repo':       return ['repo'];
      case 'branch_protection': return ['repo'];
      case 'webhook':           return ['admin:repo_hook']; // o repo con admin
    }
  }

  async validateToken(opts: ValidateTokenOpts = {}): Promise<TokenValidation> {
    let user: string | null = null;
    let scopes_present: string[] = [];
    let is_admin_of_group: boolean | null = null;
    let message = '';

    try {
      const { json, headers } = await this.request('user');
      const u = json as { login?: string };
      user = u.login ?? null;

      const scopeHeader = headers.get('x-oauth-scopes') ?? '';
      scopes_present = scopeHeader
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      message = scopeHeader === '' ? 'Token válido (fine-grained PAT — scopes por-repo)' : 'Token válido';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        valid: false, user: null, scopes_present: [], scopes_missing: [],
        is_admin_of_group: null,
        message: `Token inválido o sin acceso a la API: ${msg}`,
      };
    }

    // Verificar membership/admin en el org
    if (user) {
      try {
        const { json } = await this.request(`orgs/${this.group_or_org}/memberships/${user}`);
        const membership = json as { role?: string; state?: string };
        is_admin_of_group = membership.role === 'admin' && membership.state === 'active';
      } catch {
        // Puede que sea un user repo, no org — dejamos null
      }
    }

    // Calcular scopes faltantes
    const required = new Set<string>();
    for (const op of opts.required_for ?? []) {
      for (const s of this.requiredScopesFor(op)) required.add(s);
    }
    // Fine-grained PATs no tienen scopes clásicos — no marcamos faltantes si scopes_present está vacío
    const scopes_missing = scopes_present.length === 0
      ? []
      : [...required].filter(s => !scopes_present.includes(s));

    return {
      valid: true,
      user,
      scopes_present,
      scopes_missing,
      is_admin_of_group,
      message,
    };
  }

  // ── listGroupRepos ────────────────────────────────────────────────

  async listGroupRepos(): Promise<RepoMeta[]> {
    const { json } = await this.request(
      `orgs/${this.group_or_org}/repos`,
      { per_page: '100', sort: 'pushed', direction: 'desc' }
    );
    const repos = json as Array<Record<string, unknown>>;

    return repos.map((r) => ({
      id: r['id'] as number,
      slug: (r['name'] as string) ?? '',
      name: (r['full_name'] as string) ?? '',
      description: (r['description'] as string) ?? '',
      url: (r['clone_url'] as string) ?? '',
      ssh_url: (r['ssh_url'] as string) ?? '',
      default_branch: (r['default_branch'] as string) ?? 'main',
      last_push: (r['pushed_at'] as string) ?? '',
      language: (r['language'] as string | null) ?? null,
      size_kb: (r['size'] as number) ?? 0,
      topics: (r['topics'] as string[]) ?? [],
      archived: (r['archived'] as boolean) ?? false,
      ci_config_path: null,
    }));
  }

  // ── readFile / readFirstFound ─────────────────────────────────────

  async readFile(
    repoIdOrSlug: string | number,
    filePath: string,
    ref: string = 'main'
  ): Promise<FileContent> {
    try {
      const { json } = await this.request(
        `repos/${this.group_or_org}/${repoIdOrSlug}/contents/${filePath}`,
        { ref }
      );
      const data = json as Record<string, string>;
      const content = Buffer.from(data['content'] ?? '', 'base64').toString('utf-8');
      return { path: filePath, content, found: true };
    } catch {
      return { path: filePath, content: '', found: false };
    }
  }

  async readFirstFound(
    repoIdOrSlug: string | number,
    candidates: string[],
    ref: string = 'main'
  ): Promise<FileContent> {
    for (const candidate of candidates) {
      const result = await this.readFile(repoIdOrSlug, candidate, ref);
      if (result.found) return result;
    }
    return { path: candidates[0] ?? '', content: '', found: false };
  }

  // ── Write side (Sprint 3 stubs) ──────────────────────────────────

  async createRepo(_opts: CreateRepoOpts): Promise<RepoMeta> {
    throw new NotImplementedError('github', 'createRepo');
  }

  async setBranchProtection(_repo: string | number, _rules: BranchProtectionRules): Promise<void> {
    throw new NotImplementedError('github', 'setBranchProtection');
  }

  async createPullRequest(_repo: string | number, _opts: CreatePullRequestOpts): Promise<PullRequestRef> {
    throw new NotImplementedError('github', 'createPullRequest');
  }

  async configureWebhook(_repo: string | number, _opts: WebhookOpts): Promise<void> {
    throw new NotImplementedError('github', 'configureWebhook');
  }
}
