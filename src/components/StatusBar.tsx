import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../lib/theme.js';

export type Connection = 'checking' | 'starting' | 'loading' | 'online' | 'offline' | 'locked';

const dot: Record<Connection, { color: string; label: string }> = {
  checking: { color: theme.caramel, label: 'checking' },
  starting: { color: theme.caramel, label: 'starting' },
  loading: { color: theme.caramel, label: 'loading model' },
  online: { color: theme.mint, label: 'online' },
  offline: { color: theme.strawberry, label: 'offline' },
  locked: { color: theme.strawberry, label: 'no API key' },
};

type LineProps = { connection: Connection; provider: string; model?: string };

export function StatusLine({ connection, provider, model }: LineProps) {
  return (
    <Box paddingX={1} flexShrink={0}>
      <Text wrap="truncate-end">
        <Text color={dot[connection].color}>● </Text>
        <Text color={theme.muted}>{dot[connection].label}</Text>
        <Text color={theme.cocoa}> │ </Text>
        <Text color={theme.caramel} bold>{provider}</Text>
        {model ? <Text color={theme.cocoa}> › </Text> : null}
        {model ? <Text color={theme.cream}>{model}</Text> : null}
      </Text>
    </Box>
  );
}

type CardProps = {
  width: number;
  model: string;
  turns: number;
  speed?: number;
  temperature: number;
  flags: string[];
  notice?: string | null;
};

export function StatusCard({ width, model, turns, speed, temperature, flags, notice }: CardProps) {
  const stats = [`${turns} turn${turns === 1 ? '' : 's'}`, speed ? `${speed.toFixed(1)} tokens/s` : `temp ${temperature}`].join(' · ');
  return (
    <Box
      width={width}
      height={3}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      marginLeft={1}
    >
      <Text color={theme.cream} bold wrap="truncate-end">
        {model || 'no model yet'}
      </Text>
      <Text color={theme.muted} wrap="truncate-end">
        {stats}
      </Text>
      {notice ? (
        <Text color={theme.mint} wrap="truncate-end">
          {notice}
        </Text>
      ) : (
        <Text color={theme.cocoa} wrap="truncate-end">
          {flags.join(' · ')}
        </Text>
      )}
    </Box>
  );
}
