import { spawn } from 'node:child_process';
import type { Provider } from './providers.js';

const settleMs = 1500;
const relaunchAfterMs = 60_000;

const launches = new Map<string, { at: number; started: Promise<void> }>();

function start(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, detached: true, stdio: 'ignore', windowsHide: true });
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
  const started = start([launch.command, ...launch.args].join(' '));
  launches.set(provider.id, { at: Date.now(), started });
  started.catch(() => launches.delete(provider.id));
  return started;
}
