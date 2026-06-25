/**
 * Tests de la factory de providers (S1-8 / D-6 Parte 3).
 *
 * Garantía: la abstracción GitProvider expone la interface correcta
 * por tipo, y la inferencia desde URL/host es estable.
 */
import { describe, it, expect } from 'vitest';
import { createProvider, inferProviderType } from './factory.js';
import { GitLabProvider } from './gitlab.js';
import { GitHubProvider } from './github.js';
import type { ClientCredentials } from '../types/credentials.js';

function creds(over: Partial<ClientCredentials> = {}): ClientCredentials {
  return {
    git_token: 'fake-token',
    git_host: 'gitlab',
    git_base_url: 'https://gitlab.com',
    git_group: 'iprsa-group',
    ...over,
  };
}

describe('providers/factory', () => {
  describe('inferProviderType', () => {
    it('prefiere git_host cuando está seteado', () => {
      expect(inferProviderType('gitlab', 'https://api.github.com')).toBe('gitlab');
      expect(inferProviderType('github', 'https://gitlab.com')).toBe('github');
    });

    it('infiere desde URL cuando host está ausente', () => {
      expect(inferProviderType(undefined, 'https://github.com/org')).toBe('github');
      expect(inferProviderType(undefined, 'https://api.github.com')).toBe('github');
      expect(inferProviderType(undefined, 'https://gitlab.com')).toBe('gitlab');
      expect(inferProviderType(undefined, 'https://gitlab.empresa.cl')).toBe('gitlab');
    });

    it('default a gitlab si no se puede determinar', () => {
      expect(inferProviderType(undefined, 'https://example.com')).toBe('gitlab');
    });
  });

  describe('createProvider', () => {
    it('construye GitLabProvider para git_host=gitlab', () => {
      const p = createProvider(creds({ git_host: 'gitlab' }));
      expect(p).toBeInstanceOf(GitLabProvider);
      expect(p.type).toBe('gitlab');
      expect(p.group_or_org).toBe('iprsa-group');
    });

    it('construye GitHubProvider para git_host=github', () => {
      const p = createProvider(creds({
        git_host: 'github',
        git_base_url: 'https://api.github.com',
        git_group: 'jcharti',
      }));
      expect(p).toBeInstanceOf(GitHubProvider);
      expect(p.type).toBe('github');
      expect(p.group_or_org).toBe('jcharti');
    });

    it('normaliza github.com → api.github.com como base_url', () => {
      const p = createProvider(creds({
        git_host: 'github',
        git_base_url: 'https://github.com',
      }));
      expect(p.base_url).toBe('https://api.github.com');
    });

    it('preserva GHE base_url y agrega /api/v3 si es necesario', () => {
      const p = createProvider(creds({
        git_host: 'github',
        git_base_url: 'https://github.empresa.com',
      }));
      expect(p.base_url).toBe('https://github.empresa.com/api/v3');
    });

    it('preserva base_url de gitlab self-hosted tal cual', () => {
      const p = createProvider(creds({
        git_host: 'gitlab',
        git_base_url: 'https://gitlab.empresa.cl',
      }));
      expect(p.base_url).toBe('https://gitlab.empresa.cl');
    });

    it('overrides ganan sobre los campos de creds', () => {
      const p = createProvider(creds(), {
        type: 'github',
        base_url: 'https://api.github.com',
        group_or_org: 'override-org',
      });
      expect(p.type).toBe('github');
      expect(p.group_or_org).toBe('override-org');
    });
  });

  describe('GitProvider interface', () => {
    it('GitLab implementa read-side completo', () => {
      const p = createProvider(creds());
      expect(typeof p.validateToken).toBe('function');
      expect(typeof p.listGroupRepos).toBe('function');
      expect(typeof p.readFile).toBe('function');
      expect(typeof p.readFirstFound).toBe('function');
    });

    it('GitHub implementa read-side completo', () => {
      const p = createProvider(creds({ git_host: 'github' }));
      expect(typeof p.validateToken).toBe('function');
      expect(typeof p.listGroupRepos).toBe('function');
      expect(typeof p.readFile).toBe('function');
      expect(typeof p.readFirstFound).toBe('function');
    });

    it('write-side declarado: tira NotImplementedError en GitLab (Sprint 3)', async () => {
      const p = createProvider(creds());
      await expect(p.createRepo?.({ name: 'foo' })).rejects.toThrow(/no está implementado/);
    });

    it('write-side declarado: tira NotImplementedError en GitHub (Sprint 3)', async () => {
      const p = createProvider(creds({ git_host: 'github' }));
      await expect(p.createRepo?.({ name: 'foo' })).rejects.toThrow(/no está implementado/);
    });
  });
});
