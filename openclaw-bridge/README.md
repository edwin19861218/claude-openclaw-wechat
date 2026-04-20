# openclaw-bridge

[← 返回总览](../README.md)

OpenClaw gateway 的 HTTP bridge channel 插件。接收 wechat-claude-code 转发的微信消息，注入 OpenClaw 管道处理，并通过 `@wechat` hooks 实现跨渠道回复推送到微信。

## 功能

### HTTP Bridge Channel

- **POST /message** — 接收 wcc 转发的微信消息，注入 OpenClaw channel 管道
- **GET /health** — 健康检查端点
- 同步请求-响应模式：等待 AI agent 处理完成后返回回复

### @wechat 跨渠道推送

通过两个 OpenClaw 插件 hooks 实现：

1. **message_received hook** — 监听所有渠道消息，检测非微信渠道中的 `@wechat` 标注
2. **agent_end hook** — AI 回复生成后触发，提取回复文本并 POST 到 wcc push-server

### 推送去重

微信消息经 bridge HTTP 同步回复时，channel 自动标记该 session。agent_end hook 检测到标记后跳过推送，避免重复发送。

### Cron @wechat 支持

Cron systemEvent 不触发 message_received hook，因此在 agent_end 中额外检测：
- `isBridgeSession()` 判断是否来自 bridge
- `inputContainsAnnotation()` 检查输入消息是否包含 `@wechat`

## 工作原理

### 微信消息处理（同步）

```
wcc → POST :3847/message → channel.handleMessage()
  → setLastWechatContact() + markSessionHttpReply()
  → OpenClaw channel pipeline → AI agent
  → HTTP response {ok, reply} → wcc → 微信
```

### WebUI @wechat 推送（异步）

```
WebUI → OpenClaw → message_received hook
  → channelId ≠ "openclaw-bridge" + content 含 "@wechat"
  → markWechatPush()
  → AI agent 处理
  → agent_end hook → consumeWechatPush() → 提取回复
  → POST :3848/push → wcc → 微信
```

### Cron @wechat 推送（异步）

```
Cron → systemEvent → AI agent 处理
  → agent_end hook
  → consumeSessionHttpReply() → false
  → consumeWechatPush() → null
  → isBridgeSession() → true
  → inputContainsAnnotation(messages) → true
  → 提取回复 → POST :3848/push → wcc → 微信
```

## 项目结构

```
openclaw-bridge/
├── index.ts              # 插件注册 + hooks
│   ├── register()        # 注册 channel + message_received + agent_end
│   ├── isBridgeSession() # 判断是否 bridge session
│   ├── extractReplyText()# 从 messages 提取 AI 回复
│   └── inputContainsAnnotation() # 检测输入含 @wechat
│
└── src/
    ├── channel.ts        # Channel Plugin 实现
    │   ├── handleMessage()   # 处理 HTTP 消息 → OpenClaw pipeline
    │   └── gateway.startAccount() # 启动 HTTP server
    ├── wechat-notify.ts  # 状态共享（内存）
    │   ├── setLastWechatContact()  # 记录微信联系人
    │   ├── markWechatPush()        # 标记 @wechat 推送
    │   ├── consumeWechatPush()     # 消费推送标记
    │   ├── markSessionHttpReply()  # 标记 HTTP 回复 session
    │   └── consumeSessionHttpReply()# 消费 HTTP 回复标记
    ├── http-server.ts    # HTTP 服务器（:3847）
    ├── types.ts          # 类型定义
    └── logger.ts         # 日志
```

## 配置

插件通过 OpenClaw 标准配置管理：

```bash
openclaw config set channels.openclaw-bridge.enabled true
openclaw config set channels.openclaw-bridge.port 3847
```

## 安装

```bash
# 通过 Makefile（推荐）
make install

# 或手动
openclaw plugins install --force ./openclaw-bridge
```

验证：

```bash
curl http://localhost:3847/health
# {"ok":true,"gateway":"running","version":"1.0.0"}
```

## 开发

```bash
npm run build   # 编译
npm run dev     # 监听模式
```

## 关键设计决策

### 为什么联系人存在内存而非数据库？

单用户模式下只有一个微信联系人，用模块级变量即可。wcc 侧有 `contact-store` 做磁盘持久化兜底。

### 为什么 HTTP 回复和推送要分开去重？

微信消息走 bridge HTTP 同步回复（请求-响应模式），回复已在 HTTP 响应中返回。如果 agent_end 再推送一次，用户会收到两条相同消息。通过 `markSessionHttpReply` / `consumeSessionHttpReply` 在内存中标记已通过 HTTP 回复的 session。
