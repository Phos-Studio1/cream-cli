import type { ChatMessage } from './client.js';

export const localBudget = 14_000;
export const cloudBudget = 240_000;
const minimumBudget = 2_000;
const keptTurns = 2;
const oldToolLimit = 1_500;
const oldAssistantLimit = 4_000;
const recentToolLimit = 12_000;

export type Prepared = { messages: ChatMessage[]; droppedTurns: number; trimmed: number; size: number };

const sizeOf = (message: ChatMessage) =>
  String(message.content ?? '').length +
  (message.role === 'assistant' ? JSON.stringify(message.tool_calls ?? '').length : 0) +
  (message.role === 'user' ? (message.images?.length ?? 0) * 2_000 : 0);

export const totalSize = (messages: ChatMessage[]) => messages.reduce((n, m) => n + sizeOf(m), 0);

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n…[trimmed ${text.length - limit} characters to fit the context]`;

function shrinkTool(message: Extract<ChatMessage, { role: 'tool' }>, limit: number): ChatMessage {
  const skill = message.content.match(/^Skill "([^"]+)" loaded\./);
  if (skill && limit < recentToolLimit)
    return { ...message, content: `[Instructions for skill "${skill[1]}" were loaded earlier. Call use_skill again if they are still needed.]` };
  return { ...message, content: clip(message.content, limit) };
}

export function prepareContext(conversation: ChatMessage[], budget: number): Prepared {
  const userIndexes = conversation.flatMap((m, i) => (m.role === 'user' ? [i] : []));
  const recentStart = userIndexes.length > keptTurns ? userIndexes[userIndexes.length - keptTurns]! : 0;
  let trimmed = 0;

  let messages = conversation.map((message, i): ChatMessage => {
    const old = i < recentStart;
    let next = message;
    if (message.role === 'tool') next = shrinkTool(message, old ? oldToolLimit : recentToolLimit);
    else if (old && message.role === 'assistant' && message.content && message.content.length > oldAssistantLimit)
      next = { ...message, content: clip(message.content, oldAssistantLimit) };
    else if (old && message.role === 'user' && message.images?.length)
      next = { role: 'user', content: `${message.content}\n[${message.images.length} gambar dilampirkan sebelumnya]` };
    if (next !== message) trimmed++;
    return next;
  });

  let droppedTurns = 0;
  const effective = Math.max(minimumBudget, budget);
  while (totalSize(messages) > effective) {
    const starts = messages.flatMap((m, i) => (m.role === 'user' ? [i] : []));
    if (starts.length <= keptTurns) break;
    messages = messages.slice(starts[1]);
    droppedTurns++;
  }

  if (totalSize(messages) > effective)
    messages = messages.map((message, i) => {
      if (message.role !== 'tool' || i === messages.length - 1) return message;
      trimmed++;
      return shrinkTool(message, oldToolLimit);
    });

  return { messages, droppedTurns, trimmed, size: totalSize(messages) };
}

export function isContextError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = String((error as Error)?.message ?? '');
  return (
    (status === 400 || status === 413 || status === 422) &&
    /context|token|too long|too large|maximum|length|exceed|payload/i.test(message)
  ) || status === 413;
}

export function isUpstreamAuthError(error: unknown): boolean {
  return /\[40[13]\]|incorrect api key|invalid[ _-]?api[ _-]?key|unauthori[sz]ed|authentication/i.test(String((error as Error)?.message ?? ''));
}

export function isTransientError(error: unknown): boolean {
  if (isUpstreamAuthError(error)) return false;
  const status = (error as { status?: number }).status;
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  const message = String((error as Error)?.message ?? '');
  const cause = String(((error as { cause?: { code?: string } }).cause?.code) ?? '');
  return /terminated|socket|ECONNRESET|EPIPE|timeout|closed|other side|UND_ERR/i.test(`${message} ${cause}`);
}

export function isUnreachableError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? '');
  const cause = String(((error as { cause?: { code?: string } }).cause?.code) ?? '');
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i.test(`${message} ${cause}`);
}
