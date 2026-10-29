import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';
import { askFolderTrust, TrustPrompt } from '../src/components/TrustPrompt.js';
import { defaultConfig } from '../src/lib/config.js';
import { allowedTools, allowTool, autoApproves, folderKey, folderTrust, type TrustChoice } from '../src/lib/trust.js';
import { sleep } from './helpers.js';

const project = path.join(os.tmpdir(), 'Cream-Trust', 'project');

describe('folder trust', () => {
  it('applies a decision to the folder and its subfolders', () => {
    const folders = { [folderKey(project)]: 'trust' as const };
    expect(folderTrust(folders, project)).toBe('trust');
    expect(folderTrust(folders, path.join(project, 'src', 'lib'))).toBe('trust');
    expect(folderTrust(folders, path.dirname(project))).toBeUndefined();
  });

  it('lets the closest decision win', () => {
    const folders = { [folderKey(project)]: 'trust' as const, [folderKey(path.join(project, 'vendor'))]: 'ask' as const };
    expect(folderTrust(folders, path.join(project, 'vendor', 'pkg'))).toBe('ask');
  });

  it('auto-approves tools in trusted folders except screenshots', () => {
    const config = { ...defaultConfig, folders: { [folderKey(project)]: 'trust' as const } };
    expect(autoApproves(config, 'run_command', project)).toBe(true);
    expect(autoApproves(config, 'screenshot', project)).toBe(false);
    expect(autoApproves({ ...config, folders: { [folderKey(project)]: 'ask' } }, 'run_command', project)).toBe(false);
    expect(autoApproves({ ...config, autoApprove: true, folders: {} }, 'screenshot', project)).toBe(true);
  });
});

describe('TrustPrompt', () => {
  it('returns the chosen option', async () => {
    const choose = async (keys: string) => {
      const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
      const stdout = Object.assign(new Writable({ write: (_c, _e, cb) => cb() }), { isTTY: true, columns: 100, rows: 20 });
      let result: TrustChoice | undefined;
      const app = render(<TrustPrompt folder={project} onChoose={(c) => (result = c)} />, {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
      });
      await sleep(50);
      stdin.write(keys);
      await sleep(80);
      app.unmount();
      return result;
    };
    expect(await choose('\r')).toBe('trust');
    expect(await choose('2')).toBe('ask');
    expect(await choose('\x1b[B\x1b[B\r')).toBe('exit');
  });
});

describe('askFolderTrust', () => {
  it('resolves with the choice and releases the terminal for the next render', async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
    let output = '';
    const stdout = Object.assign(
      new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      { isTTY: true, columns: 100, rows: 20 },
    );
    const options = { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false };
    const pending = askFolderTrust(project, options);
    await sleep(100);
    expect(output).toContain('Do you trust the files in this folder?');
    stdin.write('2');
    await expect(pending).resolves.toBe('ask');
    expect(stdin.listenerCount('readable')).toBe(0);
  });
});

describe('always-allowed tools', () => {
  it('remembers tools per folder and applies them to subfolders', () => {
    let allowed = allowTool({}, 'run_command', project);
    allowed = allowTool(allowed, 'run_command', project);
    allowed = allowTool(allowed, 'mcp:rea/list_strings', path.join(project, 'sub'));
    expect(allowed[folderKey(project)]).toEqual(['run_command']);
    expect([...allowedTools(allowed, path.join(project, 'sub', 'deep'))].sort()).toEqual(['mcp:rea/list_strings', 'run_command']);
    expect(allowedTools(allowed, path.dirname(project)).size).toBe(0);
  });
});
