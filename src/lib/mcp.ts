import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type { ToolDefinition } from './tools.js';

export type McpServerConfig = { command: string; args: string[]; env?: Record<string, string>; enabled: boolean };

export type McpTool = {
  server: string;
  name: string;
  exposed: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
};

export type McpState = { status: 'starting' | 'ready' | 'error' | 'off'; tools: number; detail?: string };

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

const protocolVersion = '2025-06-18';
const startTimeoutMs = 240_000;
const callTimeoutMs = 600_000;
export const directToolLimit = 24;

const quote = (arg: string) => (/^[\w./:=@+-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);

const exposedName = (server: string, tool: string) =>
  `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

class McpClient {
  private child?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr: string[] = [];
  tools: McpTool[] = [];

  constructor(
    readonly name: string,
    private readonly config: McpServerConfig,
    private readonly onExit: (detail: string) => void,
  ) {}

  async start(version: string): Promise<void> {
    const command = [this.config.command, ...this.config.args].map(quote).join(' ');
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receive(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr.push(...chunk.split('\n').filter((l) => l.trim()));
      this.stderr = this.stderr.slice(-20);
    });
    child.on('exit', (code) => {
      const detail = `exited (code ${code ?? '?'})${this.stderr.length ? `: ${this.stderr.at(-1)}` : ''}`;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(detail));
      }
      this.pending.clear();
      this.child = undefined;
      this.onExit(detail);
    });
    child.on('error', (error) => this.onExit(error.message));

    await this.request(
      'initialize',
      { protocolVersion, capabilities: { roots: { listChanged: false } }, clientInfo: { name: 'creamcli', version } },
      startTimeoutMs,
    );
    this.notify('notifications/initialized');

    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {}, 60_000);
      for (const tool of page.tools ?? [])
        tools.push({
          server: this.name,
          name: tool.name,
          exposed: exposedName(this.name, tool.name),
          description: String(tool.description ?? '').slice(0, 1000),
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          readOnly: tool.annotations?.readOnlyHint === true,
        });
      cursor = page.nextCursor;
    } while (cursor);
    this.tools = tools;
  }

  stop(): void {
    if (!this.child) return;
    const pid = this.child.pid;
    this.child.stdin.end();
    if (process.platform === 'win32' && pid) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else this.child.kill('SIGTERM');
  }

  private send(message: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    if (!this.child) return Promise.reject(new Error(`server ${this.name} is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled by user' });
        reject(new Error('cancelled by user'));
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && message.method) this.answer(message);
      else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? 'MCP error'));
        else pending.resolve(message.result);
      }
    }
  }

  private answer(message: { id: number | string; method: string }): void {
    if (message.method === 'ping') return this.send({ jsonrpc: '2.0', id: message.id, result: {} });
    if (message.method === 'roots/list')
      return this.send({ jsonrpc: '2.0', id: message.id, result: { roots: [{ uri: pathToFileURL(process.cwd()).href, name: 'cwd' }] } });
    this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not supported: ${message.method}` } });
  }

  stderrTail(): string {
    return this.stderr.slice(-3).join(' | ');
  }
}

export class McpManager {
  private readonly clients = new Map<string, McpClient>();
  readonly states = new Map<string, McpState>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setState(name: string, state: McpState): void {
    this.states.set(name, state);
    this.emit();
  }

  sync(servers: Record<string, McpServerConfig>, version: string): void {
    for (const name of [...this.clients.keys()]) {
      if (!servers[name]?.enabled) this.stop(name);
    }
    for (const name of [...this.states.keys()]) if (!servers[name]) this.states.delete(name);
    for (const [name, config] of Object.entries(servers)) {
      if (!config.enabled) {
        this.states.set(name, { status: 'off', tools: 0 });
        continue;
      }
      if (!this.clients.has(name)) this.start(name, config, version);
    }
    this.emit();
  }

  start(name: string, config: McpServerConfig, version: string): void {
    this.stop(name);
    const client = new McpClient(name, config, (detail) => {
      if (this.clients.get(name) !== client) return;
      this.clients.delete(name);
      this.setState(name, { status: 'error', tools: 0, detail });
    });
    this.clients.set(name, client);
    this.setState(name, { status: 'starting', tools: 0 });
    client
      .start(version)
      .then(() => {
        if (this.clients.get(name) === client) this.setState(name, { status: 'ready', tools: client.tools.length });
      })
      .catch((error: Error) => {
        if (this.clients.get(name) !== client) return;
        client.stop();
        this.clients.delete(name);
        this.setState(name, { status: 'error', tools: 0, detail: `${error.message}${client.stderrTail() ? ` · ${client.stderrTail()}` : ''}` });
      });
  }

  stop(name: string): void {
    const client = this.clients.get(name);
    if (!client) return;
    this.clients.delete(name);
    client.stop();
    this.setState(name, { status: 'off', tools: 0 });
  }

  stopAll(): void {
    for (const name of [...this.clients.keys()]) this.stop(name);
  }

  tools(server?: string): McpTool[] {
    return [...this.clients.values()].filter((c) => !server || c.name === server).flatMap((c) => c.tools);
  }

  find(exposed: string): McpTool | undefined {
    return this.tools().find((tool) => tool.exposed === exposed);
  }

  lookup(server: string, name: string): McpTool | undefined {
    return this.tools(server).find((tool) => tool.name === name);
  }

  deferredServers(): { server: string; tools: number }[] {
    return [...this.clients.values()].filter((c) => c.tools.length > directToolLimit).map((c) => ({ server: c.name, tools: c.tools.length }));
  }

  definitions(): ToolDefinition[] {
    const direct = [...this.clients.values()].filter((c) => c.tools.length <= directToolLimit).flatMap((c) => c.tools);
    const definitions: ToolDefinition[] = direct.map((tool) => ({
      type: 'function',
      function: { name: tool.exposed, description: `[MCP ${tool.server}] ${tool.description}`, parameters: tool.inputSchema },
    }));
    const deferred = this.deferredServers();
    if (!deferred.length) return definitions;
    const servers = deferred.map((d) => d.server);
    definitions.push(
      {
        type: 'function',
        function: {
          name: 'mcp_find_tools',
          description: `Search the tools of large MCP servers (${deferred.map((d) => `${d.server}: ${d.tools} tools`).join(', ')}) by keywords. Returns matching tool names, descriptions and input schemas. Call this before mcp_call_tool.`,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Keywords or an exact tool name' },
              server: { type: 'string', enum: servers },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'mcp_call_tool',
          description: 'Call a tool from a large MCP server. Use the exact tool name and an arguments object that matches its schema from mcp_find_tools.',
          parameters: {
            type: 'object',
            properties: {
              server: { type: 'string', enum: servers },
              tool: { type: 'string' },
              arguments: { type: 'object' },
            },
            required: ['server', 'tool'],
          },
        },
      },
    );
    return definitions;
  }

  search(query: string, server?: string): string {
    const words = query.toLowerCase().split(/[\s_]+/).filter(Boolean);
    const candidates = this.tools(server).filter((tool) => this.deferredServers().some((d) => d.server === tool.server));
    const exact = candidates.find((tool) => tool.name.toLowerCase() === query.toLowerCase().trim());
    const ranked = exact
      ? [exact]
      : candidates
          .map((tool) => {
            const haystack = `${tool.name.replace(/_/g, ' ')} ${tool.description}`.toLowerCase();
            const nameHits = words.filter((w) => tool.name.toLowerCase().includes(w)).length;
            return { tool, score: nameHits * 3 + words.filter((w) => haystack.includes(w)).length };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((entry) => entry.tool);
    if (!ranked.length) return `No MCP tools match "${query}". Try other keywords.`;
    return ranked
      .map((tool) =>
        [
          `## ${tool.server} / ${tool.name}${tool.readOnly ? ' (read-only)' : ''}`,
          tool.description.slice(0, 400),
          `input schema: ${JSON.stringify(tool.inputSchema).slice(0, 1800)}`,
        ].join('\n'),
      )
      .join('\n\n');
  }

  async call(exposed: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
    const tool = this.find(exposed);
    if (!tool) return { ok: false, output: `MCP tool ${exposed} is not available.` };
    return this.callTool(tool.server, tool.name, args, signal);
  }

  async callTool(server: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
    const client = this.clients.get(server);
    if (!client || !this.lookup(server, name)) return { ok: false, output: `MCP tool ${server}/${name} is not available. Search with mcp_find_tools first.` };
    const result = await client.request('tools/call', { name, arguments: args }, callTimeoutMs, signal);
    const parts: string[] = [];
    for (const item of result?.content ?? []) {
      if (item.type === 'text') parts.push(item.text);
      else if (item.type === 'resource' && item.resource?.text) parts.push(item.resource.text);
      else parts.push(`[${item.type}${item.mimeType ? ` ${item.mimeType}` : ''}]`);
    }
    if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent, null, 2));
    return { ok: !result?.isError, output: parts.join('\n') || '(no output)' };
  }
}

export const mcp = new McpManager();
