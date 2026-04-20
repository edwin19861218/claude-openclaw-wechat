# wechat-claude-code

**English** | [中文](README_zh.md)

Based on [wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code), adds the `/switch` command and openclaw-bridge plugin to route WeChat messages between Claude Code and OpenClaw. The openclaw-bridge implementation references [openclaw-weixin](https://npmx.dev/package/@tencent-weixin/openclaw-weixin).

## Features

- **OpenClaw routing** — `/switch openclaw` forwards messages to OpenClaw gateway without stopping Claude Code
- **Real-time progress updates** — see Claude's tool calls (🔧 Bash, 📖 Read, 🔍 Glob…) as they happen
- **Thinking preview** — get a 💭 preview of Claude's reasoning before each tool call
- **Interrupt support** — send a new message mid-query to abort and redirect Claude
- **System prompt** — set a persistent prompt via `/prompt` (e.g. "Reply in Chinese")
- Text conversation with Claude Code through WeChat
- Image recognition — send photos for Claude to analyze
- Permission approval — reply `y`/`n` in WeChat to approve Claude's tool use
- Slash commands — `/help`, `/clear`, `/model`, `/prompt`, `/status`, `/skills`, and more
- Launch any installed Claude Code skill from WeChat
- Cross-platform — macOS (launchd), Linux (systemd + nohup fallback)
- Session persistence — resume conversations across messages
- Rate-limit safe — automatic exponential backoff on WeChat API throttling

## Prerequisites

- Node.js >= 18
- macOS or Linux
- Personal WeChat account (QR code binding required)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with `@anthropic-ai/claude-agent-sdk` installed
  > **Note:** The SDK supports third-party API providers (e.g. OpenRouter, AWS Bedrock, custom OpenAI-compatible endpoints) — set `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` accordingly.

## Installation

### Option A: Standalone (Claude Code only)

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/Wechat-ggGitHub/wechat-claude-code.git ~/.claude/skills/wechat-claude-code
cd ~/.claude/skills/wechat-claude-code
npm install
```

`postinstall` automatically compiles TypeScript via `tsc`.

### Option B: Unified (Claude Code + OpenClaw)

If you also use OpenClaw, clone the full monorepo:

```bash
git clone https://github.com/Wechat-ggGitHub/claude-openclaw-wechat.git
cd claude-openclaw-wechat
bash scripts/install.sh install
```

The install script will automatically:
1. Build both projects
2. Register openclaw-bridge as an OpenClaw plugin
3. Configure the channel and verify installation

```bash
bash scripts/install.sh install   # Full install (build + plugin + verify)
bash scripts/install.sh build     # Build only
bash scripts/install.sh verify    # Verify installation status
```

## Quick Start

### 1. Setup (first time only)

Scan QR code to bind your WeChat account:

```bash
cd ~/.claude/skills/wechat-claude-code
# or: cd claude-openclaw-wechat/wechat-claude-code
npm run setup
```

A QR code image will open — scan it with WeChat. Then configure your working directory.

### 2. Start the daemon

```bash
npm run daemon -- start
```

- **macOS**: registers a launchd agent for auto-start and auto-restart
- **Linux**: uses systemd user service (falls back to nohup if systemd unavailable)

If using OpenClaw routing, also start the OpenClaw gateway:

```bash
openclaw gateway start
```

### 3. Chat in WeChat

Send any message in WeChat to start chatting with Claude Code.

### 4. Manage the service

```bash
npm run daemon -- status   # Check if running
npm run daemon -- stop     # Stop the daemon
npm run daemon -- restart  # Restart (after code updates)
npm run daemon -- logs     # View recent logs
```

## WeChat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear current session (start fresh) |
| `/reset` | Full reset including working directory |
| `/model <name>` | Switch Claude model |
| `/permission <mode>` | Switch permission mode |
| `/prompt [text]` | View or set a system prompt appended to every query |
| `/status` | View current session state |
| `/cwd [path]` | View or switch working directory |
| `/switch` | View current routing mode |
| `/switch claude` | Switch to Claude Code (default) |
| `/switch openclaw` | Switch to OpenClaw |
| `/skills` | List installed Claude Code skills |
| `/history [n]` | View last N chat messages |
| `/compact` | Start a new SDK session (clear token context) |
| `/undo [n]` | Remove last N messages from history |
| `/<skill> [args]` | Trigger any installed skill |

## OpenClaw Routing

### Architecture

```
WeChat message → wechat-claude-code (sole listener)
                    │
                    ├── /switch claude  → Claude Agent SDK (existing flow)
                    │
                    └── /switch openclaw → HTTP POST localhost:3847
                                              → openclaw-bridge channel plugin
                                                  → OpenClaw gateway
                                                      → AI Agent processing
                                                          → HTTP response
                                                              → wechat-claude-code → WeChat
```

### How It Works

1. **Switch routing**: Send `/switch openclaw` in WeChat (auto-detects bridge availability)
2. **Send messages**: Type normally — wechat-claude-code forwards to OpenClaw gateway
3. **Receive replies**: OpenClaw agent response is sent back to WeChat automatically
4. **Switch back**: Send `/switch claude` to return to default mode

### Installing openclaw-bridge

openclaw-bridge is an OpenClaw channel plugin that receives messages forwarded from wechat-claude-code:

```bash
# From the claude-openclaw-wechat directory
bash scripts/install.sh install
openclaw gateway restart
```

Verify installation:

```bash
curl http://localhost:3847/health
# Expected: {"ok":true,"gateway":"running","version":"1.0.0"}
```

## Permission Approval

When Claude requests to execute a tool, you'll receive a permission request in WeChat:

- Reply `y` or `yes` to allow
- Reply `n` or `no` to deny
- No response within 120 seconds = auto-deny

You can switch permission mode with `/permission <mode>`:

| Mode | Description |
|------|-------------|
| `default` | Manual approval for each tool use |
| `acceptEdits` | Auto-approve file edits, other tools need approval |
| `plan` | Read-only mode, no tools allowed |
| `auto` | Auto-approve all tools (dangerous mode) |

## How It Works

### Claude Code Mode (default)

```
WeChat (phone) ←→ ilink bot API ←→ Node.js daemon ←→ Claude Code SDK (local)
```

- The daemon long-polls WeChat's ilink bot API for new messages
- Messages are forwarded to Claude Code via `@anthropic-ai/claude-agent-sdk`
- Tool calls and thinking previews are streamed back as Claude works
- Responses are sent back to WeChat with automatic rate-limit retry

### OpenClaw Mode

```
WeChat (phone) ←→ ilink bot API ←→ Node.js daemon ←HTTP→ openclaw-bridge ←→ OpenClaw gateway
```

- Messages are forwarded via HTTP POST to the local openclaw-bridge plugin
- The bridge plugin injects messages into the OpenClaw gateway channel pipeline
- When the AI agent finishes, the bridge captures the reply and returns it via HTTP
- The daemon sends the reply back to WeChat

- Platform-native service management keeps the daemon running (launchd on macOS, systemd/nohup on Linux)

## Data

All data is stored in `~/.wechat-claude-code/`:

```
~/.wechat-claude-code/
├── accounts/       # WeChat account credentials (one JSON per account)
├── config.env      # Global config (working directory, model, permission mode, system prompt)
├── sessions/       # Session data (one JSON per account)
├── get_updates_buf # Message polling sync buffer
└── logs/           # Rotating logs (daily, 30-day retention)
```

## Development

```bash
npm run dev    # Watch mode — auto-compile on TypeScript changes
npm run build  # Compile TypeScript
```

## License

[MIT](LICENSE)
