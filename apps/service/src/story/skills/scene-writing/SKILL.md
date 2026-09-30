---
name: scene-writing
description: 在 SthStart 剧情创作中编写或审查具体场景及对白时使用，关注目标、阻碍、行动、转折与人物语气；不用于前端场景组件开发。
---

# 场景写作

## 上下文与创作

先读用户提供的文本、目标和篇幅要求。需要项目上下文且 Story MCP 可用时确认项目，读取相关场景、角色和大纲，使用实际提供的 `get_project`、`search_entries`、`read_entry` 或旧版 `story_get_project`、`story_get_scene`、`story_get_character`、`story_get_outline`。相关正文截断或分页未读完时补读；无 MCP 不阻断文本创作，但注明缺少的正式设定。

明确入场目标、阻碍、行动、主要转折与离场状态，服从作品既有风格和用户指定结构。对白符合人物知识、关系和语气，不让人物替作者集中解释设定。延续既有事实；新加的关系、道具或世界规则作为候选写法说明，不假称原作已有。

## 产物与提案

正文与分析、修改说明分开。审查场景时给出依据和局部修复，创作时交付完整且可使用的场景文本，不强制每场都采用相同节奏或长度。

预览不自动提交提案。用户要求提交时读取对应目标的 ID 与 revision，原生 `submit_proposal` 明确 `operation`、`kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`，按目标选择 scene 或 chapter；更新使用当前版本，新建时 ID 与版本为 null。旧版 `story_propose_scene_change` 仅更新现有场景，不能假设支持章节新建。提案待作者审阅，不自动接受或覆盖正式场景；已授权的草稿与提案不重复确认。
