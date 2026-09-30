---
name: story-outline
description: 在 SthStart 剧情创作中设计或审查主线大纲、冲突推进、转折、高潮与收束时使用；遵循作者已有结构，不强制套用三幕式。
---

<!-- Generated from apps/service/src/story/skills/story-outline/SKILL.md. Edit the source and run npm run skills:sync. -->

# 剧情大纲

## 获取资料与组织剧情

优先使用用户提供的概要与大纲。需要项目资料且 Story MCP 可用时确认当前项目，再用 `list_entries`、`read_entry` 和必要的 `search_entries` 读取大纲、角色和世界设定；旧版使用实际提供的 `story_get_project`、`story_get_outline` 等。根据返回的分页和截断信息补读相关内容；无 MCP 时基于已有材料工作，标注正式资料缺口。

区分既定事实、推测和脑暴建议。明确主角目标、阻力、选择代价、推进事件、关键转折与结局兑现；采用用户已有的分卷、章节或阶段结构。只有任务需要时才使用三幕式等模板，不为结构整齐添加违背正式设定的事件。

## 输出与修改

按任务交付大纲、问题分析或候选方案。候选方案说明关键取舍；已有设定冲突先指出依据。用户已指定方向时直接展开，不要求其反复选择。

分析和预览不自动提交提案。用户要求提交时读取正式大纲的 ID 和当前 revision，原生 `submit_proposal` 使用 `operation: update`、`kind: outline`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`；大纲不支持 create。旧版使用实际提供的 `story_propose_outline_change`。没有目标或工具时提供草稿并说明未提交，不编造 ID。提案仍待作者审阅，不自动接受或宣称正式大纲已修改；已授权的草稿与提案不重复确认。
