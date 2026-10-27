import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/app.js';
import { defaultConfig } from '../src/lib/config.js';
import { delta, sleep, sse, startServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
const requests: any[] = [];
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-app-'));

beforeAll(async () => {
  server = await startServer((req, body, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    }
    const json = JSON.parse(body);
    requests.push(json);
    const tools = json.messages.filter((m: { role: string }) => m.role === 'tool');
    if (!tools.length)
      return sse(res, [delta({ tool_calls: [{ index: 0, id: 't1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: path.join(workdir, 'note.txt'), content: 'hello' }) } }] })]);
    sse(res, [delta({ content: 'Done, **note.txt** created.' })]);
  });
});

afterAll(() => server.close());

const strip = (s: string) => s.replace(/\x1b\[[0-9;?<]*[a-zA-Z]/g, '');

describe('App', () => {
  it('chats, asks for approval, runs the tool and renders the answer', async () => {
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
    const config = { ...defaultConfig, provider: 'custom' as const, customUrl: `${server.url}/v1`, models: { custom: 'mock-model' }, apiKeys: {}, mouse: false };
    const app = render(<App initialConfig={config} version="test" />, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    const waitFor = async (text: string) => {
      for (let i = 0; i < 100 && !strip(frame).includes(text); i++) await sleep(100);
      expect(strip(frame)).toContain(text);
    };

    await waitFor('Ask Cream anything');
    for (const ch of 'make a note') {
      stdin.write(ch);
      await sleep(5);
    }
    stdin.write('\r');
    await waitFor('Write this file?');
    stdin.write('y');
    await waitFor('Done, note.txt created.');

    expect(fs.readFileSync(path.join(workdir, 'note.txt'), 'utf8')).toBe('hello');
    expect(requests[0].messages[0].content).toMatch(/^Reply in the language of the latest user message/);
    expect(strip(frame)).toContain('● online');
    app.unmount();
  });
});
