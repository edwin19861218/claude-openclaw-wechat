# SPEC: 微信统一入口 — /switch 路由 + 跨通道 @wechat 推送

## 目标

1. 将 wechat-claude-code 改造为微信消息的**唯一监听入口**，通过 `/switch` 指令在 Claude Code 和 OpenClaw 之间切换消息路由。
2. 新建 openclaw-bridge 插件作为 OpenClaw gateway 的消息接收通道。
3. 实现 **@wechat 跨通道推送**：从非微信渠道（WebUI、定时任务等）发送的消息，当包含 `@wechat` 标注时，AI 回复自动同步推送到微信。

## 背景与问题

### /switch 路由

`openclaw-weixin` 和 `wechat-claude-code` 各自独立监听同一个微信账号的消息（通过 `getUpdates` 长轮询），两者互斥无法同时运行。用户希望用一个微信账号同时使用两个系统。

### @wechat 推送

当前 bridge 仅处理 wcc 主动 POST 的消息（请求-响应模式）。WebUI、定时任务、其他 channel 触发的消息完全绕过 bridge，回复不会推送到微信。用户希望从非微信渠道标注 `@wechat`，AI 回复就能同步到微信。

**关键约束：** 微信来源的消息已有正常的回复通道（bridge HTTP 响应 → wcc → 微信），不需要额外推送。只有**其他渠道**（webchat、cron 等）的消息带 `@wechat` 时才触发推送。

## 架构

### 消息路由（/switch）

```
微信消息 → wechat-claude-code（唯一监听者）
                │
                ├── /switch claude  → Claude Agent SDK（现有逻辑）
                │
                └── /switch openclaw → HTTP POST localhost:3847
                                            → openclaw-bridge channel
                                                → OpenClaw gateway → AI Agent
                                                    → HTTP 回传 → wcc 发回微信
```

### 跨通道推送（@wechat）

```
WebUI/定时任务/其他 channel 发送含 "@wechat" 的消息
       │
       ▼
  ① message_received hook 触发（bridge 注册）
     channelId ≠ "openclaw-bridge" 且 content 含 "@wechat"
     → 标记 wechatPushRequested = true
       │
       ▼
  ② OpenClaw gateway 正常处理（AI agent 生成回复）
       │
       ▼
  ③ agent_end hook 触发（bridge 注册）
     wechatPushRequested == true
     → 提取 AI 回复文本
     → POST 到 wcc push-server (localhost:3848)
     → 重置 wechatPushRequested = false
       │
       ▼
  ④ wcc 收到推送 → sender.sendText() 发到微信
```

**消息来源区分：**
- `channelId == "openclaw-bridge"` → 来自微信，已有回复通道，**不推送**
- `channelId != "openclaw-bridge"`（webchat、cron 等）→ 来自其他渠道，**检测 @wechat 后推送**

## 已验证的技术前提（Phase 0）

| 验证项 | 结果 | 关键发现 |
|--------|------|----------|
| `api.on("message_received")` 跨通道可用 | ✅ 通过 | 捕获 webchat 消息，channelId=webchat |
| `api.on("agent_end")` 跨通道可用 | ✅ 通过 | 捕获 AI 回复，含完整 messages 数组和 sessionKey |
| `message_sending` hook 对 webchat 无效 | ⚠️ 限制 | webchat 是内部通道，不走 delivery 管道，不触发此 hook |
| sessionKey 含微信联系人 ID | ✅ 通过 | 格式：`agent:sevenger:openclaw-bridge:direct:<userId>` |
| OpenClaw 标准化 userId 为小写 | ⚠️ 注意 | sessionKey 中 userId 被转为小写，需从 wcc 原始消息获取正确大小写 |
| contextToken 可从 wcc 消息流获取 | ✅ 通过 | wcc POST /message 时携带 contextToken，bridge 记录 |

## 组件职责

| 组件 | 改动 | 说明 |
|------|------|------|
| wechat-claude-code `/switch` | 已实现 | 微信消息路由切换 |
| wechat-claude-code `/whoami` | 待实现 | 显示当前路由指向 claude 还是 openclaw |
| wechat-claude-code `bridge-client.ts` | 已实现 | HTTP 客户端，转发消息给 bridge |
| wechat-claude-code `push-server.ts` | 已实现 | HTTP 端点 (3848)，接收 bridge 转发的回复并调 sender 发微信 |
| wechat-claude-code 联系人持久化 | 待实现 | 持久化最近微信联系人到磁盘，避免重启后丢失 |
| openclaw-bridge `index.ts` hook | 已实现 | `agent_end` hook 提取回复，POST 到 wcc push-server |
| openclaw-bridge `channel.ts` | 已实现 | 记录 wcc 原始 userId（含大小写）和 contextToken |
| openclaw-bridge `wechat-notify.ts` | 已实现 | 联系人状态共享模块 |

## 项目结构

```
claude-openclaw-wechat/
├── wechat-claude-code/
│   └── src/
│       ├── commands/
│       │   ├── router.ts           # /switch + /whoami 路由
│       │   └── handlers.ts         # switchHandler + whoamiHandler
│       ├── openclaw/
│       │   ├── bridge-client.ts    # HTTP 客户端 → bridge
│       │   ├── push-server.ts      # HTTP 端点 ← bridge 转发
│       │   ├── contact-store.ts    # 联系人持久化（新增）
│       │   └── health.ts           # 健康检查
│       └── main.ts                 # 启动 push-server + daemon
│
├── openclaw-bridge/
│   ├── index.ts                    # 插件注册 + message_received + agent_end hooks
│   └── src/
│       ├── channel.ts              # Channel 实现 + 记录联系人
│       ├── wechat-notify.ts        # 联系人状态 + @wechat 标记共享
│       ├── http-server.ts          # HTTP 服务器
│       ├── types.ts
│       └── logger.ts
│
└── openclaw-weixin/                # 不动
```

## 详细设计 — P1 新增

### 1. @wechat 标注过滤（bridge 侧）

```typescript
// wechat-notify.ts — 共享状态
let wechatPushRequested = false;
let lastContact: { originalId: string; contextToken?: string } | null = null;

export function markWechatPush(contact: { originalId: string; contextToken?: string }): void {
  wechatPushRequested = true;
  lastContact = contact;
}

export function consumeWechatPush(): { originalId: string; contextToken?: string } | null {
  if (!wechatPushRequested || !lastContact) return null;
  wechatPushRequested = false;
  return lastContact;
}
```

```typescript
// index.ts — hooks
api.on("message_received", (event, ctx) => {
  // 只处理非微信渠道 + 含 @wechat 的消息
  if (ctx.channelId === "openclaw-bridge") return;
  const content = (event as any).content ?? "";
  if (!content.includes("@wechat")) return;

  const contact = getLastWechatContact();
  if (!contact) return;

  markWechatPush(contact);
  console.log(`[wechat-notify] @wechat detected from ${ctx.channelId}, will push to ${contact.originalId}`);
});

api.on("agent_end", (event, ctx) => {
  const contact = consumeWechatPush();
  if (!contact) return;

  const replyText = extractReplyText((event as any).messages);
  if (!replyText) return;

  fetch("http://localhost:3848/push", { ... });
});
```

### 2. 联系人持久化（wcc 侧）

```typescript
// src/openclaw/contact-store.ts
// 持久化到 DATA_DIR/contact.json
// { originalId: string, contextToken?: string, updatedAt: number }

// wcc 每次收到微信消息时调用 save()
// push-server 收到推送且包含联系人时也调用 save()
// push-server 启动时调用 load() 作为兜底
```

### 3. /whoami 指令（wcc 侧）

```
/whoami → 回复当前路由模式：
  "当前路由: Claude Code" 或 "当前路由: OpenClaw"
  同时显示 push-server 状态
```

## 验收标准

### P0（必须）— 已完成 ✅

- [x] `/switch` 指令可在 claude 和 openclaw 之间切换
- [x] openclaw 模式下文本消息正确路由到 OpenClaw gateway 并收到回复
- [x] WebUI 发送消息，AI 回复同步推送到微信
- [x] 推送失败不影响原始通道的回复

### P1（应该）— 已完成 ✅

- [x] **@wechat 标注过滤**：仅非微信渠道 + 含 `@wechat` 才推送；微信来源不推送
- [x] **联系人持久化**：wcc 持久化最近微信联系人，bridge/wcc 重启后仍可推送
- [x] **/whoami 指令**：显示当前路由指向 claude 还是 openclaw
- [x] **长回复自动分段**：复用 wcc 现有的 splitMessage 逻辑
- [x] **contextToken 兜底**：push-server 无 token 时使用持久化的最近 token
- [x] **推送失败容错**：推送失败只记日志，不影响原始通道回复

### P2（可以延后）

- [ ] `@wechat:wxid_xxx` 指定推送目标
- [ ] 推送状态反馈（bridge 回复原始通道"已推送到微信"）
- [ ] 多微信账号支持
- [ ] 图片/媒体消息转发

## 边界

### 始终做
- 保持 wechat-claude-code 的现有 Claude Code 功能完全不受影响
- 所有微信消息收发只通过 wechat-claude-code
- openclaw-bridge 仅监听 localhost（3847 + 3848）
- 推送失败只记日志，不影响原始通道回复
- 联系人信息从 wcc 的正常消息流中自动获取
- 微信来源消息的回复走现有 bridge HTTP 响应通道，不走 push

### 先问再做
- `@wechat` 的精确匹配规则（子串 vs 独立词）
- contextToken 过期时的重试策略
- 是否需要推送确认消息回原始通道

### 永远不做
- 修改 openclaw-weixin 的代码
- 修改 OpenClaw gateway 核心代码
- 让 wcc 依赖 openclaw plugin-sdk
- 暴露任何端口到外网
- 阻塞原始通道的消息回复流程

## 技术栈

| 组件 | 语言 | 运行时 | 关键依赖 |
|------|------|--------|---------|
| wechat-claude-code | TypeScript | Node.js ≥ 18 | 现有依赖（无新增） |
| openclaw-bridge | TypeScript | OpenClaw gateway | openclaw/plugin-sdk, Node http |

## 已知局限性

### 安全

- **HTTP 端口无认证**：3847/3848 仅限 localhost 访问（已校验 remoteAddress），但无 token/API key 认证。同机其他进程可调用这些端口。当前为单用户开发场景，可接受。
- **联系人明文存储**：`contact.json` 以明文保存 userId 和 contextToken。需确保 `DATA_DIR` 权限正确（`chmod 700`）。

### 隐私

- **日志不含消息内容**：已移除消息文本和回复内容的日志记录，仅记录长度。
- **userId 记入日志**：微信 userId 出现在日志中（用于调试）。生产环境应考虑脱敏。

### 架构

- **单用户模式**：联系人状态为内存单例，多用户同时使用时 @wechat 推送可能发给错误的人。
- **推送无重试**：push-server 不可用时推送直接丢弃，无重试队列。
- **sessionsWithHttpReply 无清理**：bridge 进程长期运行时，异常 session 的标记不会自动清理。
