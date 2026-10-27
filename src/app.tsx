import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { ApprovalPrompt, type ApprovalRequest, type Decision } from './components/ApprovalPrompt.js';
import { Banner } from './components/Banner.js';
import {
  AssistantMessage,
  BrainPanel,
  HelpPanel,
  McpPanel,
  RemotePanel,
  Notice,
  SkillsPanel,
  ToolActivity,
  ToolEntry,
  UserMessage,
  type McpRow,
  type NoticeTone,
  type RemoteRow,
  type Stats,
  type ToolStatus,
} from './components/Entries.js';
import { InputBar, type Attachment } from './components/InputBar.js';
import { ConfirmPrompt } from './components/ConfirmPrompt.js';
import { KeyPrompt } from './components/KeyPrompt.js';
import { ModelPicker } from './components/ModelPicker.js';
import { ProviderPicker } from './components/ProviderPicker.js';
import { Mascot, type Mood } from './components/Mascot.js';
import { ScrollView } from './components/ScrollView.js';
import { SessionPicker } from './components/SessionPicker.js';
import { StatusCard, StatusLine, type Connection } from './components/StatusBar.js';
import {
  ApiError,
  isOllama,
  listModels,
  streamChat,
  warmModel,
  type ChatMessage,
  type StreamResult,
  type StreamState,
} from './lib/client.js';
import { remoteToken, resolveActive, saveConfig, type Active, type Config } from './lib/config.js';
import { RemoteHub, type HubEvents, type RemoteState } from './lib/remote/hub.js';
import { platformLabel, type RemotePlatform, type RemoteTarget } from './lib/remote/types.js';
import { getProvider, providerIds, type ProviderId } from './lib/providers.js';
import { commands, skillAliases, type Command } from './lib/commands.js';
import {
  bootstrapSkills,
  defaultRepo,
  installSkills,
  isRepo,
  loadSkills,
  readSkill,
  removeSkill,
  type Skill,
} from './lib/skills.js';
import { useMouse } from './lib/terminal.js';
import { addMemory, clearMemories, loadMemories, removeMemory, type Memory } from './lib/brain.js';
import {
  cloudBudget,
  isContextError,
  isTransientError,
  isUnreachableError,
  isUpstreamAuthError,
  localBudget,
  prepareContext,
} from './lib/context.js';
import { directToolLimit, mcp, type McpState } from './lib/mcp.js';
import {
  deleteAllSessions,
  deleteSession,
  listSessions,
  loadSession,
  newSessionId,
  saveSession,
  timeAgo,
  titleFrom,
  type Session,
} from './lib/sessions.js';
import { saveImage, type ImageRef } from './lib/attachments.js';
import { dataRoot } from './lib/paths.js';
import { captureScreen } from './lib/screenshot.js';
import { writeClipboard } from './lib/clipboard.js';
import { theme } from './lib/theme.js';
import {
  describeCall,
  executeTool,
  approvalKey,
  needsApproval,
  parseCall,
  shellName,
  toolDefinitions,
  type ParsedCall,
  type ToolOutcome,
} from './lib/tools.js';

type SkillSummary = { name: string; description: string; source: string; repo?: string };

type Entry =
  | { id: number; kind: 'banner' }
  | { id: number; kind: 'help' }
  | { id: number; kind: 'brain'; memories: Memory[] }
  | { id: number; kind: 'skills'; skills: SkillSummary[]; pinned: string[] }
  | { id: number; kind: 'user'; text: string; images?: { width?: number; height?: number }[]; via?: string }
  | { id: number; kind: 'remote'; rows: RemoteRow[]; code: string }
  | { id: number; kind: 'mcp'; rows: McpRow[] }
  | { id: number; kind: 'notice'; tone: NoticeTone; text: string }
  | { id: number; kind: 'tool'; name: string; detail: string; status: ToolStatus; output: string }
  | {
      id: number;
      kind: 'assistant';
      model: string;
      content: string;
      reasoning: string;
      stats?: Stats;
      aborted?: boolean;
    };

type EntryInput = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never;

type Live = StreamState & { startedAt: number; activity?: string };

type Overlay = 'model' | 'provider' | 'key' | 'resume' | 'delete' | null;

const savedKinds = new Set<Entry['kind']>(['user', 'assistant', 'tool']);

type Pending = { request: ApprovalRequest; resolve: (decision: Decision) => void };

type Props = { initialConfig: Config; initialPrompt?: string; resume?: Session | 'pick'; version: string; migrated?: string[] };

const maxSteps = 30;

let nextId = 0;

const Transcript = memo(function Transcript(props: {
  entries: Entry[];
  columns: number;
  version: string;
  showThinking: boolean;
}) {
  const { entries, columns, version, showThinking } = props;
  return (
    <>
      {entries.map((entry) => {
        switch (entry.kind) {
          case 'banner':
            return <Banner key={entry.id} columns={columns} version={version} />;
          case 'help':
            return <HelpPanel key={entry.id} />;
          case 'brain':
            return <BrainPanel key={entry.id} memories={entry.memories} />;
          case 'skills':
            return <SkillsPanel key={entry.id} skills={entry.skills} pinned={entry.pinned} />;
          case 'user':
            return <UserMessage key={entry.id} text={entry.text} images={entry.images} via={entry.via} />;
          case 'mcp':
            return <McpPanel key={entry.id} rows={entry.rows} />;
          case 'remote':
            return <RemotePanel key={entry.id} rows={entry.rows} code={entry.code} />;
          case 'notice':
            return <Notice key={entry.id} tone={entry.tone} text={entry.text} />;
          case 'tool':
            return <ToolEntry key={entry.id} name={entry.name} detail={entry.detail} status={entry.status} output={entry.output} />;
          case 'assistant':
            return (
              <AssistantMessage
                key={entry.id}
                model={entry.model}
                content={entry.content}
                reasoning={entry.reasoning}
                stats={entry.stats}
                aborted={entry.aborted}
                showThinking={showThinking}
              />
            );
        }
      })}
    </>
  );
});

const isGatewayAuthError = (error: unknown, active: Active) =>
  Boolean(active.provider.gateway) && error instanceof ApiError && (error.status === 401 || error.status === 403);

function describeError(error: unknown, active: Active, toolsOn: boolean): string {
  const label = active.provider.label;
  if (active.provider.gateway && error instanceof ApiError && !isGatewayAuthError(error, active) && isUpstreamAuthError(error)) {
    const upstream = error.message.match(/^\[([^\]]+)\]/)?.[1] ?? active.model;
    const cooldown = error.message.match(/\(reset after ([^)]+)\)/)?.[1];
    return `${label}: the provider behind ${upstream} rejected its API key. Fix that provider's key in the dashboard ${active.provider.keyUrl}, or pick a model from another provider with /model.${cooldown ? ` 9Router paused this provider for ${cooldown}.` : ''}`;
  }
  if (isGatewayAuthError(error, active))
    return active.apiKey
      ? `${label} rejected the request for ${active.model}: ${(error as ApiError).message}. Check that the 9Router API key is correct (/key) and that this model's provider is connected in the dashboard ${active.provider.keyUrl}.`
      : `${label} requires an API key. Create one in the dashboard ${active.provider.keyUrl}, then paste it below or use /key.`;
  if (isContextError(error))
    return `The request is too large for this model's context even after trimming the history. Try /clear for a fresh chat, ${toolsOn ? '/tools to turn off tools and the skill list, ' : ''}or pick a model with a larger context.`;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return `${label} rejected the API key. Update it with /key.`;
    if (error.status === 402) return `${label}: insufficient balance. Top up and /retry.`;
    if (error.status === 429) return `${label} is rate limiting requests. Wait a moment and /retry.`;
    const hint = /image|vision|multimodal|image_url/i.test(error.message)
      ? ' This model may not support images, pick a vision model with /model.'
      : toolsOn && /tool|function/i.test(error.message)
        ? ' This model may not support tools, turn them off with /tools.'
        : '';
    return `Error ${label} ${error.status}: ${error.message}${hint}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (isTransientError(error) && !isUnreachableError(error))
    return `The connection to ${label} dropped mid-answer. Send again or type /retry.`;
  if (isUnreachableError(error) || /fetch failed/i.test(message))
    return active.provider.local
      ? `Cannot reach ${active.baseUrl}. ${active.provider.startHint ?? 'Is your LLM server running?'}`
      : `Cannot reach ${label}. Check your internet connection.`;
  return `Request failed: ${message}`;
}

const toolMapping = [
  'Skills may be written for other agents (Claude Code, Codex). In Cream, map their actions to your tools:',
  '- Skill tool / invoking a skill (also "superpowers:<name>") -> use_skill with the bare name',
  '- Read, Write, Edit -> read_file, write_file, edit_file; Bash or shell -> run_command; Glob or Grep -> list_dir or run_command',
  '- TodoWrite or task lists -> keep a Markdown checklist in your reply or a TODO.md file',
  '- Subagents, Task tool, parallel agents -> not available; do the work yourself step by step (prefer executing-plans over subagent-driven-development)',
  '- Plan mode or AskUserQuestion -> ask the user directly in your reply and wait for the answer',
].join('\n');

function summarize(description: string): string {
  const sentence = description.split(/(?<=\.)\s/)[0] ?? description;
  return sentence.length > 120 ? `${sentence.slice(0, 117)}…` : sentence;
}

const languageRule =
  'Reply in the language of the latest user message. Tool results and skill instructions do not change the reply language. Keep code, commands, file names and technical terms as they are.';

function brainSection(memories: Memory[], toolsOn: boolean, compact: boolean): string {
  const shown = compact ? memories.slice(-50) : memories;
  const lines = [
    'Long-term memory about this user, collected from previous chats. Use it to personalize answers and do not bring it up unless relevant:',
    shown.length ? shown.map((m) => `#${m.id} ${m.text}`).join('\n') : '(no memories yet)',
  ];
  if (toolsOn)
    lines.push(
      'When the user shares a durable fact or preference worth keeping across chats (name, projects, preferences, setup, goals), call remember with one short standalone sentence, quietly. Use forget for memories that are wrong or outdated. When the user refers to an earlier conversation, call search_chats.',
    );
  return lines.join('\n');
}

function buildSystemPrompt(config: Config, skills: Skill[], pinned: string[], memories: Memory[], compact: boolean): string {
  const parts = [languageRule, config.systemPrompt].filter(Boolean);
  if (config.tools || memories.length) parts.push(brainSection(memories, config.tools, compact));
  if (config.tools) {
    parts.push(
      [
        `You are running inside Cream on ${process.platform} with tools. Working directory: ${process.cwd()}`,
        `run_command uses ${shellName}${process.platform === 'win32' ? ', so use Windows command syntax' : ''}.`,
        'Only use tools when the task needs files or commands; otherwise answer directly. Save generated files in the working directory unless told otherwise.',
      ].join('\n'),
    );
    if (skills.length)
      parts.push(
        [
          'Installed skills. When a request matches one, call use_skill with its name before doing the task, then follow the loaded instructions:',
          ...skills.map((s) => `- ${s.name}: ${compact ? summarize(s.description) : s.description}`),
        ].join('\n'),
      );
    if (skills.length) parts.push(toolMapping);
    const deferred = mcp.deferredServers();
    if (deferred.length)
      parts.push(
        `Large MCP servers are connected (${deferred.map((d) => `${d.server}: ${d.tools} tools`).join(', ')}). Use mcp_find_tools to discover the right tool and its schema, then mcp_call_tool to run it. Tool names mentioned by skills can be passed to mcp_find_tools as the query.`,
      );
  }
  for (const name of pinned) {
    const skill = skills.find((s) => s.name === name);
    if (skill) parts.push(`<always-active-skill name="${skill.name}">\n${readSkill(skill)}\n</always-active-skill>`);
  }
  return parts.join('\n\n');
}

export function App({ initialConfig, initialPrompt, resume, version, migrated = [] }: Props) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();

  const [config, setConfig] = useState(initialConfig);
  const [entries, setEntries] = useState<Entry[]>([{ id: nextId++, kind: 'banner' }]);
  const [conversation, setConversation] = useState<ChatMessage[]>([]);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [connection, setConnection] = useState<Connection>('checking');
  const [speed, setSpeed] = useState<number>();
  const [anchor, setAnchor] = useState<number | null>(null);
  const [skills, setSkills] = useState<Skill[]>(() => loadSkills());
  const [, setMcpTick] = useState(0);
  const mcpStates = useRef(new Map<string, McpState['status']>());
  const [memories, setMemories] = useState<Memory[]>(() => loadMemories());
  const [confirm, setConfirm] = useState<{ title: string; detail?: string; run: () => void } | null>(null);

  const session = useRef({ id: newSessionId(), createdAt: new Date().toISOString() });
  const abortRef = useRef<AbortController | null>(null);
  const lookQueue = useRef<ImageRef[]>([]);
  const originRef = useRef<RemoteTarget | null>(null);
  const liveRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;
  liveRef.current = Boolean(live);
  const [remoteStates, setRemoteStates] = useState<Partial<Record<RemotePlatform, RemoteState>>>({});
  const remoteEvents = useRef<HubEvents | null>(null);
  const hubRef = useRef<RemoteHub | null>(null);
  if (!hubRef.current) hubRef.current = new RemoteHub(() => remoteEvents.current!);
  const hub = hubRef.current;
  const allowed = useRef(new Set<string>());
  const started = useRef(false);
  const scrollMetrics = useRef({ max: 0, height: rows });

  const active = useMemo(() => resolveActive(config), [config]);
  const pinned = config.pinnedSkills;
  const endpoint = useMemo(() => ({ baseUrl: active.baseUrl, apiKey: active.apiKey }), [active.baseUrl, active.apiKey]);

  const push = useCallback((...items: EntryInput[]) => {
    setEntries((prev) => [...prev, ...items.map((item) => ({ ...item, id: nextId++ }) as Entry)]);
    setAnchor(null);
  }, []);

  const notify = useCallback((tone: NoticeTone, text: string) => push({ kind: 'notice', tone, text }), [push]);

  const updateConfig = useCallback((patch: Partial<Config> | ((prev: Config) => Partial<Config>)) => {
    setConfig((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      saveConfig(next);
      return next;
    });
  }, []);

  const setModel = useCallback(
    (model: string) => updateConfig((prev) => ({ models: { ...prev.models, [prev.provider]: model } })),
    [updateConfig],
  );

  const setPinned = useCallback(
    (update: (prev: string[]) => string[]) => updateConfig((prev) => ({ pinnedSkills: update(prev.pinnedSkills) })),
    [updateConfig],
  );

  const resolveSkillCommand = useCallback(
    (command: string) => {
      const name = skillAliases[command] ?? command.slice(1);
      return skills.find((s) => s.name === name);
    },
    [skills],
  );

  const skillCommands = useMemo<Command[]>(() => {
    const names = new Set(skills.map((s) => s.name));
    const aliases = Object.entries(skillAliases)
      .filter(([, target]) => names.has(target))
      .map(([alias, target]) => ({ name: alias, args: '[request]', description: `Run the ${target} skill` }));
    const direct = skills
      .filter((s) => !commands.some((c) => c.name === `/${s.name}`))
      .map((s) => ({ name: `/${s.name}`, args: '[request]', description: summarize(s.description) }));
    return [...aliases, ...direct];
  }, [skills]);

  const setApiKey = useCallback(
    (key: string) => updateConfig((prev) => ({ apiKeys: { ...prev.apiKeys, [prev.provider]: key } })),
    [updateConfig],
  );

  const switchProvider = useCallback(
    (id: ProviderId) => {
      const next = resolveActive({ ...config, provider: id });
      updateConfig({ provider: id });
      notify('success', `Provider set to ${next.provider.label}`);
      if (next.needsKey && !next.apiKey) setOverlay('key');
    },
    [config, updateConfig, notify],
  );

  const scrollBy = useCallback((delta: number) => {
    setAnchor((current) => {
      const { max } = scrollMetrics.current;
      const next = Math.max(0, Math.min(max, (current ?? max) + delta));
      return next >= max ? null : next;
    });
  }, []);

  const [activityAt, setActivityAt] = useState(() => Date.now());
  const [moodFlash, setMoodFlash] = useState<Mood | null>(null);
  const moodTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const flashMood = useCallback((mood: Mood, ms: number) => {
    clearTimeout(moodTimer.current);
    setMoodFlash(mood);
    moodTimer.current = setTimeout(() => setMoodFlash(null), ms);
  }, []);

  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const mouse = useMouse(
    {
      onWheel: scrollBy,
      onCopied: (chars) => {
        clearTimeout(copiedTimer.current);
        setCopied(`✔ ${chars} characters copied`);
        copiedTimer.current = setTimeout(() => setCopied(null), 2500);
      },
    },
    config.mouse,
  );

  const [recheck, setRecheck] = useState(0);
  const budgets = useRef(new Map<string, number>());
  const trimNotified = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let warned = false;
    let timer: NodeJS.Timeout | undefined;

    if (active.needsKey && !active.apiKey) {
      setConnection('locked');
      notify('info', `${active.provider.label} needs an API key. Paste it below or use /key.`);
      setOverlay((current) => current ?? 'key');
      return;
    }

    const check = () => {
      listModels(endpoint)
        .then((models) => {
          if (cancelled) return;
          if (warned) notify('success', `Connected to ${active.provider.label}`);
          if (!active.model) {
            setConnection('online');
            return setOverlay((current) => current ?? 'model');
          }
          if (models.length && !models.includes(active.model)) {
            setConnection('online');
            return notify('info', `Model "${active.model}" is not available on ${active.provider.label}. Pick one with /model.`);
          }
          if (!isOllama(active.baseUrl)) return setConnection('online');
          setConnection('loading');
          warmModel(active.baseUrl, active.model)
            .catch(() => undefined)
            .finally(() => {
              if (!cancelled) setConnection('online');
            });
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            setConnection('locked');
            setOverlay((current) => current ?? 'key');
            return notify('error', describeError(error, active, false));
          }
          setConnection('offline');
          if (!warned) notify('error', `${describeError(error, active, false)} Retrying in the background…`);
          warned = true;
          timer = setTimeout(check, 5000);
        });
    };

    setConnection('checking');
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active.provider.id, active.baseUrl, active.apiKey, active.model, recheck]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setElapsed((Date.now() - live.startedAt) / 1000), 100);
    return () => clearInterval(timer);
  }, [live?.startedAt]);

  const askApproval = useCallback(
    (request: ApprovalRequest) =>
      new Promise<Decision>((resolve) => {
        let settled = false;
        let remoteId: string | undefined;
        const finish = (decision: Decision) => {
          if (settled) return;
          settled = true;
          if (remoteId) hub.settleApproval(remoteId);
          setPending(null);
          resolve(decision);
        };
        const origin = originRef.current;
        if (origin) {
          const title = { run_command: 'Run this command?', write_file: 'Write this file?', edit_file: 'Edit this file?', screenshot: 'Take a screenshot?' }[request.name];
          const preview = request.preview
            ? `\n\n\`\`\`\n${request.preview.split('\n').slice(0, 15).join('\n').replace(/```/g, "'''")}\n\`\`\``
            : '';
          const detail = request.detail.replace(/`/g, "'").slice(0, 300);
          const remote = hub.askApproval(origin, `🔐 **${title ?? `Izinkan ${request.name}?`}**\n\n\`${detail}\`${preview}`);
          remoteId = remote.id;
          void remote.decision.then(finish);
        }
        setPending({ request, resolve: finish });
      }),
    [hub],
  );

  const runTool = useCallback(
    async (call: ParsedCall, signal: AbortSignal): Promise<ToolOutcome & { stop?: boolean }> => {
      const detail = describeCall(call);
      const record = (status: ToolStatus, outcome: ToolOutcome) => {
        push({ kind: 'tool', name: call.name, detail, status, output: outcome.output });
        const origin = originRef.current;
        if (origin) {
          const shown = detail.split('\n')[0]!.replace(/`/g, "'").slice(0, 160);
          hub.log(origin, `${{ ok: '✅', error: '❌', denied: '🚫' }[status]} **${call.name}**${shown ? ` \`${shown}\`` : ''}`);
        }
      };

      const key = approvalKey(call);
      if (needsApproval(call.name, call.args) && !config.autoApprove && !allowed.current.has(key)) {
        const preview =
          call.name === 'write_file'
            ? String(call.args.content ?? '')
            : call.name === 'edit_file'
              ? `- ${String(call.args.old_text ?? '')}\n+ ${String(call.args.new_text ?? '')}`
              : undefined;
        setLive((prev) => (prev ? { ...prev, activity: 'Menunggu persetujuanmu…' } : prev));
        const decision = await askApproval({ name: call.name, detail, preview });
        if (decision === 'always') allowed.current.add(key);
        if (decision === 'deny' || decision === 'stop') {
          const outcome = { ok: false, output: 'The user denied this action. Ask how they would like to proceed.' };
          record('denied', outcome);
          return { ...outcome, stop: decision === 'stop' };
        }
      }

      setLive((prev) => (prev ? { ...prev, activity: `${call.name} ${detail.split('\n')[0]}` } : prev));
      const outcome = await executeTool(call, {
        cwd: process.cwd(),
        skills,
        signal,
        sessionId: session.current.id,
        screenshot: async (args) => {
          const shot = await captureScreen(args.screen === 'primary' ? 'primary' : 'all');
          const ref = saveImage(session.current.id, shot);
          const caption = args.caption ? String(args.caption) : `🖥️ Screenshot PC · ${new Date().toLocaleTimeString('en-GB')}`;
          const origin = originRef.current;
          let delivery = 'not sent anywhere';
          if (origin) {
            await hub.sendImage(origin, shot, caption);
            delivery = `sent to the user's ${platformLabel[origin.platform]} chat`;
          } else if (args.send_to_phone) {
            const to = await hub.broadcastImage(remoteAllowed(), shot, caption);
            delivery = to.length ? `sent to ${to.join(', ')}` : 'not sent because no paired phone account is connected';
          }
          if (args.look) lookQueue.current.push(ref);
          const size = shot.width ? `${shot.width}x${shot.height}` : 'unknown size';
          return { ok: true, output: `Screenshot ${size} saved to ${ref.path}; ${delivery}.${args.look ? ' The image is attached in the next message.' : ''}` };
        },
      });
      record(outcome.ok ? 'ok' : 'error', outcome);
      if (call.name === 'remember' || call.name === 'forget') setMemories(loadMemories());
      return outcome;
    },
    [config.autoApprove, skills, push, askApproval, hub],
  );

  const generate = useCallback(
    async (history: ChatMessage[], origin?: RemoteTarget) => {
      const reply = (text: string) => origin && hub.send(origin, text);
      if (active.needsKey && !active.apiKey) {
        setConversation(history);
        notify('error', `${active.provider.label} needs an API key first.`);
        reply(`✖ ${active.provider.label} needs an API key. Set it in the terminal with /key.`);
        return setOverlay('key');
      }
      if (!active.model) {
        setConversation(history);
        notify('error', 'Pick a model first.');
        reply('✖ No model selected. Pick one in the terminal with /model.');
        return setOverlay('model');
      }

      const controller = new AbortController();
      abortRef.current = controller;
      originRef.current = origin ?? null;
      if (origin) hub.typing(origin);
      const typing = origin ? setInterval(() => hub.typing(origin), 4500) : undefined;
      const startedAt = Date.now();
      const systemPrompt = buildSystemPrompt(config, skills, pinned, loadMemories(), active.provider.local);
      const tools = config.tools ? toolDefinitions(skills) : undefined;
      const keepReasoning = /deepseek\.com|moonshot\./.test(active.baseUrl);
      let working = history;

      setElapsed(0);
      setAnchor(null);
      setLive({ content: '', reasoning: '', startedAt });

      try {
        for (let step = 0; step < maxSteps; step++) {
          let latest: StreamState = { content: '', reasoning: '' };
          let lastPaint = 0;
          setLive((prev) => ({ content: '', reasoning: '', startedAt: prev?.startedAt ?? startedAt }));

          let result: StreamResult | undefined;
          let aborted = false;
          const budgetKey = `${active.provider.id}:${active.model}`;
          for (let attempt = 0; ; attempt++) {
            const budget = budgets.current.get(budgetKey) ?? (active.provider.local ? localBudget : cloudBudget);
            const prepared = prepareContext(working, budget);
            if (prepared.droppedTurns && !trimNotified.current) {
              trimNotified.current = true;
              notify('info', 'This chat is getting long: the earliest turns are no longer sent to the model to keep things fast. The full history is still saved.');
            }
            const system = prepared.droppedTurns
              ? `${systemPrompt}\n\nThe earliest ${prepared.droppedTurns} turns of this conversation were trimmed to fit the context window. Ask the user if you need details from them.`
              : systemPrompt;
            try {
              result = await streamChat({
                ...endpoint,
                model: active.model,
                temperature: config.temperature,
                messages: system ? [{ role: 'system', content: system }, ...prepared.messages] : prepared.messages,
                tools,
                signal: controller.signal,
                onUpdate: (state) => {
                  latest = state;
                  const now = Date.now();
                  if (now - lastPaint > 40) {
                    lastPaint = now;
                    setLive((prev) => ({ ...state, startedAt: prev?.startedAt ?? startedAt }));
                  }
                },
              });
              break;
            } catch (error) {
              if (controller.signal.aborted) {
                aborted = true;
                break;
              }
              const partial = Boolean(latest.content || latest.reasoning);
              if (isContextError(error) && attempt < 3 && prepareContext(working, Math.floor(prepared.size / 2)).size < prepared.size) {
                budgets.current.set(budgetKey, Math.floor(Math.min(budget, prepared.size) / 2));
                notify('info', 'Context too long for this model. Trimming older history and retrying…');
                continue;
              }
              if (isTransientError(error) && !partial && attempt < 2) {
                if (prepared.size > 60_000) budgets.current.set(budgetKey, Math.floor(prepared.size * 0.6));
                notify('info', `Connection to ${active.provider.label} dropped. Retrying (${attempt + 1}/2)…`);
                await new Promise((resolve) => {
                  const timer = setTimeout(resolve, 1500 * (attempt + 1));
                  controller.signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
                });
                continue;
              }
              throw error;
            }
          }

          if (aborted || !result) {
            push({ kind: 'assistant', model: active.model, content: latest.content, reasoning: latest.reasoning, aborted: true });
            if (latest.content) working = [...working, { role: 'assistant', content: latest.content }];
            reply(`${latest.content ? `${latest.content}\n\n` : ''}■ Dihentikan.`);
            break;
          }

          setConnection('online');
          setSpeed(result.tokensPerSecond);
          const calls = result.toolCalls;

          if (result.content.trim()) reply(result.content);
          if (result.content.trim() || !calls.length)
            push({
              kind: 'assistant',
              model: active.model,
              content: result.content,
              reasoning: result.reasoning,
              stats: { tokens: result.tokens, seconds: result.seconds, tokensPerSecond: result.tokensPerSecond },
            });

          working = [
            ...working,
            {
              role: 'assistant',
              content: result.content || (calls.length ? null : ''),
              ...(calls.length ? { tool_calls: calls } : {}),
              ...(calls.length && keepReasoning && result.reasoning ? { reasoning_content: result.reasoning } : {}),
            },
          ];
          if (!calls.length) break;

          let stopped = false;
          for (const payload of calls) {
            if (stopped || controller.signal.aborted) {
              working = [...working, { role: 'tool', tool_call_id: payload.id, content: 'Cancelled by the user.' }];
              continue;
            }
            const outcome = await runTool(parseCall(payload), controller.signal);
            working = [...working, { role: 'tool', tool_call_id: payload.id, content: outcome.output }];
            if (outcome.stop) stopped = true;
          }
          if (lookQueue.current.length) {
            working = [...working, { role: 'user', content: '[Screenshot from the screenshot tool]', images: lookQueue.current }];
            lookQueue.current = [];
          }
          if (stopped || controller.signal.aborted) break;
          if (step === maxSteps - 1) notify('info', `Stopped after ${maxSteps} tool steps. Send a message to continue.`);
        }
        if (!controller.signal.aborted) flashMood('happy', 2500);
      } catch (error) {
        flashMood('sad', 3500);
        if (isGatewayAuthError(error, active) && !active.apiKey) {
          setConnection('locked');
          setOverlay((current) => current ?? 'key');
        } else if (isGatewayAuthError(error, active)) setConnection('online');
        else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setConnection('locked');
        else if (isUnreachableError(error)) {
          setConnection('offline');
          setRecheck((n) => n + 1);
        }
        notify('error', describeError(error, active, config.tools));
        reply(`✖ ${describeError(error, active, config.tools)}`);
      } finally {
        clearInterval(typing);
        setActivityAt(Date.now());
        setConversation(working);
        abortRef.current = null;
        originRef.current = null;
        setLive(null);
      }
    },
    [active, endpoint, config, skills, pinned, push, notify, runTool, hub, flashMood],
  );

  const startFresh = useCallback(() => {
    session.current = { id: newSessionId(), createdAt: new Date().toISOString() };
    trimNotified.current = false;
    setEntries([{ id: nextId++, kind: 'banner' }]);
    setConversation([]);
    setSpeed(undefined);
    setAnchor(null);
  }, []);

  const confirmDelete = useCallback(
    (id: string, title: string, reopen?: Overlay) =>
      setConfirm({
        title: 'Delete this chat?',
        detail: title,
        run: () => {
          if (!deleteSession(id)) return notify('error', 'Could not delete the chat.');
          if (id === session.current.id) startFresh();
          notify('success', `Deleted chat "${title}"`);
          if (reopen && listSessions().length) setOverlay(reopen);
        },
      }),
    [notify, startFresh],
  );

  const remoteAllowed = () => ({
    telegram: configRef.current.remote.telegram.allowed,
    discord: configRef.current.remote.discord.allowed,
  });

  const remoteRows = useCallback((): RemoteRow[] => {
    const current = configRef.current;
    return (['telegram', 'discord'] as RemotePlatform[]).map((platform) => {
      const state = remoteStates[platform];
      const token = remoteToken(current, platform);
      const paired = current.remote[platform].allowed.length;
      const accounts = paired ? `${paired} account${paired === 1 ? '' : 's'} paired` : 'no paired accounts';
      if (!token) return { label: platformLabel[platform], status: 'not set up', tone: 'off', detail: `/remote ${platform} <token>` };
      if (!current.remote.enabled) return { label: platformLabel[platform], status: 'off', tone: 'off', detail: '/remote on to enable' };
      if (state?.status === 'online') return { label: platformLabel[platform], status: 'online', tone: 'on', detail: `${state.name} · ${accounts}` };
      if (state?.status === 'error') return { label: platformLabel[platform], status: 'error', tone: 'error', detail: state.detail ?? '' };
      return { label: platformLabel[platform], status: 'connecting…', tone: 'off', detail: accounts };
    });
  }, [remoteStates]);

  const runCommand = useCallback(
    (raw: string, origin?: RemoteTarget) => {
      const [name, ...rest] = raw.split(' ').filter(Boolean);
      const arg = rest.join(' ').trim();

      switch (name?.toLowerCase()) {
        case '/help':
          return push({ kind: 'help' });
        case '/exit':
        case '/quit':
          return exit();
        case '/clear':
          return startFresh();
        case '/resume':
          if (!listSessions().length) return notify('info', 'No saved chats yet.');
          return setOverlay('resume');
        case '/delete':
          if (!listSessions().length) return notify('info', 'No saved chats yet.');
          if (arg === 'all')
            return setConfirm({
              title: `Delete all ${listSessions().length} chats?`,
              detail: 'Chat history is deleted permanently. Brain memories are kept.',
              run: () => {
                const count = deleteAllSessions();
                startFresh();
                notify('success', `Deleted ${count} chats`);
              },
            });
          if (arg) {
            const target = loadSession(arg);
            return target ? confirmDelete(target.id, target.title) : notify('error', `Chat "${arg}" not found.`);
          }
          return setOverlay('delete');
        case '/remote': {
          const [sub, token] = rest;
          const platform = sub?.toLowerCase() as RemotePlatform;
          if (!sub || sub === 'status') return push({ kind: 'remote', rows: remoteRows(), code: hub.pairingCode });
          if (platform === 'telegram' || platform === 'discord') {
            if (!token) return notify('error', `Usage: /remote ${platform} <bot token>`);
            updateConfig((prev) => ({ remote: { ...prev.remote, enabled: true, [platform]: { ...prev.remote[platform], token } } }));
            return notify('info', `Connecting ${platformLabel[platform]}… Pairing code: ${hub.pairingCode} (send /pair ${hub.pairingCode} to the bot from your phone).`);
          }
          if (sub === 'off') {
            updateConfig((prev) => ({ remote: { ...prev.remote, enabled: false } }));
            return notify('success', 'Remote off. The bots no longer accept commands.');
          }
          if (sub === 'on') {
            updateConfig((prev) => ({ remote: { ...prev.remote, enabled: true } }));
            return notify('success', 'Remote on.');
          }
          if (sub === 'code') return notify('info', `New pairing code: ${hub.rotateCode()}`);
          if (sub === 'unpair')
            return setConfirm({
              title: 'Unpair every connected phone account?',
              detail: 'Accounts will need to pair again with a new code.',
              run: () => {
                updateConfig((prev) => ({
                  remote: {
                    ...prev.remote,
                    telegram: { ...prev.remote.telegram, allowed: [] },
                    discord: { ...prev.remote.discord, allowed: [] },
                  },
                }));
                hub.rotateCode();
                notify('success', 'All phone accounts unpaired.');
              },
            });
          if (sub === 'forget' && (token === 'telegram' || token === 'discord')) {
            updateConfig((prev) => ({ remote: { ...prev.remote, [token]: { token: '', allowed: [] } } }));
            return notify('success', `Removed the ${platformLabel[token]} token and accounts.`);
          }
          return notify('error', 'Usage: /remote [telegram|discord <token>|on|off|code|unpair|forget <platform>]');
        }
        case '/mcp': {
          const [sub, server, ...commandParts] = rest;
          const servers = config.mcpServers;
          const rows = (): McpRow[] =>
            Object.entries(configRef.current.mcpServers).map(([name, entry]) => {
              const state = mcp.states.get(name);
              const command = [entry.command, ...entry.args].join(' ');
              if (!entry.enabled) return { name, status: 'off', tone: 'off', command, detail: `/mcp on ${name}` };
              if (state?.status === 'ready') {
                const extra = state.tools > directToolLimit ? ' · tool search mode' : '';
                return { name, status: 'ready', tone: 'on', command, detail: `${state.tools} tools${extra}` };
              }
              if (state?.status === 'error') return { name, status: 'error', tone: 'error', command, detail: state.detail ?? '' };
              return { name, status: 'starting…', tone: 'off', command, detail: 'first download can take a while' };
            });
          if (!sub) return push({ kind: 'mcp', rows: rows() });
          if (sub === 'add') {
            if (!server || !commandParts.length) return notify('error', 'Usage: /mcp add <name> <command> [args…]');
            if (!/^[a-z0-9_-]+$/i.test(server)) return notify('error', 'Server names may only contain letters, numbers, - and _');
            const [command, ...args] = commandParts;
            updateConfig((prev) => ({ mcpServers: { ...prev.mcpServers, [server]: { command: command!, args, enabled: true } } }));
            return notify('info', `Starting MCP ${server}: ${commandParts.join(' ')}`);
          }
          if (!server || !servers[server]) return notify('error', `No MCP server named "${server ?? ''}". See /mcp.`);
          if (sub === 'remove') {
            updateConfig((prev) => {
              const others = { ...prev.mcpServers };
              delete others[server];
              return { mcpServers: others };
            });
            return notify('success', `Removed MCP ${server}`);
          }
          if (sub === 'on' || sub === 'off') {
            updateConfig((prev) => ({ mcpServers: { ...prev.mcpServers, [server]: { ...prev.mcpServers[server]!, enabled: sub === 'on' } } }));
            return notify('success', `MCP ${server} ${sub === 'on' ? 'enabled' : 'disabled'}`);
          }
          if (sub === 'restart') {
            mcp.start(server, servers[server]!, version);
            return notify('info', `Restarting MCP ${server}…`);
          }
          if (sub === 'tools') {
            const list = mcp.tools(server);
            if (!list.length) return notify('info', `MCP ${server} is not ready or has no tools.`);
            const names = list.map((t) => (t.readOnly ? t.name : `${t.name}*`)).join(', ');
            return notify('info', `${list.length} tools on ${server}: ${names}  (* = asks for approval)`);
          }
          return notify('error', 'Usage: /mcp [add <name> <command…>|remove|on|off|restart|tools <name>]');
        }
        case '/brain':
          return push({ kind: 'brain', memories: loadMemories() });
        case '/remember': {
          if (!arg) return notify('error', 'Usage: /remember <something to remember>');
          const { memory, duplicate } = addMemory(arg, session.current.id);
          setMemories(loadMemories());
          return notify('success', duplicate ? `Already remembered as #${memory.id}` : `Remembered as #${memory.id}: ${memory.text}`);
        }
        case '/forget': {
          if (arg === 'all')
            return setConfirm({
              title: `Delete all ${loadMemories().length} memories?`,
              detail: 'Cream will forget everything it remembers about you.',
              run: () => {
                const count = clearMemories();
                setMemories([]);
                notify('success', `Deleted ${count} memories`);
              },
            });
          const removed = removeMemory(Number(arg.replace('#', '')));
          if (!removed) return notify('error', 'Usage: /forget <id|all>. See ids with /brain.');
          setMemories(loadMemories());
          return notify('success', `Forgot #${removed.id}: ${removed.text}`);
        }
        case '/provider': {
          if (!arg) return setOverlay('provider');
          const provider = getProvider(arg);
          if (!provider) return notify('error', `Unknown provider. Options: ${providerIds.join(', ')}`);
          return switchProvider(provider.id);
        }
        case '/model':
          if (!arg) return setOverlay('model');
          setModel(arg);
          return notify('success', `Model set to ${arg}`);
        case '/key':
          if (active.provider.local && !active.provider.keyOptional)
            return notify('info', `${active.provider.label} runs locally and does not need an API key.`);
          if (!arg) return setOverlay('key');
          setApiKey(arg);
          return notify('success', `API key saved for ${active.provider.label}`);
        case '/url': {
          if (!arg) return notify('info', `Endpoint: ${active.baseUrl}`);
          const preset = getProvider(arg);
          if (preset) return switchProvider(preset.id);
          if (!/^https?:\/\//.test(arg)) return notify('error', 'The URL must start with http:// or https://');
          updateConfig({ provider: 'custom', customUrl: arg });
          return notify('success', `Custom endpoint set to ${arg}`);
        }
        case '/skills': {
          const [sub, ...names] = rest;
          if (!sub) return push({ kind: 'skills', skills, pinned });
          if (sub === 'install') {
            const repo = names[0] && isRepo(names[0]) ? names[0] : defaultRepo;
            const wanted = names[0] && isRepo(names[0]) ? names.slice(1) : names;
            notify('info', `Downloading ${wanted.length ? wanted.join(', ') : 'all skills'} from github.com/${repo}…`);
            installSkills(repo, wanted)
              .then((installed) => {
                setSkills(loadSkills());
                notify('success', `Installed ${installed.length} skill${installed.length === 1 ? '' : 's'} from ${repo}: ${installed.join(', ')}`);
                const boot = (bootstrapSkills[repo] ?? []).filter((n) => installed.includes(n));
                if (boot.length) {
                  setPinned((prev) => [...new Set([...prev, ...boot])]);
                  notify('info', `${boot.join(', ')} is now always active, like a session-start hook. Toggle it with /skill ${boot[0]}.`);
                }
              })
              .catch((error: Error) => notify('error', `Skill install failed: ${error.message}`));
            return;
          }
          if (sub === 'remove') {
            if (!names.length) return notify('error', 'Usage: /skills remove <name>');
            const removed = names.filter((n) => removeSkill(n));
            setSkills(loadSkills());
            setPinned((prev) => prev.filter((n) => !removed.includes(n)));
            return removed.length
              ? notify('success', `Removed ${removed.join(', ')}`)
              : notify('error', 'No matching skills to remove.');
          }
          return notify('error', 'Usage: /skills [install|remove] [owner/repo] [nama|all]');
        }
        case '/skill': {
          if (!arg) return push({ kind: 'skills', skills, pinned });
          if (!skills.some((s) => s.name === arg)) return notify('error', `No skill named "${arg}". See /skills.`);
          const isPinned = pinned.includes(arg);
          setPinned((prev) => (isPinned ? prev.filter((n) => n !== arg) : [...prev, arg]));
          return notify('success', isPinned ? `Skill ${arg} is no longer always active` : `Skill ${arg} is now always active`);
        }
        case '/tools':
          updateConfig({ tools: !config.tools });
          return notify('success', config.tools ? 'Tools off · plain chat mode' : 'Tools on · files, commands and skills enabled');
        case '/approve':
          updateConfig({ autoApprove: !config.autoApprove });
          return config.autoApprove
            ? notify('success', 'Auto-approve off · you will confirm file writes and commands')
            : notify('info', 'Auto-approve on · the model can write files and run commands without asking');
        case '/system':
          if (!arg) return notify('info', `System prompt: ${config.systemPrompt || '(empty)'}`);
          updateConfig({ systemPrompt: arg === 'none' ? '' : arg });
          return notify('success', 'System prompt diperbarui');
        case '/temp': {
          const value = Number(arg);
          if (!arg || Number.isNaN(value) || value < 0 || value > 2) return notify('error', 'Usage: /temp <0-2>');
          updateConfig({ temperature: value });
          return notify('success', `Temperature set to ${value}`);
        }
        case '/think':
          updateConfig({ showThinking: !config.showThinking });
          return notify('success', `Reasoning display ${config.showThinking ? 'off' : 'on'}`);
        case '/mascot':
          updateConfig({ mascot: !config.mascot });
          return notify('success', config.mascot ? 'Mascot hidden' : 'Mascot is back 🍦');
        case '/mouse':
          updateConfig({ mouse: !config.mouse });
          return notify(
            'success',
            config.mouse ? 'Cream mouse off · using the native terminal selection' : 'Mouse on · scroll, and drag to copy text',
          );
        case '/screenshot': {
          notify('info', 'Taking a screenshot…');
          captureScreen(arg === 'primary' ? 'primary' : 'all')
            .then(async (shot) => {
              const ref = saveImage(session.current.id, shot);
              const to = await hub.broadcastImage(remoteAllowed(), shot, `🖥️ Screenshot PC · ${new Date().toLocaleTimeString('en-GB')}`);
              notify('success', `Screenshot ${shot.width ?? '?'}×${shot.height ?? '?'} saved to ${ref.path}${to.length ? ` and sent to ${to.join(', ')}` : ' (no phone paired via /remote yet)'}`);
            })
            .catch((error: Error) => notify('error', `Screenshot failed: ${error.message}`));
          return;
        }
        case '/copy': {
          const last = conversation.findLast((m) => m.role === 'assistant' && m.content);
          if (!last?.content) return notify('error', 'No answer to copy yet.');
          void writeClipboard(last.content);
          return notify('success', 'Last answer copied to the clipboard');
        }
        case '/retry': {
          const lastUser = conversation.map((m) => m.role).lastIndexOf('user');
          if (lastUser === -1) return notify('error', 'Nothing to retry yet.');
          notify('info', 'Regenerating the last answer…');
          return void generate(conversation.slice(0, lastUser + 1));
        }
        default: {
          const skill = resolveSkillCommand(name!.toLowerCase());
          if (!skill) return notify('error', `Unknown command ${name}. Type /help to see all commands.`);
          push({ kind: 'user', text: raw, ...(origin ? { via: platformLabel[origin.platform] } : {}) });
          const request = arg || 'No specific request yet. Ask me what I would like to work on.';
          return void generate(
            [
              ...conversation,
              {
                role: 'user',
                content: `Use the "${skill.name}" skill for this request. Its instructions are below.\n\n${readSkill(skill)}\n\n---\nMy request: ${request}`,
              },
            ],
            origin,
          );
        }
      }
    },
    [
      active,
      config,
      conversation,
      skills,
      pinned,
      push,
      notify,
      exit,
      updateConfig,
      setModel,
      setApiKey,
      setPinned,
      switchProvider,
      generate,
      resolveSkillCommand,
      startFresh,
      confirmDelete,
      remoteRows,
      hub,
    ],
  );

  const handleSubmit = useCallback(
    (text: string, attachments: Attachment[] = [], origin?: RemoteTarget) => {
      if (text && !origin && !/^\/(key|remote\s+(telegram|discord))\s+\S/i.test(text))
        setInputHistory((prev) => (prev.at(-1) === text ? prev : [...prev, text]));
      if (text.startsWith('/')) {
        if (attachments.length) notify('info', 'Image attachments are ignored for commands.');
        return runCommand(text, origin);
      }
      const images = attachments.map((a) => saveImage(session.current.id, a));
      push({
        kind: 'user',
        text,
        ...(images.length ? { images: images.map(({ width, height }) => ({ width, height })) } : {}),
        ...(origin ? { via: platformLabel[origin.platform] } : {}),
      });
      void generate([...conversation, { role: 'user', content: text, ...(images.length ? { images } : {}) }], origin);
    },
    [conversation, push, notify, generate, runCommand],
  );

  const remoteHelp = [
    '## 🍦 Cream Remote',
    '',
    'Send a normal message to chat with Cream on your PC. Send a **photo** to have it analysed (needs a vision model).',
    '',
    '**Commands**',
    '- /status · Cream status',
    '- /screenshot · capture the PC screen (add primary for the main monitor only)',
    '- /stop · stop the current answer',
    '- /clear · start a new conversation',
    '- /brainstorm, /write-plan, /skill-name · run a skill',
    '',
    '**Approvals**',
    'When Cream asks to write a file or run a command, tap a button or reply `y` / `a` / `n` / `stop`.',
  ].join('\n');

  remoteEvents.current = {
    isAllowed: (platform, userId) => configRef.current.remote[platform].allowed.includes(userId),
    allow: (platform, userId) =>
      updateConfig((prev) => ({
        remote: { ...prev.remote, [platform]: { ...prev.remote[platform], allowed: [...new Set([...prev.remote[platform].allowed, userId])] } },
      })),
    onPaired: (platform, userName) => notify('success', `${userName} paired via ${platformLabel[platform]} and can now control Cream.`),
    onState: (platform, state) => {
      setRemoteStates((prev) => ({ ...prev, [platform]: state ?? undefined }));
      if (state?.status === 'online') {
        const paired = configRef.current.remote[platform].allowed.length;
        notify(
          'success',
          `${platformLabel[platform]} online as ${state.name}.${paired ? '' : ` Send /pair ${hub.pairingCode} to the bot from your phone to pair.`}`,
        );
      } else if (state?.status === 'error') notify('error', `${platformLabel[platform]}: ${state.detail}`);
    },
    onMessage: ({ target, text, images }) => {
      const command = (text.trim().toLowerCase().split(/\s+/)[0] ?? '').replace(/@\w+$/, '');
      if (command === '/start' || command === '/help') return hub.send(target, remoteHelp);
      if (command === '/stop') {
        if (!liveRef.current) return hub.send(target, 'Nothing is running.');
        return abortRef.current?.abort();
      }
      if (command === '/status') {
        const turns = conversation.filter((m) => m.role === 'user').length;
        return hub.send(
          target,
          [
            '## 📊 Cream status',
            '',
            `- **Connection:** ${connection === 'online' ? '🟢 online' : `🔴 ${connection}`}`,
            `- **Model:** ${active.provider.label} › \`${active.model || 'no model yet'}\``,
            `- **Conversation:** ${turns} turns · brain ${memories.length} memories`,
            `- **State:** ${liveRef.current ? '⏳ answering' : '✅ ready'}`,
            `- **Folder:** \`${process.cwd()}\``,
          ].join('\n'),
        );
      }
      if (command === '/screenshot' || command === '/ss') {
        hub.send(target, '📸 Taking a screenshot…');
        captureScreen(text.includes('primary') ? 'primary' : 'all')
          .then((shot) => {
            saveImage(session.current.id, shot);
            return hub.sendImage(target, shot, `🖥️ Screenshot PC · ${new Date().toLocaleTimeString('en-GB')}`);
          })
          .catch((error: Error) => hub.send(target, `❌ Screenshot failed: ${error.message}`));
        return;
      }
      if (command === '/clear' || command === '/new') {
        if (liveRef.current) return hub.send(target, 'Stop it first with /stop.');
        startFresh();
        return hub.send(target, '✨ Percakapan baru dimulai.');
      }
      if (liveRef.current || pending || confirm) return hub.send(target, '⏳ Cream is still busy. Wait a moment or send /stop.');
      if (command.startsWith('/') && !resolveSkillCommand(command))
        return hub.send(target, 'That command is only available in the terminal. Send /help for the commands you can use from your phone.');
      if (!text.trim() && !images.length) return;
      handleSubmit(text.trim(), images, target);
    },
  };

  useEffect(() => {
    for (const platform of ['telegram', 'discord'] as RemotePlatform[]) {
      const token = remoteToken(config, platform);
      if (config.remote.enabled && token) hub.start(platform, token);
      else hub.stop(platform);
    }
  }, [config.remote.enabled, config.remote.telegram.token, config.remote.discord.token]);

  useEffect(() => () => hub.stop(), []);

  useEffect(
    () =>
      mcp.subscribe(() => {
        setMcpTick((n) => n + 1);
        for (const [name, state] of mcp.states) {
          if (mcpStates.current.get(name) === state.status) continue;
          mcpStates.current.set(name, state.status);
          if (state.status === 'ready') {
            const extra = state.tools > directToolLimit ? ' · the model finds the tools it needs via mcp_find_tools' : '';
            notify('success', `MCP ${name} ready · ${state.tools} tools${extra}`);
          } else if (state.status === 'error') notify('error', `MCP ${name}: ${state.detail}`);
        }
      }),
    [],
  );

  useEffect(() => mcp.sync(config.mcpServers, version), [JSON.stringify(config.mcpServers)]);

  useEffect(() => () => mcp.stopAll(), []);

  const restore = useCallback(
    (saved: Session) => {
      const restored = (saved.entries as Entry[]).filter((e) => savedKinds.has(e.kind)).map((e) => ({ ...e, id: nextId++ }));
      session.current = { id: saved.id, createdAt: saved.createdAt };
      trimNotified.current = false;
      setEntries([
        { id: nextId++, kind: 'banner' },
        ...restored,
        {
          id: nextId++,
          kind: 'notice',
          tone: 'info',
          text: `Resuming "${saved.title}" · ${saved.turns} turns · last active ${timeAgo(saved.updatedAt)}`,
        },
      ]);
      setConversation(saved.conversation);
      setAnchor(null);
      if (saved.model && saved.model !== active.model)
        notify('info', `This session used ${saved.model} before, now ${active.model || 'no model yet'}. Switch with /model if needed.`);
    },
    [active.model, notify],
  );

  useEffect(() => {
    if (!conversation.some((m) => m.role === 'user')) return;
    saveSession({
      id: session.current.id,
      title: titleFrom(conversation),
      createdAt: session.current.createdAt,
      updatedAt: new Date().toISOString(),
      provider: active.provider.label,
      model: active.model,
      cwd: process.cwd(),
      turns: conversation.filter((m) => m.role === 'user').length,
      conversation,
      entries: entries.filter((e) => savedKinds.has(e.kind)),
    });
  }, [conversation, entries]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (migrated.length) notify('info', `Moved ${migrated.join(', ')} to ${dataRoot}. The old copies were left in place.`);
    if (resume === 'pick') {
      if (listSessions().length) setOverlay('resume');
      else notify('info', 'No saved chats yet. Starting a new chat.');
    } else if (resume) restore(resume);
    if (!initialPrompt) return;
    if (resume && resume !== 'pick') {
      push({ kind: 'user', text: initialPrompt });
      void generate([...resume.conversation, { role: 'user', content: initialPrompt }]);
    } else handleSubmit(initialPrompt);
  }, []);

  useInput((_input, key) => {
    const page = Math.max(3, scrollMetrics.current.height - 2);
    mouse.clear();
    setActivityAt(Date.now());
    if (key.escape && live) abortRef.current?.abort();
    else if (key.pageUp) scrollBy(-page);
    else if (key.pageDown) scrollBy(page);
    else if (key.ctrl && key.upArrow) scrollBy(-1);
    else if (key.ctrl && key.downArrow) scrollBy(1);
  });

  const hiddenBelow = anchor === null ? 0 : scrollMetrics.current.max - anchor;
  const flags = [
    config.tools ? `⚙ ${skills.length} skill${skills.length === 1 ? '' : 's'}` : 'chat only',
    `◉ brain ${memories.length}`,
    ...(Object.entries(remoteStates)
      .filter(([, state]) => state?.status === 'online')
      .map(([platform]) => `⇄ ${platformLabel[platform as RemotePlatform]}`)),
    ...(mcp.tools().length ? [`MCP ${mcp.tools().length}`] : []),
    ...(pinned.length ? [`pinned: ${pinned.join(', ')}`] : []),
    ...(config.autoApprove ? ['auto-approve'] : []),
    ...(config.showThinking ? ['thinking shown'] : []),
  ];
  const showCard = columns >= 72;
  const showMascot = config.mascot && columns >= 60;
  const mood: Mood = pending
    ? 'waiting'
    : live?.activity
      ? 'working'
      : live?.content
        ? 'talking'
        : live
          ? 'thinking'
          : (moodFlash ?? (connection === 'offline' || connection === 'locked' ? 'offline' : 'idle'));
  const cardWidth = Math.min(36, Math.floor(columns * 0.3));

  const renderBottom = () => {
    if (pending) return <ApprovalPrompt request={pending.request} onDecision={pending.resolve} />;
    if (confirm)
      return (
        <ConfirmPrompt
          title={confirm.title}
          detail={confirm.detail}
          onConfirm={() => {
            setConfirm(null);
            confirm.run();
          }}
          onCancel={() => setConfirm(null)}
        />
      );
    switch (overlay) {
      case 'delete':
        return (
          <SessionPicker
            title="Delete a chat"
            current={session.current.id}
            onSelect={(id) => {
              setOverlay(null);
              confirmDelete(id, listSessions().find((s) => s.id === id)?.title ?? id, 'delete');
            }}
            onCancel={() => setOverlay(null)}
          />
        );
      case 'model':
        return (
          <ModelPicker
            endpoint={endpoint}
            providerLabel={active.provider.label}
            current={active.model}
            onSelect={(model) => {
              setOverlay(null);
              setModel(model);
              notify('success', `Model set to ${model}`);
            }}
            onCancel={(error) => {
              setOverlay(null);
              if (error) notify('error', error);
            }}
          />
        );
      case 'provider':
        return (
          <ProviderPicker
            current={active.provider.id}
            customUrl={config.customUrl}
            hasKey={(id) => Boolean(resolveActive({ ...config, provider: id }).apiKey)}
            onSelect={(id) => {
              setOverlay(null);
              if (id !== active.provider.id) switchProvider(id);
            }}
            onCancel={() => setOverlay(null)}
          />
        );
      case 'key':
        return (
          <KeyPrompt
            provider={active.provider}
            onSubmit={(key) => {
              setOverlay(null);
              setApiKey(key);
              notify('success', `API key saved for ${active.provider.label}`);
            }}
            onCancel={() => setOverlay(null)}
          />
        );
      case 'resume':
        return (
          <SessionPicker
            current={session.current.id}
            onDelete={(id) => {
              setOverlay(null);
              confirmDelete(id, listSessions().find((s) => s.id === id)?.title ?? id, 'resume');
            }}
            onSelect={(id) => {
              setOverlay(null);
              const saved = loadSession(id);
              if (saved) restore(saved);
              else notify('error', 'Could not open the session.');
            }}
            onCancel={() => setOverlay(null)}
          />
        );
      default:
        return (
          <InputBar history={inputHistory} extraCommands={skillCommands} disabled={Boolean(live)} onSubmit={handleSubmit} />
        );
    }
  };

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <ScrollView
        anchor={anchor}
        onMetrics={(max, height) => {
          scrollMetrics.current = { max, height };
        }}
      >
        <Transcript entries={entries} columns={columns} version={version} showThinking={config.showThinking} />
        {live?.activity ? (
          <ToolActivity label={live.activity} elapsed={elapsed} />
        ) : live ? (
          <AssistantMessage
            model={active.model}
            content={live.content}
            reasoning={live.reasoning}
            showThinking={config.showThinking}
            streaming
            elapsed={elapsed}
          />
        ) : null}
        <Text> </Text>
      </ScrollView>

      {hiddenBelow > 0 ? (
        <Box justifyContent="flex-end" paddingX={2} flexShrink={0}>
          <Text color={theme.caramel}>
            ↓ {hiddenBelow} more lines <Text color={theme.muted}>· PgDn or scroll to follow</Text>
          </Text>
        </Box>
      ) : null}

      <Box flexShrink={0} alignItems="flex-start">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {renderBottom()}
        </Box>
        {showCard ? (
          <StatusCard
            width={cardWidth}
            model={active.model}
            turns={conversation.filter((m) => m.role === 'user').length}
            speed={speed}
            temperature={config.temperature}
            flags={flags}
            notice={copied}
          />
        ) : null}
        {showMascot ? <Mascot mood={mood} activityAt={activityAt} /> : null}
      </Box>
      <StatusLine connection={connection} provider={active.provider.label} model={showCard ? undefined : active.model} />
    </Box>
  );
}
