import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Markdown } from './Markdown.js';
import { commands, shortcuts } from '../lib/commands.js';
import { theme } from '../lib/theme.js';

export type Stats = { tokens: number; seconds: number; tokensPerSecond: number };

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function UserMessage({
  text,
  images = [],
  via,
}: {
  text: string;
  images?: { width?: number; height?: number }[];
  via?: string;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.caramel} bold>
        ❯ You{via ? <Text color={theme.muted} bold={false}> · via {via}</Text> : null}
      </Text>
      {text ? (
        <Box paddingLeft={2}>
          <Text color={theme.vanilla}>{text}</Text>
        </Box>
      ) : null}
      {images.length ? (
        <Box paddingLeft={2} gap={1} flexWrap="wrap">
          {images.map((image, i) => (
            <Text key={i} color={theme.caramel} backgroundColor="#3A302A">
              {` 🖼 Image ${i + 1}${image.width ? ` ${image.width}×${image.height}` : ''} `}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

type AssistantProps = {
  model: string;
  content: string;
  reasoning: string;
  showThinking: boolean;
  stats?: Stats;
  aborted?: boolean;
  streaming?: boolean;
  elapsed?: number;
};

export function AssistantMessage(props: AssistantProps) {
  const { model, content, reasoning, showThinking, stats, aborted, streaming, elapsed = 0 } = props;
  const thinking = streaming && !content;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text color={theme.strawberry} bold>✦ Cream</Text>
        <Text color={theme.muted}>{model}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {reasoning && showThinking ? (
          <Box flexDirection="column" marginBottom={content ? 1 : 0}>
            <Text color={theme.cocoa} italic>
              {reasoning}
            </Text>
          </Box>
        ) : null}
        {thinking ? (
          <Text color={theme.caramel}>
            <Spinner type="dots" />{' '}
            <Text color={theme.muted}>
              {reasoning ? `thinking… ${wordCount(reasoning)} words` : 'warming up'} · {elapsed.toFixed(1)}s
            </Text>
          </Text>
        ) : (
          <Box flexDirection="column">
            {reasoning && !showThinking ? (
              <Text color={theme.cocoa} italic>
                ◌ reasoned {wordCount(reasoning)} words
              </Text>
            ) : null}
            <Markdown source={streaming ? `${content}▍` : content || '_(empty response)_'} />
          </Box>
        )}
        {stats ? (
          <Text color={theme.muted}>
            {stats.tokens} tokens · {stats.tokensPerSecond.toFixed(1)} tokens/s · {stats.seconds.toFixed(1)}s
          </Text>
        ) : null}
        {aborted ? <Text color={theme.strawberry}>■ stopped</Text> : null}
      </Box>
    </Box>
  );
}

export type NoticeTone = 'info' | 'success' | 'error';

const tones: Record<NoticeTone, { icon: string; color: string }> = {
  info: { icon: '◆', color: theme.cocoa },
  success: { icon: '✔', color: theme.mint },
  error: { icon: '✖', color: theme.strawberry },
};

export function Notice({ tone, text }: { tone: NoticeTone; text: string }) {
  const { icon, color } = tones[tone];
  return (
    <Box marginTop={1}>
      <Text color={color}>{icon} </Text>
      <Text color={tone === 'error' ? theme.strawberry : theme.vanilla}>{text}</Text>
    </Box>
  );
}

export function HelpPanel() {
  const width = Math.max(...commands.map((c) => `${c.name} ${c.args ?? ''}`.length)) + 2;
  return (
    <Box flexDirection="column" alignSelf="flex-start" marginTop={1} borderStyle="round" borderColor={theme.cocoa} paddingX={2}>
      <Text color={theme.strawberry} bold>Commands</Text>
      {commands.map((c) => (
        <Box key={c.name}>
          <Box width={width}>
            <Text color={theme.caramel}>{c.name}</Text>
            {c.args ? <Text color={theme.muted}> {c.args}</Text> : null}
          </Box>
          <Text color={theme.vanilla}>{c.description}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color={theme.strawberry} bold>Shortcuts</Text>
      {shortcuts.map(([key, label]) => (
        <Box key={key}>
          <Box width={width}>
            <Text color={theme.mint}>{key}</Text>
          </Box>
          <Text color={theme.vanilla}>{label}</Text>
        </Box>
      ))}
    </Box>
  );
}

export type ToolStatus = 'ok' | 'error' | 'denied';

const toolStatus: Record<ToolStatus, { icon: string; color: string }> = {
  ok: { icon: '✔', color: theme.mint },
  error: { icon: '✖', color: theme.strawberry },
  denied: { icon: '⊘', color: theme.cocoa },
};

export function ToolEntry({ name, detail, status, output }: { name: string; detail: string; status: ToolStatus; output: string }) {
  const { icon, color } = toolStatus[status];
  const preview =
    name === 'use_skill' ? [] : status === 'denied' ? ['denied by you'] : output.split('\n').filter((l) => l.trim()).slice(0, 4);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text wrap="truncate-end">
        <Text color={color}>{icon} </Text>
        <Text color={theme.caramel} bold>{name}</Text>
        <Text color={theme.vanilla}> {detail.split('\n')[0]}</Text>
      </Text>
      {preview.length ? (
        <Box flexDirection="column" paddingLeft={2}>
          {preview.map((line, i) => (
            <Text key={i} color={theme.muted} wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function ToolActivity({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <Box marginTop={1}>
      <Text color={theme.caramel} wrap="truncate-end">
        <Spinner type="dots" /> <Text color={theme.vanilla}>{label}</Text>
        <Text color={theme.muted}> · {elapsed.toFixed(1)}s · esc to stop</Text>
      </Text>
    </Box>
  );
}

export function SkillsPanel({ skills, pinned }: { skills: { name: string; description: string; source: string; repo?: string }[]; pinned: string[] }) {
  return (
    <Box flexDirection="column" alignSelf="flex-start" marginTop={1} borderStyle="round" borderColor={theme.cocoa} paddingX={2}>
      <Text color={theme.strawberry} bold>Skills ({skills.length})</Text>
      {skills.length ? (
        skills.map((s) => (
          <Text key={s.name} wrap="truncate-end">
            <Text color={pinned.includes(s.name) ? theme.mint : theme.caramel} bold>
              {pinned.includes(s.name) ? '● ' : '  '}
              {s.name}
            </Text>
            <Text color={theme.cocoa}>  {s.repo ?? s.source}</Text>
            <Text color={theme.muted}>  {s.description.slice(0, 80)}{s.description.length > 80 ? '…' : ''}</Text>
          </Text>
        ))
      ) : (
        <Text color={theme.muted}>No skills installed yet.</Text>
      )}
      <Text> </Text>
      <Text color={theme.muted}>
        <Text color={theme.caramel}>/skills install [owner/repo] [name|all]</Text> · <Text color={theme.caramel}>/skill name</Text> to pin · <Text color={theme.mint}>●</Text> always active
      </Text>
    </Box>
  );
}

export function BrainPanel({ memories }: { memories: { id: number; text: string; createdAt: string }[] }) {
  return (
    <Box flexDirection="column" alignSelf="flex-start" marginTop={1} borderStyle="round" borderColor={theme.cocoa} paddingX={2}>
      <Text color={theme.strawberry} bold>Brain · {memories.length} memories</Text>
      {memories.length ? (
        memories.map((m) => (
          <Text key={m.id} wrap="truncate-end">
            <Text color={theme.caramel}>#{m.id} </Text>
            <Text color={theme.vanilla}>{m.text}</Text>
            <Text color={theme.cocoa}>  {m.createdAt.slice(0, 10)}</Text>
          </Text>
        ))
      ) : (
        <Text color={theme.muted}>No memories yet. Cream remembers important things from chats, or use /remember.</Text>
      )}
      <Text> </Text>
      <Text color={theme.muted}>
        <Text color={theme.caramel}>/remember text</Text> add · <Text color={theme.caramel}>/forget id|all</Text> remove · carried into every new chat
      </Text>
    </Box>
  );
}

export type RemoteRow = { label: string; status: string; tone: 'on' | 'off' | 'error'; detail: string };

export function RemotePanel({ rows, code }: { rows: RemoteRow[]; code: string }) {
  const color = { on: theme.mint, off: theme.cocoa, error: theme.strawberry };
  return (
    <Box flexDirection="column" alignSelf="flex-start" marginTop={1} borderStyle="round" borderColor={theme.cocoa} paddingX={2}>
      <Text color={theme.strawberry} bold>Remote · control Cream from your phone</Text>
      {rows.map((row) => (
        <Text key={row.label} wrap="truncate-end">
          <Text color={theme.caramel} bold>{row.label.padEnd(9)}</Text>
          <Text color={color[row.tone]}>● {row.status}</Text>
          <Text color={theme.muted}>  {row.detail}</Text>
        </Text>
      ))}
      <Text> </Text>
      <Text>
        <Text color={theme.vanilla}>Pairing code: </Text>
        <Text color={theme.cream} bold>{code}</Text>
        <Text color={theme.muted}>  · send </Text>
        <Text color={theme.caramel}>/pair {code}</Text>
        <Text color={theme.muted}> to the bot from your phone</Text>
      </Text>
      <Text> </Text>
      <Text color={theme.muted}>
        <Text color={theme.caramel}>/remote telegram TOKEN</Text> · <Text color={theme.caramel}>/remote discord TOKEN</Text> · <Text color={theme.caramel}>/remote off|on|unpair|code</Text>
      </Text>
      <Text color={theme.muted}>Telegram: create a bot with @BotFather → /newbot · Discord: discord.com/developers → Bot → Reset Token, enable Message Content Intent</Text>
    </Box>
  );
}

export type McpRow = { name: string; status: string; tone: 'on' | 'off' | 'error'; command: string; detail: string };

export function McpPanel({ rows }: { rows: McpRow[] }) {
  const color = { on: theme.mint, off: theme.cocoa, error: theme.strawberry };
  return (
    <Box flexDirection="column" alignSelf="flex-start" marginTop={1} borderStyle="round" borderColor={theme.cocoa} paddingX={2}>
      <Text color={theme.strawberry} bold>MCP · external tools</Text>
      {rows.length ? (
        rows.map((row) => (
          <Box key={row.name} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={theme.caramel} bold>{row.name.padEnd(10)}</Text>
              <Text color={color[row.tone]}>● {row.status}</Text>
              <Text color={theme.muted}>  {row.detail}</Text>
            </Text>
            <Text color={theme.cocoa} wrap="truncate-end">{`  $ ${row.command}`}</Text>
          </Box>
        ))
      ) : (
        <Text color={theme.muted}>No MCP servers yet.</Text>
      )}
      <Text> </Text>
      <Text color={theme.muted}>
        <Text color={theme.caramel}>/mcp add name command…</Text> · <Text color={theme.caramel}>/mcp tools name</Text> · <Text color={theme.caramel}>/mcp on|off|restart|remove name</Text>
      </Text>
      <Text color={theme.muted}>Read-only tools run directly, other tools ask for approval first.</Text>
    </Box>
  );
}
