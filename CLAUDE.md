# CLAUDE.md — claude-openclaw-wechat 项目指令

## 项目概述

微信统一入口项目，通过 `/switch` 在 Claude Code 和 OpenClaw 间路由微信消息，支持 `@wechat` 跨渠道推送。

## 构建 & 开发

```bash
make build          # 构建两个子项目
make install        # 构建 + 安装 bridge 插件 + 复制 wcc 到 ~/.claude/skills/
make restart        # 重启 gateway + wcc
make verify         # 检查安装状态
```

wcc daemon 管理：`cd wechat-claude-code && npm run daemon -- {start|stop|restart|status|logs}`

## 架构要点

- **wechat-claude-code** 是微信消息的**唯一监听入口**（单用户模式）
- **openclaw-bridge** 是 OpenClaw 插件，提供 HTTP bridge channel
- 微信消息流向：微信 → wcc → `/switch` 路由 → Claude Code 或 bridge:3847 → OpenClaw
- 跨渠道推送：非微信渠道带 `@wechat` → bridge hook → POST wcc:3848 → 微信
- **微信来源消息不推送**：经 bridge HTTP 同步回复的 session 不触发 push

## 端口

- `3847`: openclaw-bridge HTTP（/message, /health）
- `3848`: wcc push-server（POST /push）

## 关键文件

| 文件 | 职责 |
|------|------|
| `wechat-claude-code/src/main.ts` | daemon 入口 + push-server 启动 |
| `wechat-claude-code/src/commands/router.ts` | /switch + /whoami 路由 |
| `wechat-claude-code/src/openclaw/bridge-client.ts` | HTTP → bridge |
| `wechat-claude-code/src/openclaw/push-server.ts` | HTTP ← bridge 推送 |
| `wechat-claude-code/src/openclaw/contact-store.ts` | 联系人持久化 |
| `openclaw-bridge/index.ts` | 插件注册 + @wechat hooks |
| `openclaw-bridge/src/channel.ts` | Channel 实现 + 联系人记录 |
| `openclaw-bridge/src/wechat-notify.ts` | 推送状态共享 |

## 编码规范

- TypeScript strict mode
- 路径别名使用 `.js` 扩展名（ESM）
- 无外部状态管理库，使用模块级变量共享状态
- 推送失败只记日志，不阻塞主流程
- 所有端口绑定 `127.0.0.1`
- HTTP 端点校验 remoteAddress 拒绝非本地请求
- 请求体大小限制 1 MB
- 日志不记录消息内容，仅记录长度

## 环境变量

- `ANTHROPIC_API_KEY` — Claude API 密钥（必需）
- `ANTHROPIC_BASE_URL` — 自定义 API 端点（可选）

## 已知局限性

- 单用户模式，多用户 @wechat 推送可能错发
- HTTP 端口无 token 认证，依赖 localhost 限制
- 联系人明文存储于 `contact.json`
- 推送无重试机制
- sessionsWithHttpReply Set 可能缓慢增长（长运行时需重启 bridge）

## 测试

目前无自动化测试，使用 `make verify` + 手动端到端测试验证。
