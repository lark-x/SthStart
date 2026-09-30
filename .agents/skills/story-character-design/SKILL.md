---
name: story-character-design
description: 在 SthStart 剧情创作中设计或审查人物目标、内在需求、关系、说话方式与成长弧时使用；不用于角色库 API 或导入功能开发。
---

<!-- Generated from apps/service/src/story/skills/character-design/SKILL.md. Edit the source and run npm run skills:sync. -->

# 人物塑造

## 资料与判断

优先使用用户给出的文本。需要项目设定且 Story MCP 可用时，确认当前项目，再读取相关角色、大纲与场景；根据实际工具选择 `get_project`、`search_entries`、`read_entry`，或旧版 `story_get_project`、`story_get_character`、`story_get_outline` 等。分页或正文截断时按返回信息补读与任务相关的内容，不把搜索摘录当完整设定。MCP 未连接时仍可分析现有文本，并注明资料缺口。

将已确认设定、推测和新增建议分开。检查外在目标、内在需要、行动障碍、选择代价、关系张力和成长变化，用具体行为与场景说明，不堆砌性格形容词。对白不能泄露角色尚不知道的信息。

## 输出与写入

按用户需要给出人物分析或候选设定，重点包含目标与矛盾、关键关系、说话方式和可用于场景的行为例子。修改建议说明原依据、建议和理由；缺少原资料时不伪造设定或条目来源。

分析或预览不自动提交提案。用户明确要求提交时，先读目标取得真实 ID 与 revision；原生 `submit_proposal` 使用 `operation`、`kind: character`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`，更新使用当前版本，新建时 ID 与版本为 null。旧版只能使用实际提供的 `story_propose_character_change` 更新既有角色。提交后说明仍待作者审阅，不自动接受或覆盖正式内容；已授权的草稿和提案无需重复确认。
