import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cream-test-'));
process.env.CREAM_HOME = path.join(home, 'data');
process.env.HOME = home;
process.env.USERPROFILE = home;
for (const key of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'MOONSHOT_API_KEY', 'NINEROUTER_API_KEY', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN'])
  delete process.env[key];
