import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addMemory, clearMemories, loadMemories, removeMemory } from '../src/lib/brain.js';
import { loadConfig, resolveActive, saveConfig } from '../src/lib/config.js';
import { configPath, dataRoot } from '../src/lib/paths.js';
import { deleteSession, listSessions, loadSession, newSessionId, saveSession, searchSessions, titleFrom } from '../src/lib/sessions.js';
import { loadSkills, parseFrontmatter } from '../src/lib/skills.js';

describe('sessions', () => {
  it('saves, lists, searches and deletes chats', () => {
    const id = newSessionId();
    const conversation = [
      { role: 'user' as const, content: 'How do I deploy the Roblox game?' },
      { role: 'assistant' as const, content: 'Use Publish to Roblox.' },
    ];
    saveSession({ id, title: titleFrom(conversation), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', provider: 'Test', model: 'm', cwd: '/', turns: 1, conversation, entries: [] });
    expect(listSessions().map((s) => s.title)).toContain('How do I deploy the Roblox game?');
    expect(loadSession(id.slice(0, 15))?.id).toBe(id);
    expect(searchSessions('roblox publish')).toContain(id);
    expect(deleteSession(id)).toBe(true);
    expect(loadSession(id)).toBeNull();
  });
});

describe('brain', () => {
  it('adds, deduplicates and removes memories', () => {
    clearMemories();
    const first = addMemory('User prefers TypeScript.');
    expect(addMemory('user prefers   typescript.').duplicate).toBe(true);
    expect(loadMemories()).toHaveLength(1);
    expect(removeMemory(first.memory.id)?.text).toBe('User prefers TypeScript.');
    expect(loadMemories()).toHaveLength(0);
  });
});

describe('config', () => {
  it('stores config under the data root', () => {
    expect(path.dirname(configPath)).toBe(dataRoot);
  });

  it('migrates legacy fields and drops unknown providers', () => {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3:4b',
        systemPrompt: 'Kamu adalah Cream, asisten yang ramah dan ringkas yang berjalan di terminal. Gunakan Markdown bila membantu.',
        apiKeys: { gone: 'x', deepseek: 'sk-1' },
      }),
    );
    const config = loadConfig();
    expect(config.provider).toBe('ollama');
    expect(config.models.ollama).toBe('qwen3:4b');
    expect(config.systemPrompt).toMatch(/^You are Cream/);
    expect(Object.keys(config.apiKeys)).toEqual(['deepseek']);
    saveConfig(config);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).provider).toBe('ollama');
  });

  it('prefers environment keys over stored keys', () => {
    const config = { ...loadConfig(), provider: 'deepseek' as const };
    expect(resolveActive(config).apiKey).toBe('sk-1');
    process.env.DEEPSEEK_API_KEY = 'sk-env';
    expect(resolveActive(config).apiKey).toBe('sk-env');
    delete process.env.DEEPSEEK_API_KEY;
  });
});

describe('skills', () => {
  it('parses quoted and folded frontmatter', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: "Use \\"this\\" skill"\n---\n')).toEqual({ name: 'a', description: 'Use "this" skill' });
    expect(parseFrontmatter('---\nname: b\ndescription: >\n  line one\n  line two\n---\n').description).toBe('line one line two');
  });

  it('loads skills from the data directory', () => {
    const dir = path.join(dataRoot, 'skills', 'demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nBody');
    expect(loadSkills().find((s) => s.name === 'demo')?.description).toBe('Demo skill');
  });
});
