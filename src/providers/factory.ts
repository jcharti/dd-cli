/**
 * Factory para construir un GitProvider desde las credenciales del cliente.
 *
 * El caller no decide qué provider construir — sólo entrega las credenciales
 * y obtiene la interface unificada. Cumple D-6 Parte 3 del rediseño.
 *
 * Detección del provider:
 *   1. Si `creds.git_host` está seteado, gana.
 *   2. Si no, inferir desde `git_base_url`:
 *        contiene "github" → github
 *        else              → gitlab
 *
 * El registry / context-repo.yml también pueden guardar `provider` explícito
 * y pasarlo acá — eso es el caso preferido (sin inferencia).
 */
import type { ClientCredentials, GitHost } from '../types/credentials.js';
import type { GitProvider, ProviderType } from './types.js';
import { GitLabProvider } from './gitlab.js';
import { GitHubProvider } from './github.js';

export interface CreateProviderOverrides {
  type?: ProviderType;
  base_url?: string;
  group_or_org?: string;
}

/**
 * Construye un GitProvider concreto desde las credenciales registradas.
 * Por defecto usa los campos de `creds`; los overrides permiten ajustar
 * (útil para tests y para `client new` cuando el cliente no está aún en el registry).
 */
export function createProvider(
  creds: ClientCredentials,
  overrides: CreateProviderOverrides = {}
): GitProvider {
  const type = overrides.type ?? inferProviderType(creds.git_host, creds.git_base_url);
  const base_url = overrides.base_url ?? defaultBaseUrlFor(type, creds.git_base_url);
  const group_or_org = overrides.group_or_org ?? creds.git_group;

  switch (type) {
    case 'gitlab':
      return new GitLabProvider({
        base_url,
        group: group_or_org,
        token: creds.git_token,
      });
    case 'github':
      return new GitHubProvider({
        base_url,
        org: group_or_org,
        token: creds.git_token,
      });
  }
}

export function inferProviderType(host: GitHost | undefined, baseUrl: string): ProviderType {
  if (host === 'github') return 'github';
  if (host === 'gitlab') return 'gitlab';
  // bitbucket / azure todavía no soportados — caen a github si la URL los huele, else gitlab
  if (/github/i.test(baseUrl)) return 'github';
  return 'gitlab';
}

/**
 * GitLab usa el base_url tal cual (api/v4 lo agrega el provider).
 * GitHub cloud necesita https://api.github.com aunque el clone URL sea github.com.
 * GitHub Enterprise: <base>/api/v3.
 */
function defaultBaseUrlFor(type: ProviderType, raw: string): string {
  if (type === 'gitlab') return raw;
  // github cloud — si el caller pasa github.com queremos api.github.com
  if (/^https?:\/\/(www\.)?github\.com\/?$/i.test(raw)) {
    return 'https://api.github.com';
  }
  // si ya parece una URL de API, dejarla
  if (/\/api\/v\d/.test(raw)) return raw;
  // GHE: <base>/api/v3
  if (/github/i.test(raw)) return `${raw.replace(/\/$/, '')}/api/v3`;
  return raw;
}
