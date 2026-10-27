import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;

export async function startServer(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function sse(res: http.ServerResponse, events: unknown[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end('data: [DONE]\n\n');
}

export const delta = (value: Record<string, unknown>) => ({ choices: [{ delta: value }] });

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
