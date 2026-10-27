import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { removeSessionImages } from './attachments.js';
import type { ChatMessage } from './client.js';
import { dataRoot } from './paths.js';

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  provider: string;
  model: string;
  cwd: string;
  turns: number;
};

export type Session = SessionMeta & {
  conversation: ChatMessage[];
  entries: unknown[];
};

export const sessionsDir = path.join(dataRoot, 'sessions');

const fileFor = (id: string) => path.join(sessionsDir, `${id}.json`);

const pad = (n: number) => String(n).padStart(2, '0');

export function newSessionId(date = new Date()): string {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export function titleFrom(conversation: ChatMessage[]): string {
  const first = conversation.find((m) => m.role === 'user')?.content ?? '';
  const line = first.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'Untitled chat';
}

export function saveSession(session: Session): void {
  try {
    fs.mkdirSync(sessionsDir, { recursive: true });
    const file = fileFor(session.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(session));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    return;
  }
}

export function loadSession(id: string): Session | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as Session;
  } catch {
    const match = listSessions().find((s) => s.id.startsWith(id));
    if (!match || match.id === id) return null;
    return loadSession(match.id);
  }
}

export function listSessions(): SessionMeta[] {
  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const sessions: SessionMeta[] = [];
  for (const file of files) {
    try {
      const { conversation, entries, ...meta } = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')) as Session;
      sessions.push(meta);
    } catch {
      continue;
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): boolean {
  try {
    fs.rmSync(fileFor(id));
    removeSessionImages(id);
    return true;
  } catch {
    return false;
  }
}

export function deleteAllSessions(): number {
  const sessions = listSessions();
  return sessions.filter((s) => deleteSession(s.id)).length;
}

export function searchSessions(query: string, excludeId?: string, limit = 8): string {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return 'Query is empty.';
  const hits: { score: number; text: string }[] = [];

  for (const meta of listSessions()) {
    if (meta.id === excludeId) continue;
    const session = loadSession(meta.id);
    if (!session) continue;
    for (const message of session.conversation) {
      if ((message.role !== 'user' && message.role !== 'assistant') || !message.content) continue;
      const lower = message.content.toLowerCase();
      const score = words.filter((w) => lower.includes(w)).length;
      if (score < Math.ceil(words.length / 2)) continue;
      const at = Math.max(0, lower.indexOf(words.find((w) => lower.includes(w))!) - 120);
      const snippet = message.content.slice(at, at + 360).replace(/\s+/g, ' ').trim();
      hits.push({
        score,
        text: `[${meta.id}] "${meta.title}" (${meta.updatedAt.slice(0, 10)}) ${message.role}: …${snippet}…`,
      });
    }
  }

  if (!hits.length) return `No previous chats mention "${query}".`;
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.text)
    .join('\n\n');
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
