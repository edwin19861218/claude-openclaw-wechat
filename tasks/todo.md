# TODO — 多会话管理

## T1: session.ts 重构为多会话存储
- [ ] 新增 SessionMeta / SessionIndex 类型
- [ ] createMultiSessionStore(): loadIndex, saveIndex, listByDir, createNew, switchTo
- [ ] 旧数据迁移 migrateFromLegacy()
- [ ] 保持 load/save 兼容接口

## T2: handlers.ts 添加 /session 命令
- [ ] handleSession(ctx, args) 解析 list/new/select
- [ ] 更新 handleHelp 添加 /session 说明
- [ ] handleCwd 集成自动恢复会话

## T3: router.ts 添加路由
- [ ] case 'session' → handleSession

## T4: main.ts 适配新存储
- [ ] 启动时迁移
- [ ] handleMessage 使用新接口
- [ ] make build 通过

## T5: 验证
- [ ] 旧数据迁移正常
- [ ] /session list/new/select 正常
- [ ] /cwd 切换目录自动恢复会话
