/**
 * Utilidades de paths del proyecto y de la instalación global de Claude Code.
 */
import { existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Detecta el root del proyecto actual.
 * Estrategia: buscar `.devflow/` ascendiendo, o si no existe, buscar `package.json` / `.git`.
 */
export function getProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    if (existsSync(path.join(current, '.devflow'))) {
      return current;
    }
    current = path.dirname(current);
  }

  // Si no encontró .devflow/, devuelve cwd (sesión nueva)
  return path.resolve(startDir);
}

export function getSessionPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'session.json');
}

export function getDevflowDir(projectRoot: string): string {
  return path.join(projectRoot, '.devflow');
}

export function getHeartbeatLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.devflow', 'heartbeat.log');
}

/**
 * Path donde Claude Code lee skills y settings.
 */
export function getClaudeHome(): string {
  return path.join(os.homedir(), '.claude');
}

export function getClaudeSkillsDir(): string {
  // Claude Code lee slash commands desde ~/.claude/commands/
  // El subdirectorio devflow-ia agrupa las skills del método
  return path.join(getClaudeHome(), 'commands', 'devflow-ia');
}

export function getClaudeCommandsDir(): string {
  return path.join(getClaudeHome(), 'commands');
}

export function getProjectClaudeDir(projectRoot: string): string {
  return path.join(projectRoot, '.claude');
}

export function getProjectClaudeSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'settings.json');
}

/**
 * Verifica que Claude Code esté instalado (existe `~/.claude/`).
 */
export function isClaudeCodeInstalled(): boolean {
  const dir = getClaudeHome();
  return existsSync(dir) && statSync(dir).isDirectory();
}
