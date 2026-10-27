import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataRoot } from './paths.js';

export type Skill = {
  name: string;
  description: string;
  dir: string;
  file: string;
  source: 'user' | 'project';
  repo?: string;
};

export const userSkillsDir = path.join(dataRoot, 'skills');

export const defaultRepo = 'anthropics/skills';

export const bootstrapSkills: Record<string, string[]> = {
  'obra/superpowers': ['using-superpowers'],
};

const sourceFile = '.creamcli-source';

const projectSkillsDirs = () => [path.join(process.cwd(), '.cream', 'skills'), path.join(process.cwd(), '.creamcli', 'skills')];

const exec = promisify(execFile);

export function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1]!.split(/\r?\n/);
  const data: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i]!.match(/^([\w-]+):\s*(.*)$/);
    if (!entry) continue;
    let value = entry[2]!.trim();

    if (/^[>|][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) block.push(lines[++i]!.trim());
      value = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    data[entry[1]!] = value;
  }
  return data;
}

function readSource(dir: string): string | undefined {
  try {
    return fs.readFileSync(path.join(dir, sourceFile), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function loadSkills(): Skill[] {
  const found = new Map<string, Skill>();
  const roots: [string, Skill['source']][] = [
    [userSkillsDir, 'user'],
    ...projectSkillsDirs().map((dir): [string, Skill['source']] => [dir, 'project']),
  ];

  for (const [root, source] of roots) {
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const folder of names) {
      const dir = path.join(root, folder);
      const file = path.join(dir, 'SKILL.md');
      try {
        const meta = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const name = meta.name || folder;
        found.set(name, { name, description: meta.description ?? '', dir, file, source, repo: readSource(dir) });
      } catch {
        continue;
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(skill: Skill): string {
  const body = fs.readFileSync(skill.file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return [
    `Skill "${skill.name}" loaded. Skill directory: ${skill.dir}`,
    'Resolve relative paths in these instructions (scripts, reference files) against the skill directory.',
    '',
    body.trim(),
  ].join('\n');
}

function findSkillDirs(root: string, depth = 0): string[] {
  if (fs.existsSync(path.join(root, 'SKILL.md'))) return [root];
  if (depth > 3) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .flatMap((d) => findSkillDirs(path.join(root, d.name), depth + 1));
}

export const isRepo = (value: string) => /^[\w.-]+\/[\w.-]+$/.test(value);

export async function installSkills(repo: string, names: string[]): Promise<string[]> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'creamcli-skills-'));
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/tarball`, {
      headers: { 'User-Agent': 'Cream', Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) throw new Error(`repository ${repo} not found`);
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    fs.writeFileSync(path.join(tmp, 'repo.tgz'), Buffer.from(await res.arrayBuffer()));
    await exec('tar', ['-xzf', 'repo.tgz'], { cwd: tmp, windowsHide: true });

    const extracted = fs.readdirSync(tmp).find((n) => n !== 'repo.tgz');
    if (!extracted) throw new Error('archive was empty');
    const top = path.join(tmp, extracted);
    const skillsRoot = [path.join(top, 'skills'), path.join(top, '.agents', 'skills'), path.join(top, '.claude', 'skills')].find((dir) =>
      fs.existsSync(dir),
    );
    const dirs = findSkillDirs(skillsRoot ?? top);
    const available = new Map(dirs.map((dir) => [path.basename(dir), dir]));
    if (!available.size) throw new Error(`no SKILL.md files found in ${repo}`);

    const wanted = names.length && !names.includes('all') ? names : [...available.keys()];
    const missing = wanted.filter((n) => !available.has(n));
    if (missing.length) throw new Error(`unknown skill ${missing.join(', ')}. Available: ${[...available.keys()].join(', ')}`);

    fs.mkdirSync(userSkillsDir, { recursive: true });
    for (const name of wanted) {
      const target = path.join(userSkillsDir, name);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(available.get(name)!, target, { recursive: true });
      fs.writeFileSync(path.join(target, sourceFile), repo);
    }
    return wanted;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function removeSkill(name: string): boolean {
  const target = path.join(userSkillsDir, name);
  if (!fs.existsSync(path.join(target, 'SKILL.md'))) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}
