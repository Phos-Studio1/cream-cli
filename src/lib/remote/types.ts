import type { ImageInput } from '../attachments.js';

export type RemotePlatform = 'telegram' | 'discord';

export type RemoteTarget = { platform: RemotePlatform; chatId: string };

export type RemoteDecision = 'once' | 'always' | 'deny' | 'stop';

export type ChannelEvent =
  | {
      kind: 'message';
      target: RemoteTarget;
      userId: string;
      userName: string;
      text: string;
      images: ImageInput[];
      addressed: boolean;
    }
  | { kind: 'decision'; target: RemoteTarget; userId: string; approvalId: string; decision: RemoteDecision };

export interface RemoteChannel {
  readonly platform: RemotePlatform;
  start(): Promise<string>;
  stop(): void;
  send(chatId: string, text: string): Promise<void>;
  log(chatId: string, line: string): Promise<void>;
  sendImage(chatId: string, image: ImageInput, caption?: string): Promise<void>;
  directChat(userId: string): Promise<string>;
  typing(chatId: string): Promise<void>;
  askApproval(chatId: string, approvalId: string, text: string): Promise<void>;
}

export const platformLabel: Record<RemotePlatform, string> = { telegram: 'Telegram', discord: 'Discord' };

export function splitMessage(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim() || '(empty)';
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest);
  return chunks;
}

export async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
