import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from './paths.js';

export type Memory = { id: number; text: string; createdAt: string; sessionId?: string };

export const brainDir = path.join(dataRoot, 'brain');

const memoryFile = path.join(brainDir, 'memory.json');

const maxMemories = 200;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

export function loadMemories(): Memory[] {
  try {
    const data = JSON.parse(fs.readFileSync(memoryFile, 'utf8')) as { memories?: Memory[] };
    return data.memories ?? [];
  } catch {
    return [];
  }
}

function saveMemories(memories: Memory[]): void {
  fs.mkdirSync(brainDir, { recursive: true });
  fs.writeFileSync(`${memoryFile}.tmp`, JSON.stringify({ memories }, null, 2));
  fs.renameSync(`${memoryFile}.tmp`, memoryFile);
}

export function addMemory(text: string, sessionId?: string): { memory: Memory; duplicate: boolean } {
  const memories = loadMemories();
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  const existing = memories.find((m) => normalize(m.text) === normalize(clean));
  if (existing) return { memory: existing, duplicate: true };
  const memory = { id: Math.max(0, ...memories.map((m) => m.id)) + 1, text: clean, createdAt: new Date().toISOString(), sessionId };
  saveMemories([...memories, memory].slice(-maxMemories));
  return { memory, duplicate: false };
}

export function removeMemory(id: number): Memory | undefined {
  const memories = loadMemories();
  const target = memories.find((m) => m.id === id);
  if (target) saveMemories(memories.filter((m) => m.id !== id));
  return target;
}

export function clearMemories(): number {
  const count = loadMemories().length;
  if (count) saveMemories([]);
  return count;
}
