import { describe, expect, it } from 'vitest';
import { launchProvider } from '../src/lib/launcher.js';
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
