import { describe, expect, it } from 'vitest';
import { ApiError, type ChatMessage } from '../src/lib/client.js';
import {
  isContextError,
  isTransientError,
  isUnreachableError,
  isUpstreamAuthError,
  prepareContext,
  totalSize,
} from '../src/lib/context.js';

function turn(index: number, toolSize = 30_000): ChatMessage[] {
  return [
    { role: 'user', content: `question ${index}` },
    { role: 'assistant', content: null, tool_calls: [{ id: `c${index}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${index}`, content: 'x'.repeat(toolSize) },
    { role: 'assistant', content: `answer ${index}` },
  ];
}

describe('prepareContext', () => {
  const history = [...turn(1), ...turn(2), ...turn(3), ...turn(4)];

  it('trims old tool output but keeps the last two turns intact', () => {
    const { messages, trimmed } = prepareContext(history, 1_000_000);
    expect(trimmed).toBeGreaterThan(0);
    expect(messages.slice(-8)).toEqual(
      history.slice(-8).map((m) => (m.role === 'tool' ? { ...m, content: m.content.slice(0, 12_000) + m.content.slice(12_000).replace(/x+/, (s) => `\n…[trimmed ${s.length} characters to fit the context]`) } : m)),
    );
    expect(String(messages[2]!.content).length).toBeLessThan(2_000);
  });

  it('drops the oldest turns when over budget and always starts with a user message', () => {
    const { messages, droppedTurns, size } = prepareContext(history, 20_000);
    expect(droppedTurns).toBeGreaterThan(0);
    expect(messages[0]!.role).toBe('user');
    expect(size).toBe(totalSize(messages));
    expect(messages.at(-1)).toEqual(history.at(-1));
  });

  it('replaces old skill instructions with a short note', () => {
    const skill: ChatMessage = { role: 'tool', tool_call_id: 's', content: `Skill "pdf" loaded. Skill directory: x\n${'y'.repeat(20_000)}` };
    const conversation: ChatMessage[] = [{ role: 'user', content: 'a' }, skill, ...turn(2, 10), ...turn(3, 10)];
    const { messages } = prepareContext(conversation, 1_000_000);
    expect(messages[1]!.content).toMatch(/^\[Instructions for skill "pdf" were loaded earlier/);
  });
});

describe('error classification', () => {
  it('detects context length errors', () => {
    expect(isContextError(new ApiError(400, "This model's maximum context length is 8192 tokens"))).toBe(true);
    expect(isContextError(new ApiError(413, 'Payload too large'))).toBe(true);
    expect(isContextError(new ApiError(400, 'invalid model'))).toBe(false);
  });

  it('retries transient failures but not upstream auth errors', () => {
    expect(isTransientError(new TypeError('terminated'))).toBe(true);
    expect(isTransientError(new ApiError(503, 'Service unavailable'))).toBe(true);
    expect(isTransientError(new ApiError(429, 'rate limited'))).toBe(true);
    const wrapped = new ApiError(503, '[openai/gpt-5.5] [401]: Incorrect API key provided: a. (reset after 1m 56s)');
    expect(isUpstreamAuthError(wrapped)).toBe(true);
    expect(isTransientError(wrapped)).toBe(false);
    expect(isTransientError(new ApiError(400, 'bad request'))).toBe(false);
  });

  it('flags unreachable servers', () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    expect(isUnreachableError(refused)).toBe(true);
    expect(isUnreachableError(new TypeError('terminated'))).toBe(false);
  });
});
