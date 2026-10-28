import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { theme } from '../lib/theme.js';

type Props = { columns: number; version: string };

const block = [
  ' ██████╗██████╗ ███████╗ █████╗ ███╗   ███╗',
  '██╔════╝██╔══██╗██╔════╝██╔══██╗████╗ ████║',
  '██║     ██████╔╝█████╗  ███████║██╔████╔██║',
  '██║     ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║',
  '╚██████╗██║  ██║███████╗██║  ██║██║ ╚═╝ ██║',
  ' ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝',
].join('\n');

const chrome = [
  '╔═╗╦═╗╔═╗╔═╗╔╦╗',
  '║  ╠╦╝║╣ ╠═╣║║║',
  '╚═╝╩╚═╚═╝╩ ╩╩ ╩',
].join('\n');

export function Banner({ columns, version }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {columns >= 50 ? (
        <Gradient colors={[...theme.gradient]}>
          <Text>{columns >= 80 ? block : chrome}</Text>
        </Gradient>
      ) : (
        <Gradient colors={[...theme.gradient]}>
          <Text bold>Cream</Text>
        </Gradient>
      )}
      <Box gap={1}>
        <Gradient colors={[...theme.gradient]}>
          <Text bold>Smooth as cream</Text>
        </Gradient>
        <Text color={theme.muted}>made by</Text>
        <Text color={theme.strawberry} bold>ziaul</Text>
        <Text color={theme.cocoa}>· v{version}</Text>
      </Box>
      <Text color={theme.muted}>
        <Text color={theme.caramel}>/help</Text> commands  ·  <Text color={theme.caramel}>/provider</Text> switch provider  ·  <Text color={theme.caramel}>/model</Text> switch model  ·  <Text color={theme.caramel}>esc</Text> stop
      </Text>
    </Box>
  );
}
