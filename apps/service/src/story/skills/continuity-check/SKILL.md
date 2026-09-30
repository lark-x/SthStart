---
name: continuity-check
description: 在 SthStart 剧情文本中检查时间线、人物知识、动机、世界规则和伏笔是否一致时使用；不用于代码一致性或数据库完整性检查。
---

# 剧情连贯性检查

## 获取依据

先使用用户给出的文本。需要项目资料且 Story MCP 可用时确认当前项目，用 `search_entries` 与 `read_entry` 查询相关大纲、世界观、角色和场景；旧版按实际可用的 `story_search`、`story_get_outline`、`story_get_world`、`story_get_character`、`story_get_scene` 读取。搜索摘录不是全文，正文截断或相关结果未读完时按返回分页信息补读。无 MCP 时标明文本范围和待补资料，不把未找到资料当作矛盾。

## 判断与输出

先列确定的冲突，再列待核实疑点；区别叙述角度差异、不可靠叙述、刻意悬念与真正冲突。每项说明涉及条目名称、ID 和可用的 revision 或原文位置、证据、影响，以及最小修复建议。用户只提供文本时使用段落或引文定位，不编造项目 ID。

重点核对事件先后、人物当时掌握的信息、选择动机、世界规则与伏笔兑现。优先修复局部，不因一个疑点改写整部作品。

## 修改边界

检查报告不自动写入项目。用户要求修复并提交提案时，逐个读取实际目标和当前 revision，使用原生 `submit_proposal` 的更新字段：`operation: update`、对应 `kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`；旧版使用实际存在的 `story_propose_<kind>_change`。不把检查报告当作正式正文写入，不自动接受提案。没有写入工具时交付可审阅的修改文本，并说明未提交；已授权的草稿或提案不重复确认。
