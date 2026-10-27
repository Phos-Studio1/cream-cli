import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { addMemory, removeMemory } from './brain.js';
import { mcp } from './mcp.js';
import { searchSessions } from './sessions.js';
import { readSkill, type Skill } from './skills.js';

export type ToolCallPayload = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolContext = {
  cwd: string;
  skills: Skill[];
  signal: AbortSignal;
  sessionId?: string;
  screenshot?: (args: Record<string, any>) => Promise<ToolOutcome>;
};

export type ToolOutcome = { ok: boolean; output: string };

export type ParsedCall = { id: string; name: string; args: Record<string, any>; error?: string };

const approvalTools = new Set(['write_file', 'edit_file', 'run_command', 'screenshot']);

const maxOutput = 16000;

export function needsApproval(name: string, args: Record<string, any> = {}): boolean {
  if (name === 'mcp_find_tools') return false;
  if (name === 'mcp_call_tool') return !mcp.lookup(String(args.server ?? ''), String(args.tool ?? ''))?.readOnly;
  if (name.startsWith('mcp__')) return !mcp.find(name)?.readOnly;
  return approvalTools.has(name);
}

export const approvalKey = (call: ParsedCall) =>
  call.name === 'mcp_call_tool' ? `mcp:${call.args.server}/${call.args.tool}` : call.name;

export const shellName = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

function object(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties, required };
}

export function toolDefinitions(skills: Skill[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a UTF-8 text file. Optionally read a line range.',
        parameters: object(
          {
            path: { type: 'string', description: 'File path, absolute or relative to the working directory' },
            offset: { type: 'integer', description: 'First line to read (1-based)' },
            limit: { type: 'integer', description: 'Maximum number of lines' },
          },
          ['path'],
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: 'List files and folders in a directory.',
        parameters: object({ path: { type: 'string', description: 'Directory path, defaults to the working directory' } }, []),
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a text file with the given content. Parent folders are created automatically.',
        parameters: object({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Replace an exact, unique snippet of text in an existing file.',
        parameters: object(
          { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
          ['path', 'old_text', 'new_text'],
        ),
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: `Run a shell command (${shellName}) in the working directory and return its output.`,
        parameters: object(
          {
            command: { type: 'string' },
            timeout_seconds: { type: 'integer', description: 'Defaults to 120, maximum 600' },
          },
          ['command'],
        ),
      },
    },
  ];

  tools.push(
    {
      type: 'function',
      function: {
        name: 'remember',
        description:
          'Save a durable fact about the user to long-term memory shared across all chats (name, projects, preferences, setup, goals). Write one short standalone sentence. Never store secrets such as API keys or passwords.',
        parameters: object({ text: { type: 'string' } }, ['text']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'forget',
        description: 'Delete a memory that is wrong or outdated, by its id.',
        parameters: object({ id: { type: 'integer' } }, ['id']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_chats',
        description: 'Search previous chat sessions for details the user mentioned before. Returns matching snippets with session ids.',
        parameters: object({ query: { type: 'string', description: 'Keywords to look for' } }, ['query']),
      },
    },
  );

  tools.push({
    type: 'function',
    function: {
      name: 'screenshot',
      description:
        "Capture the PC screen as a PNG. If the user is chatting from their phone (Telegram/Discord) the image is sent to that chat automatically; otherwise set send_to_phone to deliver it to the user's paired phone accounts. Set look to true to also receive the image yourself (requires a vision model).",
      parameters: object(
        {
          screen: { type: 'string', enum: ['all', 'primary'], description: 'all monitors (default) or only the primary one' },
          look: { type: 'boolean', description: 'Attach the screenshot so you can see it' },
          send_to_phone: { type: 'boolean', description: 'Send to paired phone accounts when the chat is in the terminal' },
          caption: { type: 'string' },
        },
        [],
      ),
    },
  });

  tools.push(...mcp.definitions());

  if (skills.length)
    tools.unshift({
      type: 'function',
      function: {
        name: 'use_skill',
        description: 'Load the full instructions of an installed skill. Call this before starting a task that matches a skill.',
        parameters: object({ name: { type: 'string', enum: skills.map((s) => s.name) } }, ['name']),
      },
    });

  return tools;
}

export function parseCall(call: ToolCallPayload): ParsedCall {
  const base = { id: call.id, name: call.function.name };
  try {
    const args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
    return { ...base, args: typeof args === 'object' && args ? args : {} };
  } catch {
    return { ...base, args: {}, error: 'Arguments were not valid JSON.' };
  }
}

export function describeCall(call: ParsedCall): string {
  const { name, args } = call;
  if (name === 'use_skill') return String(args.name ?? '');
  if (name === 'run_command') return String(args.command ?? '');
  if (name === 'remember') return String(args.text ?? '');
  if (name === 'forget') return `#${args.id ?? '?'}`;
  if (name === 'search_chats') return String(args.query ?? '');
  if (name.startsWith('mcp__')) return JSON.stringify(args).slice(0, 160);
  if (name === 'screenshot') return `${args.screen === 'primary' ? 'primary monitor' : 'all monitors'}${args.look ? ' · model looks' : ''}${args.send_to_phone ? ' · send to phone' : ''}`;
  if (name === 'mcp_find_tools') return `${args.server ? `${args.server}: ` : ''}${args.query ?? ''}`;
  if (name === 'mcp_call_tool') return `${args.server}/${args.tool} ${JSON.stringify(args.arguments ?? {}).slice(0, 140)}`;
  return String(args.path ?? '.');
}

function truncate(text: string): string {
  if (text.length <= maxOutput) return text;
  const half = maxOutput / 2;
  return `${text.slice(0, half)}\n… [${text.length - maxOutput} characters omitted] …\n${text.slice(-half)}`;
}

function runCommand(command: string, cwd: string, timeoutSeconds: number, signal: AbortSignal): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let output = '';
    let settled = false;
    const finish = (outcome: ToolOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGTERM');
    };
    const onAbort = () => {
      kill();
      finish({ ok: false, output: truncate(`${output}\n[cancelled by user]`) });
    };
    const timer = setTimeout(() => {
      kill();
      finish({ ok: false, output: truncate(`${output}\n[timed out after ${timeoutSeconds}s]`) });
    }, timeoutSeconds * 1000);

    signal.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));
    child.on('error', (error) => finish({ ok: false, output: error.message }));
    child.on('close', (code) => {
      const text = output.trim() || '(no output)';
      finish({ ok: code === 0, output: truncate(code === 0 ? text : `${text}\n[exit code ${code}]`) });
    });
  });
}

export async function executeTool(call: ParsedCall, ctx: ToolContext): Promise<ToolOutcome> {
  if (call.error) return { ok: false, output: call.error };
  const { args } = call;
  const resolvePath = (p: unknown) => path.resolve(ctx.cwd, String(p ?? '.'));

  try {
    switch (call.name) {
      case 'use_skill': {
        const wanted = String(args.name ?? '').replace(/^[\w-]+:/, '');
        const skill = ctx.skills.find((s) => s.name === wanted);
        if (!skill) return { ok: false, output: `No skill named "${args.name}". Installed: ${ctx.skills.map((s) => s.name).join(', ')}` };
        return { ok: true, output: readSkill(skill) };
      }
      case 'read_file': {
        const file = resolvePath(args.path);
        const buffer = fs.readFileSync(file);
        if (buffer.includes(0)) return { ok: true, output: `${file} is a binary file (${buffer.length} bytes).` };
        const lines = buffer.toString('utf8').split('\n');
        const start = Math.max(1, Number(args.offset) || 1);
        const end = args.limit ? start + Number(args.limit) - 1 : lines.length;
        return { ok: true, output: truncate(lines.slice(start - 1, end).join('\n')) };
      }
      case 'list_dir': {
        const dir = resolvePath(args.path);
        const items = fs
          .readdirSync(dir, { withFileTypes: true })
          .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
          .sort();
        return { ok: true, output: items.length ? truncate(items.join('\n')) : '(empty directory)' };
      }
      case 'write_file': {
        const file = resolvePath(args.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, String(args.content ?? ''));
        return { ok: true, output: `Wrote ${file}` };
      }
      case 'edit_file': {
        const file = resolvePath(args.path);
        const text = fs.readFileSync(file, 'utf8');
        const oldText = String(args.old_text ?? '');
        const count = oldText ? text.split(oldText).length - 1 : 0;
        if (count !== 1) return { ok: false, output: `old_text must match exactly once, found ${count} matches.` };
        fs.writeFileSync(file, text.replace(oldText, () => String(args.new_text ?? '')));
        return { ok: true, output: `Edited ${file}` };
      }
      case 'run_command': {
        const timeout = Math.min(600, Math.max(1, Number(args.timeout_seconds) || 120));
        return await runCommand(String(args.command ?? ''), ctx.cwd, timeout, ctx.signal);
      }
      case 'remember': {
        const text = String(args.text ?? '').trim();
        if (!text) return { ok: false, output: 'Memory text is empty.' };
        const { memory, duplicate } = addMemory(text, ctx.sessionId);
        return { ok: true, output: duplicate ? `Already remembered as #${memory.id}.` : `Saved memory #${memory.id}.` };
      }
      case 'forget': {
        const removed = removeMemory(Number(args.id));
        return removed ? { ok: true, output: `Forgot #${removed.id}: ${removed.text}` } : { ok: false, output: `No memory #${args.id}.` };
      }
      case 'search_chats':
        return { ok: true, output: truncate(searchSessions(String(args.query ?? ''), ctx.sessionId)) };
      case 'screenshot':
        return ctx.screenshot ? await ctx.screenshot(args) : { ok: false, output: 'Screenshot is not available here.' };
      case 'mcp_find_tools':
        return { ok: true, output: truncate(mcp.search(String(args.query ?? ''), args.server ? String(args.server) : undefined)) };
      case 'mcp_call_tool': {
        const outcome = await mcp.callTool(String(args.server ?? ''), String(args.tool ?? ''), args.arguments ?? {}, ctx.signal);
        return { ok: outcome.ok, output: truncate(outcome.output) };
      }
      default:
        if (call.name.startsWith('mcp__')) {
          const outcome = await mcp.call(call.name, args, ctx.signal);
          return { ok: outcome.ok, output: truncate(outcome.output) };
        }
        return { ok: false, output: `Unknown tool "${call.name}".` };
    }
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
