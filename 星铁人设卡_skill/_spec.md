# 星铁人设卡（Skill 版）· 生成规范 _spec.md

> 本文档是星铁（崩坏：星穹铁道）各生成代理的唯一作业规范。开工前必读：本文件 + 技能原文 `.agents/skills/extract-character-persona/SKILL.md`。
> 打法与原神版完全一致，差异仅在本文件的 game_id / ID 前缀 / 任务键格式。原神侧全套经验见 `_CONTEXT_COMPRESSION.md` 与 `角色人设卡_skill/_spec.md`。

## 1. 目标

为《崩坏：星穹铁道》所有重要角色（自机角色、剧情角色、NPC）各生成一张 skill 体例人设卡（7 节结构，含证据溯源与防复读范例）。范围：**尽可能全**——凡库内有台词、有姓名、有文本证据的角色都收。

## 2. 数据源

- MCP：`gamesmcp`，**`game_id = df3eb8fb-7a5c-431d-9f54-5db451f0cdd2`**（崩坏：星穹铁道，slug `honkai-star-rail`）
- revision：`df3eb8fb-7a5c-431d-9f54-5db451f0cdd6`（currentRevision，已验证）
- **所有 search 调用必须带 `game_id`**，否则报 `game_id_required`。

## 3. 与原神的关键差异（实测）

| 项 | 星铁 |
|---|---|
| 角色 stableId | **`sr_char_1001`** 形式（如三月七=sr_char_1001 与 sr_char_1224 双记录） |
| 其他 stableId 前缀 | material **无前缀**（`material_150100`）、achievement=`sr_ach_*`、enemy=`sr_enemy_*`（多形态变体）、voice/其他待批次实测补充 |
| 任务键 | **`mission/XXXXXXX`**（如 mission/1030201；**不是 quest/**）；引用写作 `mission/1030201` |
| 无 character 记录的说话人 | 帕姆（列车长）即为实例——同原神派蒙方案：以 type=dialogue speaker 台词成卡，第 1 节据实标注 |
| 语音条目 | **structured 无 voice 类命中**（探针「关于三月七」只回两条 character 记录，与原神 `genshin:voice:*` 模式不同）——**语音级证据改用 dialogue 的 mission 节点 + document 分段引用**，不再期待 voice stableId |
| 弱角色结构记录 | structured 里另有 npc 类条目，核验方式同原神 |
| 其余结构 | dialogue（speaker/questKey/documentId/dialogueNodeKey/citation）、document、item、mechanism、quest 各 type 均同原神 |

## 4. 工具配方（同原神，全部实测）

- 主力 `search`（type=dialogue/structured/document/item/quest/mechanism/all）；**单关键词最稳，多词并查易落空**；`speaker=` 过滤可试。
- ⚠️ **调用参数顺序**：本会话宿主对 search 多参调用存在发射怪癖——**必须把 `query` 放第一个参数、`game_id` 放第二个**（query 在前可稳定传输；game_id 在前会丢参报 `Required at query`）。
- `get_character`/`resolve_entity`/`get_quest`/`get_material`/`get_document` 部分会话可用（星铁侧未逐一验证，用前先小样本试）；`get_entity_texts`/`get_relationships` 在原神侧为空绑定，星铁同样预期不可用。
- 避免 `get_quest` 整篇拉取（原神侧曾致代理上下文超载失败）。
- **实测经验（车组批沉淀）**：① `speaker=` 过滤对主角无效（开拓者节点 speaker=null）——主角/无 speaker 者改走 **document 短信/群聊分段**取台词；② 多形态角色须用「名字•命途」全名调 get_character（如 开拓者•毁灭=sr_char_8001）；③ 多形态合并为一卡、形态在 §1 列明。
- **KB 缺口（匹诺康尼c 批实测）**：`get_document` 对部分 documentId（如 4240307/4240311 等 7 例）返回 document_not_found、`get_game_document` 报 game_provider_not_found——search 索引有 excerpt 但文档库无全文。**遭遇时改以 search 命中的 excerpt + 成就/阶段目标为间接证据成卡，并在 §7 标注证据等级**，不反复重试。
- **检索器实测（翁法罗斯批对照实验）**：① `speaker=` 过滤**本会话不可用**（对照实验：已知有台词角色 query="我"+speaker= 也返 0）——**勿据此判「无台词」**；② **`quest=` 过滤可用且精准**（quest=mission/XXXX 直接命中该任务台词）＝speaker 过滤的替代；③ 台词正文一般不含说话人自己名字——**用对手/身边人的特有词做 query 反查 speaker 效果最好**（如「拉莱德」「吾师」）。
- **get_document 补充坑（天才批实测）**：必须带 game_id 否则 game_id_required；对 quest/dialogue 类文档 id 常返 document_not_found（只能靠 search 摘录取证）；**两字人名的 document 全文检索可能 0 命中**——换内容关键词（如「燃素循环」）绕开。**零本台词的历史组卡**：第 5 节统一写「0 句本人台词、语流为推导」，不编造。

## 5. 输出规范

- 路径：`星铁人设卡_skill/{类别}/{角色名}.md`，类别 ∈ `自机角色` / `剧情角色` / `NPC`
- 文件内容 = 技能第四节模板**完整 7 节**，H1 为 `# 角色人设卡：{角色名}`
- 单卡 1000~2200 字（剧情核心可至 2500），7 节 + 3×`<START>` 齐备

## 6. 质量红线（原样继承）

1. **证据先行**：每条推导附出处（`mission/XXXX`、`sr_char_*`、`genshin:voice` 对应的星铁 voice stableId、documentId）；无证据写「库内未检索到」，**严禁编造台词与出处**。
2. 表里张力：第 2 节必须写防御机制与软肋，禁止扁平标签。
3. 认知边界：第 3 节写清「不知道什么」与未知概念反应模型。
4. 防复读：第 6 节三段 `<START>` 缺一不可，重节奏轻道具，禁复用检索原句。
5. **写卡前 get_character 核验**：命中 character 记录属卡池角色；NPC 批次发现转正者改写 `自机角色/` 并单列报告。
6. 取证↔写卡交替，**写完一张立即落盘**；弱证据 1 次反查无果即未命中收尾（宁可未命中不硬写）。
7. **严禁写入原神旧库 `角色人设卡/` 或原神 `角色人设卡_skill/`**；写完 Test-Path 自查路径。
8. 不能再下派子代理；不修改 `_spec.md`/`SKILL.md`/`_CONTEXT_COMPRESSION.md`。

## 7. 报告格式（同原神，第 6 节）

```
已生成: [文件路径列表]
未命中/证据不足: [名字+原因]
NPC→自机转正名单: [名字+stableId]
新发现候选角色: [名字+来源]
```
