# Plan: 多会话管理 — 同目录 session 复用

## 目标

同一工作目录下支持多个 Claude SDK 会话，通过 `/session` 命令管理。
`/cwd` 切换目录时自动恢复该目录上次的活跃会话。

## 存储设计

```
~/.wechat-claude-code/
  sessions/
    {accountId}/
      _index.json              ← 会话索引
      {sessionId}.json         ← 会话数据
```

### _index.json 结构

```typescript
interface SessionIndex {
  activeSessionId: string;       // 当前活跃会话 ID
  sessions: SessionMeta[];       // 所有会话元数据
}

interface SessionMeta {
  id: string;                    // 短 ID (s1, s2, ...)
  name: string;                  // 显示名称（默认 "会话 1"）
  workingDirectory: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;          // 缓存的消息数
}
```

### 会话数据文件

`{sessionId}.json` 直接复用现有 `Session` 接口，无需修改。

## 命令设计

```
/session              显示当前会话信息
/session list         列出当前目录的所有会话（标记活跃）
/session new [名称]   创建新会话并切换（可选自定义名称）
/session select <n>   切换到第 n 个会话（从 list 中编号）
```

输出示例（/session list）：
```
📂 当前目录: /Volumes/PiCData/Claude/my-project

  [1] * 主会话        12条消息  刚刚
  [2]  调试认证       35条消息  2小时前
  [3]  新会话          0条消息  昨天
```

## /cwd 集成

切换目录时自动恢复该目录上次的活跃会话：
1. 遍历 `_index.json` 找到 `workingDirectory === targetPath` 的会话
2. 找到 → 激活该会话（更新 `activeSessionId`）
3. 未找到 → 创建新会话

## 数据迁移

首次启动时检测旧格式（`sessions/{accountId}.json` 单文件）：
1. 读取旧数据
2. 创建 `sessions/{accountId}/_index.json`
3. 将旧数据写入 `sessions/{accountId}/s1.json`
4. 删除旧文件

## 改动范围

### T1: session.ts — 重构为多会话存储

- 新增 `SessionMeta`、`SessionIndex` 类型
- `createSessionStore()` → `createMultiSessionStore()`
- 新方法: `loadIndex()`, `saveIndex()`, `loadSession(id)`, `saveSession(id, data)`
- 新方法: `findSessionByDir(dir)`, `createNewSession(dir, name?)`, `switchSession(id)`
- 新方法: `migrateFromLegacy()` 旧数据迁移
- 保持 `load(accountId)` 兼容接口（返回活跃会话）

### T2: handlers.ts — 添加 /session 命令

- `handleSession(ctx, args)` — 解析子命令 list/new/select
- 更新 `handleHelp()` 添加 /session 说明
- 更新 `handleCwd()` 切换目录时自动恢复会话

### T3: router.ts — 添加 session 路由

- 添加 `case 'session'` 路由

### T4: main.ts — 适配新会话存储

- 启动时调用迁移
- `handleMessage()` 加载/保存会话改用新接口
- `handleCwd` 通过 ctx 暴露会话切换能力

## 风险

| 风险 | 缓解 |
|------|------|
| 迁移失败丢失会话 | 迁移前备份旧文件，失败时回退 |
| 大量会话影响性能 | 限制单目录最大 20 个会话 |
| 会话 ID 冲突 | 使用自增计数器 s1, s2, ... |

## 估计

| 任务 | 新建/修改 | 行数 |
|------|----------|------|
| T1 session.ts 重构 | 修改 | ~180 |
| T2 handlers.ts 命令 | 修改 | ~80 |
| T3 router.ts 路由 | 修改 | ~3 |
| T4 main.ts 适配 | 修改 | ~30 |
