export type Command = { name: string; args?: string; description: string };

export const commands: Command[] = [
  { name: '/help', description: 'Show commands and shortcuts' },
  { name: '/provider', args: '[name]', description: 'Switch provider (Ollama, OpenRouter, DeepSeek, Kimi…)' },
  { name: '/model', args: '[name]', description: 'Pick or set the model' },
  { name: '/key', args: '[apikey]', description: 'Set the API key for the current provider' },
  { name: '/url', args: '<url>', description: 'Use a custom OpenAI-compatible endpoint' },
  { name: '/skills', args: '[install|remove] [owner/repo] [name|all]', description: 'List, install or remove skills' },
  { name: '/skill', args: '<name>', description: 'Pin a skill so it is always active (toggle)' },
  { name: '/mcp', args: '[add <name> <command…>|remove|on|off|restart|tools <name>]', description: 'Manage MCP servers (external tools such as REA)' },
  { name: '/tools', description: 'Toggle tools (files, commands, skills)' },
  { name: '/approve', description: 'Toggle auto-approve for file writes and commands' },
  { name: '/trust', description: 'Change whether this folder is trusted' },
  { name: '/system', args: '[prompt]', description: 'Show or set the system prompt' },
  { name: '/temp', args: '<0-2>', description: 'Set the temperature' },
  { name: '/think', description: 'Show or hide model reasoning' },
  { name: '/retry', description: 'Regenerate the last answer' },
  { name: '/screenshot', args: '[primary]', description: 'Capture the PC screen and send it to paired phones' },
  { name: '/copy', description: 'Copy the last answer to the clipboard' },
  { name: '/mascot', description: 'Show or hide the Cream mascot' },
  { name: '/mouse', description: 'Toggle the Cream mouse (scroll and selection)' },
  { name: '/resume', description: 'Resume a previous chat' },
  { name: '/delete', args: '[id|all]', description: 'Delete chats from history' },
  { name: '/remote', args: '[telegram|discord <token>|on|off|code|unpair]', description: 'Control Cream from your phone via Telegram/Discord' },
  { name: '/brain', description: 'See everything Cream remembers about you' },
  { name: '/remember', args: '<text>', description: 'Save a new memory to the brain' },
  { name: '/forget', args: '<id|all>', description: 'Remove memories from the brain' },
  { name: '/clear', description: 'Start a new conversation' },
  { name: '/exit', description: 'Quit Cream' },
];

export const shortcuts: [string, string][] = [
  ['Enter', 'Send message'],
  ['Tab', 'Complete command'],
  ['↑ / ↓', 'Input history or command suggestions'],
  ['Wheel / PgUp PgDn', 'Scroll the chat'],
  ['Drag mouse', 'Select text, copied automatically'],
  ['Ctrl+V / Alt+V', 'Paste text or an image from the clipboard'],
  ['Shift+Enter', 'New line in the input'],
  ['Ctrl+↑ / Ctrl+↓', 'Scroll line by line'],
  ['Esc', 'Stop the answer'],
  ['Ctrl+C', 'Quit'],
];

export const skillAliases: Record<string, string> = {
  '/brainstorm': 'brainstorming',
  '/write-plan': 'writing-plans',
  '/execute-plan': 'executing-plans',
};

export function matchCommands(input: string, extra: Command[] = []): Command[] {
  if (!input.startsWith('/') || input.includes(' ')) return [];
  return [...commands, ...extra].filter((c) => c.name.startsWith(input.toLowerCase()));
}
