import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../lib/theme.js';

export type PickerItem = { value: string; label: string; hint?: string; badge?: string; badgeColor?: string };

type Props = {
  title: string;
  items: PickerItem[] | null;
  current?: string;
  loadingLabel?: string;
  actionHint?: string;
  onAction?: (value: string) => void;
  onSelect: (value: string) => void;
  onCancel: () => void;
};

const visibleCount = 8;

export function Picker({ title, items, current, loadingLabel = 'loading…', actionHint, onAction, onSelect, onCancel }: Props) {
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () => (items ?? []).filter((item) => `${item.label} ${item.value}`.toLowerCase().includes(filter.toLowerCase())),
    [items, filter],
  );

  const currentIndex = Math.max(0, filtered.findIndex((item) => item.value === current));
  const active = Math.min(index ?? currentIndex, Math.max(0, filtered.length - 1));
  const count = Math.max(1, filtered.length);

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (!items) return;
    if (onAction && key.ctrl && input === 'd') {
      const choice = filtered[active];
      return choice ? onAction(choice.value) : undefined;
    }
    if (key.upArrow) return setIndex((active - 1 + count) % count);
    if (key.downArrow) return setIndex((active + 1) % count);
    if (key.return) {
      const choice = filtered[active];
      return choice ? onSelect(choice.value) : undefined;
    }
    if (key.backspace || key.delete) {
      setFilter((f) => f.slice(0, -1));
      return setIndex(0);
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setFilter((f) => f + input);
      setIndex(0);
    }
  });

  const start = Math.min(Math.max(0, active - Math.floor(visibleCount / 2)), Math.max(0, filtered.length - visibleCount));
  const visible = filtered.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.strawberry} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={theme.strawberry} bold>{title}</Text>
        <Text color={theme.muted}>↑↓ move · enter select{actionHint ? ` · ${actionHint}` : ''} · esc cancel</Text>
      </Box>
      {!items ? (
        <Text color={theme.caramel}>
          <Spinner type="dots" /> <Text color={theme.muted}>{loadingLabel}</Text>
        </Text>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.muted}>
            filter: <Text color={theme.cream}>{filter || '…type to search'}</Text>
          </Text>
          {visible.length ? (
            visible.map((item, i) => {
              const selected = start + i === active;
              return (
                <Text key={item.value} color={selected ? theme.cream : theme.vanilla} bold={selected}>
                  <Text color={theme.strawberry}>{selected ? '❯ ' : '  '}</Text>
                  {item.label}
                  {item.hint ? <Text color={theme.muted} bold={false}>  {item.hint}</Text> : null}
                  {item.badge ? <Text color={item.badgeColor ?? theme.mint} bold={false}>  {item.badge}</Text> : null}
                  {item.value === current ? <Text color={theme.mint} bold={false}>  ● current</Text> : null}
                </Text>
              );
            })
          ) : (
            <Text color={theme.muted}>  no match</Text>
          )}
          {filtered.length > visibleCount ? (
            <Text color={theme.muted}>  {active + 1}/{filtered.length}</Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}
