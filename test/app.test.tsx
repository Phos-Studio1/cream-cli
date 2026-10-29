import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app.js';
import { defaultConfig, loadConfig } from '../src/lib/config.js';
import { folderKey } from '../src/lib/trust.js';
import { delta, sleep, sse, startServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
const requests: any[] = [];
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-app-'));

const questions = [
  { question: 'Which framework?', header: 'Framework', options: [{ label: 'React' }, { label: 'Vue' }] },
  { question: 'Which extras?', header: 'Extras', options: [{ label: 'Tests' }, { label: 'CI' }, { label: 'Docker' }], multi_select: true },
];

const toolCall = (name: string, args: unknown) => [delta({ tool_calls: [{ index: 0, id: 't1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] })];

beforeAll(async () => {
  server = await startServer((req, body, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    }
    const json = JSON.parse(body);
    requests.push(json);
    const prompt = json.messages.filter((m: { role: string }) => m.role === 'user').at(-1).content;
    const answered = json.messages.at(-1).role === 'tool';
    const steps = json.messages.filter((m: { role: string }) => m.role === 'tool').length;
    if (prompt.includes('long task'))
      return steps < 35 ? sse(res, toolCall('read_file', { path: `missing-${steps}.txt` })) : sse(res, [delta({ content: 'All 35 steps done.' })]);
    if (prompt.includes('loop forever')) return sse(res, toolCall('read_file', { path: 'same.txt' }));
    if (prompt.includes('plan'))
      return answered ? sse(res, [delta({ content: 'Got your answers.' })]) : sse(res, toolCall('ask_user', { questions }));
    if (!answered) return sse(res, toolCall('write_file', { path: path.join(workdir, 'note.txt'), content: 'hello' }));
    sse(res, [delta({ content: 'Done, **note.txt** created.' })]);
  });
});

afterAll(() => server.close());

const strip = (s: string) => s.replace(/\x1b\[[0-9;?<]*[a-zA-Z]/g, '');

function mount(overrides: Partial<typeof defaultConfig> = {}) {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  let frame = '';
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        frame = chunk.toString();
        callback();
      },
    }),
    { isTTY: true, columns: 110, rows: 30 },
  );
  const config = { ...defaultConfig, provider: 'custom' as const, customUrl: `${server.url}/v1`, models: { custom: 'mock-model' }, apiKeys: {}, mouse: false, ...overrides };
  const app = render(<App initialConfig={config} version="test" />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  const screen = () => strip(frame);
  const waitFor = async (text: string) => {
    for (let i = 0; i < 100 && !screen().includes(text); i++) await sleep(100);
    expect(screen()).toContain(text);
  };
  const press = async (keys: string) => {
    stdin.write(keys);
    await sleep(60);
  };
  const type = async (text: string) => {
    for (const ch of text) await press(ch);
    await press('\r');
  };
  return { app, screen, waitFor, press, type };
}

describe('App', () => {
  it('chats, asks for approval, runs the tool and renders the answer', async () => {
    const { app, screen, waitFor, press, type } = mount();
    await waitFor('Ask Cream anything');
    await type('make a note');
    await waitFor('Write this file?');
    await press('y');
    await waitFor('Done, note.txt created.');

    expect(fs.readFileSync(path.join(workdir, 'note.txt'), 'utf8')).toBe('hello');
    expect(requests[0].messages[0].content).toMatch(/^Reply in the language of the latest user message/);
    expect(screen()).toContain('● online');
    app.unmount();
  });

  it('keeps working past 30 tool steps without asking to continue', async () => {
    const { app, screen, waitFor, type } = mount();
    await waitFor('Ask Cream anything');
    await type('long task');
    await waitFor('All 35 steps done.');
    expect(screen()).not.toContain('Send a message to continue');
    expect(requests.at(-1).messages.filter((m: { role: string }) => m.role === 'tool')).toHaveLength(35);
    app.unmount();
  });

  it('stops a model that repeats the same tool call', async () => {
    const { app, waitFor, type } = mount();
    await waitFor('Ask Cream anything');
    const before = requests.length;
    await type('loop forever');
    await waitFor('repeated the same tool call 4 times');
    expect(requests.length - before).toBe(4);
    app.unmount();
  });

  it('remembers "always allow" in later sessions', async () => {
    fs.rmSync(path.join(workdir, 'note.txt'), { force: true });
    const first = mount();
    await first.waitFor('Ask Cream anything');
    await first.type('make a note');
    await first.waitFor('Write this file?');
    await first.press('a');
    await first.waitFor('Done, note.txt created.');
    first.app.unmount();
    expect(loadConfig().allowed[folderKey(process.cwd())]).toContain('write_file');

    fs.rmSync(path.join(workdir, 'note.txt'), { force: true });
    const second = mount({ allowed: loadConfig().allowed });
    await second.waitFor('Ask Cream anything');
    await second.type('make a note');
    await second.waitFor('Done, note.txt created.');
    expect(second.screen()).not.toContain('Write this file?');
    expect(fs.readFileSync(path.join(workdir, 'note.txt'), 'utf8')).toBe('hello');
    second.app.unmount();
  });

  it('runs tools without asking in a trusted folder', async () => {
    fs.rmSync(path.join(workdir, 'note.txt'), { force: true });
    const { app, screen, waitFor, type } = mount({ folders: { [folderKey(process.cwd())]: 'trust' } });
    await waitFor('Ask Cream anything');
    await type('make a note');
    await waitFor('Done, note.txt created.');
    expect(screen()).not.toContain('Write this file?');
    expect(fs.readFileSync(path.join(workdir, 'note.txt'), 'utf8')).toBe('hello');
    app.unmount();
  });

  it('collects every ask_user answer in a menu and submits them together', async () => {
    const { app, screen, waitFor, press, type } = mount();
    await waitFor('Ask Cream anything');
    const before = requests.length;
    await type('plan my app');
    await waitFor('Which framework?');
    await press('\x1b[B');
    await press('\r');
    await waitFor('Which extras?');
    await press(' ');
    await press('3');
    await press('4');
    await waitFor('type your answer');
    await type('Storybook');
    await press('\r');
    await waitFor('enter submit all answers');
    expect(screen()).toContain('Framework: Vue');
    expect(screen()).toContain('Extras: Tests; Docker; Storybook');
    await press('\r');
    await waitFor('Got your answers.');

    expect(requests.length - before).toBe(2);
    const result = requests.at(-1).messages.at(-1);
    expect(result.role).toBe('tool');
    expect(result.content).toBe('The user answered:\n1. Which framework?\n   → Vue\n2. Which extras?\n   → Tests; Docker; Storybook');
    app.unmount();
  });
});
