import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const override = process.env.CREAM_HOME ?? process.env.CREAMCLI_DATA_DIR;

export const dataRoot = override ? path.resolve(override) : path.join(os.homedir(), '.cream');

export const configPath = path.join(dataRoot, 'config.json');

export type MigrationPaths = { root: string; legacyConfigDir: string; legacyInstallDir: string };

const defaultMigration: MigrationPaths = {
  root: dataRoot,
  legacyConfigDir: path.join(os.homedir(), '.creamcli'),
  legacyInstallDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
};

function copyIfMissing(source: string, target: string): boolean {
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return true;
}

function rewriteAttachmentPaths(sessionsDir: string, from: string, to: string): void {
  if (!fs.existsSync(sessionsDir)) return;
  const escape = (p: string) => JSON.stringify(p).slice(1, -1);
  for (const file of fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'))) {
    const full = path.join(sessionsDir, file);
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes(escape(from))) fs.writeFileSync(full, text.split(escape(from)).join(escape(to)));
  }
}

export function migrateLegacyData(paths: MigrationPaths = defaultMigration, force = false): string[] {
  const { root, legacyConfigDir, legacyInstallDir } = paths;
  const marker = path.join(root, '.migrated');
  if ((override && !force) || fs.existsSync(marker)) return [];
  const moved: string[] = [];
  if (copyIfMissing(path.join(legacyConfigDir, 'config.json'), path.join(root, 'config.json'))) moved.push('config');
  if (copyIfMissing(path.join(legacyConfigDir, 'skills'), path.join(root, 'skills'))) moved.push('skills');
  if (path.resolve(legacyInstallDir) !== path.resolve(root))
    for (const dir of ['sessions', 'brain', 'attachments'])
      if (copyIfMissing(path.join(legacyInstallDir, dir), path.join(root, dir))) moved.push(dir);
  if (moved.includes('attachments'))
    rewriteAttachmentPaths(path.join(root, 'sessions'), path.join(legacyInstallDir, 'attachments'), path.join(root, 'attachments'));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString());
  return moved;
}
