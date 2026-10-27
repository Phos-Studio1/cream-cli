#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { brainDir } from './lib/brain.js';
import { configPath, loadConfig } from './lib/config.js';
import { migrateLegacyData } from './lib/paths.js';
import { getProvider, providerIds } from './lib/providers.js';
import { listSessions, loadSession, sessionsDir, type Session } from './lib/sessions.js';
import { mcp } from './lib/mcp.js';
import { disableMouse, renders } from './lib/terminal.js';

const version = '0.18.0';

const usage = `
  Cream v${version} - Smooth as cream, made by ziaul

  Usage
    $ cream [options] [prompt]

  Options
    -p, --provider <name>  ${providerIds.join(', ')}
    -m, --model <name>     Model to use (e.g. qwen3:4b, deepseek-chat)
    -u, --url <url>        Custom OpenAI-compatible base URL
    -r, --resume [id]      Resume a previous chat (no id: pick from a list)
    -c, --continue         Continue the most recent chat
    -h, --help             Show this help
    -v, --version          Show version

  API keys
    Set inside the app with /key, or via OPENAI_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY, MOONSHOT_API_KEY, NINEROUTER_API_KEY

  Remote (phone)
    /remote telegram <token> or /remote discord <token>, or via TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN

  Config is stored at ${configPath}
  Chat history is stored at ${sessionsDir}
  Brain memories are stored at ${brainDir}
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const options: {
    provider?: string;
    model?: string;
    url?: string;
    resume?: string | true;
    continue?: boolean;
    prompt: string[];
  } = { prompt: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(usage);
      process.exit(0);
    }
    if (arg === '-v' || arg === '--version') {
      process.stdout.write(`${version}\n`);
      process.exit(0);
    }
    if (arg === '-p' || arg === '--provider') options.provider = argv[++i];
    else if (arg === '-m' || arg === '--model') options.model = argv[++i];
    else if (arg === '-u' || arg === '--url') options.url = argv[++i];
    else if (arg === '-c' || arg === '--continue') options.continue = true;
    else if (arg.startsWith('--resume=')) options.resume = arg.slice(9);
    else if (arg === '-r' || arg === '--resume') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && loadSession(next)) options.resume = argv[++i]!;
      else options.resume = true;
    } else options.prompt.push(arg);
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));
const migrated = migrateLegacyData();
const config = loadConfig();

if (args.url) {
  const preset = getProvider(args.url);
  if (preset) config.provider = preset.id;
  else {
    config.provider = 'custom';
    config.customUrl = args.url;
  }
}
if (args.provider) {
  const provider = getProvider(args.provider);
  if (!provider) fail(`Unknown provider "${args.provider}". Options: ${providerIds.join(', ')}`);
  config.provider = provider.id;
}
if (args.model) config.models = { ...config.models, [config.provider]: args.model };

let resume: Session | 'pick' | undefined;
if (typeof args.resume === 'string') {
  const session = loadSession(args.resume);
  if (!session) fail(`Session "${args.resume}" not found. Run cream --resume to see the list.`);
  resume = session;
} else if (args.resume) resume = 'pick';
else if (args.continue) {
  const latest = listSessions()[0];
  resume = (latest && loadSession(latest.id)) || 'pick';
}

if (!process.stdin.isTTY) fail('Cream needs an interactive terminal.');

process.on('exit', () => {
  disableMouse();
  mcp.stopAll();
});

const instance = render(
  <App initialConfig={config} initialPrompt={args.prompt.join(' ') || undefined} resume={resume} version={version} migrated={migrated} />,
  { incrementalRendering: true, alternateScreen: true, onRender: () => renders.emit('render') },
);

await instance.waitUntilExit();
process.stdout.write('\n  🍦 See you soon!\n\n');
