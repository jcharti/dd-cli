/**
 * GitProvider — abstracción provider-agnóstica (D-6 Parte 3 del rediseño).
 *
 * Soporta GitLab (cloud + self-hosted) y GitHub (cloud + Enterprise) detrás
 * de la misma interface. `pattern-detector.ts` y la skill `/client-onboard`
 * reciben un `GitProvider` ya construido — no saben qué proveedor es.
 *
 * Bitbucket / Azure DevOps quedan para v2 con la misma interface.
 *
 * Scope v1 (Sprint 1):
 *   - validateToken / listGroupRepos / readFile / readFirstFound  → implementados.
 *   - createRepo / setBranchProtection / createPullRequest / configureWebhook
 *     → stubs que tiran NOT_IMPLEMENTED. Se completan en Sprint 3 (`client new`).
 */

export type ProviderType = 'gitlab' | 'github';

// ── Repo + Files ────────────────────────────────────────────────────

export interface RepoMeta {
  id: string | number;
  slug: string;                 // kebab-case path/name
  name: string;                 // display name / full_name
  description: string;
  url: string;                  // HTTPS clone URL
  ssh_url: string;
  default_branch: string;
  last_push: string;            // ISO 8601
  language: string | null;      // null si el provider no lo expone
  size_kb: number;
  topics: string[];
  archived: boolean;
  ci_config_path: string | null;
}

export interface FileContent {
  path: string;
  content: string;              // ya decodificado de base64
  found: boolean;
}

// ── Token validation (preflight, sección 4.7) ───────────────────────

export interface TokenValidation {
  valid: boolean;
  user: string | null;           // login/username del owner del token
  scopes_present: string[];      // los que sí tiene
  scopes_missing: string[];      // los que faltan según `required_for`
  is_admin_of_group: boolean | null;  // null si no se pudo determinar
  message: string;               // mensaje humano del provider
}

export interface ValidateTokenOpts {
  /**
   * Operaciones que el caller quiere validar. El provider calcula qué scopes
   * mínimos requiere cada una y reporta los que faltan.
   */
  required_for?: Array<'read' | 'write' | 'create_repo' | 'branch_protection' | 'webhook'>;
}

// ── Write-side (Sprint 3) — declarado, stub por defecto ─────────────

export interface CreateRepoOpts {
  name: string;
  description?: string;
  visibility?: 'private' | 'internal' | 'public';
  default_branch?: string;
  initialize_with_readme?: boolean;
}

export interface BranchProtectionRules {
  branch: string;
  require_pull_request?: boolean;
  required_approvals?: number;
  allow_force_push?: boolean;
}

export interface CreatePullRequestOpts {
  source_branch: string;
  target_branch: string;
  title: string;
  body: string;
}

export interface PullRequestRef {
  number: number;
  url: string;
}

export interface WebhookOpts {
  url: string;
  events: string[];              // ej: ['merge_request', 'push']
  secret?: string;
}

// ── Interface unificada ─────────────────────────────────────────────

export interface GitProvider {
  readonly type: ProviderType;
  readonly base_url: string;
  readonly group_or_org: string;

  // ── Read side (Sprint 1) ──────────────────────────────────────────
  validateToken(opts?: ValidateTokenOpts): Promise<TokenValidation>;
  listGroupRepos(): Promise<RepoMeta[]>;
  readFile(repoIdOrSlug: string | number, filePath: string, ref?: string): Promise<FileContent>;
  readFirstFound(repoIdOrSlug: string | number, candidates: string[], ref?: string): Promise<FileContent>;

  // ── Write side (Sprint 3 — declarado pero opcional) ───────────────
  createRepo?(opts: CreateRepoOpts): Promise<RepoMeta>;
  setBranchProtection?(repoIdOrSlug: string | number, rules: BranchProtectionRules): Promise<void>;
  createPullRequest?(repoIdOrSlug: string | number, opts: CreatePullRequestOpts): Promise<PullRequestRef>;
  configureWebhook?(repoIdOrSlug: string | number, opts: WebhookOpts): Promise<void>;
}

// ── Errors estructurados ────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly cause?: {
      provider: ProviderType;
      status?: number;
      body?: string;
    }
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class NotImplementedError extends ProviderError {
  constructor(provider: ProviderType, feature: string) {
    super(`${provider}: ${feature} no está implementado todavía (Sprint 3)`, { provider });
    this.name = 'NotImplementedError';
  }
}
