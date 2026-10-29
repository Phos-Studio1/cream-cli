import path from 'node:path';
import type { Config, FolderTrust } from './config.js';

export type TrustChoice = FolderTrust | 'exit';

export function folderKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function* ancestors(dir: string): Generator<string> {
  let current = folderKey(dir);
  while (true) {
    yield current;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function folderTrust(folders: Config['folders'], dir = process.cwd()): FolderTrust | undefined {
  for (const folder of ancestors(dir)) if (folders[folder]) return folders[folder];
  return undefined;
}

export function allowedTools(allowed: Config['allowed'], dir = process.cwd()): Set<string> {
  return new Set([...ancestors(dir)].flatMap((folder) => allowed[folder] ?? []));
}

export function allowTool(allowed: Config['allowed'], key: string, dir = process.cwd()): Config['allowed'] {
  const folder = folderKey(dir);
  const current = allowed[folder] ?? [];
  return current.includes(key) ? allowed : { ...allowed, [folder]: [...current, key] };
}

export function autoApproves(config: Config, tool: string, dir = process.cwd()): boolean {
  return config.autoApprove || (tool !== 'screenshot' && folderTrust(config.folders, dir) === 'trust');
}
