import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from './paths.js';

export type ImageRef = { path: string; mime: string; width?: number; height?: number };

export type ImageInput = { data: Buffer; mime: string; width?: number; height?: number };

export const attachmentsDir = path.join(dataRoot, 'attachments');

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export function saveImage(sessionId: string, image: ImageInput): ImageRef {
  const dir = path.join(attachmentsDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(16).slice(2, 6)}.${extensions[image.mime] ?? 'png'}`);
  fs.writeFileSync(file, image.data);
  return { path: file, mime: image.mime, width: image.width, height: image.height };
}

export function imageDataUrl(image: ImageRef): string | null {
  try {
    return `data:${image.mime};base64,${fs.readFileSync(image.path).toString('base64')}`;
  } catch {
    return null;
  }
}

export function removeSessionImages(sessionId: string): void {
  fs.rmSync(path.join(attachmentsDir, sessionId), { recursive: true, force: true });
}
