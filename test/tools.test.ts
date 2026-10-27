import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { approvalKey, describeCall, executeTool, needsApproval, parseCall, toolDefinitions } from '../src/lib/tools.js';

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-tools-'));
const ctx = { cwd, skills: [], signal: new AbortController().signal };
const call = (name: string, args: Record<string, unknown>) => ({ id: name, name, args });

describe('tools', () => {
  it('writes, edits, reads and lists files relative to the working directory', async () => {
    expect((await executeTool(call('write_file', { path: 'dir/a.txt', content: 'one two' }), ctx)).ok).toBe(true);
    expect((await executeTool(call('edit_file', { path: 'dir/a.txt', old_text: 'two', new_text: '2' }), ctx)).ok).toBe(true);
    expect((await executeTool(call('read_file', { path: 'dir/a.txt' }), ctx)).output).toBe('one 2');
    expect((await executeTool(call('list_dir', { path: '.' }), ctx)).output).toBe('dir/');
  });

  it('refuses ambiguous edits', async () => {
    await executeTool(call('write_file', { path: 'b.txt', content: 'x x' }), ctx);
    const result = await executeTool(call('edit_file', { path: 'b.txt', old_text: 'x', new_text: 'y' }), ctx);
    expect(result).toMatchObject({ ok: false });
    expect(result.output).toContain('found 2 matches');
  });

  it('runs commands and reports the exit code', async () => {
    const ok = await executeTool(call('run_command', { command: 'node -e "console.log(21*2)"' }), ctx);
    expect(ok).toEqual({ ok: true, output: '42' });
    const fail = await executeTool(call('run_command', { command: 'node -e "process.exit(3)"' }), ctx);
    expect(fail.ok).toBe(false);
    expect(fail.output).toContain('[exit code 3]');
  });

  it('cancels a running command when aborted', async () => {
    const controller = new AbortController();
    const pending = executeTool(call('run_command', { command: 'node -e "setTimeout(() => {}, 20000)"' }), { ...ctx, signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.output).toContain('cancelled by user');
  });

  it('requires approval only for side effects', () => {
    expect(needsApproval('read_file')).toBe(false);
    expect(needsApproval('write_file')).toBe(true);
    expect(needsApproval('run_command')).toBe(true);
    expect(needsApproval('screenshot')).toBe(true);
    expect(needsApproval('mcp_find_tools')).toBe(false);
    expect(approvalKey(parseCall({ id: 'x', type: 'function', function: { name: 'mcp_call_tool', arguments: '{"server":"rea","tool":"list_strings"}' } }))).toBe(
      'mcp:rea/list_strings',
    );
  });

  it('parses arguments and describes calls', () => {
    expect(parseCall({ id: '1', type: 'function', function: { name: 'read_file', arguments: '{bad' } }).error).toBeDefined();
    expect(describeCall(call('run_command', { command: 'npm test' }))).toBe('npm test');
    expect(toolDefinitions([]).map((t) => t.function.name)).not.toContain('use_skill');
  });
});
