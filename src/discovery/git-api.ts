/**
 * Backward-compat shim — re-exports desde la abstracción `GitProvider`.
 *
 * El verdadero motor vive en `src/providers/{gitlab,github,factory}.ts` desde
 * S1-8 (D-6 Parte 3 del rediseño). Este archivo se mantiene porque
 * `pattern-detector.ts` y consumidores externos importan tipos desde acá.
 *
 * No agregues nueva lógica acá — toda capability nueva va en `src/providers/`.
 */
import type { ClientCredentials } from '../types/credentials.js';
import { createProvider } from '../providers/factory.js';
import type { GitProvider, RepoMeta, FileContent } from '../providers/types.js';

export type { RepoMeta, FileContent } from '../providers/types.js';

/**
 * @deprecated Usá `createProvider(creds)` desde `src/providers/factory.ts`.
 * Esta clase es un thin adapter para no romper consumidores existentes.
 */
export class GitApiClient {
  private readonly provider: GitProvider;

  constructor(creds: ClientCredentials) {
    this.provider = createProvider(creds);
  }

  get host(): GitProvider['type'] { return this.provider.type; }

  async listRepos(): Promise<RepoMeta[]> {
    return this.provider.listGroupRepos();
  }

  async readFile(
    repoIdOrSlug: string | number,
    filePath: string,
    branch: string = 'main'
  ): Promise<FileContent> {
    return this.provider.readFile(repoIdOrSlug, filePath, branch);
  }

  async readFirstFound(
    repoIdOrSlug: string | number,
    candidates: string[],
    branch: string = 'main'
  ): Promise<FileContent> {
    return this.provider.readFirstFound(repoIdOrSlug, candidates, branch);
  }
}

/** @deprecated Usá `createProvider(creds)` desde `src/providers/factory.ts`. */
export function createGitApiClient(creds: ClientCredentials): GitApiClient {
  return new GitApiClient(creds);
}
