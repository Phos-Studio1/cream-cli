import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mcp } from '../src/lib/mcp.js';
import { executeTool, needsApproval, toolDefinitions } from '../src/lib/tools.js';
import { sleep } from './helpers.js';

const server = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-mcp-server.mjs');
const ctx = { cwd: process.cwd(), skills: [], signal: new AbortController().signal };

async function ready(name: string) {
  for (let i = 0; i < 100 && mcp.states.get(name)?.status !== 'ready'; i++) await sleep(100);
  return mcp.states.get(name);
}

afterEach(() => mcp.stopAll());

describe('MCP client', () => {
  it('exposes a small server directly with approval rules from annotations', async () => {
    mcp.sync({ small: { command: 'node', args: [server, '3'], enabled: true } }, 'test');
    expect(await ready('small')).toMatchObject({ status: 'ready', tools: 3 });
    const names = toolDefinitions([]).map((t) => t.function.name);
    expect(names).toContain('mcp__small__inspect_file');
    expect(names).not.toContain('mcp_find_tools');
    expect(needsApproval('mcp__small__inspect_file')).toBe(false);
    expect(needsApproval('mcp__small__run_probe')).toBe(true);
    const result = await executeTool({ id: '1', name: 'mcp__small__inspect_file', args: { path: 'a.exe' } }, ctx);
    expect(result).toEqual({ ok: true, output: 'inspect_file:a.exe' });
  });

  it('switches large servers to search mode', async () => {
    mcp.sync({ big: { command: 'node', args: [server, '40'], enabled: true } }, 'test');
    expect(await ready('big')).toMatchObject({ status: 'ready', tools: 40 });
    const names = toolDefinitions([]).map((t) => t.function.name);
    expect(names).toContain('mcp_find_tools');
    expect(names.some((n) => n.startsWith('mcp__big__'))).toBe(false);
    expect(mcp.search('inspect file')).toContain('## big / inspect_file (read-only)');
    const result = await executeTool({ id: '2', name: 'mcp_call_tool', args: { server: 'big', tool: 'extra_tool_7', arguments: { path: 'x' } } }, ctx);
    expect(result).toEqual({ ok: true, output: 'extra_tool_7:x' });
    expect(needsApproval('mcp_call_tool', { server: 'big', tool: 'inspect_file' })).toBe(false);
  });

  it('reports servers that fail to start', async () => {
    mcp.sync({ broken: { command: 'node', args: ['-e', 'process.exit(1)'], enabled: true } }, 'test');
    for (let i = 0; i < 100 && mcp.states.get('broken')?.status === 'starting'; i++) await sleep(100);
    expect(mcp.states.get('broken')?.status).toBe('error');
  });
});
