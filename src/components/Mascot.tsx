import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../lib/theme.js';

export type Mood = 'idle' | 'thinking' | 'talking' | 'working' | 'waiting' | 'happy' | 'sad' | 'offline';

type Pose = { face: string; extra: string; offset: number; extraColor?: string };

const sleepAfterMs = 90_000;
const spinner = ['-', '\\', '|', '/'];

function pose(mood: Mood | 'sleep', tick: number): Pose {
  switch (mood) {
    case 'thinking':
      return { face: ['•_•', '°_°', '•_•', '•.•'][Math.floor(tick / 2) % 4]!, extra: '.'.repeat(tick % 4), offset: 1 };
    case 'talking':
      return { face: ['•o•', '•ᴗ•', '•-•', '•O•'][tick % 4]!, extra: '', offset: tick % 2 };
    case 'working':
      return { face: tick % 6 < 3 ? '>_<' : '•_•', extra: spinner[tick % 4]!, offset: 1, extraColor: theme.caramel };
    case 'waiting':
      return { face: '•?•', extra: tick % 4 < 2 ? '?' : '', offset: 1, extraColor: theme.caramel };
    case 'happy':
      return { face: '^ᴗ^', extra: tick % 2 ? '✦' : '✧', offset: tick % 2 ? 0 : 2, extraColor: theme.mint };
    case 'sad':
      return { face: ';_;', extra: '', offset: 1 };
    case 'offline':
      return { face: 'x_x', extra: '', offset: 1 };
    case 'sleep':
      return { face: '-ᴗ-', extra: ['z', 'zZ', 'zZz', 'zZz'][Math.floor(tick / 3) % 4]!, offset: 1, extraColor: theme.cocoa };
    default:
      return { face: tick % 14 === 0 ? '-ᴗ-' : '•ᴗ•', extra: '', offset: Math.floor(tick / 5) % 2 };
  }
}

export function Mascot({ mood, activityAt }: { mood: Mood; activityAt: number }) {
  const current = (): Mood | 'sleep' => (mood === 'idle' && Date.now() - activityAt > sleepAfterMs ? 'sleep' : mood);
  const [shown, setShown] = useState(() => pose(current(), 0));
  const fast = mood === 'talking' || mood === 'working' || mood === 'happy';

  useEffect(() => {
    let tick = 0;
    let last = '';
    const update = () => {
      const next = pose(current(), tick++);
      const key = `${next.face}|${next.extra}|${next.offset}|${next.extraColor}`;
      if (key === last) return;
      last = key;
      setShown(next);
    };
    update();
    const timer = setInterval(update, fast ? 220 : 420);
    return () => clearInterval(timer);
  }, [mood, activityAt, fast]);

  const { face, extra, offset, extraColor } = shown;
  const pad = ' '.repeat(offset);

  return (
    <Box width={12} height={3} flexShrink={0} flexDirection="column" marginLeft={1}>
      <Text>
        {pad}
        <Text color={theme.strawberry}> ▄▀▀▀▄</Text>
        <Text color={extraColor ?? theme.muted}> {extra}</Text>
      </Text>
      <Text>
        {pad}
        <Text color={theme.strawberry}>▐ </Text>
        <Text color={theme.cream} bold>{face}</Text>
        <Text color={theme.strawberry}> ▌</Text>
      </Text>
      <Text>
        {pad}
        <Text color={theme.caramel}> ╲▒▒▒╱</Text>
      </Text>
    </Box>
  );
}
