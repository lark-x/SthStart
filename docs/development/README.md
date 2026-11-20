# SthStart 开发记录

本目录是 SthStart 的长期开发状态入口。它补充 Git 提交历史和功能文档，用于回答三个问题：当前已经有什么、接下来要做什么、哪些验证被明确留到后续阶段。

首版以 2026-08-27 的 `main`（`52bdf12`）为基线。此前历史不逐项重建；详细的阶段日志从此基线开始持续记录。

## 文档导航

- [文档与工具清理记录](reviews/2026-11-19-docs-tooling-cleanup.md)说明早期方案、旧人设 Skill 和 DSH 本机配置的归档位置。
- [故事世界架构标准](STORY_WORLDS_ARCHITECTURE.md)：世界与分支、个人知识、持久化运行、公共生图队列和项目采纳的后续开发标准。
 - [邻舍借用台账](LINSHE_BORROW_LEDGER.md)：借用内容的固定提交、许可、为何不跟 main、再生成与校验命令。
- [故事世界完整计划](STORY_WORLDS_PLAN.md)与[集成验收记录](reviews/2026-11-11-story-worlds-delivery.md)：产品范围和实际证据分开维护。
- [前端架构规范](../FRONTEND_ARCHITECTURE.md)：后续前端开发与审查标准，包含职责、依赖、状态归属、保存和兼容入口。
- [前端架构实施验收](reviews/2026-11-11-frontend-architecture-delivery.md)：S0–S6 实际交付、性能范围、已知限制和恢复单位。
- [Mantine 全站升级计划](2026-11-13-MANTINE_FRONTEND_UPGRADE_PLAN.md)：组件统一、页面分派和最终验收条件。
- [前端架构整理实施计划](FRONTEND_ARCHITECTURE_PLAN.md)：S0–S6 的工作范围、依赖、估算、验收和恢复办法；执行状态统一登记到 BACKLOG，架构验收记录放在可纳入 Git 的 `reviews/`。
- [CURRENT_STATUS.md](CURRENT_STATUS.md)：各模块当前状态、已实现能力、限制和下一步。
- [BACKLOG.md](BACKLOG.md)：待开发、待修复和文档任务的唯一人工维护清单。
- [DEFERRED_VALIDATION.md](DEFERRED_VALIDATION.md)：已经明确延后、但不能遗忘的验证工作。
- [CONTRIBUTING_LOG.md](CONTRIBUTING_LOG.md)：开发者和 Agent 更新这些文档时必须遵守的规则。
- `logs/` 保存本机阶段开发日志。随仓库维护的交付和审查记录见 [reviews/](reviews/)。
- [templates/DEVELOPMENT_LOG_TEMPLATE.md](templates/DEVELOPMENT_LOG_TEMPLATE.md)：新建阶段日志时使用的模板。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已完成 | 当前范围内已经实现，并有与风险相称的基础验证。 |
| 开发中 | 正在实现，接口或行为仍可能变化。 |
| 部分完成 | 主要骨架已经存在，但仍缺关键能力或闭环。 |
| 待开发 | 尚未开始，或只有设计和占位实现。 |
| 已暂停 | 暂时停止推进，需满足前置条件后再恢复。 |

“代码已写入”不自动等于“已完成”。没有真实环境、跨平台或大文件验证的能力，必须在状态说明中明确标注，并在需要时进入延后验收清单。

## 与其他文档的关系

- 历史《AI 媒体平台与 H3 实施计划》记录目标设计，不代表当前完成情况；当前仓库未包含该原稿，现行任务与后续安排请查看本目录的 BACKLOG 和阶段计划。
- [公共服务](../PUBLIC_SERVICES.md) 记录公共 API、身份和服务边界。
- [本地部署](../LOCAL_DEPLOYMENT.md) 与 [运维和备份](../OPERATIONS_AND_BACKUP.md) 记录运行、部署和恢复方法。
- [实验性媒体能力](../EXPERIMENTAL_MEDIA.md) 记录尚未成为稳定能力的媒体功能。

Git 提交是代码变化的事实来源；本目录负责提供面向人的状态、决策、限制和后续上下文。
