import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Provider } from './providers.js';

const settleMs = 1500;
const relaunchAfterMs = 60_000;

const launches = new Map<string, { at: number; started: Promise<void> }>();

export function shimScript(shim: string, dir: string): string | undefined {
  const match = shim.match(/"%dp0%\\([^"]+?\.[cm]?js)"/);
  return match ? path.join(dir, ...match[1]!.split('\\')) : undefined;
}

export function findShimScript(command: string, searchPath = process.env.PATH ?? ''): string | undefined {
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    const shim = path.join(dir, `${command}.cmd`);
    if (!fs.existsSync(shim)) continue;
    const script = shimScript(fs.readFileSync(shim, 'utf8'), dir);
    if (script && fs.existsSync(script)) return script;
  }
  return undefined;
}

function spawnDetached(command: string, args: string[]): ChildProcess {
  const options = { detached: true, stdio: 'ignore', windowsHide: true } as const;
  const script = process.platform === 'win32' ? findShimScript(command) : undefined;
  if (script) return spawn(process.execPath, [script, ...args], options);
  return spawn([command, ...args].join(' '), { ...options, shell: true });
}

function start(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnDetached(command, args);
    child.unref();
    const timer = setTimeout(resolve, settleMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code) reject(new Error(`\`${command}\` exited with code ${code}`));
      else resolve();
    });
  });
}

export function launchProvider(provider: Provider): Promise<void> {
  const { launch } = provider;
  if (!launch) return Promise.reject(new Error(`${provider.label} cannot be started automatically.`));
  const previous = launches.get(provider.id);
  if (previous && Date.now() - previous.at < relaunchAfterMs) return previous.started;
  const started = start(launch.command, launch.args);
  launches.set(provider.id, { at: Date.now(), started });
  started.catch(() => launches.delete(provider.id));
  return started;
}
