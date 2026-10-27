import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../lib/theme.js';

type Props = {
  title: string;
  detail?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmPrompt({ title, detail, onConfirm, onCancel }: Props) {
  useInput((input, key) => {
    const choice = input.toLowerCase();
    if (choice === 'y') onConfirm();
    else if (choice === 'n' || key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.strawberry} paddingX={1}>
      <Text color={theme.strawberry} bold>{title}</Text>
      {detail ? <Text color={theme.cream} wrap="truncate-end">{detail}</Text> : null}
      <Text>
        <Text color={theme.strawberry} bold>y</Text>
        <Text color={theme.muted}> yes, delete · </Text>
        <Text color={theme.mint} bold>n</Text>
        <Text color={theme.muted}> / esc cancel</Text>
      </Text>
    </Box>
  );
}
