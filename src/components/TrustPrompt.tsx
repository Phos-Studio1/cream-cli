import React, { useRef, useState } from 'react';
import { Box, render, Text, useInput, type RenderOptions } from 'ink';
import type { TrustChoice } from '../lib/trust.js';
import { theme } from '../lib/theme.js';

type Props = { folder: string; onChoose: (choice: TrustChoice) => void };

const choices: { value: TrustChoice; label: string; hint: string }[] = [
  { value: 'trust', label: 'Yes, I trust this folder', hint: 'Edit files and run commands here without asking' },
  { value: 'ask', label: 'Ask me for every permission', hint: 'Confirm each file change and command' },
  { value: 'exit', label: 'No, exit', hint: 'Close Cream' },
];

export function TrustPrompt({ folder, onChoose }: Props) {
  const [index, setIndex] = useState(0);
  const current = useRef(0);
  const select = (next: number) => {
    current.current = (next + choices.length) % choices.length;
    setIndex(current.current);
  };

  useInput((input, key) => {
    if (key.escape) return onChoose('exit');
    if (key.upArrow) return select(current.current - 1);
    if (key.downArrow) return select(current.current + 1);
    if (/^[1-3]$/.test(input)) return onChoose(choices[Number(input) - 1]!.value);
    if (key.return) onChoose(choices[current.current]!.value);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.caramel} paddingX={1}>
      <Text color={theme.caramel} bold>
        Do you trust the files in this folder?
      </Text>
      <Text color={theme.cream} wrap="truncate-middle">
        {folder}
      </Text>
      <Box marginY={1}>
        <Text color={theme.muted}>
          Cream can read files here and edit them or run commands for you. Only trust folders whose contents you know, since files can contain
          instructions that steer the model.
        </Text>
      </Box>
      {choices.map((choice, i) => (
        <Box key={choice.value}>
          <Text color={i === index ? theme.caramel : theme.muted}>{i === index ? '› ' : '  '}</Text>
          <Text color={i === index ? theme.caramel : theme.cream} bold={i === index}>{`${i + 1}. ${choice.label}`}</Text>
          <Text color={theme.muted}>{`  ${choice.hint}`}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted}>enter confirm · ↑↓ move · 1-3 pick · esc exit</Text>
      </Box>
    </Box>
  );
}

export async function askFolderTrust(folder: string, options?: RenderOptions): Promise<TrustChoice> {
  let choice: TrustChoice = 'exit';
  const prompt = render(
    <TrustPrompt
      folder={folder}
      onChoose={(value) => {
        choice = value;
        prompt.clear();
        prompt.unmount();
      }}
    />,
    options,
  );
  await prompt.waitUntilExit();
  return choice;
}
