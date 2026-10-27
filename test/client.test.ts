import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, listModels, splitThink, streamChat } from '../src/lib/client.js';
import { delta, sse, startServer } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
let lastBody: any;
let lastAuth: string | undefined;
let mode = 'text';

beforeAll(async () => {
  server = await startServer((req, body, res) => {
    lastAuth = req.headers.authorization;
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
    }
    lastBody = JSON.parse(body);
    if (mode === 'error') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }
    if (mode === 'tools')
      return sse(res, [
        delta({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_dir', arguments: '{"pa' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'th":"."}' } }] }),
      ]);
    sse(res, [
      delta({ content: '<think>hmm' }),
      delta({ content: '</think>Hello' }),
      delta({ content: ' world' }),
      { choices: [], usage: { completion_tokens: 7 } },
    ]);
  });
});

afterAll(() => server.close());

const base = () => ({ baseUrl: `${server.url}/v1`, apiKey: 'sk-test', model: 'm', temperature: 0.5, signal: new AbortController().signal });

describe('client', () => {
  it('lists models sorted and sends the API key', async () => {
    expect(await listModels({ baseUrl: `${server.url}/v1/`, apiKey: 'sk-test' })).toEqual(['a-model', 'b-model']);
    expect(lastAuth).toBe('Bearer sk-test');
  });

  it('streams content and separates <think> reasoning', async () => {
    mode = 'text';
    const updates: string[] = [];
    const result = await streamChat({ ...base(), messages: [{ role: 'user', content: 'hi' }], onUpdate: (s) => updates.push(s.content) });
    expect(result.content).toBe('Hello world');
    expect(result.reasoning).toBe('hmm');
    expect(result.tokens).toBe(7);
    expect(updates).not.toContain('<think>hmm');
  });

  it('assembles streamed tool call fragments', async () => {
    mode = 'tools';
    const result = await streamChat({ ...base(), messages: [{ role: 'user', content: 'ls' }], onUpdate: () => undefined });
    expect(result.toolCalls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }]);
  });

  it('throws ApiError with the server message', async () => {
    mode = 'error';
    await expect(streamChat({ ...base(), messages: [{ role: 'user', content: 'x' }], onUpdate: () => undefined })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid API key',
    });
    expect(new ApiError(401, 'x')).toBeInstanceOf(Error);
  });

  it('splitThink handles partial and closing-only tags', () => {
    expect(splitThink('<thi')).toEqual({ content: '', reasoning: '' });
    expect(splitThink('reason</think>\n\nAnswer')).toEqual({ content: 'Answer', reasoning: 'reason' });
    expect(splitThink('plain')).toEqual({ content: 'plain', reasoning: '' });
  });
});
