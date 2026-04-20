# SPEC: 微信统一入口 — /switch 指令路由

## 目标

将 wechat-claude-code 改造为微信消息的**唯一监听入口**，通过 `/switch` 指令在 Claude Code 和 OpenClaw 之间切换消息路由。新建 openclaw-bridge 插件作为 OpenClaw gateway 的消息接收通道。

## 背景与问题

当前 `openclaw-weixin` 和 `wechat-claude-code` 各自独立监听同一个微信账号的消息（通过 `getUpdates` 长轮询），两者互斥无法同时运行。用户希望用一个微信账号同时使用两个系统。

## 架构

```
微信消息 → wechat-claude-code（唯一监听者）
                │
                ├── /switch claude  → Claude Agent SDK（现有逻辑）
                │
                └── /switch openclaw → HTTP POST localhost:port
                                            → openclaw-bridge channel
                                                → OpenClaw gateway
                                                    → AI Agent 处理
                                                        → channel.sendMessage()
                                                            → HTTP 回传
                                                                → wechat-claude-code 发回微信
```

### 组件职责

| 组件 | 职责 | 类型 |
|------|------|------|
| wechat-claude-code | 微信消息监听、/switch 路由、Claude Code 对话、消息发回微信 | 改造现有 |
| openclaw-bridge | OpenClaw channel 插件，暴露本地 HTTP API，转发消息给 gateway | 新建 |

## 项目结构

```
claude-openclaw-wechat/
├── wechat-claude-code/          # 改造
│   └── src/
│       ├── commands/
│       │   ├── router.ts         # 添加 /switch 路由
│       │   └── handlers.ts       # 添加 switchHandler
│       ├── openclaw/
│       │   ├── bridge-client.ts  # HTTP 客户端，转发消息给 bridge
│       │   └── health.ts         # OpenClaw gateway 健康检查
│       ├── session.ts            # 添加 routingMode 字段
│       └── store.ts              # 持久化 routingMode
│
├── openclaw-bridge/              # 新建
│   ├── index.ts                  # 插件注册入口
│   ├── openclaw.plugin.json      # 插件配置
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── channel.ts            # Channel 插件实现
│       ├── http-server.ts        # 本地 HTTP 服务器
│       ├── types.ts              # 消息类型定义
│       └── logger.ts             # 日志
│
└── openclaw-weixin/              # 不动
```

## 详细设计

### 1. wechat-claude-code 改造

#### 1.1 /switch 指令

**路由状态：**
```typescript
type RoutingMode = 'claude' | 'openclaw';

// 存储在 session 中，持久化到磁盘
interface Session {
  // ... 现有字段
  routingMode: RoutingMode;  // 默认 'claude'
}
```

**指令行为：**
- `/switch` — 显示当前路由目标和状态
- `/switch claude` — 切换到 Claude Code 模式
- `/switch openclaw` — 切换到 OpenClaw 模式（自动检测 bridge 可用性）

**切换到 openclaw 时的检查：**
1. 检查本地 HTTP bridge 是否可达（GET `/health`）
2. 不可达时提示用户：启动 OpenClaw gateway 或安装 openclaw-bridge
3. 可达时确认切换并提示当前工作目录

#### 1.2 消息路由逻辑

在 `commands/router.ts` 的消息处理入口添加路由判断：

```
收到微信消息
    │
    ├── 是 /switch 指令？ → switchHandler 处理
    ├── 是 /help？→ 追加显示 /switch 说明
    │
    └── routingMode == 'claude'？
            ├── 是 → 现有 Claude Code 处理流程（不变）
            └── 否 → 转发给 openclaw-bridge
                        │
                        ├── 文本消息：提取 text_body
                        ├── 图片消息：下载解密后传 base64 或 URL
                        └── 等待 bridge 回传响应 → 发回微信
```

#### 1.3 Bridge Client

```typescript
// src/openclaw/bridge-client.ts

interface BridgeClientConfig {
  baseUrl: string;  // 默认 http://localhost:3847
  timeoutMs: number; // 默认 120000
}

interface BridgeMessage {
  from: string;          // 微信发送者 ID
  text: string;          // 消息文本
  media?: {              // 可选媒体
    type: 'image' | 'voice' | 'file';
    data: string;        // base64 或下载 URL
    mimeType?: string;
    fileName?: string;
  };
  timestamp: number;
  contextToken?: string; // 微信 context_token（用于回传）
  metadata?: Record<string, string>; // 扩展字段
}

interface BridgeResponse {
  ok: boolean;
  reply?: {
    text: string;
    media?: { url: string; type: string }[];
  };
  error?: string;
}
```

**关键方法：**
- `send(message): Promise<BridgeResponse>` — POST `/message`
- `healthCheck(): Promise<{ ok: boolean; gatewayStatus: string }>` — GET `/health`

#### 1.4 OpenClaw 模式下的响应回传

wechat-claude-code 等待 bridge 的 HTTP 响应（同步模式）或轮询结果（异步模式，如果 OpenClaw agent 处理时间较长）。

**响应模式选择：**
- 同步模式（推荐初始实现）：bridge 等 agent 处理完再返回 HTTP 响应
- 超时处理：如果 agent 处理超过 60s，bridge 先返回一个"处理中"状态，后续通过回调推送

### 2. openclaw-bridge 新建

#### 2.1 插件注册

```json
// openclaw.plugin.json
{
  "id": "openclaw-bridge",
  "version": "1.0.0",
  "channels": ["openclaw-bridge"],
  "configSchema": {
    "type": "object",
    "properties": {
      "port": {
        "type": "number",
        "default": 3847,
        "description": "本地 HTTP 监听端口"
      }
    }
  }
}
```

#### 2.2 Channel 实现

```typescript
// src/channel.ts

export const bridgeChannel: ChannelPlugin = {
  register(api) {
    return {
      auth: { /* 简化认证，仅本地访问 */ },
      gateway: {
        startAccount(ctx) {
          // 启动本地 HTTP 服务器
          // 收到 HTTP 请求后调用 channelRuntime.onMessage()
        },
        stopAccount(ctx) {
          // 关闭 HTTP 服务器
        },
      },
      outbound: {
        async sendText(ctx) {
          // gateway 回复文本 → 返回给 HTTP 调用方
        },
        async sendMedia(ctx) {
          // gateway 回复媒体 → 返回给 HTTP 调用方
        },
      },
    };
  },
};
```

#### 2.3 HTTP API

```
POST /message
  Body: BridgeMessage (JSON)
  Response: BridgeResponse (JSON)
  超时: 120s

GET /health
  Response: { ok: boolean, gateway: "running" | "stopped", version: string }
```

#### 2.4 安全考虑

- 仅监听 localhost（127.0.0.1）
- 可选：简单 token 认证（通过 plugin config 设置）
- 不暴露到外网

### 3. 消息流程详解

#### Claude Code 模式（现有，不变）
```
用户微信发消息 → wcc 监听 → 路由到 Claude → 流式响应 → 发回微信
```

#### OpenClaw 模式（新增）
```
1. 用户微信发消息 "帮我写个 Python 脚本"
2. wcc 监听到消息，routingMode == 'openclaw'
3. wcc 构建 BridgeMessage:
   { from: "wxid_xxx", text: "帮我写个 Python 脚本", timestamp: ..., contextToken: "..." }
4. wcc POST → http://localhost:3847/message
5. openclaw-bridge 收到请求
6. bridge 调用 channelRuntime.onMessage({ from, text, ... })
7. OpenClaw gateway 接收消息，交给 AI agent 处理
8. agent 处理完成，gateway 调用 channel.outbound.sendText({ text: "这是脚本..." })
9. bridge 拦截 sendText 回调，将文本写入 HTTP 响应
10. bridge 返回 HTTP 响应: { ok: true, reply: { text: "这是脚本..." } }
11. wcc 收到响应，通过 sendMessage 发回微信
```

## 验收标准

### 必须实现（P0）
- [ ] `/switch` 指令可在 claude 和 openclaw 之间切换
- [ ] 切换到 openclaw 时自动检测 bridge 可用性
- [ ] openclaw 模式下文本消息正确路由到 OpenClaw gateway 并收到回复
- [ ] openclaw 模式下的回复正确发回微信
- [ ] bridge 不可用时给出明确错误提示，不影响 claude 模式使用
- [ ] routing 状态持久化，重启后恢复

### 应该实现（P1）
- [ ] openclaw 模式支持图片消息转发
- [ ] bridge 健康检查（/health 端点）
- [ ] `/status` 指令显示当前路由状态
- [ ] 日志记录路由切换事件

### 可以延后（P2）
- [ ] openclaw 模式支持语音/文件消息
- [ ] 长时间 agent 响应的异步处理
- [ ] 多微信账号的路由隔离

## 边界

### 始终做
- 保持 wechat-claude-code 的现有 Claude Code 功能完全不受影响
- 所有微信消息收发只通过 wechat-claude-code
- openclaw-bridge 仅监听 localhost
- 切换失败时回退到 claude 模式

### 先问再做
- openclaw-bridge 的端口号（默认 3847）
- 是否需要 bridge 认证 token
- agent 长时间响应的处理策略

### 永远不做
- 修改 openclaw-weixin 的代码
- 让 wechat-claude-code 依赖 openclaw plugin-sdk
- 暴露 bridge HTTP 端点到外网
- 破坏现有 wechat-claude-code 命令的兼容性

## 技术栈

| 组件 | 语言 | 运行时 | 关键依赖 |
|------|------|--------|---------|
| wechat-claude-code | TypeScript | Node.js ≥ 18 | 现有依赖（无新增） |
| openclaw-bridge | TypeScript | OpenClaw gateway | openclaw/plugin-sdk, Node http 模块 |

## 测试策略

### 单元测试
- `/switch` 指令解析和状态管理
- BridgeClient 的 HTTP 请求构建
- 路由决策逻辑（routingMode 判断）

### 集成测试
- wechat-claude-code ↔ openclaw-bridge HTTP 通信
- openclaw-bridge ↔ OpenClaw gateway channel 接口
- 端到端：微信消息 → 路由 → OpenClaw → 响应 → 微信

### 手动验证
- 启动 OpenClaw gateway + openclaw-bridge
- 启动 wechat-claude-code
- 微信中发送 `/switch openclaw`，确认切换成功
- 发送文本消息，确认 OpenClaw 回复正确
- 发送 `/switch claude`，确认切回并正常对话
