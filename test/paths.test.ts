import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateLegacyData } from '../src/lib/paths.js';

describe('migrateLegacyData', () => {
  it('copies legacy data once, rewrites attachment paths and keeps the originals', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-migrate-'));
    const legacyConfigDir = path.join(base, 'home', '.creamcli');
    const legacyInstallDir = path.join(base, 'app');
    const root = path.join(base, 'home', '.cream');
    fs.mkdirSync(path.join(legacyConfigDir, 'skills', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(legacyInstallDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(legacyInstallDir, 'attachments', 's1'), { recursive: true });
    fs.writeFileSync(path.join(legacyConfigDir, 'config.json'), '{"provider":"deepseek"}');
    fs.writeFileSync(path.join(legacyConfigDir, 'skills', 'demo', 'SKILL.md'), 'x');
    const oldImage = path.join(legacyInstallDir, 'attachments', 's1', 'a.png');
    fs.writeFileSync(oldImage, 'img');
    fs.writeFileSync(
      path.join(legacyInstallDir, 'sessions', 's1.json'),
      JSON.stringify({ id: 's1', conversation: [{ role: 'user', content: 'hi', images: [{ path: oldImage, mime: 'image/png' }] }] }),
    );

    const paths = { root, legacyConfigDir, legacyInstallDir };
    expect(migrateLegacyData(paths, true)).toEqual(['config', 'skills', 'sessions', 'attachments']);
    expect(migrateLegacyData(paths, true)).toEqual([]);

    const session = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 's1.json'), 'utf8'));
    const image = session.conversation[0].images[0].path;
    expect(image).toBe(path.join(root, 'attachments', 's1', 'a.png'));
    expect(fs.existsSync(image)).toBe(true);
    expect(fs.existsSync(path.join(legacyConfigDir, 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(legacyInstallDir, 'sessions', 's1.json'))).toBe(true);
  });
});
