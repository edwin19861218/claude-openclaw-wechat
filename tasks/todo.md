# TODO — 微信统一入口 /switch 路由

## Phase 1: 基础能力（T1 ∥ T3 并行）

### T1: openclaw-bridge 脚手架 + HTTP 服务
- [x] 创建 `openclaw-bridge/` 项目目录和 package.json
- [x] 创建 tsconfig.json
- [x] 创建 openclaw.plugin.json 插件元数据
- [x] 创建 src/types.ts（BridgeMessage, BridgeResponse 类型）
- [x] 创建 src/logger.ts
- [x] 创建 index.ts 插件注册入口
- [x] 创建 src/http-server.ts（localhost HTTP 服务 + /health + /message）
- [x] 验证：build 通过，curl /health + /message smoke test 通过

### T3: wcc /switch 指令 + routingMode
- [x] session.ts: Session 添加 `routingMode` 字段，默认 'claude'
- [x] handlers.ts: 新增 handleSwitch() 处理函数（含 healthCheck）
- [x] router.ts: 添加 'switch' case 路由
- [x] handlers.ts: 更新 handleHelp() 添加 /switch 说明
- [x] handlers.ts: 更新 handleStatus() 显示路由模式
- [x] 验证：build 通过

## Phase 2: 核心连接（T2 依赖 T1, T4 依赖 T3）

### T2: openclaw-bridge channel 插件完整实现
- [x] src/channel.ts: 实现 ChannelPlugin 接口
- [x] channel.gateway.startAccount(): 启动 HTTP 服务，接收消息后走 channelRuntime pipeline
- [x] 使用 createReplyDispatcherWithTyping + withReplyDispatcher 拦截回复
- [x] index.ts: register() 保存 PluginRuntime
- [x] 验证：build 通过

### T4: wcc bridge-client + 消息路由转发
- [x] 创建 src/openclaw/bridge-client.ts（HTTP 客户端）
- [x] 创建 src/openclaw/health.ts（健康检查）
- [x] main.ts: 添加 sendToOpenClaw() 函数和 routingMode 路由分支
- [x] handlers.ts handleSwitch(): 切换前 healthCheck
- [x] router.ts: routeCommand 改为 async
- [x] 验证：build 通过

## Phase 3: 集成与打磨

### T5: 端到端集成 + 错误处理
- [x] bridge 不可达时友好提示（/switch openclaw 健康检查）
- [x] agent 响应超时处理（BridgeClient 120s timeout）
- [x] sendToOpenClaw 错误兜底（catch + finally 重置 state）
- [x] /help 已更新包含 /switch 说明
- [x] /status 显示路由模式
- [x] 两个项目 build 通过

## 待验证（需要实际 OpenClaw gateway 环境）
- [ ] gateway 启动 + openclaw-bridge 注册
- [ ] curl POST /message 收到 AI 回复
- [ ] wcc → bridge → gateway → 回复 → 微信 全链路
- [ ] /switch openclaw → 发消息 → /switch claude → 发消息
