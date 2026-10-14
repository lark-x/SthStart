---
name: story-creative-suite
description: 在 SthStart 剧情创作中提供一体化创作套件：涵盖主线大纲规划、人物深度塑造、具体场景编写、小说转剧本流适配（StoryCompiler）以及剧情连贯性审查；遵循作者结构，统一协调创作与提案流程。
---

<!-- Generated from apps/service/src/story/skills/*. Edit the sources and run npm run skills:sync. -->

# 剧情创作一体化套件 (Story Creative Suite)

本套件整合 SthStart 剧情创作五大核心模块，遵循作者已有结构，协调剧情分析、创作、剧本流编译与版本提案全流程。

## 通用操作与提案规范

1. **资料获取与 MCP 优先**：
   - 优先使用用户提供的上下文与正文。
   - 当需要项目全局资料且 Story MCP 可用时，先确认当前项目，再使用 `list_entries`、`read_entry` 或 `search_entries`；当返回内容截断或有分页时补读。无 MCP 时在文本范围内展开，注明正式资料缺口。
2. **事实、推测与建议分层**：
   - 严格区分已有设定事实、合理推测与脑暴修改建议。不捏造未提供的条目或 ID。
3. **提案边界与作者主权**：
   - 分析、审查和草稿预览绝不自动提交提案，更不自动覆盖正文。
   - 仅在用户明确要求提交时，读取目标真实 ID 与 revision，调用 `submit_proposal`。说明提案待作者审阅。已授权的内容不反复弹窗确认。

---

## 模块一：主线大纲规划 (Story Outline)

<!-- Source: apps/service/src/story/skills/story-outline/SKILL.md -->

### 获取资料与组织剧情

优先使用用户提供的概要与大纲。需要项目资料且 Story MCP 可用时确认当前项目，再用 `list_entries`、`read_entry` 和必要的 `search_entries` 读取大纲、角色和世界设定；旧版使用实际提供的 `story_get_project`、`story_get_outline` 等。根据返回的分页和截断信息补读相关内容；无 MCP 时基于已有材料工作，标注正式资料缺口。

区分既定事实、推测和脑暴建议。明确主角目标、阻力、选择代价、推进事件、关键转折与结局兑现；采用用户已有的分卷、章节或阶段结构。只有任务需要时才使用三幕式等模板，不为结构整齐添加违背正式设定的事件。

### 输出与修改

按任务交付大纲、问题分析或候选方案。候选方案说明关键取舍；已有设定冲突先指出依据。用户已指定方向时直接展开，不要求其反复选择。

分析和预览不自动提交提案。用户要求提交时读取正式大纲的 ID 和当前 revision，原生 `submit_proposal` 使用 `operation: update`、`kind: outline`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`；大纲不支持 create。旧版使用实际提供的 `story_propose_outline_change`。没有目标或工具时提供草稿并说明未提交，不编造 ID。提案仍待作者审阅，不自动接受或宣称正式大纲已修改；已授权的草稿与提案不重复确认。

---

## 模块二：人物深度塑造 (Character Design)

<!-- Source: apps/service/src/story/skills/character-design/SKILL.md -->

### 资料与判断

优先使用用户给出的文本。需要项目设定且 Story MCP 可用时，确认当前项目，再读取相关角色、大纲与场景；根据实际工具选择 `get_project`、`search_entries`、`read_entry`，或旧版 `story_get_project`、`story_get_character`、`story_get_outline` 等。分页或正文截断时按返回信息补读与任务相关的内容，不把搜索摘录当完整设定。MCP 未连接时仍可分析现有文本，并注明资料缺口。

将已确认设定、推测和新增建议分开。检查外在目标、内在需要、行动障碍、选择代价、关系张力和成长变化，用具体行为与场景说明，不堆砌性格形容词。对白不能泄露角色尚不知道的信息。

### 输出与写入

按用户需要给出人物分析或候选设定，重点包含目标与矛盾、关键关系、说话方式和可用于场景的行为例子。修改建议说明原依据、建议和理由；缺少原资料时不伪造设定或条目来源。

分析或预览不自动提交提案。用户明确要求提交时，先读目标取得真实 ID 与 revision；原生 `submit_proposal` 使用 `operation`、`kind: character`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`，更新使用当前版本，新建时 ID 与版本为 null。旧版只能使用实际提供的 `story_propose_character_change` 更新既有角色。提交后说明仍待作者审阅，不自动接受或覆盖正式内容；已授权的草稿和提案无需重复确认。

---

## 模块三：场景与对白写作 (Scene Writing)

<!-- Source: apps/service/src/story/skills/scene-writing/SKILL.md -->

### 上下文与创作

先读用户提供的文本、目标和篇幅要求。需要项目上下文且 Story MCP 可用时确认项目，读取相关场景、角色和大纲，使用实际提供的 `get_project`、`search_entries`、`read_entry` 或旧版 `story_get_project`、`story_get_scene`、`story_get_character`、`story_get_outline`。相关正文截断或分页未读完时补读；无 MCP 不阻断文本创作，但注明缺少的正式设定。

明确入场目标、阻碍、行动、主要转折与离场状态，服从作品既有风格和用户指定结构。对白符合人物知识、关系和语气，不让人物替作者集中解释设定。延续既有事实；新加的关系、道具或世界规则作为候选写法说明，不假称原作已有。

### 产物与提案

正文与分析、修改说明分开。审查场景时给出依据和局部修复，创作时交付完整且可使用的场景文本，不强制每场都采用相同节奏或长度。

预览不自动提交提案。用户要求提交时读取对应目标的 ID 与 revision，原生 `submit_proposal` 明确 `operation`、`kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`，按目标选择 scene 或 chapter；更新使用当前版本，新建时 ID 与版本为 null。旧版 `story_propose_scene_change` 仅更新现有场景，不能假设支持章节新建。提案待作者审阅，不自动接受或覆盖正式场景；已授权的草稿与提案不重复确认。

---

## 模块四：小说转剧本流与解析器适配 (Scene Flow & StoryCompiler)

<!-- Source: apps/service/src/story/skills/story-scene-flow/SKILL.md -->

### 原文与改编范围

优先使用用户提供的正文。需要项目文本且 Story MCP 可用时确认项目，用 `list_entries`、`read_entry` 或 `search_entries` 定位并读取目标章节或大纲；旧版按实际工具读取场景与大纲。相关文本有分页或截断时补读。无 MCP 可以转换用户文本，不能声称已读取未提供的章节。

保留事件顺序、角色知识与说话方式。根据大纲补出的细节标为改编建议；心理活动不能直接变成已发生的行动或对白，需要可视化改编时明确说明。

### 适配现有解析器

解析依据为项目根目录下 `apps/service/src/story/compiler.ts`。待编译正文采用以下格式：

```text
##### 场景：离岛港口 - 夜

旅行者望向海面。

派蒙（轻笑）：我们走吧。
```

- 标题只用于场景地点与时间；当前解析器把以 `#`、`【`、`[` 开头的行都当作场景标题。
- 每行一条角色对白，使用 `角色名：对白` 或 `角色名（情绪）：对白`；角色名加情绪前缀需简短，现有显式对白解析上限为 16 个字符。动作另起普通叙述行。
- 不输出独立的 `[微笑]` 标签，不在待编译正文里写 `登场角色：……`、分析标题、Markdown 项目列表或围栏标记，以免误解析。
- 普通叙述中避免用中文引号模拟标签或心理独白，解析器可能将其当对白。叙述保持普通句子，不能靠标记承诺解析器尚不支持的镜头指令。
- 人物清单、来源和改编说明放在编译正文之外，并明确标出可复制的正文范围。

现有角色列表主要从已识别的对白提取，纯动作中的人物不一定被识别。预览后提醒核对角色映射，不能为登记人物而编造对白，也不承诺自动补齐所有登场角色。

### 提案边界

整理或预览不自动提交。用户明确要求提交时先读取现有目标及 revision，使用原生 `submit_proposal` 的 `operation`、对应 scene 或 chapter 的 `kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`；更新需当前版本，新建时 ID 与版本为 null。旧版只在确有工具和现有场景时使用 `story_propose_scene_change`。提案正文仅包含待编译文本，说明放在 reason 或回复中；不自动接受提案，不宣称活动、图片或视频已经生成。

---

## 模块五：剧情连贯性与逻辑审查 (Continuity Check)

<!-- Source: apps/service/src/story/skills/continuity-check/SKILL.md -->

### 获取依据

先使用用户给出的文本。需要项目资料且 Story MCP 可用时确认当前项目，用 `search_entries` 与 `read_entry` 查询相关大纲、世界观、角色和场景；旧版按实际可用的 `story_search`、`story_get_outline`、`story_get_world`、`story_get_character`、`story_get_scene` 读取。搜索摘录不是全文，正文截断或相关结果未读完时按返回分页信息补读。无 MCP 时标明文本范围和待补资料，不把未找到资料当作矛盾。

### 判断与输出

先列确定的冲突，再列待核实疑点；区别叙述角度差异、不可靠叙述、刻意悬念与真正冲突。每项说明涉及条目名称、ID 和可用的 revision 或原文位置、证据、影响，以及最小修复建议。用户只提供文本时使用段落或引文定位，不编造项目 ID。

重点核对事件先后、人物当时掌握的信息、选择动机、世界规则与伏笔兑现。优先修复局部，不因一个疑点改写整部作品。

### 修改边界

检查报告不自动写入项目。用户要求修复并提交提案时，逐个读取实际目标和当前 revision，使用原生 `submit_proposal` 的更新字段：`operation: update`、对应 `kind`、`targetId`、`baseRevision`、`proposedTitle`、`proposedBody`、`reason`；旧版使用实际存在的 `story_propose_<kind>_change`。不把检查报告当作正式正文写入，不自动接受提案。没有写入工具时交付可审阅的修改文本，并说明未提交；已授权的草稿或提案不重复确认。
