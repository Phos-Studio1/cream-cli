import React from 'react';
import { providers, type ProviderId } from '../lib/providers.js';
import { theme } from '../lib/theme.js';
import { Picker } from './Picker.js';

type Props = {
  current: ProviderId;
  customUrl: string;
  hasKey: (id: ProviderId) => boolean;
  onSelect: (id: ProviderId) => void;
  onCancel: () => void;
};

export function ProviderPicker({ current, customUrl, hasKey, onSelect, onCancel }: Props) {
  const items = providers.map((p) => {
    const url = (p.baseUrl ?? customUrl).replace(/^https?:\/\//, '');
    if (p.id === 'custom') return { value: p.id, label: p.label, hint: url, badge: 'any OpenAI-compatible API' };
    if (p.local && p.keyOptional)
      return { value: p.id, label: p.label, hint: url, badge: hasKey(p.id) ? 'local · ✔ key saved' : 'local · key optional' };
    if (p.local) return { value: p.id, label: p.label, hint: url, badge: 'local' };
    const keyed = hasKey(p.id);
    return {
      value: p.id,
      label: p.label,
      hint: url,
      badge: keyed ? '✔ key saved' : '✖ needs key',
      badgeColor: keyed ? theme.mint : theme.strawberry,
    };
  });

  return (
    <Picker
      title="Choose a provider"
      items={items}
      current={current}
      onSelect={(value) => onSelect(value as ProviderId)}
      onCancel={onCancel}
    />
  );
}
