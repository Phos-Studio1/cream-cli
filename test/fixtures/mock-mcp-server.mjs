import readline from 'node:readline';

const count = Number(process.argv[2] ?? 3);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const tools = Array.from({ length: count }, (_, i) => ({
  name: i === 0 ? 'inspect_file' : i === 1 ? 'run_probe' : `extra_tool_${i}`,
  description: i === 0 ? 'Read-only file inspection' : 'Runs something',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  ...(i === 0 ? { annotations: { readOnlyHint: true } } : {}),
}));

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize')
    return send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1.0.0' } } });
  if (msg.method === 'tools/list') {
    const start = msg.params?.cursor ? Number(msg.params.cursor) : 0;
    const page = tools.slice(start, start + 10);
    return send({ jsonrpc: '2.0', id: msg.id, result: { tools: page, ...(start + 10 < tools.length ? { nextCursor: String(start + 10) } : {}) } });
  }
  if (msg.method === 'tools/call')
    return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `${msg.params.name}:${msg.params.arguments.path ?? ''}` }] } });
});
