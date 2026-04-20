# Implementation Plan: 微信统一入口 /switch 路由

## Dependency Graph

```
T1 (bridge 脚手架 + HTTP 服务)
 │
 ├──→ T2 (bridge channel 注册 + 消息转发) ──→ T5 (端到端集成)
 │
T3 (wcc /switch 指令 + routingMode)
 │
 └──→ T4 (wcc bridge-client + 消息转发) ──→ T5

T1 和 T3 互相独立，可并行开发。
T2 依赖 T1，T4 依赖 T3，T5 依赖 T2 + T4。
```

## Phase 1: 基础能力（可并行）

### T1: openclaw-bridge 脚手架 + HTTP 服务
**垂直切片**: 可启动的 HTTP 服务，curl 可验证 `/health` 和 `/message`

新建文件:
- `openclaw-bridge/package.json` — 项目配置，依赖 openclaw devDep
- `openclaw-bridge/tsconfig.json` — 复用 openclaw-weixin 的配置模式
- `openclaw-bridge/openclaw.plugin.json` — 插件元数据
- `openclaw-bridge/index.ts` — 插件注册入口（先空壳）
- `openclaw-bridge/src/types.ts` — BridgeMessage, BridgeResponse 类型
- `openclaw-bridge/src/logger.ts` — 简单日志
- `openclaw-bridge/src/http-server.ts` — HTTP 服务器（localhost only）
  - `GET /health` → `{ ok: true, gateway: string }`
  - `POST /message` → 接收 BridgeMessage，暂存响应
  - 可独立启动测试

**验收**: `curl http://localhost:3847/health` 返回 200

### T3: wcc /switch 指令 + routingMode
**垂直切片**: 微信中发送 `/switch openclaw` 能看到状态变化，`/status` 显示路由

修改文件:
- `wechat-claude-code/src/session.ts` — Session 接口添加 `routingMode: 'claude' | 'openclaw'`，默认 `'claude'`
- `wechat-claude-code/src/commands/handlers.ts` — 新增 `handleSwitch()`, 更新 `handleHelp()`, `handleStatus()`
- `wechat-claude-code/src/commands/router.ts` — router switch 添加 `'switch'` case

**验收**: `/switch` 显示当前模式，`/switch openclaw` 提示 bridge 不可用（因为还没启动），`/switch claude` 切回

## Phase 2: 核心连接

### T2: openclaw-bridge channel 插件完整实现
**垂直切片**: OpenClaw gateway 启动时 bridge 作为 channel 注册，收到 HTTP 消息后通过 channelRuntime 推给 gateway，gateway 的回复通过 HTTP 响应返回

新建/修改文件:
- `openclaw-bridge/src/channel.ts` — 完整 ChannelPlugin 实现
  - `gateway.startAccount()`: 启动 HTTP 服务，收到 POST /message 后调用 `channelRuntime.onMessage()`
  - `outbound.sendText()`: 拦截 gateway 回复，写入 HTTP 响应
  - `outbound.sendMedia()`: 同上
- `openclaw-bridge/index.ts` — 填充 register() 逻辑
- `openclaw-bridge/src/http-server.ts` — 集成 channel runtime，消息同步等待处理结果

**关键设计决策**:
- 同步模式：HTTP 请求阻塞等待 gateway agent 处理完成（最长 120s）
- 用 Promise + resolve/reject 模式将 sendText 回调的返回值传回 HTTP 响应

**验收**: OpenClaw gateway 启动后，`curl -X POST localhost:3847/message -d '{"from":"test","text":"hello"}'` 收到 AI 回复

### T4: wcc bridge-client + 消息路由转发
**垂直切片**: `/switch openclaw` 后发消息能收到 OpenClaw 回复

新建/修改文件:
- `wechat-claude-code/src/openclaw/bridge-client.ts` — HTTP 客户端
  - `send(msg: BridgeMessage): Promise<BridgeResponse>`
  - `healthCheck(): Promise<{ok:boolean}>`
- `wechat-claude-code/src/openclaw/health.ts` — bridge 健康检查
- `wechat-claude-code/src/main.ts` — `handleMessage()` 添加 routingMode 分支
  - `routingMode === 'openclaw'` → 构建 BridgeMessage → bridgeClient.send() → 将 reply 发回微信
- `wechat-claude-code/src/commands/handlers.ts` — `handleSwitch()` 完善：切换前 healthCheck

**验收**: 启动 wcc + bridge + gateway → `/switch openclaw` → 发消息 → 收到 OpenClaw 回复

## Phase 3: 集成与打磨

### T5: 端到端集成 + 错误处理
**垂直切片**: 完整的用户场景可以跑通，异常情况有友好提示

修改文件:
- `wechat-claude-code/src/main.ts` — 错误处理：
  - bridge 不可达时的提示
  - agent 响应超时处理
  - 网络中断恢复
- `wechat-claude-code/src/commands/handlers.ts` — `handleHelp()` 补充 `/switch` 说明

**验收**:
- bridge 未启动时 `/switch openclaw` → 提示 "OpenClaw bridge 不可用，请确认 gateway 已启动"
- 正常流程：微信发消息 → openclaw 回复 → 微信收到
- bridge 中断后自动回退 claude 模式

## Checkpoints

| 检查点 | 触发条件 | 验证方式 |
|--------|---------|---------|
| CP1 | T1 + T3 完成 | `npm run build` 两个项目都通过，/switch 指令可用 |
| CP2 | T2 完成 | bridge 作为 channel 注册到 gateway，curl 测试通过 |
| CP3 | T4 完成 | wcc 能通过 bridge-client 发消息并收到回复 |
| CP4 | T5 完成 | 完整端到端流程：微信 → openclaw → 回复 → 微信 |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| gateway channel 接口与预期不符 | T2 阻塞 | T1 先用 mock 验证 HTTP 层，T2 再接真实 gateway |
| agent 响应时间超过 HTTP 超时 | 用户体验差 | 初始设 120s 超时，后续考虑异步模式 |
| openclaw/plugin-sdk 版本兼容性 | 编译失败 | 复用 openclaw-weixin 的 devDependency 版本 |

## 估计工作量

| 任务 | 新建文件 | 修改文件 | 估计行数 |
|------|---------|---------|---------|
| T1 | 6 | 0 | ~250 |
| T2 | 1 | 2 | ~300 |
| T3 | 0 | 3 | ~120 |
| T4 | 2 | 2 | ~200 |
| T5 | 0 | 2 | ~80 |
| **合计** | **9** | **9** | **~950** |
