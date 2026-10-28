export type ProviderId = 'ollama' | 'lmstudio' | 'llamacpp' | '9router' | 'openai' | 'openrouter' | 'deepseek' | 'kimi' | 'custom';

export type Provider = {
  id: ProviderId;
  label: string;
  baseUrl?: string;
  local: boolean;
  gateway?: boolean;
  keyOptional?: boolean;
  defaultModel?: string;
  keyEnv?: string;
  keyUrl?: string;
  startHint?: string;
  launch?: { command: string; args: string[]; install: string };
};

export const providers: Provider[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    local: true,
    defaultModel: 'qwen3:4b',
    startHint: 'Open the Ollama app or run `ollama serve`.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    local: true,
    startHint: 'Start the Local Server in LM Studio.',
  },
  { id: 'llamacpp', label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', local: true, startHint: 'Run `llama-server`.' },
  {
    id: '9router',
    label: '9Router',
    baseUrl: 'http://localhost:20128/v1',
    local: true,
    gateway: true,
    keyOptional: true,
    keyEnv: 'NINEROUTER_API_KEY',
    keyUrl: 'http://localhost:20128/dashboard',
    startHint: 'Run `9router --host 127.0.0.1` in another terminal (install: `npm install -g 9router`).',
    launch: { command: '9router', args: ['--tray', '--skip-update', '--no-browser', '--host', '127.0.0.1'], install: 'npm install -g 9router' },
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
    keyEnv: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    local: false,
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    local: false,
    defaultModel: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    local: false,
    keyEnv: 'MOONSHOT_API_KEY',
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
  },
  { id: 'custom', label: 'Custom', local: true, keyOptional: true },
];

export const providerIds = providers.map((p) => p.id);

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === id.toLowerCase());
}
