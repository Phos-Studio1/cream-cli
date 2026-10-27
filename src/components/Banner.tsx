import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { theme } from '../lib/theme.js';

type Props = { columns: number; version: string };

export function Banner({ columns, version }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {columns >= 50 ? (
        <Gradient colors={[...theme.gradient]}>
          <BigText text="Cream" font={columns >= 80 ? 'block' : 'chrome'} letterSpacing={0} space={false} />
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
