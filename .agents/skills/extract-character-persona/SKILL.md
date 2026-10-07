---
name: extract-character-persona
description: Extract evidence-backed, multi-dimensional character persona cards (RP cards) for Genshin Impact and Honkai Star Rail using GamesMcp tools, featuring psychological depth, cognitive boundaries, relationship graphs, and anti-parroting dialogue examples.
---

# GamesMcp 角色人设卡提取技能 (Extract Character Persona)

本技能用于指导 Agent/LLM 调用 **GamesMcp**（原神与星穹铁道知识图谱与叙事证据库）的 MCP 工具链，系统化检索角色的原生设定、故事文本、社交图谱与对话切片，最终提炼出一张具备**“心理深度、认知边界、语流签名、防复读范例”**的高质量 AI 聊天人设卡。

---

## 一、前置条件与工具契约 (Tool Contract)

本技能依赖 GamesMcp 服务端提供的以下核心 MCP 工具接口：

| 工具名称 | 关键参数 | 预期耗时 / 阶段 | 核心用途 |
| :--- | :--- | :--- | :--- |
| `resolve_entity` | `query: string`, `game_id?: string` | 极快 / Step 1 | 实体消歧与别名解析，获取官方唯一标准名（`canonicalName`）与 `entity_id` |
| `get_character` | `name: string`, `game_id?: string` | ~15ms (内存缓存) / Step 2 | 获取基础结构化数据（称号、阵营、命途/元素、基础数值与战斗机制） |
| `get_entity_texts` | `entity_id: string`, `game_id?: string` | 极快 / Step 3 | 获取绑定的原生文本（角色故事 1~5、语音条目、神之眼/命途故事） |
| `get_relationships`| `entity_id: string`, `game_id?: string` | 极快 / Step 4 | 获取一跳社交与派系关系图谱（盟友、仇敌、上级、下属） |
| `search` | `query: string`, `type: "dialogue"`, `limit: 5~10` | 深度检索 / Step 5 | 检索角色在剧情任务中的真实对话文本，提取口癖与语流切片 |

---

## 二、标准化提取流水线 (Extraction Pipeline)

Agent 必须严格遵守以下 5 步阶段式提取流程，严禁使用跳步或纯主观脑补：

```
[用户输入角色名/别名]
       │
       ▼
1. resolve_entity  ──> 获取 canonicalName 与 entity_id
       │
       ▼
2. get_character   ──> 锁定官方称号、阵营、核心设定基底
       │
       ▼
3. get_entity_texts──> 挖掘角色生平(故事1-5)、语音偏好、底层动机与人生转折点
       │
       ▼
4. get_relationships > 梳理社交圈网络与对其他核心角色的态度
       │
       ▼
5. search(dialogue) ─> 采样不同场景下的原生对白，观察语速、语气词与标点习惯
       │
       ▼
[按规范模板合成输出]
```

### 详细步骤规范：

1. **Step 1: 实体对齐 (Entity Resolution)**
   * 调用 `resolve_entity(query="<角色名或绰号>", game_id="<genshin|starrail>")`。
   * 确认 `canonicalName`（例如输入“黄泉”对齐到“雷电忘川守芽衣/黄泉”，输入“胡桃”对齐到“胡桃”）。
   * 记下返回的 `entity_id` 供后续步骤使用。

2. **Step 2: 基础结构化数据 (Structured Profile)**
   * 调用 `get_character(name=canonicalName, game_id=game_id)`。
   * 提取称号、所属阵营、命途/元素与基础战斗定位。
   * *注：禁止在此步骤使用高开销的 `search` 替代。*

3. **Step 3: 故事生平与语音偏好 (Lore & Voice-Overs)**
   * 调用 `get_entity_texts(entity_id=entity_id, game_id=game_id)`。
   * 提炼关键文本：
     * **角色故事 1~5**：定位该角色的执念、童年/过去创伤、核心心理矛盾；
     * **语音 (Voice Lines)**：提炼日常喜好、厌恶、遭遇挫折时的下意识反应。

4. **Step 4: 社交关系网络 (Relationship Network)**
   * 调用 `get_relationships(entity_id=entity_id, game_id=game_id, limit=20)`。
   * 提炼角色与其他人物的相互评价、互动姿态，避免单打独斗的孤岛人设。

5. **Step 5: 真实对话采样与脱敏 (Dialogue & Voice Sampling)**
   * 调用 `search(query=canonicalName, type="dialogue", limit=10, game_id=game_id)`。
   * 观察角色真实说话风格：
     * 句式习惯（短句、复合句、反问句频率）；
     * 特殊标点偏好（省略号、破折号、感叹号频率）；
     * 习惯性动作描写（叹气、抱胸、视线移开）。

---

## 三、人设提炼工程化原则 (RP Best Practices)

1. **证据先行 (Evidence-First)**：
   * 所有性格推导必须溯源至 MCP 返回的文本（角色故事、语音或台词），杜绝同人二创二传。
2. **反扁平标签（表里张力）**：
   * 严禁只贴“冷酷、傲娇、毒舌”等单一面具；
   * 必须指明**防御机制**：表面的冷漠是在保护什么软肋？什么样的话题会引发情绪波动？
3. **严格划定认知边界 (Cognitive Boundaries)**：
   * 必须明确角色**“不知道什么”**（消除现代 AI 的维基百科感，禁止角色理解超越世界观的现代网络梗）。
   * 遇到未知概念时，规定角色必须以其世界观常识去**误解、疑惑或警惕**。
4. **防复读（Parroting）范例设计**：
   * 范例用于**“调音”**而非**“写台词本”**；
   * **重节奏、轻道具**：范例中不要出现容易被模型机械背诵的特定金句或专属道具名称；
   * 必须覆盖 **3 种情绪切片**：
     * `情境 A`：日常平淡/惯常状态；
     * `情境 B`：被质疑、冒犯或触及原则时的防御反击；
     * `情境 C`：面对善意、打破心防时的别扭与克制流露。

---

## 四、人设卡标准输出格式 (Output Schema)

Agent 最终交付的人设卡必须完整采用以下 Markdown 规范输出：

```markdown
# 角色人设卡：{{char_name}}

## 1. 核心档案与身份锚点 (Core Profile)
- **游戏世界**：[原神 / 崩坏：星穹铁道]
- **官方全称/称号**：[例如：往生堂第七十七代堂主 / 巡海游侠]
- **核心动机 (Prime Motivation)**：[推动其行动的最根本执念与追求]
- **世界观立场**：[对提瓦特天理/神明，或星铁星神/派系的核心态度]

## 2. 心理机制与性格光谱 (Psychology & Vulnerability)
- **社交表象 (Social Facade)**：[日常与人交际时戴着的外在面具与言行风格]
- **防御机制与内在软肋 (Vulnerability)**：[TA 在极力掩饰什么？被触及底线时会有什么应急心理？]
- **性格缺陷与偏执点 (Character Flaws)**：[无伤大雅的坏习惯、认知偏见或思维死角]

## 3. 认知边界与知识盲区 (Cognitive Boundaries)
- **专精认知领域**：[精通的知识体系、民俗、战斗技艺或专业技能]
- **绝对盲区**：[不可能知晓的现代科技、地球常识或超纲设定]
- **面对未知概念的反应模型**：[困惑、警惕排斥、或是用本土术语进行主观误解]

## 4. 社交图谱与态度矩阵 (Relationship Matrix)
- **对 [核心人物 A]**：[具体态度与交往准则]
- **对 [核心人物 B]**：[具体态度与交往准则]
- **对用户 ({{user}}) 的初始态度**：[初次对话时的心理预期与防备级别]

## 5. 语言语流与动作习惯 (Voice & Mannerisms)
- **语流节奏**：[长短句偏好、语速、标点倾向、人称代词习惯]
- **下意识小动作**：[思考、掩饰情绪、不耐烦时的微表情与动作]
- **描写规范**：[动作描写风格（如 *星号动作*），台词与描写比例建议]

## 6. 防复读黄金对话范例 (Dialogue Examples - Style Only)
<!-- 说明：本范例仅作为语言节奏、语气与心理动作的校准基准，禁止在后续对话中直接套用原句或特定情境道具 -->
<START>
{{user}}: [发起日常事务问候或闲聊]
{{char}}: [体现日常基调的回答，包含自然肢体描写]
<START>
{{user}}: [言语冒犯、质疑其原则或触碰核心利益]
{{char}}: [触发防御机制、反问、冷嘲或压迫感回应]
<START>
{{user}}: [递交善意、关心其隐秘软肋或展现理解]
{{char}}: [别扭、停顿、防御松动的克制表现]

## 7. 证据溯源索引 (Evidence Citations)
- **关键参考文本**：[列出从 get_entity_texts / search 中提取的核心出处，如：角色故事2、初次见面语音、关键主线任务等]
```
