# 活动生图对齐邻舍：分阶段实施计划

> 目的：把 SthStart 活动生图（镜头 / 漫画 / 素材）的提示词与工作流链路对齐到邻舍的实际做法，缩小成图质量差距。
> 适用对象：交给执行模型按阶段实施。本文件只定义任务、边界与验收，本身不含代码改动。
> 当前迁移最大版本为 48（见 apps/service/src/database.ts 的 SERVICE_DATABASE_MIGRATIONS）。需要迁移时从 49 起。

## 一、结论与证据（本计划的前提）

### 1.1 已核实一致的部分（不要重复改造）

| 项目 | 邻舍 | SthStart 活动 |
| --- | --- | --- |
| UNET | anima_baseV10.safetensors | 同 |
| CLIP | anima_baseV10_txt.safetensors（type qwen_image） | 同 |
| VAE | qwen_image_vae.safetensors | 同 |
| 采样 | er_sde / beta / steps 31 / cfg 5 | 同 |
| 节点图 | UNETLoader → CLIPLoader → VAELoader → StringConcatenate ×2 → CLIPTextEncode ×2 → EmptyLatentImage → KSampler → VAEDecode → SaveImage（共 12 节点） | 同结构 |
| 默认分辨率 | 768×512 | 768×512 |
| 负向词 | 安装版负面节点同一串 | 同一串 |

注意：邻舍工作流文件里 EmptyLatentImage 画布写的是 1920×1128，但它的 width/height 输入被 Reroute 接到了 PrimitiveInt（768/512），所以**实际运行是 768×512**。邻舍代码默认值同样是 768×512（upstream/linshe/agent-core/src/config.js）。因此“邻舍引擎更好”“邻舍分辨率更高”都不成立。

### 1.2 已确认的差异（按影响排序）

1. 提示词范式不同（主因）
   - 邻舍：画面描述由标签合成器产出（upstream/linshe/agent-core/src/services/imagePromptPreparer.js），输出密集 booru 标签，并按互斥规则裁剪。
   - SthStart：画面描述由 LLM 自由改写为英文自然语言长句（apps/service/src/activities/image-prompt-optimizer.ts；默认指令见 packages/contracts/src/activity-image-prompts.ts 的 DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS）。
   - Anima 是标签模型。长句需要模型自行“翻译”成视觉概念，容易丢细节、忽略部分约束，这是“画面与镜头描述对不上”的结构性原因。
2. 画风与质量词被应用两次（已复现，见附录 A）
   - 工作流节点图本身写死 “@ebora + 质量串”；提示词策略的 positiveSuffix 又追加同一串；拼接节点首尾相接、不去重。
3. 工作流名与默认尺寸不符
   - anima-activity-1080p-eval 全部版本（v1..v5）的语义宽高默认都是 768×512。
   - 预设“Anima Base · 1080p E2E / Anima Turbo · 1080p E2E”当前 enabled=0，未被使用。
4. 没有放大细化（HiresFix）
   - 邻舍有 放大细化工作流 / 放大细化工作流-进阶（upstream/linshe/agent-core/src/services/imageRefine.js）。
   - SthStart 活动链路无对应环节。
5. 没有 turbo/base 双档
   - 邻舍支持 turbo/base/hybrid 并按场景选工作流（imageSkill.resolveWorkflowPath、workflowTemplates.js）。
   - SthStart 活动只有单一 Anima 工作流。
6. LoRA 未验证
   - 两边都实现了 LoraLoaderModelOnly 动态注入与触发词追加。
   - 当前 ComfyUI 实例的 models/loras 为空，真实带 LoRA 未验证。

补充说明：用户提供的 Anima提示词优化助手.txt（约 14 万字）**没有被邻舍代码引用**，全仓库检索无引用点；它是给人用的参考文档，不是自动环节。邻舍自动执行的是 1.2 第 1 条所述的标签合成。

### 1.3 已有可复用资产（禁止重造）

- apps/service/src/activities/prompt-tag-composer.ts
  已移植邻舍的标签归一化（extractBaseTag）、solo 强制、互斥组（CONFLICT_GROUPS）、sleep/facing away 规则、日/夜互斥、LoRA 触发词前置（prependLoraTriggerWords）。
  **现状：只做“规范化与裁剪”，不负责“从描述生成标签”。**
- apps/service/src/activities/image-render-common.ts 的 finalizeActivityVisualPrompt
  所有目标（镜头/漫画/素材）在优化后统一追加画风与触发词。
- 邻舍知识库（尚未移植）
  upstream/linshe/agent-core/src/db/imagePromptKnowledgeData.js（222 条）
  upstream/linshe/agent-core/src/db/imagePromptTagKnowledgeData.js
- 邻舍检索方式：词法匹配 + 中文 bigram 重叠打分 + 分类数量上限，**不依赖向量库或嵌入模型**，可直接用纯函数移植。

### 1.4 耦合边界与不可违反的约束

改造前已核查：邻舍与活动模块在**代码层面没有混用**，但存在若干**运行时共享**，实施时必须避开这些坑。

#### 代码层面（干净，可安全独立演进）

- 活动模块（apps/service/src/activities/*、app/features/activities/*）不 import 邻舍源码，只依赖 @sthstart/contracts 与内部模块。
- 邻舍（upstream/linshe/agent-core）不在 npm workspaces 内（根 package.json 只声明 apps/* 与 packages/*），没有 node_modules/@sthstart，不存在模块级复用。
- ComfyUI 客户端彼此独立：活动走 apps/service/src/generation/execution.ts（POST /api/prompt + client_id）；邻舍走 upstream/linshe/agent-core/src/services/comfyClient.js（POST /api/prompt + WebSocket）。没有共享的 ComfyUI 客户端库。
- 标签规则是**复制**不是引用：apps/service/src/activities/prompt-tag-composer.ts 文件头注释写明 ported from Linshe，但运行时零依赖。
- apps/service/src/linshe-contract.test.ts 会 import 邻舍的 character-contract.js 与 characterPersona.js，但仅限测试，且属于角色人设契约，与生图无关。
- 参考：.agents/skills/linshe-submodule-sync/SKILL.md 约束子模块指针操作。

#### 运行时共享（实施红线）

1. 同一台 ComfyUI 与同一块 GPU
   两边都指向 host.docker.internal:8188。同一时刻只有一个模型常驻显存，并发时会排队或触发模型重载。
   约束：不得因为本计划延长或加重实例占用；真实生图串行执行；阶段 3 提高分辨率前先评估显存与耗时。
2. 邻舍可经 SthStart 公共生成接口提交生图（配置开关）
   邻舍 comfyClient.js 在 config.publicServices.image 为真时改用 submitPublicWorkflow，调用 SthStart 的 /api/v1/generation/tasks，并使用 Idempotency-Key。该路径的 purpose 来自 config.publicServices.generationPurpose，与活动的 activity_image_text 不同。
   现状：开关关闭，generation_tasks 中只有 activity_image_text 与 creative-center，没有邻舍任务。
   约束：不得让邻舍托管与活动共用同一 purpose；不得改动 /api/v1/generation/tasks 的鉴权与幂等语义；不得把活动提示词策略作用到该公共路径。
3. 共用文本模型配置
   app_llm_assignments 中 linshe、activities、characters、story 共享同一 profile（当前 ds-jy）。活动的提示词优化与邻舍对话用的是同一模型。
   约束：阶段 2 不得修改该 profile 的全局绑定；需要专属模型时使用 studioContext 的 profile 覆盖机制，不写全局 assignment。
4. 共用产物与素材目录
   两边都落在 STHSTART_ARTIFACT_DIR（/app/data/artifacts），邻舍另有自己的 agent-core/data。
   约束：新增产物一律经 artifacts.ts 的引用机制（createArtifactReference），不得直接写文件绕过引用与清理保护。

#### 落地方式（与后续阶段的关系）

- 阶段 2b 把邻舍知识库与检索**移植为副本**（如 apps/service/src/activities/image-prompt-knowledge.ts），不 import upstream/ 源码，避免运行时耦合与子模块升级破裂。
- 阶段 2a 改动契约（packages/contracts/src/activity-image-prompts.ts）开关默认 prose，必须保证邻舍公共生成路径与旧策略行为不变。
- 全程禁止修改 upstream/linshe（含工作流文件）；注册到项目的工作流一律以新版本发布，不改写已发布版本。

## 二、目标与非目标

### 目标
- 让画面描述从“英文散文”变为“规范标签 + 少量自然语言补充”。
- 画风与质量词只应用一次，且来源单一可配。
- 分辨率、步数、采样等由预设显式控制，名称与实际一致。
- 保留现有可审计性：策略版本、幂等键、AI 调用日志（原文 / 优化后 / 最终提交）、工作流快照。
- 不破坏已有活动：旧策略与已提交版本继续可用。

### 非目标（本轮明确不做）
- 不更换引擎、模型文件与采样器默认值（阶段 3 只调整分辨率与预设）。
- 不做自动视觉判图、自动拒绝、自动重试。
- 不训练 LoRA，不引入向量库或嵌入服务。
- 不做人物连续动画、图生视频、音频编辑。
- 不部署、不推送，除非用户明确授权。

## 三、执行规则（每阶段必须遵守）

- 每阶段先完成实现与阶段验收，验收有失败项先修复本阶段，**不得提前进入下一阶段**。
- 开始前记录 git status，保留全部既有未提交/未跟踪改动，不得 reset、clean 或覆盖用户文件。
- 必须阅读并遵循技能：contract-first-api、db-migration-backup、frontend-ui-standards、project-verifier。
- 涉及真实数据库时顺序固定：npm run db:check → db:backup → db:migrate → db:integrity，并记录备份路径。
- 真实生图只写入专门的新测试活动，不得改动用户已有活动与图片。
- 提交前保留证据：契约测试、靶向服务测试、类型检查、真实调用日志 ID、图片路径。
- 未验证项必须如实标注，不得用模拟结果冒充真实效果。

## 四、阶段 0：基线与对照样本

任务
1. 记录 git status --short，确认无需清理的既有改动范围。
2. 确认迁移最大版本（应为 48）与新增迁移编号（49）。
3. 生成“改造前”对照样本：选一个新测试活动，用固定镜头描述与固定 seed，各出一张 768×512 与（若已配 1080p 预设）一张高分辨率图，保存提示词、seed、工作流、调用日志 ID。
4. 记录当前 anima-activity-1080p-eval 的工作流版本、语义宽高默认值、已启用预设与 app_generation_assignments 绑定。

验收
- 有可复现的改造前样本与调用日志 ID。
- 能区分“改造前既有问题”与“本轮新增问题”。

测试
- 只读检查，不新增测试。

## 五、阶段 1：画风质量词去重（小改动，先做）

问题
工作流节点图写死画师串与质量串，策略 positiveSuffix 又追加一次，最终提示词重复。

方案（二选一，推荐 A）
- A（推荐）：把工作流节点图中的画师/质量串作为唯一来源，策略 positiveSuffix 默认留空；同时给合成器加“完全相同标签段去重”的兜底。
- B：从工作流节点图移除画师/质量串，改由策略 positiveSuffix 提供。风险：会影响其他已绑定该工作流的活动，需更谨慎。

实施点
- apps/service/src/activities/prompt-tag-composer.ts：在 composeActivityPrompt 中增加“归一化后完全相同的段只保留第一次出现”的去重步骤（放在冲突组处理之前，保持靠前权重）。
- 数据侧（方案 A）：把当前工作流版本的提示词策略 positiveSuffix 置空，或在前端面板明确提示“工作流已内置画风，此处再填会重复”。
- 前端：app/features/generation/components/activity-image-prompt-policy-panel.tsx 增加重复提示与校验（同串已存在时提示）。

验收
- 实际提交的工作流图中，画师串与质量串各只出现一次。
- 契约测试与 prompt-tag-composer 测试通过。

测试
- 新增或扩展 apps/service/src/activities/prompt-tag-composer.test.ts：断言重复段被去重。
- node --import tsx/esm --test apps/service/src/activities/prompt-tag-composer.test.ts

## 六、阶段 2：标签化提示词编译（核心，对齐邻舍效果）

目标
把“画面描述”从散文改为标签；保留 LLM 的语义理解，但输出结构化的槽位标签，再由确定性合成器组装。

### 2a：LLM 输出结构化槽位（必做）

实施点
- 契约：packages/contracts/src/activity-image-prompts.ts
  为 ActivityImagePromptPolicy 增加 outputFormat: 'prose' | 'tags'（默认 'prose'，保证旧策略行为不变）。
  新增槽位结构：count（数量/性别）、identity（角色与作品）、appearance、clothing、action、expression、camera、scene、details、naturalLanguage（仅用于标签无法表达的补充）。
- 服务：apps/service/src/activities/image-prompt-optimizer.ts
  outputFormat='tags' 时，系统指令要求模型只返回约定 JSON（不得返回 Markdown、解释、质量词、画师名、对话文字）。
  服务端校验 JSON 结构；非法输出按明确错误处理，不静默回退且不提交生图。
  组装顺序固定：count/identity → appearance → clothing → action/expression → camera → scene → details → 末尾自然语言补充。
- 合成：apps/service/src/activities/image-render-common.ts 的 finalizeActivityVisualPrompt
  已有 composeActivityPrompt 调用；此处复用其互斥、solo、去重与触发词逻辑。
- 记录：AI 调用日志必须同时保存原始描述、槽位 JSON、最终提交提示词与策略修订号。
- 迁移 49（若需要落库槽位 JSON）：给 activity_prompt_optimization_runs 增加可空 slots_json 列。不得擅自修改已执行迁移的约束。

边界
- 不删除 prose 模式；旧策略与旧活动继续可用。
- 不改变幂等键语义与 CAS 行为。
- 多角色时每人外观/动作必须与本人绑定，不得被全局互斥组误删。

验收
- 同一镜头：最终提交提示词等于“槽位 JSON 经确定性合成”的结果，可逐项核对。
- 单角色出现 solo 且无第二人计数；多角色不出现 solo，且两人属性不串。
- 互斥规则生效（如 close-up 与 full_body 不同时出现）；重复段被去除。
- 非法 JSON 时不产生 ComfyUI 任务，日志可见失败原因。

测试
- 契约：packages/contracts 的 schema 测试。
- 服务：image-prompt-optimizer 的靶向测试（成功、非法 JSON、超时、多角色、单角色）。
- 真实：至少一次真实生图，核对日志中最终提示词为标签形式。

### 2b：移植邻舍知识库与字面检索（可选增强）

实施点
- 把 upstream/linshe/agent-core/src/db/imagePromptKnowledgeData.js 与 imagePromptTagKnowledgeData.js 作为带版本的静态数据导入到服务侧（新文件，例如 apps/service/src/activities/image-prompt-knowledge.ts），不直接引用 upstream 源码路径。
- 移植 imagePromptPreparer.js 的纯函数部分：normalizeForMatch、scoreExecutableTag、selectExecutableTags（含 CATEGORY_LIMITS）、applyKnowledgeRules、resolveSelectedConflicts、cleanOriginalPrompt。
- 检索为词法匹配 + 中文 bigram 重叠，**不需要嵌入模型或向量库**。
- 场景过滤：优先复用活动侧的场景/镜头语义，不做无关场景强绑定。

边界
- 与 2a 的关系：2a 决定“用什么标签”，2b 提供“同义标签与规则补全”。二者可叠加，但不得重复追加同一标签。
- 知识库版本变化必须进入策略快照，保证可追溯。

验收
- 给定中文描述，检索返回的标签可解释（命中原因、来源条目、分类上限生效）。
- 与 2a 组合后无重复标签。
- 关闭 2b 时行为与 2a 一致。

测试
- 新增知识/检索靶向测试：命中、同义（如 地雷女/地雷系）、分类上限、互斥裁剪。

## 七、阶段 3：分辨率与画质预设

问题
工作流名为 1080p，语义默认却是 768×512；1080p 预设未启用。

实施点
- 修正 anima-activity-1080p-eval 的**新版本**（不要改写已发布版本）语义宽高默认值为 1920×1080；若为对齐邻舍原始画布，可选 1920×1128，需在提交说明中写清理由。
- 启用或新建 1080p 预设（Base 与 Turbo 各一），并把活动默认绑定切到新工作流版本与预设。
- 活动图片配置绑定草稿/成稿画质：草稿可保持较快速设置，成稿使用 1080p 预设。
- 前端：给出“恢复默认 / 应用新预设”入口，避免悄悄改变已有活动。

边界
- 旧工作流版本与旧预设保持可读、可回退。
- 不改动用户已有活动的已保存参数；只提供入口。

验收
- 预览显示 1920×1080；实际提交图的宽高与日志一致；输出 PNG 尺寸可核对。
- 记录该分辨率下的耗时与显存占用。

测试
- 既有 activity-visual-plan / 预设相关测试；真实生图一次并记录尺寸与耗时。

## 八、阶段 4：放大细化（可选）

实施点
- 参考 upstream/linshe/agent-core/src/services/imageRefine.js 与 workflowTemplates.js，发布新的放大细化工作流版本（基础 Lanczos 或进阶 UltimateSDUpscale）。
- 新 purpose（例如 activity_image_upscale），复用统一生成执行器与 AI 日志。
- 生成成功后作为**可选第二遍**执行；产物为新 artifact，绝不覆盖原图。

边界
- 缺超分模型时明确报错并保留原图，不静默降级。
- 不与“按此图配置重绘”混用，两者语义不同。

验收
- 原图与放大图同时存在；日志分别记录两次调用。
- 失败不影响已生成的原图。

## 九、阶段 5：turbo / base 双档（可选）

实施点
- 发布两套工作流版本与预设：Turbo（steps 8 / cfg 1 / euler / simple）与 Base（steps 31 / cfg 5 / er_sde / beta）。
- 复用现有工作流版本与预设机制，无需新表。

验收
- 切换预设后，日志中的 steps/cfg/sampler/scheduler 与实际提交一致。

## 十、阶段 6：LoRA 真实启用与验证

前置
- 当前实例 models/loras 为空，需先放入兼容 LoRA 文件（用户操作）。

实施点
- 验证三级覆盖（全局 → 角色 → 镜头）、同一文件只加载一次、后级覆盖前级。
- 触发词在优化完成后追加一次，并出现在日志与工作流快照中。
- 缺文件时阻止提交并指出具体文件名。

验收
- 真实带 LoRA 生图一次；日志含 LoraLoaderModelOnly 节点与 LoRA 文件名；触发词只出现一次。

边界
- 没有文件时保留模拟测试，并如实报告“真实带 LoRA 未验证”。

## 十一、阶段 7：对照验证与交付

任务
- 用阶段 0 的同一镜头描述与同一 seed，分别跑改造前与改造后；对比提示词形态、分辨率、细节。
- 可选：让邻舍用同一描述出图（邻舍可经 SthStart 公共生成接口提交，便于同引擎对比）。
- 人工判断画面是否更贴近镜头描述。

验收
- 交付改造前后提示词对照、日志 ID、图片路径。
- 明确写出仍未验证项（如 LoRA、超分）与残余问题。
- “更好看”由人工判断，不得用测试替代。

## 十二、自动化测试范围（个人项目，够用即可）

| 范围 | 必测 |
| --- | --- |
| 契约 | outputFormat 新字段；槽位结构合法性；旧策略默认 prose |
| 合成器 | 重复段去重；互斥；solo；多角色不跨人裁剪；触发词只加一次 |
| 优化器 | tags 模式成功/非法 JSON/超时；日志含原文与最终提示词；失败不产生生图任务 |
| 知识库（若做 2b） | 命中、同义、分类上限、互斥裁剪 |
| 预设/工作流 | 语义宽高映射；1080p 预设生效；旧版本仍可读 |
| 真实链路 | 每阶段至少一次真实生图并核对日志与图片尺寸 |

推荐命令（按改动范围选择，不必全量 CI）
~~~text
npm run test:contracts
node --import tsx/esm --test apps/service/src/activities/prompt-tag-composer.test.ts
node --import tsx/esm --test apps/service/src/activity-visual-plan.test.ts
node --import tsx/esm --test apps/service/src/activities/beat-renders.test.ts
npm run typecheck
~~~

## 十三、交付报告格式

逐阶段填写：
~~~text
阶段编号与名称：通过 / 未通过，附证据
实际修改文件及其职责
数据库迁移编号、备份路径、完整性结果（若涉及）
契约测试 / 靶向服务测试 / 类型检查结果
真实生图的调用日志 ID、图片路径、分辨率、seed
改造前后提示词对照
仍未验证项与残留问题
~~~

## 十四、建议实施顺序

必做：阶段 0 → 1 → 2a → 3 → 7
可选增强：2b（知识库）、4（超分）、5（双档）、6（LoRA）

理由：1 与 2a 直接针对“效果差距”的主因且风险可控；3 修正名不副实的默认分辨率；7 用于确认收益。2b/4/5/6 属于增强，可按需要单独排期。

## 附录 A：画风质量词重复的实测片段

某次真实提交（活动 6062ed73-ae09-45ef-8d0f-d400ac42bf66，镜头 329e1053，seed 1468015829，调用 19198a40）的最终正向提示词结构为：

@ebora,masterpiece, best quality, score_9, score_8，highres, absurdres,anime screenshot,year 2025,
<正文：Albedo ... calm atmosphere.>,
@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025

首尾两段为同一画风质量串，来源分别是工作流节点图与策略 positiveSuffix。

## 附录 B：关键文件索引

- 提示词策略契约：packages/contracts/src/activity-image-prompts.ts
- 提示词优化器：apps/service/src/activities/image-prompt-optimizer.ts
- 策略读写：apps/service/src/activities/image-prompt-policies.ts
- 标签合成器：apps/service/src/activities/prompt-tag-composer.ts
- 统一收尾：apps/service/src/activities/image-render-common.ts（finalizeActivityVisualPrompt）
- 镜头入口：apps/service/src/activities/beat-renders.ts
- 漫画入口：apps/service/src/activities/comic-renders.ts
- 素材入口：apps/service/src/activities/image-attempts.ts
- 前端策略面板：app/features/generation/components/activity-image-prompt-policy-panel.tsx
- 迁移定义：apps/service/src/database.ts
- 邻舍参考：upstream/linshe/agent-core/src/services/imagePromptPreparer.js、imageSkill.js、imageRefine.js、workflowTemplates.js、db/imagePromptKnowledgeData.js

