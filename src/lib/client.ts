import { imageDataUrl, type ImageRef } from './attachments.js';
import type { ToolCallPayload, ToolDefinition } from './tools.js';

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: ImageRef[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCallPayload[]; reasoning_content?: string }
  | { role: 'tool'; tool_call_id: string; content: string };

export type StreamState = { content: string; reasoning: string };

export type StreamResult = StreamState & {
  toolCalls: ToolCallPayload[];
  tokens: number;
  seconds: number;
  tokensPerSecond: number;
};

export type Endpoint = { baseUrl: string; apiKey?: string };

type StreamOptions = Endpoint & {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  tools?: ToolDefinition[];
  signal: AbortSignal;
  onUpdate: (state: StreamState) => void;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const keepAlive = '30m';

const trimUrl = (url: string) => url.replace(/\/+$/, '');

export const isOllama = (baseUrl: string) => /:11434(\/|$)/.test(baseUrl);

function headers({ baseUrl, apiKey }: Endpoint): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(baseUrl.includes('openrouter.ai') ? { 'X-Title': 'Cream' } : {}),
  };
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  let message = body.slice(0, 200);
  try {
    const json = JSON.parse(body);
    message = json.error?.message ?? json.message ?? json.error ?? message;
  } catch {
    message = message || res.statusText;
  }
  return new ApiError(res.status, String(message));
}

export async function listModels(endpoint: Endpoint): Promise<string[]> {
  const res = await fetch(`${trimUrl(endpoint.baseUrl)}/models`, {
    headers: headers(endpoint),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw await toApiError(res);
  const json = (await res.json()) as { data?: { id: string }[] };
  return (json.data ?? []).map((m) => m.id).sort();
}

export async function warmModel(baseUrl: string, model: string): Promise<void> {
  if (!isOllama(baseUrl)) return;
  const host = trimUrl(baseUrl).replace(/\/v1$/, '');
  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: keepAlive }),
  });
  if (!res.ok) throw await toApiError(res);
  await res.text();
}

export function splitThink(raw: string): StreamState {
  const start = raw.indexOf('<think>');
  if (start === -1) {
    const close = raw.indexOf('</think>');
    if (close !== -1) return { content: raw.slice(close + 8).trimStart(), reasoning: raw.slice(0, close).trim() };
    const head = raw.trimStart();
    return { content: head && '<think>'.startsWith(head) ? '' : raw, reasoning: '' };
  }
  const end = raw.indexOf('</think>', start);
  if (end === -1) return { content: raw.slice(0, start), reasoning: raw.slice(start + 7).trim() };
  return {
    content: (raw.slice(0, start) + raw.slice(end + 8)).trimStart(),
    reasoning: raw.slice(start + 7, end).trim(),
  };
}

function toApiMessage(message: ChatMessage): unknown {
  if (message.role !== 'user' || !message.images?.length) return message;
  const parts: unknown[] = message.content ? [{ type: 'text', text: message.content }] : [];
  for (const image of message.images) {
    const url = imageDataUrl(image);
    parts.push(url ? { type: 'image_url', image_url: { url } } : { type: 'text', text: '[image not found]' });
  }
  return { role: 'user', content: parts };
}

export async function streamChat(options: StreamOptions): Promise<StreamResult> {
  const startedAt = Date.now();
  const res = await fetch(`${trimUrl(options.baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: headers(options),
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages.map(toApiMessage),
      temperature: options.temperature,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(isOllama(options.baseUrl) ? { keep_alive: keepAlive } : {}),
    }),
  });

  if (!res.ok || !res.body) throw await toApiError(res);

  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let reasoning = '';
  let tokens = 0;
  let firstTokenAt = 0;
  let state: StreamState = { content: '', reasoning: '' };
  const calls = new Map<number, ToolCallPayload>();

  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      if (json.error) throw new ApiError(500, json.error.message ?? String(json.error));
      if (json.usage?.completion_tokens) tokens = json.usage.completion_tokens;
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      for (const [position, part] of (delta.tool_calls ?? []).entries()) {
        const index = typeof part.index === 'number' ? part.index : position;
        const call = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments)
          call.function.arguments +=
            typeof part.function.arguments === 'string' ? part.function.arguments : JSON.stringify(part.function.arguments);
        calls.set(index, call);
        if (!firstTokenAt) firstTokenAt = Date.now();
      }

      const piece = delta.content ?? '';
      const thought = delta.reasoning_content ?? delta.reasoning ?? '';
      if (!piece && !thought) continue;
      if (!firstTokenAt) firstTokenAt = Date.now();

      raw += piece;
      reasoning += thought;
      const split = splitThink(raw);
      state = { content: split.content, reasoning: (reasoning + split.reasoning).trim() };
      options.onUpdate(state);
    }
  }

  const finishedAt = Date.now();
  if (!tokens) tokens = Math.max(1, Math.round((raw.length + reasoning.length) / 4));
  const genSeconds = Math.max(0.001, (finishedAt - (firstTokenAt || startedAt)) / 1000);

  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${startedAt}_${index}` }))
    .filter((call) => call.function.name);

  return {
    ...state,
    toolCalls,
    tokens,
    seconds: (finishedAt - startedAt) / 1000,
    tokensPerSecond: tokens / genSeconds,
  };
}
