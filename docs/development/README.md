# SthStart 开发记录

本目录是 SthStart 的长期开发状态入口。它补充 Git 提交历史和功能文档，用于回答三个问题：当前已经有什么、接下来要做什么、哪些验证被明确留到后续阶段。

首版以 2026-08-27 的 `main`（`52bdf12`）为基线。此前历史不逐项重建；详细的阶段日志从此基线开始持续记录。

## 文档导航

- [CURRENT_STATUS.md](CURRENT_STATUS.md)：各模块当前状态、已实现能力、限制和下一步。
- [BACKLOG.md](BACKLOG.md)：待开发、待修复和文档任务的唯一人工维护清单。
- [DEFERRED_VALIDATION.md](DEFERRED_VALIDATION.md)：已经明确延后、但不能遗忘的验证工作。
- [CONTRIBUTING_LOG.md](CONTRIBUTING_LOG.md)：开发者和 Agent 更新这些文档时必须遵守的规则。
- [logs/](logs/)：按日期保存的阶段开发日志。
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

- [AI 媒体平台与 H3 实施计划](../../SthStart_%E4%B8%8B%E4%B8%80%E9%98%B6%E6%AE%B5_AI%E5%AA%92%E4%BD%93%E5%B9%B3%E5%8F%B0%E4%B8%8EH3%E5%AE%9E%E6%96%BD%E8%AE%A1%E5%88%92.md) 记录目标设计，不代表当前完成情况。
- [公共服务](../PUBLIC_SERVICES.md) 记录公共 API、身份和服务边界。
- [本地部署](../LOCAL_DEPLOYMENT.md) 与 [运维和备份](../OPERATIONS_AND_BACKUP.md) 记录运行、部署和恢复方法。
- [实验性媒体能力](../EXPERIMENTAL_MEDIA.md) 记录尚未成为稳定能力的媒体功能。

Git 提交是代码变化的事实来源；本目录负责提供面向人的状态、决策、限制和后续上下文。
