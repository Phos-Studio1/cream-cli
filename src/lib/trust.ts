import path from 'node:path';
import type { Config, FolderTrust } from './config.js';

export type TrustChoice = FolderTrust | 'exit';

export function folderKey(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function folderTrust(folders: Config['folders'], dir = process.cwd()): FolderTrust | undefined {
  let current = folderKey(dir);
  while (true) {
    const decision = folders[current];
    if (decision) return decision;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function autoApproves(config: Config, tool: string, dir = process.cwd()): boolean {
  return config.autoApprove || (tool !== 'screenshot' && folderTrust(config.folders, dir) === 'trust');
}
