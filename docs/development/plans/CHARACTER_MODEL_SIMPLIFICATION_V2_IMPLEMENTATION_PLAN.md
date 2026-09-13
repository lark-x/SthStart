# 人设与外观精简、编译统一及角色数据库清理实施规划

日期：2026-09-11  
状态：核心已实施（2026-09-11）。实施结果、实测证据与剩余项见
[人设与外观 V2 精简交付说明](../reviews/2026-09-11-character-persona-v2-simplification-delivery.md)。
本规划保留为实现依据，范围与约束仍然有效。
项目：SthStart，面向个人自用。  
交付对象：接手实现的开发模型。

## 1. 执行目标与范围

将现有细碎的人设字段收敛为少量自然语言内容，统一试演、活动和邻舍导出的角色语义；将稳定外貌与可替换穿着分开；清理角色媒体重复列和当前项目未接入业务的服装表。

完成后，用户主要维护四块内容：**人设正文、说话方式、基础外貌、默认穿着**。名字、作品、头像仍直接可见；对话示例、行为约束、生日、分类与来源按需编辑。

这次是数据与使用链路的整体精简，不能仅隐藏原有输入框，也不能交付另一套与旧草稿双向同步的新编辑器。

### 1.1 已确定的产品决定

1. 人设允许自由文本与小标题；合并身份、背景、性格、动机、信念、好恶及长期处境。
2. 说话方式独立；对话示例保留完整多轮文本；需要强调的行为约束独立可选。
3. 基础外貌独立于默认穿着；活动穿着覆盖默认穿着。
4. 参考图继续保存用途、裁剪和启用状态；识图仍可给逐项候选，但不要求永久维护同样多的角色字段。
5. 摘要保留为可生成、可手动修改的列表简介，不作为另一份权威人设。
6. 版本、原卡、来源、关系、活动快照、媒体与生成溯源保留。
7. 当前项目不再建设命名服装库；移除未使用的 `character_outfits`，旧多套服装内容须可恢复。
8. 人设原文不丢失；迁移不依赖 AI，不自动替用户解决语义冲突。
9. 现有角色筛选、生日日历、批量导入和 AI 活动企划继续可用。

### 1.2 范围边界

- 实施公共角色库、必要的公共服务兼容和活动消费者适配。
- 不重做活动引擎、媒体仓库、生成队列或全站界面。
- 不新增世界书运行时、服装市场、角色养成或自动事实核验系统。
- 不删除 `upstream/linshe` 的 `character_outfits` / `global_outfits`；它们有实际换装业务，与当前项目的同名表不同。
- 邻舍优先通过本项目导出适配兼容；本轮不要求修改邻舍内部。若确需改动其代码，应另列原因和差异，不能借机重构。
- 不删除现有 `personas` / `persona_versions` / `app_personas` 公共接口存储；本轮把它们约束为兼容层。彻底淘汰另行评估。

## 2. 开始前的事实与复核

以下依据 2026-09-11 工作区源码的静态检查，不代表已经检查实际数据库内容或通过运行验证。

| 核查位置 | 已发现情况 | 实施含义 |
| --- | --- | --- |
| `packages/contracts/src/index.ts`：CharacterDraft、compileLinshePrompt | 大量细分字段；外观后还有边界、秘密、例句和规则 | 改为 V2 内容模型；邻舍输出外观必须放最后 |
| `apps/service/src/characters/persona-compiler.ts` | 投影保存部分顶层字段并重复携带完整 sourceSnapshot；视觉编译挑选默认服装 | 归一化入口与消费者输出分离，避免把原始快照重复送模型 |
| `apps/service/src/activities/context.ts` | 按字段拼人设，末尾整体截取 1,200 字符；未纳入 secrets / extraRules | 重做预算分配和语义覆盖，不能继续尾部硬截断 |
| `apps/service/src/characters.ts`：characterAvatarPrompt | 独立拼外观，拼入全部服装，没有统一使用 stableFeatures | 头像接入统一视觉入口 |
| `apps/service/src/activities/image-prompt-compiler.ts` | 分离 appearance 和 outfit，但自由描述里仍可能夹带旧服装 | 新数据分离保存；旧混合描述显式兼容、标注复核 |
| `upstream/linshe/agent-core/src/services/characterPersona.js` | 从“## 你的外观”一直截取到末尾 | 在本项目导出端保证标题唯一、外观段最后且无后续行为段 |
| `app/features/characters/components/*-section.tsx` | 简洁模式仍展示多组相近字段，详细模式仍是第二组编辑入口 | 合并为一份正文编辑状态，取消旧字段作为日常编辑入口 |
| `apps/service/src/database.ts`：迁移 16 | character_assets 与 character_visual_references 重复保存多类元数据 | 按第 7 节重新划定权威存储位置 |
| `character_outfits` | 当前项目源码中未发现实际业务读写，只有建表、索引和外键 | 先查真实行与引用，再迁移移除；不能直接宣称空表 |
| `character_profiles.default_outfit_id` 与 appearance.defaultOutfitId | 多处默认造型表示；当前 UI 将服装全文当 ID 使用 | V2 用 defaultOutfitText，去除伪 ID 与重复默认值 |
| `apps/service/src/management.ts`、`public-routes.ts` | 旧 persona 接口仍有读写与应用绑定 | 保留契约，接入统一服务，不保持两个独立可编辑来源 |

当前工作区存在大量已修改和未跟踪文件，尤其生日、筛选、活动企划、角色导入与数据库。接手时先记录 `git status --short` 和相关差异，以实际工作区为基线，不能清理这些改动或从旧提交覆盖文件。

原有文档参考：

- [早期精简提案](CHARACTER_LIBRARY_SIMPLIFICATION_PROPOSAL.md)
- [既有角色库整改规格](CHARACTER_LIBRARY_REMEDIATION_IMPLEMENTATION_SPEC.md)
- [生日、筛选与活动企划交付记录](../reviews/2026-09-11-character-filters-birthday-calendar-and-ai-planning.md)
- [活动图片溯源规格](ACTIVITY_STUDIO_IMAGE_PROVENANCE_SPEC.md)

本规划替代旧规格中“长期保留详细字段编辑”和“继续发展命名造型”的方向；原有导入确认、版本隔离、生日规则和溯源要求继续有效。不得把历史规划中的已完成工作重新列成待重做项目。

### 2.1 邻舍（upstream/linshe）的既有做法与字段

邻舍是本次简化的参照系：它原本就没有把角色拆成十几个字段。核查位置：`upstream/linshe/agent-core/src/db/index.js`、`agent-core/src/services/characterPersona.js`、`outfitService.js`、`routes/characters.js`。本轮只读核查，不修改其代码。

| 邻舍载体 | 字段 | 说明 |
| --- | --- | --- |
| `characters` 表 | `id`、`name`、`display_name` | 标识与显示名 |
| | `base_prompt` | **唯一的人设正文**，自由文本，没有身份/经历/性格/好恶等细分列 |
| | `short_prompt` | 简版正文，用于群聊资料卡、多角色参考、梦境等；缺失时回退 `base_prompt` |
| | `avatar_path`、`standing_url` | 头像与立绘 |
| | `emotion_baseline` | VAD 三值 JSON（valence/arousal/dominance），不是人设文本 |
| | `moments_disabled`、`artist_override`、`handwriting_font` | 行为开关与画风/字体覆盖 |
| `character_outfits` 表 | `character_id`、`name`、`description`、`enabled`、`expires_at` | 角色专属多套外观/形态；同时只启用一套，启用互斥由服务层保证 |
| `global_outfits` 表 | `name`、`description`、`enabled`、`character_id`（空 = 全局）、`expires_at`、`condition_json` | 通用限时服饰与道具写入的角色限时服饰，由 `getActiveOutfits` 惰性过滤过期项 |

`base_prompt` 的小标题由 `routes/characters.js` 的生成模板约定：`你是[中文名(EnglishName)]`（IP 角色附「来自《作品名》」）、`## 你的身份`、`## 你的性格`、`## 你的好恶`、`## 你的外观`。外观必须是**最后一段**，因为 `extractAppearanceSection()` 从 `## 你的外观` 命中处一直截取到字符串末尾。

外观段也不是原文照搬：`buildOutfitInjectionBlocks()` 与 `injectOutfitsIntoAppearance()` 在有生效服饰时把外观段重组为「标题行 → 【限时服饰 / 角色专属形态】清单 → 【基础外观】原正文（降级为参考）→ 【着装裁定】收尾」。裁定放在末尾，是为了压住基础外观里的 danbooru 标签（例如 `pink hair`）把已经换装的部位又带回画面。

对本次规划的三个直接结论：

1. 「一份人设正文 + 独立可替换的穿着」就是邻舍的原生形态，本项目 V2 与它同构，不需要发明新概念。
2. 外观段必须唯一且位于末尾；用户正文里若写了同名标题，必须在编译视图里中和，否则邻舍会提前截断。
3. 邻舍那两个服装表有真实换装业务，与本项目那个未接入业务的空壳同名表不是一回事，不能一起清理。

## 3. 目标数据模型

### 3.1 V2 草稿

沿用 `character_profiles.draft_json`，增加明确的 `schemaVersion: 2`，不新增另一张人设主表。建议契约如下；已有生日类型、组织类型复用现有定义。

```ts
type CharacterDraftV2 = {
  schemaVersion: 2;
  displayName: string;
  englishName: string;
  aliases: string[];
  originType: 'original' | 'ip';
  work: string;
  summary: string;
  personaText: string;
  speechText: string;
  dialogueExamples: string[]; // 每项是一段完整示例，可含多轮对话
  behaviorRules: string;
  appearance: {
    baseText: string;
    defaultOutfitText: string;
  };
  birthday?: CharacterBirthday;
};
```

- `world` 内容归入 personaText；若外部旧接口仍需 world，由兼容载荷处理。
- 收藏、作品类型、标签、分组、演绎方案等继续留在现有 Profile / Organization / Work 结构中，不重复移进草稿。
- 参考图列表由现有 reference 关系查询；不在可编辑 appearance 中再维护 referenceIds。发布快照仍须固定具体引用清单。
- `summary` 可手填或用 AI 生成；正文变化不能静默覆盖用户摘要。空摘要的列表展示可用纯函数生成临时预览，不必写回。
- 草稿只要求名字；“保存并使用”要求名字和非空 personaText。旧数据只有摘要时，迁移可用摘要填正文。
- schemaVersion 不认识时显式拒绝更新，不能按空草稿归一化后覆盖内容。
- 写入超长内容时给可理解的校验错误；原始导入载荷照常归档。不要用 slice 在保存阶段静默丢正文。

### 3.2 内容边界

| 内容 | 归属 | 示例 |
| --- | --- | --- |
| 身份、经历、长期处境、性格、好恶和内在动机 | personaText | “卸任后尝试普通人的生活；因害怕辜负他人而故作镇定” |
| 私密信息 | personaText 的“内心隐情”小节 | 保留“不轻易主动说出”的语义，不强制泄露 |
| 语气、表达习惯、口头禅 | speechText | “公开场合略带舞台腔，私下自然；不要每句都重复口头禅” |
| 明确行为边界 | behaviorRules | “不代替其他参与者做决定” |
| 发型发色、眼睛、体态和稳定辨识特征 | appearance.baseText | “银白长发、水蓝异色瞳、身材娇小” |
| 服装及随服装变化的帽饰、首饰等 | appearance.defaultOutfitText | “深蓝礼服、礼帽和胸针” |
| 本场分工、心情、事件、穿着和姿势 | 现有活动角色 / 活动设定 | “担任生日会主持，穿白色晚礼服” |

配饰不能一律当成稳定身份，也不能一律移进穿着；旧数据无法确定时留原文并标记需要复核。新编辑器用具体例子解释两类内容。

行为约束只是角色创作输入，不能覆盖输出 JSON 协议、模型/工具权限或本项目任务规则。旧 extraRules 如果夹杂视觉负面词或系统指令，保留原文与来源，不能不经确认转成更高优先级指令。

## 4. 人设与外观的统一使用

### 4.1 一个标准角色输入，多个明确用途的输出

在现有模块中建立共享的纯函数入口，具体函数名可调整，但职责固定：

```ts
normalizeCharacter(input)                   // V1 / V2 -> 统一运行时对象
buildCharacterContext(character, options)    // 试演、活动对话、文案、企划
buildCharacterVisualContext(character, opts) // 头像、活动生图、邻舍外观
compileLinshePrompt(character)               // 邻舍协议适配
```

不要从不同页面或路由各自拼接角色字段。共享模块应能被前端预览与服务端使用，不能让前端依赖服务端数据库/Node 专用模块。

统一的是角色语义和选材规则，不是强制所有场景收到完全相同的 prompt。试演的任务说明、活动事实、关系、分工及输出协议仍按场景提供。

V2 活动人物快照保存一次标准角色数据和必要来源标识。旧 sourceSnapshot 可继续归档和读取，不能再把“投影 + 整份 sourceSnapshot”一并交给模型作为重复人设。

### 4.2 文本长度与试演一致性

- 禁止对整个角色上下文进行无提示的末尾硬截断。
- 角色名、必要行为约束和说话方式分配独立预算；正文和例句按用途分配剩余空间。
- 按段落/完整示例裁剪，记录哪些部分缩减及采用的预算；不可截成半条规则或半段多轮示例。
- 如必要内容本身超预算，应提示用户缩短或使用更大上下文配置，不能悄悄删掉关键约束，也不能无限加长请求。
- 按所有参与角色总量预算，避免前几人完整、后几人整段被丢弃。
- 本轮不建立自动摘要缓存系统。可选 AI 摘要须保存输入版本和生成版本；未配置模型时必须可手工使用。
- 试演可选“群聊回复 / 朋友圈文案”等真实使用模式，调用相同的上下文构建器；修改建议仍先展示差异再采用。
- 固定输入、用途和预算应得到确定性的编译结果；记录编译器版本。

### 4.3 外观与换装

默认视觉输入为：基础外貌 + 有效穿着 + 所选参考图 + 本次姿态/场景/风格。

有效穿着规则：活动明确设置 > 角色默认穿着。明确空值和未设置要有契约区分，不能用简单 truthy 回退导致用户无法清空；空值仅表示未指定穿着，不自动推断裸体。

- 新基础外貌字段不放服装。生图时不再同时拼入所有旧造型。
- 头像必须使用同一视觉入口，附加半身、背景等头像任务要求；稳定特征不能只在活动生图时生效。
- 参考图文字说明标明用途；活动换装时不能让默认服装参考覆盖活动穿着。
- 如果现有图片工作流无法做到“只参考身份、不参考衣服”，应说明能力限制，不能仅凭 prompt 宣称保证换装或脸部一致。
- 旧混合外观在用户确认分离前保留兼容内容。可以明确输出覆盖规则缓解冲突，但不能报告为已彻底分离，也不能用简单正则删除不确定的服装文字。
- 识图仍返回发色、瞳色、观察到的服装、证据、未知项等候选。采用时给出 baseText / defaultOutfitText 的具体文本差异；用户未确认不写回。
- 更新外貌、穿着或参考图后，现有图片溯源应能定位到新路径并产生新的编译/生成记录。

### 4.4 邻舍导出

新生成的邻舍正文必须符合：身份/性格或人设正文、说话方式、例句、边界等全部在前，唯一的顶层 `## 你的外观` 在最后。

- 保留邻舍依赖的必要标题约定；复核 `cropPersonalityForEmotion` / short_prompt 生成和非生图消费者，不能只测试生图提取。
- 用户正文中出现相同标题时，在编译视图降级/转义该标题，不能修改原文；避免正文内标题提前触发外观提取。
- 新导出的外观来自统一视觉入口，使用默认穿着而非全部旧服装。
- 历史已发布 compiledLinshePrompt 不原地重写；修复通过新发布版本提供。旧应用导入版本及本地修改检测保持有效。
- 必须以邻舍实际提取函数或真实契约测试验证：提取结果没有后置例句、秘密、行为规则。

## 5. 编辑、导入与保存体验

### 5.1 编辑器

沿用现有界面风格和组件，页面围绕“人设”“外观”组织，不另建完整编辑器。

- 基本资料：名字、作品、头像；生日、别名、标签与演绎分类按需展开。
- 人设：personaText、speechText；例句、行为约束和列表摘要折叠显示。
- 外观：baseText、defaultOutfitText、参考图；识图候选和用途配置在对应区域。
- 来源、关系、历史版本、模型配置移入更多设置，但功能继续可达。
- 取消旧字段的简洁/详细双编辑模式。迁移原文可只读查看，不形成第二套可保存表单。
- 主动作仍用“保存并使用”，将保存与生成新发布快照串联；自动保存只保存草稿。失败时清楚区分草稿已存、发布未成。
- 新角色、已发布角色、未发布修改分别显示真实状态，不能让“已保存”误表示其他应用已用上最新版。

### 5.2 导入与辅助生成

- 保留现有搜索、PNG/JSON、粘贴、批量导入、重复判断、预览确认、取消与幂等提交。
- Tavern description / personality 直接保留正文语义，不强制 AI 拆成十几个字段；dialogueExamples 保留轮次与占位符。
- creator_notes / system_prompt / post_history_instructions / scenario / first_mes / 世界书继续按原有兼容规则归档，不自动升级为本应用系统规则。
- 原始外观字段可形成初始 baseText / 穿着候选；普通 PNG 不伪装成带角色定义的卡片。
- 导出分“原卡原样导出”和“编辑后的兼容卡”，后者明确不能表达的字段；不得声称任意扩展完全无损运行。
- AI 生成人设、AI 整理、试演建议、外观识别、旧快捷导入接口、批量脚本全部适配 V2。
- 生日提取继续只依赖明确资料，人工清空仍优先；更新字段结构不能导致生日自动恢复或丢失。

## 6. 角色数据迁移与兼容

### 6.1 字段映射

| 旧内容 | 新位置 | 迁移规则 |
| --- | --- | --- |
| identity、background、world、currentSituation | personaText | 按身份、经历、世界与长期处境小标题组合，保留原文 |
| personality、motivations、beliefs、likes、dislikes、fears | personaText | 按原字段小标题组合，不做 AI 改写；只可去除完全一致的重复项 |
| secrets | personaText | 加“内心隐情，不轻易主动说出”小标题，保留文本 |
| speech.tone / habits / catchphrases | speechText | 保留语气、习惯、常用表达小标题 |
| speech.examples | dialogueExamples | 每项原样保留多行，不按换行拆碎 |
| boundaries、extraRules | behaviorRules / 待复核原文 | 边界确定性迁移；混合用途规则标注复核，原文归档且不提升指令优先级 |
| summary | summary | 原值保留；只有其他人设正文为空时兼作正文兜底 |
| legacyPrompt | personaText / 兼容读取 | 只有旧正文时优先保留原文；与其他字段同时存在时两者均归档，按旧实际生效逻辑决定初始视图并报告歧义 |
| appearance.hair / eyes / build / stableFeatures | appearance.baseText | 带标签合并，保留稳定辨识信息 |
| appearance.description | appearance.baseText / 待复核 | 原文保留；与细项矛盾或夹带服装时生成复核项，禁止自作主张选择事实 |
| appearance.accessories | 基础外貌或默认穿着 / 待复核 | 可确定的按用途放置；不确定的原文保留 |
| appearance.outfits、defaultOutfitId、profile 默认列 | appearance.defaultOutfitText | 优先旧运行时实际选中值，否则第一套；所有未选服装归档；不同默认值冲突报告 |
| appearance.referenceIds | 发布快照的引用清单 | 不继续作为日常可编辑字段；旧版本引用原样保留 |
| 名称、别名、作品、生日、组织、关系、来源 | 对应现有字段 | 保持角色 ID 与语义，不重新从名称推断事实 |

迁移 report 必须分开记录“已确定映射”“存在语义冲突”“文件/关系无法解析”。不能仅以 JSON 能解析便判定内容迁移成功。

### 6.2 归档与可恢复性

每份被改写的 V1 草稿必须有可定位的原始 JSON、角色 ID、旧 draftRevision、内容哈希、迁移版本和映射报告。优先复用 `character_source_snapshots` 存储原始载荷，使用明确的内部迁移来源标识及 characterId 映射；不能伪装成外部百科或用户导入来源。

需要确认现有快照原文接口的授权、查询与来源枚举支持该标识；必要时只扩展此机制，不再新增一套通用档案系统。发布版本 0 的未发布草稿也必须有原文归档。旧多套服装和待复核规则一起可恢复。

只有原始归档已成功存储且哈希核对后才能改写草稿。重复执行不能重复拼接正文、创建无穷来源记录或反复增加版本。

### 6.3 版本与旧消费者

- 可编辑草稿切换为 V2；实际发生结构转换时 draftRevision 增加，使旧页面/候选的 CAS 失效。
- 旧 `character_versions.data_json`、compiled prompt、外观快照及历史活动内容保留原样。读取时归一化，不回填覆盖。
- 读取已发布版的参考图时采用该版冻结的引用、用途和媒体身份，不能用当前 reference.enabled 或当前裁剪状态重新过滤/替换。当前库停用参考图只影响后续选择与新发布；版本保护引用继续有效。旧快照信息不足时明确采用兼容规则，不能声称完全复现。
- 发布新版本才保存 V2 内容和新编译器版本；不得为结构迁移自动批量发布角色。
- 未指定版本的新使用保持现有选择语义；已经发布但未重新发布的角色仍使用其既定发布版。
- 旧活动继续可查看、播放、导出和生成后续内容；新编译请求记录新编译器版本，不能冒充历史 prompt。
- 现有企划会话、人设哈希、活动快照哈希和任务输入快照不可静默重算。旧草稿会话遇修订变化按现有冲突机制提示重新读取；冻结发布版继续按原版处理。
- AI 采用、试演建议和识图候选必须绑定 schemaVersion、输入哈希与 draftRevision。V1 路径候选不能直接打到 V2 字段；可映射的展示新差异，不可映射的要求重新生成。
- 已存在但未确认的导入会话也必须识别候选版本；转换后更新预览修订与哈希并要求重新确认。已提交会话的幂等重试仍返回原提交结果，不能因 V2 迁移再创建一次角色。
- 新接口只写 V2。旧接口经单独适配器转换到权威角色服务，不维持 V1/V2 双向自动同步；无法无损表达的旧写入返回明确冲突或“不支持此旧格式更新”，保留已支持的旧新建/导入路径。
- `legacyPrompt` 退出 V2 正常写入；其保留位置是旧版本与原文档案。

## 7. 数据库精简设计

### 7.1 数据归属

保留媒体的三层分工，收敛重复字段。API 可继续返回扁平响应，但由 JOIN/适配产生，不要求所有返回值都另存一遍。

| 表 | 保留职责 | 目标权威内容 |
| --- | --- | --- |
| artifacts | 实际文件与所有权 | 路径、MIME、字节数、哈希、尺寸、原文件名、文件状态、app_id |
| character_assets | 角色对一份文件的使用与来源 | id、character_id、artifact_id、kind、来源页面/URL、作者/用户备注、created_at |
| character_visual_references | 图片作为生成参考的配置 | id、character_id、asset_id、purposes_json、enabled、crop_json、created_at、updated_at |

`character_visual_references.character_id` 暂保留用于现有查询与所属校验，所有写入校验其与 asset.character_id 一致；这是明确的关系约束，不为减少一个列而扩展本轮表重构范围。

图片备注在本轮定义为该角色图片资产的备注；用途、裁剪、启用是参考配置。同一实际文件可以有多个角色资产关联，不要求把所有同哈希记录合并。

### 7.2 列级清理清单

| 位置 | 拟移除 | 替代来源 / 前置条件 |
| --- | --- | --- |
| character_visual_references | artifact_id、sha256 | 经 asset.artifact_id 关联 artifacts；必须先处理两份 artifact 不一致 |
| character_visual_references | source_page、original_url、author_note、user_note | 收敛到 character_assets.source_page / source_url / author_note / user_note |
| character_visual_references | outfit_id | 无命名服装业务，归档原值后移除；保留用途 outfit，其语义只是图片用途 |
| character_assets | purposes_json、enabled、crop_json | 参考用途移到 reference；头像选中状态由 profile.avatar_asset_id 表示，不靠 purposes 再存一次 |
| character_assets | outfit_id | 同上，归档后移除 |
| character_assets | sha256、width、height | artifacts 对应字段 |
| character_assets | local_path、content_type、byte_size、original_name | 完成旧文件 Artifact 接入后使用 artifacts；这是有条件的最终清理，不可先删再补文件 |
| character_profiles | default_outfit_id | V2 appearance.defaultOutfitText；旧默认值参与迁移审计 |
| character_outfits | 整表及其专用索引 | 完成行数据与外键归档/转换，并确认当前业务不再依赖 |

资产 ID、reference ID、artifact ID、角色 ID 和已有 URL 的稳定含义必须保持。不能为简化表结构重建全套新 ID，造成旧版本或活动失联。

### 7.3 重复值冲突规则

1. 先输出每组重复列的差异数量与记录 ID，不假设双写字段总相同。
2. artifact 不一致或哈希不一致属于内容身份问题，不能简单 COALESCE。依据当前实际读取路径、现存文件与哈希确认每个引用原本使用的文件；无证据时列为阻止该记录清理的异常。
3. 来源与备注有两个不同非空值时都归档。当前参考图展示值作为该参考的初始迁移结果；独立资产/头像原有展示值也要保留。
4. 同一个 asset 被多个 reference 使用且来源备注冲突时，可拆成指向同一 artifact 的多个 asset 关联，并让各 reference 保持原 ID 指向相应关联。不复制二进制文件，不重写旧快照 JSON。
5. 空字符串、NULL、false 和空数组要按原语义处理，不能用“非空优先”把禁用状态恢复为启用。
6. 无 reference 的资产不能丢作者/来源/备注；purposes 包含参考用途的历史记录需复核是否补参考关联。既有禁用/裁剪数据须映射完整后才能去列。
7. `activity_character_asset_transfers.sha256`、版本中的 appearanceSnapshot 和历史执行 valueSnapshot 是不可变证据，不在重复列清理范围内。

### 7.4 旧文件接入 Artifact

- 审计无 artifact_id 的资产、缺失文件、归属错误、哈希冲突与悬空引用。
- 可读旧文件通过现有 Artifact 服务登记/导入，归属仍为 characters；建立既有保护引用。已有合法 Artifact 不重复上传。
- 缺失文件可以采用现有 Artifact 缺失状态机制，但须先确认所有读取与导出路径支持明确缺失响应，且保留旧路径等恢复线索；不能伪造 ready 文件。
- 所有资产都有可解释的 Artifact 关联或受支持的缺失记录后，才移除资产表中的文件镜像列。
- 若个别旧记录无法解释，停在该清理阶段并报告具体记录，其他独立开发继续。不能为了声称迁移成功而删记录或悄悄清空头像。
- 不借此清理磁盘旧媒体。文件回收另按现有 Artifact 生命周期执行。
- 活动仍通过现有受控资产转入机制使用角色媒体，不绕过 app_id 检查。

### 7.5 未接入业务的服装表

审计只针对 SthStart 服务数据库的 `character_outfits`。

- 空表：先移除/重建引用该表的外键与 outfit_id 列，再删表和专用索引。
- 非空表：归档每行原文、角色关系、enabled 及引用；可确定的当前默认穿着转成 defaultOutfitText，其他服装放迁移原文记录。多个互相冲突的默认状态需复核。
- 没有 character_outfits 行不代表 appearance.outfits 为空；两者都要审计。
- 不将服装全文伪造为新的 ID，不以新增一张 V2 服装表替代旧空壳。
- 删除完成后通知用户确切删除范围、归档位置和恢复方法。

### 7.6 旧 persona 表与查询投影

- 保留 personas / persona_versions / app_personas 的现有外部契约与历史记录。
- app_personas 中应用自己创建或修改的本地快照继续属于该应用，不能为了统一公共角色编辑而自动反向覆盖公共库；公共角色新版本也不能静默覆盖应用本地修改。
- 所有新编辑以 character_profiles 为权威，发布时生成兼容 persona 视图/记录；旧 management 写入口必须路由到同一角色服务或明确限制不支持的覆盖行为。
- 兼容 appearancePrompt 使用统一编译结果，不能仅取旧 description 导致丢特征。
- 生日索引、作品分类等有查询用途的派生结构保留，明确从权威字段同步；不因“看起来重复”删除。
- 不删除来源快照、候选、关系、发布快照或生成链路表来追求更少表数量。

## 8. 实施顺序与阶段出口

按依赖顺序执行，每阶段记录实际结果；文档和阶段名不等于实现完成。

| 阶段 | 实施内容 | 退出条件 |
| --- | --- | --- |
| P0 基线审计 | 复核工作区、调用点、实际数据库、媒体；输出迁移预览与冲突清单 | 明确 V1 数据数量、异常与备份/恢复路径；不触发自动迁移 |
| P1 统一使用入口 | 提取人设/外观编译、上下文预算；修复邻舍标题约定与头像外观口径 | 现有 V1 角色也可通过统一入口，关键语义有回归验证 |
| P2 V2 模型与兼容 | 契约、V1 适配、原文归档、草稿转换、旧读写适配、快照版本处理 | 新建写 V2，旧草稿可迁移，旧版本与旧活动可读，重复迁移安全 |
| P3 编辑与导入 | 新字段编辑、AI 候选差异、试演模式、所有导入/批量/导出/生日路径 | 用户可完成创建—试演—保存使用；无双编辑来源 |
| P4 数据库收敛 | 冲突归档、Artifact 补齐、读写 JOIN 切换、删重复列和空壳服装表 | 新旧数据库升级均通过；无悬空引用与丢失文件；明确物理删除结果 |
| P5 集成验证与交付 | 真实样本迁移演练、活动与邻舍兼容、必要浏览器/模型检查、恢复演练 | 达到第 10 节完成标准，交付实际变更和未验证项 |

P1/P2 可以内部小步迭代，但不能把只会读 V2 的代码部署到未迁移数据上。P4 的物理删除必须晚于全部读取和写入路径切换及备份完成。

不要求建立长期功能开关或永久双写机制；临时迁移代码和旧读取适配有明确职责，后续可以在历史兼容需求结束后单独清理。

### 8.1 实施现状（2026-09-11 交接快照）

| 阶段 | 状态 | 落地依据 |
| --- | --- | --- |
| P0 基线审计 | 已完成 | `scripts/character-model-audit.mjs` 只读审计；实测 120 个角色全为 V1、参考行与资产为 0、`character_outfits` 0 行 |
| P1 统一使用入口 | 已完成 | `toCharacterRuntime()`、`buildCharacterVisualContext()`、`buildCharacterContextSections()`、`compileLinshePrompt()` |
| P2 V2 模型与兼容 | 已完成 | `CharacterDraftV2`、`migrateCharacterDraftToV2()`；120/120 已迁移并归档原文 |
| P3 编辑与导入 | 已完成 | 编辑器、导入合并、识图候选差异预览与采用、试演建议对照采用，统一走 V2 |
| P4 数据库收敛 | 已完成 | 迁移 20、21：删重复列、删空壳服装表；迁移 22：发布版本记录编译器版本 |
| P5 集成验证与交付 | 部分完成 | 自动化（含新增契约、邻舍真实锚点、媒体巡检用例）、真实库副本冒烟、Windows chromium 界面、角色主流程与迁移复核面板已执行；真实模型/生图未执行 |

复核阶段另外修掉九个真实缺陷：Windows 端口探测把空闲端口误判为占用、Windows 上启动 npm 抛 `spawn EINVAL`、结构迁移的原文归档无法下载、迁移把已是 V2 的草稿清空、非空服装表会被静默删除、发布与试演不记录编译器版本、试演建议给出不存在的字段路径、媒体巡检删掉来源快照与导入暂存文件（此前表现为约 5 次 1 次的间歇测试失败）、角色编辑器在 390px 下横向溢出。都带回归测试，见交付说明第 5 节。

尚未完成的事项集中在交付说明第 7 节，接手时以那份清单为准，不要重复已完成的工作。

## 9. 数据库升级、备份与恢复

迁移 20、21、22 为本轮新增，当前最高编号为 22；后续只追加迁移，不能改已应用的迁移内容或固定假设下一编号。

`ServiceDatabase` 构造时会自动迁移；当前迁移器每个迁移在事务中执行静态 SQL。必须处理这个约束：

1. P0 审计使用原始只读数据库连接，不实例化会自动迁移的 ServiceDatabase。
2. 先在数据库及媒体副本上完成完整演练，再升级日常使用数据。
3. DDL 迁移只承担可安全事务化的数据库变更。原文归档、文件导入、冲突检查等由显式维护步骤先完成；必要时小幅扩展迁移能力，不建立新迁移框架。
4. 破坏性迁移必须检查前置状态；未归档、未迁移、存在未处理外键或身份冲突时回滚并给出明确维护指引，不能服务启动时直接删列。
5. 升级时暂停有关写入/后台任务，记录代码版本、数据库版本和媒体清单。SQLite WAL 下使用一致性备份方式，不只复制主数据库文件。
6. 复用并核实 `scripts/database.ts` 的备份/恢复能力。它明确提示数据库备份不包含媒体文件，二进制媒体需另行保存。
7. 如需表重建，保留主键、外键、索引和触发器；外键设置须按 SQLite 实际事务行为处理，不能在已开启事务里盲目切换 PRAGMA。迁移后执行 foreign_key_check 和完整性检查。
8. 大文件导入不能假装与 SQL 原子提交；登记已创建 Artifact，失败后按既有保护/清理机制恢复，不删除共享文件。
9. 重复运行应跳过已验证完成项；遇哈希变化停止该项并报告，不把后续用户编辑当成 V1 再次覆盖。
10. 回滚方式为恢复配套数据库、所需媒体与兼容代码版本；已删字段不能通过再次执行旧程序自动恢复。升级后新增写入必须先单独保全，不能直接覆盖丢掉。

执行模型交付可运行的审计/迁移入口与使用说明，至少支持 preview/dry-run 和明确的 apply，参数及实际路径必须记录。不要把 destructive apply 混入一个名称为 check 的操作。

## 10. 验证与完成标准

个人自用项目，验证围绕数据不丢、角色行为一致和主流程可用，不建立与改动无关的大型测试体系。

### 10.1 必须覆盖的自动化行为

| 场景 | 预期 |
| --- | --- |
| 完整 V1 草稿迁移 | 所有文字有映射或原文档案；再迁移不重复正文 |
| 仅 legacyPrompt、仅 summary、字符串 appearance、未知版本 | 旧有效内容保留；未知版本拒绝覆盖 |
| 长背景 + 短语气 + 关键约束 + 多轮例句 | 预算不静默切掉约束，不拆断例句，不丢整个参与者 |
| 同角色试演、活动、邻舍导出 | 使用相同的角色语义；用途差异可解释 |
| 导出正文包含用户自写“你的外观”标题 | 邻舍提取到唯一正确外观段，不带行为内容 |
| 多套旧服装、默认值冲突、活动穿着覆盖、明确清空 | 默认选择确定，未选原文保留，活动覆盖不会回退旧列表 |
| 参考图/资产重复列相同与不同、同资产多参考、无 reference 的头像 | 来源和配置可恢复，ID 稳定，不盲目合并不同文件 |
| 非空服装表、旧外键、缺失文件 | 有归档与明确缺失/冲突状态；不通过删记录掩盖错误 |
| 旧数据库升级、新库初始化、再次启动 | 迁移与 schema 检查通过；SQL 查询不引用已删列 |
| V2 发布、旧 persona 读写、CAS、旧 AI 候选 | 只有一个编辑真相；旧修订请求不覆盖新正文 |
| 旧活动和企划会话 | 历史内容/媒体引用不变；草稿变化产生真实冲突，冻结版本不变 |
| 生日、筛选、导入和批量脚本 | 生日人工清空保留、日历/筛选一致、导入仍先确认 |
| 迁移失败和恢复 | 数据/媒体可恢复，副本演练有证据 |

### 10.2 最小人工检查

- 桌面与窄屏完成：名字 + 正文新建、保存并使用；补语气、默认穿着和一张参考图。
- 导入一张有真实内容的角色卡，确认后查看正文、例句、来源与头像；取消另一候选不产生角色。
- 用同一角色试演与生成一段活动对话，检查语气和一条明确行为约束；结果不要求逐字相同。
- 活动换装后查看实际编译输入、所选参考图及溯源；有可用图像服务时生成一张验证，不能用编译正确代替画面正确。
- 打开迁移前的活动和版本，验证播放/导出媒体可用；打开生日页面确认既有规则。
- 查看迁移复核项、原始多套服装与原卡，确认可以找到恢复入口。

### 10.3 可复用的验证入口

根据 package.json 与当前环境复核后执行，记录实际结果；不要把过去文档里的“通过”搬成这次结果。

```text
npm run typecheck
npm run test --workspace @sthstart/service
npm run test:portal
npm run test:linshe-contract
npm run build
git diff --check
```

优先补充/调整 character、character-card、character-remediation、character-organization、database、linshe-contract、calendar-planning、activity-text-modes 及现有活动图片测试；只运行与变更相关的浏览器场景。数据库 check/integrity 命令先确认目标是测试副本或已经备份的正确库。

没有真实模型或图片服务时，仍须完成可独立运行的代码、契约、迁移和编译验证，交付说明分别列出“自动化通过”“人工通过”“因环境未执行”。外部服务缺失不能变成伪造实机完成的理由。

## 11. 接手文件清单与交付要求

### 11.1 重点代码

- 契约：`packages/contracts/src/index.ts`、`packages/contracts/src/activities.ts`，确认实际导出路径与重复定义。
- 角色服务：`apps/service/src/characters.ts`、`characters/draft.ts`、`persona-compiler.ts`、`card-mapper.ts`、`import-sessions.ts`、`organization.ts`、`birthday.ts`。
- 兼容服务：`apps/service/src/management.ts`、`public-routes.ts` 及旧 persona 迁移入口。
- 活动：`activities/characters.ts`、`context.ts`、`prompts.ts`、`planning.ts`、`image-prompt-compiler.ts`、图片溯源与输入快照处理。
- 数据：`apps/service/src/database.ts`、`artifacts.ts`、`scripts/database.ts`。
- 前端：`app/features/characters` 的编辑、表单、导入、试演、发布与外观组件，活动选人、企划及自定义参与者入口。
- 存量脚本：检索 `scripts` 中生成/修复角色、外观锚点、生日提取与批量导入的读写，避免后续脚本写回 V1 字段。
- 邻舍只读核查：`upstream/linshe/agent-core/src/services/characterPersona.js`、`emotionEngine.js`、角色公共库导入/更新路由。

### 11.2 交付物

1. 可运行实现与必要迁移；保留当前已有未提交工作。
2. 实際数据库清理清单：移除的表/列、保留的兼容表/查询投影及理由。
3. 迁移审计与差异报告：数量、失败、冲突、缺失文件、原文档案与备份位置；避免无必要公开完整角色私密文本。
4. V1/V2 兼容说明，旧应用写入和旧活动读取策略，编译器版本变化。
5. 真实执行的验证结果；一个足以展示简化后编辑流程的界面证据。
6. 在副本完成的升级与恢复演练结果，日常库是否实际迁移单独说明。
7. 本轮已完成/未完成清单；数据库去列或空壳表删除未完成时必须明确，不能只因 UI 变简单就声称整体完成。

最终验收重点：用户主要编辑四块内容；新数据只有一个人设来源；旧文字与图片可恢复；试演与活动共享语义；外貌与活动换装分开；重复列及本项目空壳服装表按明确映射安全退出。

## 12. 交接说明（给接手模型）

### 12.1 阅读顺序

1. 本规划：范围、约束、目标模型、阶段出口。
2. [人设与外观 V2 精简交付说明](../reviews/2026-09-11-character-persona-v2-simplification-delivery.md)：实际改了什么、实测证据、剩余项。
3. [生日、筛选与活动企划交付记录](../reviews/2026-09-11-character-filters-birthday-calendar-and-ai-planning.md)：同批未提交改动的背景。

### 12.2 当前状态

- 代码：V2 内容模型、统一运行时、统一视觉编译与迁移 20/21 均已落地；`npm run typecheck`、`npm run build`、`npm run test:portal`、`npm run test:contracts`、`npm run test:linshe-contract` 与全部服务端测试（148/148）通过。
- 数据：`data/sthstart.db` 已升级到迁移 21，120 个角色全部为 `schemaVersion=2`。
- 备份：`data/sthstart.db.before-persona-v2-20260911.bak`、`...before-v20-20260911.bak`、`...before-v21-20260911.bak`，各带同名 `.db-wal.bak`。
- 界面：Windows chromium 上重生成角色编辑器视觉基线，并跑通「创建 → 编辑 → 刷新回读 → 发布 → 导出」主流程。

### 12.3 剩余任务

旧 persona 三表尚未淘汰；真实模型与生图验收未做。69 条外观混装与 103 条配饰归属的复核项已有界面入口（角色「关系与来源」的结构迁移复核面板 + `character-migration-reviews` 接口）。明细以交付说明第 7 节为准。

### 12.4 红线

- 不修改 `upstream/linshe`：它的同名服装表有真实换装业务。
- 不再拆分 `packages/contracts`：该包以 TypeScript 源码被消费，Node 不会把 `./x.js` 映射到 `./x.ts`，拆分即运行时报错。
- 不在已开启的事务里切换 `PRAGMA foreign_keys`；迁移 20 用的是 `foreignKeysOff` 标记加迁移后 `PRAGMA foreign_key_check`。
- 迁移语句数组的每一项单独执行，多行 SQL 必须拼成一条字符串。
- 不删除备份与 `.codex/` 下的演练副本，除非确认不再需要恢复。
