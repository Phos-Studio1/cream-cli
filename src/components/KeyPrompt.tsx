import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Provider } from '../lib/providers.js';
import { theme } from '../lib/theme.js';

type Props = {
  provider: Provider;
  onSubmit: (key: string) => void;
  onCancel: () => void;
};

export function KeyPrompt({ provider, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.mint} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={theme.mint} bold>{provider.label} API key</Text>
        <Text color={theme.muted}>enter save · esc cancel</Text>
      </Box>
      {provider.keyUrl ? (
        <Text color={theme.muted}>
          Create one at <Text color={theme.caramel}>{provider.keyUrl}</Text>
        </Text>
      ) : null}
      <Box>
        <Text color={theme.strawberry} bold>{'❯ '}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          mask="•"
          placeholder="paste your API key here"
          onSubmit={(next) => {
            if (next.trim()) onSubmit(next.trim());
          }}
        />
      </Box>
      <Text color={theme.muted}>
        Saved to ~/.cream/config.json{provider.keyEnv ? ` · or set the ${provider.keyEnv} environment variable` : ''}
      </Text>
    </Box>
  );
}
