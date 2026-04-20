# wechat-claude-code

[English](README.md) | **中文**

基于 [wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code)，增加 `/switch` 指令和 openclaw-bridge 插件，实现微信消息在 Claude Code 与 OpenClaw 之间的路由切换。openclaw-bridge 的实现参考了 [openclaw-weixin](https://npmx.dev/package/@tencent-weixin/openclaw-weixin)。

## 功能特性

- **OpenClaw 路由** — `/switch openclaw` 将消息转发给 OpenClaw gateway，无需停掉 Claude Code
- **实时进度推送** — 实时查看 Claude 的工具调用（🔧 Bash、📖 Read、🔍 Glob…）
- **思考预览** — 每次工具调用前展示 💭 Claude 的推理摘要（前 300 字）
- **中断支持** — 在 Claude 处理中发送新消息可打断当前任务
- **系统提示词** — 通过 `/prompt` 设置持久化提示词（如"用中文回答"）
- 通过微信与 Claude Code 进行文字对话
- 图片识别——发送照片让 Claude 分析
- 权限审批——在微信中回复 `y`/`n` 控制工具执行
- 斜杠命令——`/help`、`/clear`、`/model`、`/prompt`、`/status`、`/skills` 等
- 在微信中触发任意已安装的 Claude Code Skill
- 跨平台——macOS（launchd）、Linux（systemd + nohup 回退）
- 会话持久化——跨消息恢复上下文
- 限频保护——微信 API 限频时自动指数退避重试

## 前置条件

- Node.js >= 18
- macOS 或 Linux
- 个人微信账号（需扫码绑定）
- 已安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（含 `@anthropic-ai/claude-agent-sdk`）
  > **注意：** 该 SDK 支持第三方 API 提供商（如 OpenRouter、AWS Bedrock、自定义 OpenAI 兼容接口）——按需设置 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_API_KEY` 即可。

## 安装

### 方式一：独立安装（仅 Claude Code）

克隆到 Claude Code skills 目录：

```bash
git clone https://github.com/Wechat-ggGitHub/wechat-claude-code.git ~/.claude/skills/wechat-claude-code
cd ~/.claude/skills/wechat-claude-code
npm install
```

`postinstall` 脚本会自动编译 TypeScript。

### 方式二：统一安装（Claude Code + OpenClaw）

如果你同时使用 OpenClaw，克隆整个 monorepo：

```bash
git clone https://github.com/Wechat-ggGitHub/claude-openclaw-wechat.git
cd claude-openclaw-wechat
bash scripts/install.sh install
```

安装脚本会自动：
1. 构建两个项目
2. 将 openclaw-bridge 注册为 OpenClaw 插件
3. 配置 channel 并验证安装

```bash
bash scripts/install.sh install   # 完整安装（构建 + 插件 + 验证）
bash scripts/install.sh build     # 仅构建
bash scripts/install.sh verify    # 验证安装状态
```

## 快速开始

### 1. 首次设置

扫码绑定微信账号：

```bash
cd ~/.claude/skills/wechat-claude-code
# 或者 cd claude-openclaw-wechat/wechat-claude-code
npm run setup
```

会自动弹出二维码图片，用微信扫码后配置工作目录。

### 2. 启动服务

```bash
npm run daemon -- start
```

- **macOS**：注册 launchd 代理，实现开机自启和自动重启
- **Linux**：使用 systemd 用户服务（无 systemd 时回退到 nohup）

如果使用 OpenClaw 路由，还需启动 OpenClaw gateway：

```bash
openclaw gateway start
```

### 3. 在微信中聊天

直接在微信中发消息即可与 Claude Code 对话。

### 4. 管理服务

```bash
npm run daemon -- status   # 查看运行状态
npm run daemon -- stop     # 停止服务
npm run daemon -- restart  # 重启服务（代码更新后使用）
npm run daemon -- logs     # 查看最近日志
```

## 微信端命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清除当前会话（重新开始） |
| `/reset` | 完全重置（包括工作目录等设置） |
| `/model <名称>` | 切换 Claude 模型 |
| `/permission <模式>` | 切换权限模式 |
| `/prompt [内容]` | 查看或设置系统提示词（全局生效） |
| `/status` | 查看当前会话状态 |
| `/cwd [路径]` | 查看或切换工作目录 |
| `/switch` | 查看当前路由模式 |
| `/switch claude` | 切换到 Claude Code（默认） |
| `/switch openclaw` | 切换到 OpenClaw |
| `/skills` | 列出已安装的 Claude Code Skill |
| `/history [数量]` | 查看最近 N 条对话记录 |
| `/compact` | 压缩上下文（开始新 SDK 会话，保留历史） |
| `/undo [数量]` | 撤销最近 N 条对话 |
| `/<skill> [参数]` | 触发任意已安装的 Skill |

## OpenClaw 路由

### 架构

```
微信消息 → wechat-claude-code（唯一监听者）
                │
                ├── /switch claude  → Claude Agent SDK（现有逻辑）
                │
                └── /switch openclaw → HTTP POST localhost:3847
                                          → openclaw-bridge channel 插件
                                              → OpenClaw gateway
                                                  → AI Agent 处理
                                                      → HTTP 回传
                                                          → wechat-claude-code 发回微信
```

### 工作流程

1. **切换路由**：微信中发送 `/switch openclaw`（自动检测 bridge 可用性）
2. **发送消息**：正常发文字消息，wechat-claude-code 转发给 OpenClaw gateway
3. **收到回复**：OpenClaw agent 处理完成后，回复自动发回微信
4. **切回 Claude**：发送 `/switch claude` 回到默认模式

### 安装 openclaw-bridge

openclaw-bridge 是一个 OpenClaw channel 插件，接收 wechat-claude-code 转发的消息：

```bash
# 在 claude-openclaw-wechat 目录下
bash scripts/install.sh install
openclaw gateway restart
```

验证安装：

```bash
curl http://localhost:3847/health
# 期望: {"ok":true,"gateway":"running","version":"1.0.0"}
```

## 权限审批

当 Claude 请求执行工具时，微信会收到权限请求：

- 回复 `y` 或 `yes` 允许
- 回复 `n` 或 `no` 拒绝
- 120 秒未回复自动拒绝

通过 `/permission <模式>` 切换权限模式：

| 模式 | 说明 |
|------|------|
| `default` | 每次工具使用需手动审批 |
| `acceptEdits` | 自动批准文件编辑，其他需审批 |
| `plan` | 只读模式，不允许任何工具 |
| `auto` | 自动批准所有工具（危险模式） |

## 工作原理

### Claude Code 模式（默认）

```
微信（手机） ←→ ilink bot API ←→ Node.js 守护进程 ←→ Claude Code SDK（本地）
```

- 守护进程通过长轮询监听微信 ilink bot API 的新消息
- 消息通过 `@anthropic-ai/claude-agent-sdk` 转发给 Claude Code
- 工具调用和思考摘要在 Claude 工作时实时推送
- 回复发送回微信，限频时自动重试

### OpenClaw 模式

```
微信（手机） ←→ ilink bot API ←→ Node.js 守护进程 ←HTTP→ openclaw-bridge ←→ OpenClaw gateway
```

- 消息通过 HTTP POST 发送给本地的 openclaw-bridge 插件
- bridge 插件将消息注入 OpenClaw gateway 的 channel 管道
- AI agent 处理完成后，bridge 拦截回复并返回给 HTTP 调用方
- 守护进程将回复发回微信

- 平台原生服务管理保持守护进程运行（macOS 使用 launchd，Linux 使用 systemd/nohup）

## 数据目录

所有数据存储在 `~/.wechat-claude-code/`：

```
~/.wechat-claude-code/
├── accounts/       # 微信账号凭证（每个账号一个 JSON）
├── config.env      # 全局配置（工作目录、模型、权限模式、系统提示词）
├── sessions/       # 会话数据（每个账号一个 JSON）
├── get_updates_buf # 消息轮询同步缓冲
└── logs/           # 运行日志（每日轮转，保留 30 天）
```

## 开发

```bash
npm run dev    # 监听模式——TypeScript 文件变更时自动编译
npm run build  # 编译 TypeScript
```

## License

[MIT](LICENSE)
