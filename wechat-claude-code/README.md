# wechat-claude-code

[← 返回总览](../README.md)

微信消息的唯一监听入口。负责接收微信消息、路由分发（Claude Code 或 OpenClaw）、以及接收跨渠道推送并转发到微信。

> 基于 [wechat-claude-code](https://github.com/Wechat-ggGitHub/wechat-claude-code) 改造，在原有 Claude Code 对话功能基础上新增 OpenClaw 路由切换和 @wechat 推送能力。

## 功能

### 核心对话能力（原有）

- **文字对话** — 直接发送文字与 Claude Code 交互
- **图片理解** — 发送图片，Claude 自动分析
- **语音消息** — 提取微信服务器转写的文字（voice_text），作为文本对话处理
- **流式回复** — 回复实时逐段推送，长消息自动分段（2048 字符）
- **实时进度** — 查看工具调用（🔧 Bash、📖 Read、🔍 Glob…）和思考预览
- **多轮会话** — 上下文连续，支持 `/compact` 压缩
- **多会话管理** — `/session` 管理 Claude 会话，`/cwd` 切换目录自动恢复会话
- **Skill 触发** — `/<skill名>` 调用已安装的 Claude Code skill
- **中断支持** — 处理中发新消息可打断当前任务
- **跨平台守护** — macOS launchd / Linux systemd 自动重启

### 权限审批（原有）

Claude Code 工具调用需审批时，微信收到权限请求，回复 `y` 允许、`n` 拒绝，120 秒超时自动拒绝。

4 种模式：`default`（每次审批）、`acceptEdits`（自动批准编辑）、`plan`（只读）、`auto`（全自动）。

### OpenClaw 路由切换（新增）

| 指令 | 说明 |
|------|------|
| `/switch` | 查看当前路由 |
| `/switch claude` | 切换到 Claude Code（默认） |
| `/switch openclaw` | 切换到 OpenClaw（自动检查 bridge 可用性） |
| `/whoami` | 当前路由 + 目标端可用性 |

### @wechat 跨渠道推送（新增）

启动 push-server（`:3848`），接收 openclaw-bridge 转发的 AI 回复并发送到微信：
- 联系人自动持久化到磁盘，重启后不丢失
- contextToken 三级兜底：请求参数 → 最近收到 → 持久化
- 长消息自动分段发送

## 工作原理

### Claude Code 模式（默认）

```
微信 ←→ ilink bot API ←→ wcc daemon ←→ Claude Agent SDK（本地）
```

1. 守护进程通过长轮询监听微信 API 新消息
2. 消息通过 Claude Agent SDK 转发给 Claude Code
3. 工具调用和思考预览实时推送回微信
4. 回复发送回微信，限频时自动指数退避重试

### OpenClaw 模式

```
微信 ←→ ilink bot API ←→ wcc daemon ←HTTP→ openclaw-bridge (:3847) ←→ OpenClaw gateway
```

1. BridgeClient 将消息 POST 到 `localhost:3847`
2. openclaw-bridge 注入 OpenClaw channel 管道，AI agent 处理
3. 回复通过 HTTP 响应返回，wcc 发回微信

### 跨渠道推送流程

```
WebUI/Cron → OpenClaw → @wechat hook → POST :3848/push → wcc → 微信
```

1. openclaw-bridge 的 agent_end hook 检测到 @wechat 标注
2. 提取 AI 回复文本，POST 到 wcc push-server
3. push-server 调用 sender.sendText() 发送到微信

## 指令列表

| 指令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清除当前会话 |
| `/reset` | 完全重置（包括工作目录） |
| `/status` | 查看会话状态 |
| `/session` | 列出当前目录的 Claude 会话 |
| `/session new` | 新建会话（开始全新对话） |
| `/session select <n>` | 切换到第 n 个历史会话 |
| `/compact` | 压缩上下文（新 SDK 会话，保留历史） |
| `/history [数量]` | 查看对话记录（默认 20 条） |
| `/undo [数量]` | 撤销最近对话 |
| `/cwd [路径]` | 查看或切换工作目录（`-c` 自动创建） |
| `/model [名称]` | 切换 Claude 模型 |
| `/permission [模式]` | 切换权限模式 |
| `/prompt [内容]` | 设置系统提示词 |
| `/skills [full]` | 列出已安装 skill |
| `/version` | 查看版本 |
| `/switch` | 查看当前路由 |
| `/switch claude` | 切换到 Claude Code |
| `/switch openclaw` | 切换到 OpenClaw |
| `/whoami` | 当前路由 + 目标端可用性 |
| `/<skill> [参数]` | 触发已安装 skill |

## 项目结构

```
wechat-claude-code/src/
├── main.ts              # 入口：daemon + push-server
├── commands/
│   ├── router.ts        # 命令路由
│   └── handlers.ts      # 处理器
├── openclaw/            # OpenClaw 集成（新增）
│   ├── bridge-client.ts # HTTP 客户端 → bridge :3847
│   ├── push-server.ts   # HTTP 服务 ← bridge 推送 :3848
│   ├── contact-store.ts # 联系人持久化
│   └── health.ts        # Bridge 健康检查
├── claude/              # Claude Agent SDK 集成
│   ├── provider.ts      # SDK 封装（支持 resume/continue）
│   ├── session-scanner.ts # 扫描 ~/.claude/projects/ 获取会话列表
│   └── skill-scanner.ts # Skill 扫描
├── wechat/              # 微信 API 封装
│   ├── api.ts           # HTTP 客户端
│   ├── monitor.ts       # 消息轮询
│   ├── send.ts          # 消息发送
│   ├── media.ts         # 图片下载 + 语音文字提取
│   └── login.ts         # QR 扫码绑定
├── session.ts           # 会话状态
├── permission.ts        # 权限审批代理
├── config.ts            # 配置管理
└── constants.ts         # 常量
```

## 数据目录

所有数据存储在 `~/.wechat-claude-code/`：

```
~/.wechat-claude-code/
├── accounts/       # 微信账号凭证
├── config.env      # 全局配置
├── sessions/       # 会话数据
├── contact.json    # 联系人持久化（@wechat 推送用）
├── get_updates_buf # 消息轮询缓冲
└── logs/           # 日志（每日轮转，保留 30 天）
```

## 快速开始

```bash
# 安装
npm install

# 首次设置（扫码绑定）
npm run setup

# 启动守护进程
npm run daemon -- start

# 管理
npm run daemon -- status
npm run daemon -- stop
npm run daemon -- restart
npm run daemon -- logs
```

## 开发

```bash
npm run dev    # 监听模式
npm run build  # 编译
```
