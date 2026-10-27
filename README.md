# Cream

[![npm](https://img.shields.io/npm/v/creamcli)](https://www.npmjs.com/package/creamcli) [![CI](https://github.com/Phos-Studio1/cream-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Phos-Studio1/cream-cli/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Terminal AI assistant for local and cloud LLMs. Cream chats, edits files, runs commands with your approval, uses skills and MCP tools, remembers context across sessions, and can be controlled from your phone.

> **Status:** beta. Expect breaking changes before 1.0. Primarily tested on Windows; macOS and Linux are supported but less tested.

## Features

- **Any OpenAI-compatible provider:** Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter, DeepSeek, Kimi, 9Router, or a custom endpoint.
- **Agent tools:** read, write and edit files, run shell commands, take screenshots. Every side effect requires approval.
- **Skills:** install [Agent Skills](https://agentskills.io) from any GitHub repository.
- **MCP:** connect stdio MCP servers. Large servers switch to tool search automatically.
- **Memory:** saved chat history with resume, and long-term memory shared across chats.
- **Remote control:** drive Cream from Telegram or Discord, with pairing and approvals on your phone.
- **Terminal UI:** fullscreen layout, streaming Markdown, mouse selection, clipboard text and image paste.

## Requirements

- Node.js 22 or later
- A terminal with true color support (Windows Terminal, iTerm2, most Linux terminals)

## Installation

```bash
npm install -g creamcli
```

Then start it with `cream`. Update with the same command.

To run from source instead:

```bash
git clone https://github.com/Phos-Studio1/cream-cli.git
cd cream-cli
npm install
npm run build
npm link
```

## Quick start

```bash
cream                          # start in the current folder
cream "explain this project"   # start with a prompt
cream -p deepseek              # choose a provider
cream -p openrouter -m <model> # choose a provider and model
cream -c                       # continue the most recent chat
```

Inside Cream, run `/provider` to pick a provider and `/model` to pick a model. Cloud providers prompt for an API key on first use.

## Providers

| Provider | Endpoint | Key |
| --- | --- | --- |
| Ollama | `http://localhost:11434/v1` | none |
| LM Studio | `http://localhost:1234/v1` | none |
| llama.cpp | `http://localhost:8080/v1` | none |
| 9Router | `http://localhost:20128/v1` | `NINEROUTER_API_KEY` |
| OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| OpenRouter | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| DeepSeek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| Kimi | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |
| Custom | set with `/url` | optional, set with `/key` |

Environment variables take precedence over keys saved with `/key`.

9Router is a third-party gateway. Some of its providers reuse consumer subscriptions, which may violate those services' terms. Review them before use.

## Commands

| Command | Description |
| --- | --- |
| `/provider [name]` | Switch provider |
| `/model [name]` | Pick or set the model |
| `/key [apikey]` | Set the API key for the current provider |
| `/url <url>` | Use a custom OpenAI-compatible endpoint |
| `/tools` | Toggle tools |
| `/approve` | Toggle auto-approve |
| `/skills [install\|remove] [owner/repo] [name\|all]` | Manage skills |
| `/skill <name>` | Pin a skill so it is always active |
| `/mcp [add\|remove\|on\|off\|restart\|tools]` | Manage MCP servers |
| `/remote [telegram\|discord <token>\|on\|off\|code\|unpair]` | Configure remote control |
| `/screenshot [primary]` | Capture the screen and send it to paired phones |
| `/resume`, `/delete [id\|all]`, `/clear` | Manage chats |
| `/brain`, `/remember <text>`, `/forget <id\|all>` | Manage memory |
| `/system [prompt]`, `/temp <0-2>`, `/think` | Model settings |
| `/retry`, `/copy` | Regenerate or copy the last answer |
| `/mouse`, `/mascot` | Interface settings |
| `/help`, `/exit` | Help and quit |

**Shortcuts:** `Enter` send · `Shift+Enter` new line · `Tab` complete · `↑/↓` history · `PgUp/PgDn` or mouse wheel scroll · drag to copy · `Ctrl+V`/`Alt+V` paste text or image · `Esc` stop · `Ctrl+C` quit.

## Tools and approvals

With tools enabled, the model can call `read_file`, `list_dir`, `write_file`, `edit_file`, `run_command`, `screenshot`, `use_skill`, `remember`, `forget` and `search_chats`. Paths and commands are relative to the folder where `cream` was started.

File writes, edits, commands and screenshots ask for approval: `y` allow once, `a` always allow that tool for the session, `n` deny, `Esc` stop. `/approve` disables prompts; use it only in folders you trust.

## Skills

Skills follow the Agent Skills format (`SKILL.md` plus resources).

```bash
/skills install all                     # github.com/anthropics/skills
/skills install obra/superpowers        # any repository with SKILL.md folders
/skill using-superpowers                # keep a skill always active
/brainstorm build a todo app            # run a skill as a command
```

The model sees each skill's name and description and loads full instructions on demand. Skills are read from `~/.cream/skills` and `./.cream/skills`.

## MCP servers

```bash
/mcp add rea npx -y rea-agents@6.8.0 mcp
/mcp tools rea
```

Tools marked read-only run directly; others require approval. Servers with more than 24 tools expose `mcp_find_tools` and `mcp_call_tool` instead of every schema, which keeps requests small.

## Remote control

```bash
/remote telegram <bot-token>   # create a bot with @BotFather
/remote discord <bot-token>    # discord.com/developers, enable Message Content Intent
```

Send `/pair <code>` to the bot from your phone, using the code shown by `/remote`. From the phone you can chat, send photos, and use `/status`, `/stop`, `/clear`, `/screenshot` and skill commands. Approvals appear as buttons on Telegram and as `y`/`a`/`n`/`stop` replies on Discord. Cream must keep running on the computer.

## Data and configuration

All data is stored in `~/.cream`:

| Path | Contents |
| --- | --- |
| `config.json` | Settings, API keys, bot tokens |
| `sessions/` | Chat history |
| `brain/` | Long-term memories |
| `attachments/` | Images and screenshots |
| `skills/` | Installed skills |

Set `CREAM_HOME` to use another location. Data from older versions (`~/.creamcli` and the install folder) is copied to `~/.cream` on first start; the originals are left in place.

## Security

- **Approvals are the main safeguard.** Read every command and file change before approving. Avoid `/approve` outside trusted folders.
- **Secrets are stored in plain text** in `~/.cream/config.json`. Prefer environment variables on shared machines.
- **Remote control executes on your computer.** Only paired accounts are accepted, codes rotate after each pairing, five wrong codes block an account until restart, and messages sent while Cream was closed are ignored. Use `/remote unpair` if a device is lost.
- **Screenshots capture the entire screen.** Close sensitive windows first.
- **Third-party skills and MCP servers run code on your machine.** Install only from sources you trust and pin versions.
- **No telemetry.** Cream only contacts the providers, bots and repositories you configure.

Report vulnerabilities privately to the maintainer instead of opening a public issue.

## Development

```bash
npm run dev        # run from source
npm test           # Vitest suite
npm run typecheck  # TypeScript
npm run build      # compile to dist/
```

CI runs typecheck, tests and build on Windows, macOS and Linux with Node 22 and 24.

## License

[MIT](LICENSE)
