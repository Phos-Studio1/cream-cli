import React, { useEffect, useState } from 'react';
import { listModels, type Endpoint } from '../lib/client.js';
import { Picker, type PickerItem } from './Picker.js';

type Props = {
  endpoint: Endpoint;
  providerLabel: string;
  current: string;
  onSelect: (model: string) => void;
  onCancel: (error?: string) => void;
};

export function ModelPicker({ endpoint, providerLabel, current, onSelect, onCancel }: Props) {
  const [items, setItems] = useState<PickerItem[] | null>(null);

  useEffect(() => {
    listModels(endpoint)
      .then((models) => {
        if (!models.length) return onCancel(`${providerLabel} has no models.`);
        setItems(models.map((id) => ({ value: id, label: id })));
      })
      .catch((error: Error) => onCancel(`Could not load models from ${providerLabel} (${error.message}).`));
  }, [endpoint.baseUrl, endpoint.apiKey]);

  return (
    <Picker
      title={`Choose a ${providerLabel} model`}
      items={items}
      current={current}
      loadingLabel="loading models…"
      onSelect={onSelect}
      onCancel={() => onCancel()}
    />
  );
}
