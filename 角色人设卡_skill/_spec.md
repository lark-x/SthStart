# 角色人设卡（Skill 版）· 生成规范 _spec.md

> 本文件是所有生成代理的唯一作业规范。开工前必读：本文件 + 技能原文 `.agents/skills/extract-character-persona/SKILL.md`。

## 1. 目标

为《原神》所有重要角色（自机角色、剧情角色、NPC）各生成一张 **skill 体例**人设卡（7 节结构，含证据溯源与防复读范例）。范围：**尽可能全**——凡库内有台词、有姓名、有文本证据的角色都收。

## 2. 数据源

- MCP：`gamesmcp`，`game_id = e9cc55e6-466a-4bfa-b73a-be229946d0ff`（原神）
- revision：`282b3fc2-26c9-4fe7-a7d8-8d811a10cd00`（r18 / AnimeGameData 7.1.0）
- **所有 search 调用必须带 `game_id`**，否则报 `game_id_required`。

## 3. 工具适配（关键差异）

本会话 MCP 的主力工具是 `search`。**实测更新（枫丹批次报告）**：`get_character` 与 `resolve_entity` **在部分代理会话中实际可调用**——若你的工具列表里有，优先用它们拿星级/武器/canonical 名（证据更硬）；`get_entity_texts` 与 `get_relationships` **返回空绑定，等同不可用**。只有 `search` 可用时，用以下等效配方：

| 技能步骤 | 等效配方 |
|---|---|
| Step1 实体对齐 | `search(query=角色名, type="structured", limit=5)` → 找 title 与角色名完全一致、`structuredKind=="character"` 的命中，确认 canonical 名与 `stableId`（形如 `genshin:character:10000003`） |
| Step2 基础档案 | 同一命中的 `excerpt` 即官方 description 原文（星级/武器库内检索不到就写「库内未检索到」，可查 `genshin:material:1XXX` 双胞胎记录辅助） |
| Step3 故事/语音 | `search(query=角色名, type="structured", limit=10~15)` → `stableId` 前缀 `genshin:voice:*` 的命中即该角色语音/故事切片（stableId 中 `voice:1000XXXX/` 的 XXXX 即角色 ID） |
| Step4 关系网络 | `search(query="关于"+角色名, type="structured", limit=10)` 取他人对该角色的评价；再用 `search(query=角色名, type="structured")` 看双向提及 |
| Step5 剧情台词 | `search(query=角色名, type="dialogue", limit=10)` → 带 `speaker`/`questKey`/`documentId` 的原生剧情台词；可换 query 变体（如角色名+地点、+剧情人物）补样 |
| 高效补充 | **`get_quest(quest_id, node_limit)` 实际可用**（不在旧工具契约里但一直存在）：一次取回整段任务原文（speakerName+segmentId），是剧情台词取证最快通道，优先使用 |

- `search` 的 type 取值：`all / dialogue / quest / document / item / mechanism / structured`；可选参数 `speaker`、`quest`、`limit`(≤50)、`locale`。
- NPC 常没有 `structuredKind=="character"` 命中：以 `type="dialogue"` 中 `speaker==角色名` 的台词为主要证据，`type="structured"`/`type="document"` 补背景；档案节据实写「库内无 character 记录」。

## 4. 输出规范

- 路径：`角色人设卡_skill/{类别}/{角色名}.md`
- 类别目录（三选一）：
  - `自机角色/` —— 卡池角色（含旅行者、派蒙）
  - `剧情角色/` —— 主线/传说/活动剧情关键人物（七神、愚人众、深渊教团、重要剧情人物等）
  - `NPC/` —— 有姓名有台词的普通 NPC
- 文件名 = canonical 角色名（去掉 `〈〉`、空格、斜杠；同名不同人加后缀区分，如 `NPC/某某(蒙德).md`）
- 文件内容 = 技能第四节模板**完整 7 节**，H1 为 `# 角色人设卡：{角色名}`。模板原文见 SKILL.md 第四节，核心结构：

```markdown
# 角色人设卡：{{char_name}}

## 1. 核心档案与身份锚点 (Core Profile)
- **游戏世界**：原神
- **官方全称/称号**：…
- **核心动机 (Prime Motivation)**：…
- **世界观立场**：…

## 2. 心理机制与性格光谱 (Psychology & Vulnerability)
- **社交表象 (Social Facade)**：…
- **防御机制与内在软肋 (Vulnerability)**：…
- **性格缺陷与偏执点 (Character Flaws)**：…

## 3. 认知边界与知识盲区 (Cognitive Boundaries)
- **专精认知领域**：…
- **绝对盲区**：…
- **面对未知概念的反应模型**：…

## 4. 社交图谱与态度矩阵 (Relationship Matrix)
- **对 [核心人物 A]**：…
- **对 [核心人物 B]**：…
- **对用户 ({{user}}) 的初始态度**：…

## 5. 语言语流与动作习惯 (Voice & Mannerisms)
- **语流节奏**：…
- **下意识小动作**：…
- **描写规范**：…

## 6. 防复读黄金对话范例 (Dialogue Examples - Style Only)
<START>
{{user}}: [日常闲聊]
{{char}}: [日常基调]
<START>
{{user}}: [冒犯/质疑原则]
{{char}}: [防御反击]
<START>
{{user}}: [善意/触及软肋]
{{char}}: [别扭松动]

## 7. 证据溯源索引 (Evidence Citations)
- **关键参考文本**：[questKey / stableId / documentId 列表]
```

## 5. 质量红线

1. **证据先行**：每条性格、关系、台词推导必须附出处（`quest/XXXX`、`genshin:voice:…`、`documentId`、`stableId`）。无证据的字段写「库内未检索到」，**严禁编造台词、出处或二创设定**。
2. **表里张力**：第 2 节必须写清防御机制与软肋，禁止只贴扁平标签。
3. **认知边界**：第 3 节必须写清角色「不知道什么」及面对未知概念的反应模型。
4. **防复读范例**：第 6 节三段 `<START>` 缺一不可；重节奏轻道具，禁止直接复用检索到的原句。
5. **调用量**：每个角色至少 2 次 search（structured + dialogue）；重要角色 3~4 次不同 query。
6. **篇幅**：单卡一般 1500~3500 字，信息密度优先，不灌水。

## 6. 完成后返回报告（给主 agent 的最终文本）

```
已生成:
- 角色人设卡_skill/自机角色/某某.md
- …
未命中/证据不足: [名字 + 原因]
新发现候选角色: [名字 + 发现来源（哪个 quest/voice/achievement）]
```

## 7. 禁止事项

- 禁止修改本规范文件、技能文件、旧库 `角色人设卡/` 下任何文件；
- 禁止一次性把全部卡片塞进一个文件；
- 禁止在没有 search 证据的情况下凭记忆写「代表台词」（认知性通识可以写，但须在第 7 节标注为通识推断）。
