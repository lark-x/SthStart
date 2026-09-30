---
name: project-verifier
description: >-
  Use when choosing or running checks for SthStart changes, diagnosing related environment
  failures, or preparing an authorized commit. Select targeted tests and expand only for
  cross-cutting changes, failures, or actual CI requirements.
---

# SthStart 定向验证

先查看当前差异、受影响调用方与 `package.json` 的实际脚本，再选择足以证明改动正确的检查。不要把提交准备自动扩展成部署或真实数据操作。

## 按改动选择检查

| 改动 | 最小有效检查 |
| --- | --- |
| 文档或 skill 文本 | 格式、引用、命令和接口事实核对；修改同步脚本时验证同步及只读检查行为 |
| 共享契约 | `npm run test:contracts`；跨层字段或调用变化增加 `npm run typecheck` |
| 服务业务逻辑 | 对应模块测试；签名或跨模块变更增加类型检查 |
| 前端工具、API 客户端 | 对应测试，或 `npm run test:portal`；类型变化增加类型检查 |
| 前端布局与交互 | 受影响路由的浏览器检查；全局外框变更扩大到代表性页面 |
| Windows Worker | `npm run test:windows-worker` |
| 邻舍适配契约 | `npm run test:linshe-contract` |
| 数据库迁移 | 临时旧版数据库升级、数据保留和完整性检查，不拿用户数据库试迁移 |

服务测试可以直接运行，不必先完整构建；以下为现有文件示例，按实际改动选择：

```bash
node --import tsx/esm --test apps/service/src/activity-production.test.ts
node --import tsx/esm --test apps/service/src/topics.test.ts
node --import tsx/esm --test apps/service/src/mcp.test.ts
```

`npm run test:portal` 覆盖 `app/lib/*.test.ts` 和 Story bridge 路由测试，不代表所有页面都已验收。`npm run typecheck` 会先构建 activity-playback 依赖，再检查根项目及 workspace 类型，不是纯单文件检查。

## 何时扩大范围

- 多模块变更、发布准备或实际 CI 要求时选择 `npm run ci:core`：类型检查、门户测试、全部服务测试和构建，不能称为轻量冒烟。
- `npm run verify` 包含类型检查、全部项目测试、构建和 lint；`npm run test:e2e` 会先构建再运行 Playwright。按任务需要选择，不作为所有小改动的固定步骤。
- 没有相关测试且变更有实质风险时补充能验证行为的测试；不为低影响可逆修改编写与实现或文档措辞逐字对应的测试。
- 相关检查通过后，只有新增修改、失败或未解决疑点才重复或扩大检查。

## 环境诊断与交付

- `npm run doctor` 对应 `scripts/linshe-doctor.mjs`，主要诊断邻舍、Python、向量模型及相关配置，不作为门户所有问题的默认诊断。
- `npm run doctor:remote` 对应远程性能诊断，可能访问配置的远程服务；仅在相关任务中使用。
- 区分代码失败和缺少服务、凭据、浏览器或外部模型等环境限制。优先完成可执行的相关检查，报告已通过、失败和未验证的内容，不声称覆盖未运行的场景。
- 提交或推送遵循用户任务范围；不能为了让检查通过而默认部署、恢复数据库或修改邻舍配置。
