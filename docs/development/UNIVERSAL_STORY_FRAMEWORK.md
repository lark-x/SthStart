# 故事通用主体框架（7-Layer Universal Story Body Framework）

本文档总结自《原神》与《崩坏：星穹铁道》两部大型长篇作品的真实故事主体建设实践，并结合叙事智能体与交互式小说开源工程的核心方法论，形成可在 SthStart 中直接复用的统一蓝图结构。

## 1. 学术与高星开源依据

| 方法/项目 | 核心思想 | 在 SthStart 通用框架中的落点 |
|---|---|---|
| **DOME** (`arXiv:2412.13575`) | 规范化事实库与动态状态追踪分离，避免幻觉回写正史 | `worldDefinition.lockedFacts` + `sources[].nature` (`canon`/`author`) + `StoryWorld` 分支隔离 |
| **DEL-ToM** (`arXiv:2505.17348`, ACL 2025) | 显式划分信息边界与人物认知局限，避免全知串台 | `actors[].goals` / `background`、`characterVoices[].taboos` 与分段上下文检索 |
| **DOC** (ACL 2023) & **Re3** (`arXiv:2210.06774`, EMNLP 2022) | 大纲分层约束 + 一致性重写，降低长篇跑偏 | `initialBranch` + `storyLines` + `storyProject.outlineBody` |
| **Dramatron** (CHI 2023) & **Agents' Room** (`arXiv:2410.02603`, ICLR 2025) | Logline → 角色表 → 地点舞台 → 场景节拍的结构化分工 | `StoryBodyPackSchema` 的分层结构与 `CreativeOrchestration` 多角色协同 |
| **SillyTavern Lorebooks / Dialogue Banks** | 关键词触发式世界书条目 + 少量典型示范句防“复读” | `openThreads`（`【触发词：...】`）配合 `activateLoreEntries` 按需激活，`dialogueExamples` 锚定声纹 |
| **NovelCrafter Codex** & **`AI_NovelGenerator`** | 反腔调（Anti-Slop）禁词表与文风样张独立治理；设定与镜头解耦 | `styleGuide`（`tone`、`bannedCliches`、`styleSample`、`pacingHint`）与 `visualReferences` |

## 2. 七层通用故事主体结构

| 层级 | 模块定位 | 《原神》对照实例 | 《崩坏：星穹铁道》对照实例 | 对应契约字段 |
|---|---|---|---|---|
| **L1 作品与时间窗锚定** | 明确作品归属、`canon-gap`/`adaptation` 切入窗口与时间刻度，禁止后世剧透越权写入 | 纳塔战后至挪德卡莱/至冬前夕间隙；提瓦特七国并行态 | 匹诺康尼庆典后、翁法罗斯远航间隙；车厢与中继站并行 | `work` / `worldDefinition.workNature` / `timeLabel` / `startMinuteOfDay` |
| **L2 世界本体与硬约束** | 定义力量代价、最高因果律与不可篡改条文，并标注证据来源级别 | 天理、神之心、降临者、地脉/世界树信息闭环；11 份 `canon` 来源 | 星神—命途—令使—星核/忆质机制与代价；13 份 `canon` 来源 | `worldDefinition.lockedFacts` / `worldDefinition.sources` |
| **L3 空间舞台与视觉母题** | 以“中立交汇点 + 势力腹地”组成可调度舞台，规范材质、光影与道具锚点 | 蒙德天使的馈赠、璃月往生堂与三碗不过港、枫丹廷歌剧院等 10 处舞台 | 观景车厢、黑塔空间站、长乐天、黄金的时刻等 11 处舞台 | `worldDefinition.locations` / `visualReferences` / `visualStyle` |
| **L4 角色库与在场演员图** | 将跨版本稳定的“权威角色档案”与“当前分支在场演员状态”分离并版本锁定 | 9 位核心角色档案 + 冻结版本 + 在场目标/驻地映射 | 8 位核心角色档案 + 冻结版本 + 星穹列车/星核猎手站位 | `characters` → `character_profiles` & `character_versions`；`worldDefinition.actors` |
| **L5 分支主旨与多线冲突** | 用主线、暗流、日常烟火三条以上互补线驱动叙事，避免单线脸谱化 | 降临者与神之心、地脉旧伤与人性制度、市井日常锚点 3 条线 | 星核追踪与脚本、长生/忆质与秩序反响、车厢停靠日常 3 条线 | `initialBranch` + `storyLines` |
| **L6 触发式伏笔账本** | 将未揭晓之谜封装为带触发词的条件挂钩，只在相关性命中的场景浮现 | 派蒙真身、火神之心下落等 5 条 `【触发词：...】` 伏笔 | 三月七六相冰、艾利欧脚本等 7 条 `【触发词：...】` 伏笔 | `openThreads` → `src_open_threads_ledger` + `story_documents('world')` |
| **L7 声纹规范与项目落地** | 把去 AI 味禁用词、文风样张与角色口癖约束持久化为工作台作用域策略，并绑定小说项目 | `原神 · 提瓦特间隙志` 项目 + 9 组 `characterVoices` | `星穹铁道 · 银河停靠手记` 项目 + 8 组 `characterVoices` | `styleGuide` + `characterVoices` + `storyProject` → `co_scope_policies` & `story_projects` |

## 3. 四层收敛模型与 Novelcrafter 风格工作台布局

在作者与编辑的实际使用视角中，上述七层底层数据结构收敛为**四层主心智模型**，并映射到 Novelcrafter 风格的作品工作台（[workspace.tsx](file:///f:/Project/SthStart/app/features/story-worlds/workspace.tsx)）：

1. **L1 作品（Work）**：宏观世界观、常驻硬法则（`lockedFacts`）、地域分层（`regions -> locations`）、阵营与角色档案（`factions -> actors -> character_profiles`）以及 Anti-Slop 文风治理（`styleGuide`）。
2. **L2 篇章 / 任务线（Arc / Quest）**：扩展 `WorldStoryLine`（`sw_story_lines`）承载 `arcKind`（`main` / `quest` / `companion` / `side`）、`timeWindowLabel` 与 5–10 人核心阵容，允许跨篇时间跳跃。
3. **L3 章节 / 场景（Chapter / Scene）**：前台主交付与阅读单元，直接打通 `StoryProject`（`story_documents('outline' | 'chapter' | 'scene')`）与 AI 创作工作台（`/apps/ai-studio`）。
4. **L4 事件与记忆账本（Events / Facts / Foreshadowing）**：退居幕后并收录入工作台「引擎账本」视图，持续承担 ToM 知情隔离检查、平行分支历史隔离、伏笔触发与原有分钟级 `StoryWorldFlow` 调试轨迹。

## 4. 代码复用入口与导入工具


- **契约与空模板工厂**：[story-blueprint.ts](file:///f:/Project/SthStart/packages/contracts/src/story-blueprint.ts)（导出 `StoryBodyPackSchema` 与 `createUniversalStoryBlueprintTemplate(workName)`）
- **事务性幂等导入器**：[blueprint.ts](file:///f:/Project/SthStart/apps/service/src/creative-orchestration/blueprint.ts)（导出 `importStoryBodyPack(database, rawPack, options?)`）
- **命令行导入脚本**：[import-story-pack.ts](file:///f:/Project/SthStart/scripts/import-story-pack.ts)
  - 仅校验格式：`node --import tsx scripts/import-story-pack.ts --dry-run <pack.json>`
  - 导入本地库：`node --import tsx scripts/import-story-pack.ts <pack.json>`
