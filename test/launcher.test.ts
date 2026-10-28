import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findShimScript, launchProvider, shimScript } from '../src/lib/launcher.js';
import { getProvider, type Provider } from '../src/lib/providers.js';

const fake = (id: string, command: string, args: string[]): Provider =>
  ({ id, label: id, local: true, launch: { command, args, install: `install ${id}` } }) as unknown as Provider;

describe('launchProvider', () => {
  it('starts a background command once and reuses the launch', async () => {
    const provider = fake('fake-ok', 'node', ['-e', '"setTimeout(() => {}, 3000)"']);
    const first = launchProvider(provider);
    expect(launchProvider(provider)).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it('rejects when the command is missing', async () => {
    await expect(launchProvider(fake('fake-missing', 'cream-missing-command-xyz', []))).rejects.toThrow(/exited with code|ENOENT/);
  });

  it('rejects providers without a launch command', async () => {
    await expect(launchProvider(getProvider('ollama')!)).rejects.toThrow(/cannot be started automatically/);
  });

  it('starts 9Router in local-only tray mode', () => {
    expect(getProvider('9router')!.launch).toEqual({
      command: '9router',
      args: ['--tray', '--skip-update', '--no-browser', '--host', '127.0.0.1'],
      install: 'npm install -g 9router',
    });
  });
});

describe('npm shims', () => {
  const shim = String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\9router\cli.js" %*`;

  it('extracts the script path from an npm cmd shim', () => {
    expect(shimScript(shim, path.join('C:', 'npm'))).toBe(path.join('C:', 'npm', 'node_modules', '9router', 'cli.js'));
    expect(shimScript('@echo off', 'x')).toBeUndefined();
  });

  it('finds the script behind a command on PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-shim-'));
    fs.mkdirSync(path.join(dir, 'node_modules', '9router'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', '9router', 'cli.js'), '');
    fs.writeFileSync(path.join(dir, 'fake9r.cmd'), shim);
    const script = findShimScript('fake9r', [path.join(dir, 'missing'), dir].join(path.delimiter));
    expect(script).toBe(path.join(dir, 'node_modules', '9router', 'cli.js'));
    expect(findShimScript('not-installed', dir)).toBeUndefined();
  });
});
