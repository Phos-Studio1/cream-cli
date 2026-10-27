import React, { useMemo } from 'react';
import { listSessions, timeAgo } from '../lib/sessions.js';
import { theme } from '../lib/theme.js';
import { Picker } from './Picker.js';

type Props = {
  title?: string;
  current?: string;
  onDelete?: (id: string) => void;
  onSelect: (id: string) => void;
  onCancel: () => void;
};

export function SessionPicker({ title = 'Resume a chat', current, onDelete, onSelect, onCancel }: Props) {
  const items = useMemo(
    () =>
      listSessions().map((s) => ({
        value: s.id,
        label: s.title,
        hint: `${timeAgo(s.updatedAt)} · ${s.turns} turns · ${s.model}`,
        badge: s.cwd === process.cwd() ? 'this folder' : undefined,
        badgeColor: theme.caramel,
      })),
    [],
  );

  return (
    <Picker
      title={title}
      items={items}
      current={current}
      actionHint={onDelete ? 'ctrl+d delete' : undefined}
      onAction={onDelete}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
