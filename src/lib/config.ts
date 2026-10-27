import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProvider, providers, type Provider, type ProviderId } from './providers.js';
import type { McpServerConfig } from './mcp.js';
import { configPath } from './paths.js';
import type { RemotePlatform } from './remote/types.js';

export type Config = {
  provider: ProviderId;
  customUrl: string;
  models: Partial<Record<ProviderId, string>>;
  apiKeys: Partial<Record<ProviderId, string>>;
  systemPrompt: string;
  temperature: number;
  showThinking: boolean;
  mouse: boolean;
  tools: boolean;
  autoApprove: boolean;
  pinnedSkills: string[];
  remote: RemoteConfig;
  mascot: boolean;
  mcpServers: Record<string, McpServerConfig>;
};

export type RemoteBot = { token: string; allowed: string[] };

export type RemoteConfig = { enabled: boolean; telegram: RemoteBot; discord: RemoteBot };

export const remoteTokenEnv: Record<RemotePlatform, string> = {
  telegram: 'TELEGRAM_BOT_TOKEN',
  discord: 'DISCORD_BOT_TOKEN',
};

export const remoteToken = (config: Config, platform: RemotePlatform) =>
  process.env[remoteTokenEnv[platform]] || config.remote[platform].token;

export type Active = {
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  needsKey: boolean;
};

export const defaultConfig: Config = {
  provider: 'ollama',
  customUrl: 'http://localhost:8000/v1',
  models: {},
  apiKeys: {},
  systemPrompt: 'You are Cream, a friendly and concise assistant running in the terminal. Use Markdown when it helps.',
  temperature: 0.7,
  showThinking: false,
  mouse: true,
  tools: true,
  autoApprove: false,
  pinnedSkills: [],
  remote: { enabled: true, telegram: { token: '', allowed: [] }, discord: { token: '', allowed: [] } },
  mascot: true,
  mcpServers: {},
};

const freshRemote = (raw?: Partial<RemoteConfig>): RemoteConfig => ({
  enabled: raw?.enabled ?? true,
  telegram: { token: raw?.telegram?.token ?? '', allowed: [...(raw?.telegram?.allowed ?? [])] },
  discord: { token: raw?.discord?.token ?? '', allowed: [...(raw?.discord?.allowed ?? [])] },
});

const legacyPrompts = [
  'Kamu adalah Cream, asisten yang ramah dan ringkas yang berjalan di terminal. Gunakan Markdown bila membantu.',
  'You are Cream, a friendly and concise assistant running in the terminal. Use Markdown when it helps.',
  'You are Cream, a friendly and concise assistant running locally in the terminal. Use Markdown when it helps.',
];

export { configPath };

export function resolveActive(config: Config): Active {
  const provider = getProvider(config.provider) ?? providers[0]!;
  const envKey = provider.keyEnv ? process.env[provider.keyEnv] : undefined;
  return {
    provider,
    baseUrl: provider.baseUrl ?? config.customUrl,
    model: config.models[provider.id] ?? provider.defaultModel ?? '',
    apiKey: envKey || config.apiKeys[provider.id] || '',
    needsKey: !provider.local,
  };
}

function migrate(raw: Record<string, any>): Config {
  const config: Config = {
    ...defaultConfig,
    ...raw,
    models: { ...raw.models },
    apiKeys: { ...raw.apiKeys },
    remote: freshRemote(raw.remote),
    mcpServers: { ...raw.mcpServers },
  };
  if (legacyPrompts.includes(raw.systemPrompt)) config.systemPrompt = defaultConfig.systemPrompt;
  if (!raw.provider && typeof raw.baseUrl === 'string') {
    const match = providers.find((p) => p.baseUrl === raw.baseUrl);
    config.provider = match?.id ?? 'custom';
    if (!match) config.customUrl = raw.baseUrl;
    if (raw.model) config.models[config.provider] = raw.model;
  }
  if (!getProvider(config.provider)) config.provider = defaultConfig.provider;
  for (const id of Object.keys(config.models)) if (!getProvider(id)) delete config.models[id as ProviderId];
  for (const id of Object.keys(config.apiKeys)) if (!getProvider(id)) delete config.apiKeys[id as ProviderId];
  delete (config as Record<string, unknown>).baseUrl;
  delete (config as Record<string, unknown>).model;
  return config;
}

export function loadConfig(): Config {
  try {
    return migrate(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return { ...defaultConfig, models: {}, apiKeys: {}, remote: freshRemote(), mcpServers: {} };
  }
}

export function saveConfig(config: Config): void {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  } catch {
    return;
  }
}
