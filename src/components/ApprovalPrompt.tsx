import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../lib/theme.js';

export type Decision = 'once' | 'always' | 'deny' | 'stop';

export type ApprovalRequest = { name: string; detail: string; preview?: string };

type Props = { request: ApprovalRequest; onDecision: (decision: Decision) => void };

const titles: Record<string, string> = {
  run_command: 'Run this command?',
  write_file: 'Write this file?',
  edit_file: 'Edit this file?',
  screenshot: 'Take a screenshot?',
};

export function ApprovalPrompt({ request, onDecision }: Props) {
  useInput((input, key) => {
    const choice = input.toLowerCase();
    if (choice === 'y' || key.return) onDecision('once');
    else if (choice === 'a') onDecision('always');
    else if (choice === 'n') onDecision('deny');
    else if (key.escape) onDecision('stop');
  });

  const lines = request.preview?.split('\n') ?? [];
  const shown = lines.slice(0, 8);

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.caramel} paddingX={1}>
      <Text color={theme.caramel} bold>{titles[request.name] ?? `Izinkan ${request.name}?`}</Text>
      <Text color={theme.cream} wrap="truncate-end">
        {request.name === 'run_command' ? '$ ' : ''}
        {request.detail}
      </Text>
      {shown.length ? (
        <Box flexDirection="column" paddingLeft={1}>
          {shown.map((line, i) => (
            <Text key={i} color={theme.muted} wrap="truncate-end">
              {`│ ${line}`}
            </Text>
          ))}
          {lines.length > shown.length ? <Text color={theme.muted}>{`│ … ${lines.length - shown.length} more lines`}</Text> : null}
        </Box>
      ) : null}
      <Text>
        <Text color={theme.mint} bold>y</Text>
        <Text color={theme.muted}> allow · </Text>
        <Text color={theme.mint} bold>a</Text>
        <Text color={theme.muted}> always allow {request.name} · </Text>
        <Text color={theme.strawberry} bold>n</Text>
        <Text color={theme.muted}> deny · </Text>
        <Text color={theme.strawberry} bold>esc</Text>
        <Text color={theme.muted}> stop</Text>
      </Text>
    </Box>
  );
}
