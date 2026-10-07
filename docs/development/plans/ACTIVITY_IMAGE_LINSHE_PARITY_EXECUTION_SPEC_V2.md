# 活动生图对齐邻舍：完整实施与交接规格 V2

> 编制日期：2026-10-03（Asia/Shanghai）。
> 状态：**已实施（大部分）**——阶段 0–7 的代码、契约、迁移、注册与 UI 均已落地并在真实实例上验证，真实提交 7/12。**逐项完成度、证据与未完成项见 §21**（本文件原先写“待实施”，该行已按实际进度更新）。本文件仍是开发规格；实施细节与失败记录以 `docs/development/logs/activity-image-linshe-parity-v2-progress.md` 为准。
> 更正优先：§21.7 更正了 §21 的若干结论，冲突时以 §21.7 为准。
> ⚠️ **真实业务库 `data/sthstart.db` 当前已确认损坏**（迁移版本 49，`PRAGMA integrity_check` 报 2 个 btree／100 个页面 `btreeInitPage() returns error code 11`，`foreign_key_check` 报 `database disk image is malformed`）。**在真实库确认健康之前，不得进行真实联调**（不启动会自动迁移的服务、不写真实活动、不调用真实模型）。诊断见 `docs/development/logs/activity-image-parity-round2-db-diagnosis.md`。
> 本文件替代同目录 `ACTIVITY_IMAGE_LINSHE_PARITY_IMPLEMENTATION_PLAN.md` 作为本轮实施依据；旧文件保留用于对照。两者冲突时以本文件为准。
> 交付方式：分轮完成全部约定功能。每阶段实现与验收通过后再继续；真实 LoRA 验证依赖用户提供兼容文件。

## 0. 给执行模型的首条指令

先阅读本文件全文，再阅读项目技能与现有实现；不要根据标题直接开始改提示词。

本轮需要完成：镜头、漫画、活动素材三个入口的提示词编译对齐；解决工作流额外拼接造成的质量词重复；配置 Base/Turbo；接入手动基础放大细化；保留历史、选图、日志、幂等和恢复行为。

不需要重做整个活动工作室，也不需要把邻舍代码整包搬进服务。实现者不得自行更换模型、扩展为向量检索或进阶超分、修改邻舍运行设置、重构无关页面。

实施记录保存为 `docs/development/logs/activity-image-linshe-parity-v2-progress.md`。每阶段更新完成项、检查结果、失败项、证据和下一阶段，不把预计结果写成已经通过。

## 1. 目标、现状与证据等级

### 1.1 最终用户体验

用户在活动画风设置中选择“邻舍对齐”画风，在绘制设置中选择草稿／成稿、尺寸及补充描述，便可从当前镜头、漫画画格或素材说明生成图片。

详细策略、负向词、LoRA、种子与采样仍放在高级设置。生成记录可以查看从中文来源到实际文本编码输入的完整过程。历史图提供“按原配置重绘”“放大细化”“查看日志”，不重新铺开一组常驻参数栏。

“按原配置重绘”是复用参数、换种子生成新图；“放大细化”是以原图为输入低幅重绘。两者不能共用同一按钮含义。

### 1.2 已核对的事实与需要纠正的旧判断

| 项目 | 当前证据 | 实施结论 |
| --- | --- | --- |
| Anima 提示词 | 官方支持 Danbooru 风格标签、自然语言及混合描述 | 不删除自然语言；不预设纯标签必然更好 |
| 附件分辨率 | `EmptyLatentImage` 控件虽写 1920×1128，但输入连到 768／512 的整数节点 | 原附件静态连接给出 768×512；运行时覆盖仍须另查 |
| 邻舍 Base 模板 | `anima_baseV10.safetensors`，31 步，CFG 5，er_sde／beta | 作为 Base 对齐预设 |
| 邻舍 Turbo 模板 | `anima_turboV10.safetensors`，12 步，CFG 1，er_sde／beta | 不使用旧计划中的 8 步、euler／simple |
| 现有合成器 | 已有归一化、去重、互斥和触发词处理 | 不能再把“新增去重函数”当作重复质量词问题的完整修复 |
| 固定工作流拼接 | 服务端合成之后，工作流还能追加固定画师／质量串 | 在新工作流版本消除第二次追加 |
| 当前双档架构 | 已有 `renderProfiles.draft/final`，三入口共享解析 | 配置和验证即可，不新增第二套质量档体系 |
| 邻舍知识检索 | 关键词召回与向量结果可混合，向量不可用时走关键词 | 本轮只移植关键词分支，日志标记 keyword，不冒充 hybrid |
| 上次小样 | 已有真实任务及图片证据，存在最终提示词重复案例 | 可作历史证据，不证明提示词是唯一质量原因 |

Anima 官方参考：[模型说明中的 Prompting](https://huggingface.co/circlestone-labs/Anima/blob/272847f8029a5e46847531f41dbc5f65900674e2/README.md)。这是一份固定版本说明；不要把其中预览版的限制直接套用到本机 Base v1.0。

本轮编制时最近一次 ComfyUI `127.0.0.1:8188` 连接被拒绝。不能据此宣称节点或模型不存在，也不启动服务来完成文档编制。此前实时清单只作为旧环境快照：Base/Turbo、文本编码器、VAE 曾可发现，LoRA 与超分模型清单为空，UltimateSDUpscale 系列节点未安装。执行前必须重新检查实际所选实例。

### 1.3 不能预先承诺的效果

- “提示词形态是质量差距主因”只是假设，需控制变量对照。
- 同模型文件名不等于权重内容必然相同；比较时至少记录实例、文件名、可获得的文件元信息及实际图。
- 属性按人物编译只能减少歧义，不能保证模型绝不串角色。
- 尺寸提高不等于画质必然提高，可能改变构图并增加显存占用。
- 标签、知识库、LoRA 和参考图都不能代替人工判断画面是否符合描述。

## 2. 实施边界与数据保护

### 2.1 必须遵守

1. 记录 Git 状态和重叠文件差异。当前大量改动属于既有工作，禁止 reset、clean、强制 checkout 或用旧文件覆盖。
2. 只读参考 `upstream/linshe`，不修改子模块文件、不更新指针、不在运行时 import 邻舍路径。
3. 工作流只发布新版本或新独立工作流；旧发布版本、预设修订、策略修订及实际任务快照不可变。
4. 三入口继续通过 `createGenerationTask()`；不要直接请求 ComfyUI `/prompt`、另建下载结果管线或绕过生成审计。
5. 不修改 `app_llm_assignments`、邻舍公共服务开关或其他应用的用途绑定；优化器继续使用现有活动模型与已授权的任务级备用机制。
6. 所有图片都通过产物目录解析与引用机制管理。禁止凭前端 URL、Windows 绝对路径或“文件看起来在 output 目录”判断归属。
7. 镜头保留既有首次自动入镜规则；漫画只改漫画文档；素材保留配方、编译及采纳链路。本轮细化结果一律 history_only，包括空镜头。
8. 失败任务不计入图片数；只有已入库且文件可读的产物才作为可选图片。一次任务的全部图片产物都保留。
9. 请求断流、5xx、提交结果不明、上游可能继续等状态不能变成可自动重投的失败。
10. 服务端有版本／内容冲突时保留本地输入；后台不得静默覆盖正在编辑的草稿。

### 2.2 本轮不做

- 新的生图引擎、模型下载、模型训练、LoRA 训练。
- 新向量库、嵌入服务、邻舍向量同步调度器。
- UltimateSDUpscale、超分模型安装、分块高级细化、自动面部修复。
- 自动视觉评分、自动采纳、自动拒绝或质量驱动的无限重试。
- 邻舍客户端升级、跨应用全局并发调度改造或全局 GPU interrupt。
- 无关前端重构、数据库清理、旧工作流删除和 SD 模型卸载。
- 默认部署、Git 提交或推送。真实迁移／新配置注册须确认实际数据目标及对应授权。

### 2.3 必读技能

- `.agents/skills/contract-first-api/SKILL.md`
- `.agents/skills/db-migration-backup/SKILL.md`
- `.agents/skills/frontend-ui-standards/SKILL.md`
- `.agents/skills/project-verifier/SKILL.md`
- `.agents/skills/linshe-submodule-sync/SKILL.md`

技能负责项目操作规范；本计划中的功能范围、兼容约束和阶段门槛不可被“通用最佳实践”扩大。

## 3. 现有接入点与模块职责

| 模块 | 已有能力／本轮职责 |
| --- | --- |
| `packages/contracts/src/activity-image-prompts.ts` | 策略、优化结果和编译诊断的唯一跨端契约来源 |
| `packages/contracts/src/activity-studio-jobs.ts` | 复用目标、版本上下文、任务及结果 Schema；细化不新增 job kind |
| `packages/contracts/src/index.ts` | 导出新增契约；扩展 `GenerationEditorConfigSchema` |
| `apps/service/src/activities/image-prompt-policies.ts` | 策略读取、旧值兼容、CAS 新修订保存 |
| `apps/service/src/activities/image-prompt-optimizer.ts` | 模型请求、幂等、错误与审计；增加 tags 分支，不重写传输层 |
| `apps/service/src/activities/prompt-tag-composer.ts` | 现有 legacy 处理保持兼容；增加有作用域的 V2 合成能力 |
| `apps/service/src/activities/image-render-common.ts` | 三入口统一参数解析与最终提示词组装；计划哈希纳入新快照 |
| `apps/service/src/activities/visual-settings.ts` | 沿用现有活动／目标／档位覆盖规则 |
| `apps/service/src/activities/beat-renders.ts` | 镜头来源、历史与选图；接入编译上下文及细化历史适配 |
| `apps/service/src/activities/comic-renders.ts` | 漫画来源、历史与选图；不写原镜头 |
| `apps/service/src/activities/image-attempts.ts` | 素材配方、attempt、执行快照、父子关系与产物 |
| `apps/service/src/activities/studio-routes.ts` | 管理接口、调度、关闭钩子；先按 operation 分派细化 |
| `apps/service/src/activities/studio-recovery.ts` | 不重投的恢复与人工继续；识别细化操作 |
| `apps/service/src/activities/studio-render-results.ts` | 任务核对、文件可用性、原生历史同步；不生成、不选图 |
| `apps/service/src/generation/configuration.ts` | 解析／校验新编辑配置字段，避免解析时丢失字段 |
| `apps/service/src/generation/execution.ts` | 继续负责排队、上传、提交、结果、任务与调用记录关联 |
| `apps/service/src/artifacts.ts` | 图片路径、归属、引用、清理保护 |
| `app/features/activities/studio-api.ts` | 细化请求集中放这里，queries／mutations 同步扩展 |
| `app/features/generation/components/activity-image-prompt-policy-panel.tsx` | 策略模式、兼容提示、保存错误 |

建议新增小模块：

```text
apps/service/src/activities/
  image-prompt-v2.ts             # 有作用域的纯编译、规则与最终组装
  image-prompt-knowledge.ts      # keyword 检索纯函数
  image-prompt-knowledge-data.ts # 版本化静态词表
  image-prompt-snapshot.ts       # 历史实际编码文本与加载器快照解析
  studio-hires.ts                # 预览、冻结、任务与调度适配
  studio-hires-history.ts        # 细化到三类原生历史的适配
```

新模块名称是建议的落点，职责不能合并到一个继续膨胀的大函数。不要为本轮重排所有活动目录。

## 4. 分轮与阶段门槛

| 轮次 | 阶段 | 必交付内容 | 进入下一阶段条件 |
| --- | --- | --- | --- |
| 第一轮 | 0 | 基线、环境、接入点、旧问题分类 | 工作区保护和事实清单完成 |
| 第一轮 | 1 | 新工作流、唯一画风来源、实际编码文本 | 去重、旧工作流兼容和快照测试通过 |
| 第一轮 | 2 | 策略迁移、结构化优化、keyword、三入口、最小策略 UI | 三入口自动化和受控对照完成；收益如实记录 |
| 第二轮 | 3 | Base/Turbo、尺寸与活动画风注册 | 参数／覆盖／显式应用测试通过 |
| 第二轮 | 4 | 基础放大细化、历史、恢复与接口 | 三类历史、幂等和恢复测试通过 |
| 第二轮 | 5 | 完整常用／高级 UI、历史菜单、日志详情 | 桌面／窄屏真实交互检查通过 |
| 最终 | 6 | LoRA 回归与真实验证 | 模拟通过；真实项有证据或标明外部阻塞 |
| 最终 | 7 | 总回归、效果对照、交付报告 | 全部功能门槛通过，未验证项明确 |

外部环境暂不可用时可以完成对应代码和模拟检查，但阶段报告写“实现完成，真实门槛未通过”。不能把整个计划标成全部完成。

## 5. 阶段 0：基线与保护

### 5.1 检查顺序

```powershell
git status --short
git diff --stat
git submodule status upstream/linshe
git -C upstream/linshe status --short
```

读取当前数据库迁移数组最大版本。本次审查为 48，实施时使用实际最大值加一，不写死下一版本为 49。

运行已有相关测试建立基线，优先合成器、视觉计划、三入口及工作室恢复；失败要分类为旧问题、新问题或环境问题。

### 5.2 记录内容

- 邻舍实际 SHA、安装包工作流路径、模板来源分别记录，不能混为同一版本。
- 当前活动用途、引擎 ID、工作流 ID／版本、预设 ID／修订、策略修订及实际默认绑定。
- 真实对照采用的 UNET／文本编码器／VAE、采样、尺寸、负向词、LoRA、参考图和 seed。
- 所选引擎实时 `/object_info` 清单；离线写 unknown，不写 missing。
- 现有真实样例目录和完整调用 ID；短 UUID 只适合显示，不作为交付定位依据。

不要为了取得基线清理旧图片、修改邻舍公共开关或启动可能迁移真实数据库的服务。

## 6. 阶段 1：唯一组装来源与新工作流

### 6.1 固定方案

采用 **服务端组装完整提示词，工作流只编码与生成**。不采用旧计划的“把固定质量词留在工作流、只把策略清空”的方案。

建立独立工作流族 `anima-activity-linshe-parity`，通过现有导入／草稿／发布机制发布版本。避免改变旧 `anima-activity-1080p-eval` 的任何已发布定义。

新版本：

- 同类型模型加载器、KSampler、VAE 解码、SaveImage。
- 正／负提示词语义字段分别直接绑定 `CLIPTextEncode.inputs.text`。
- 不使用固定画师／质量串的 StringConcatenate 分支；不隐藏另一次前后缀追加。
- 保留明确的动态 LoRA MODEL 插入点；不预置固定 LoRALoader。
- 参数仍按语义绑定，不能只依赖字段叫 `width` 或 `height`。
- 预设锁定模型与采样参数；尺寸可在允许范围内单独覆盖。

扩展编辑配置：

```ts
promptAssembly?: 'service-finalized-v1';
```

缺失表示 legacy。只在项目新增并验证过的新版本声明该字段。必须同时更新 `GenerationEditorConfigSchema`、`parseEditorConfig()`、严格保存校验及序列化测试；仅改类型而未改解析器会丢字段。

发布校验：此标记要求正／负文本输入能直接绑定编码器。当前只支持此种直接绑定的标准 Anima 图；不根据任意自定义节点猜实际文本。图不满足条件时阻止发布，错误指向节点和字段。

### 6.2 画风所有权

- 新工作流的画师／质量／风格由活动画风的 `positiveStylePrompt`／`globalStylePrompt` 管理。
- 新策略 `positiveSuffix=''`，前端显示为“由活动画风管理”而不是第二个可编辑画风框。
- 保存新组装模式的策略时，非空 positiveSuffix 返回 409 `prompt_policy_style_managed_by_activity`。
- 旧工作流及旧策略的 positiveSuffix 保留语义，不批量清空。
- 新策略 tags 模式只允许用于声明了新组装方式的工作流；否则返回 409 `prompt_policy_workflow_incompatible`。

统一 V2 组装顺序：LoRA 触发词 → 活动画风／质量 → 明确人数 → 角色块 → 相机 → 环境 → 细节 → 必要自然语言。

角色块使用明确身份与关系句衔接。不能仅把两个角色的眼睛、服装和动作混进同一个无归属标签列表。

### 6.3 有作用域的去重

现有 legacy 合成器不做破坏性行为更改。V2 规则：

- 全局画风、数量、相机和环境可以在各自块去重。
- 每个角色块独立去重；不能删掉第二个角色同样的发色。
- 仅完整归一化标签相同且权重表达相同的段自动去重；不同显式权重不擅自合并，诊断中提示。
- 支持括号内逗号及转义分隔的最小扫描，不直接 `split(',')` 拆坏权重表达。无法安全分析的表达保留为不透明段并给诊断，不自行改权重。
- LoRA 触发词完整标签匹配，不能用 `includes()` 把短词误判为已经出现。
- 同一触发词列表内部也去重；触发词既已存在正文时只保留一次，不重新前置第二份。

### 6.4 实际编码文本

新工作流中日志的 finalPositive／finalNegative 必须等于编码器节点 text。

旧快照只允许安全解析字符串字面量和已有 StringConcatenate 链，按真实 delimiter 组装；循环、未知节点或缺值返回“无法解析旧实际编码文本”。不得用请求的 prompt 字段冒充实际编码输入。

解析器不执行任意节点、不访问网络、不 `eval` 字符串。旧历史记录不回填伪造字段；显示值和可读性说明即可。

## 7. 阶段 2A：契约与数据库

### 7.1 策略字段

现有策略请求／响应增加：

```ts
outputFormat: 'prose' | 'tags';
knowledgeMode: 'none' | 'keyword';
```

旧请求字段可省略：读取和保存规范化为 prose／none。新响应始终返回明确值。tags 可以启用或关闭 keyword；本轮 prose 仅支持 knowledgeMode=none，其他组合返回明确校验错误。

新“邻舍对齐”策略创建时显式写入 tags／keyword；无策略记录的旧工作流仍按 prose／none 解析。不要全局修改默认指令使旧活动突然走 JSON。

模型输出 Schema 示例（必须为 TypeBox，不能照抄 interface 当运行时校验）：

```ts
const strict = { additionalProperties: false } as const;
const tags = () => Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 16 });

export const StructuredVisualPromptSchema = Type.Object({
  actors: Type.Array(Type.Object({
    actorId: Type.String({ minLength: 1, maxLength: 160 }),
    identity: tags(), appearance: tags(), clothing: tags(),
    action: tags(), expression: tags(),
  }, strict), { maxItems: 8 }),
  camera: tags(), scene: tags(), details: tags(),
  naturalLanguage: Type.String({ maxLength: 2000 }),
}, strict);
export type StructuredVisualPrompt = Static<typeof StructuredVisualPromptSchema>;
```

额外限制：所有块合计最多 128 个标签；模型原始响应最多 32,000 字符；超限直接失败，不截断成另一份有效输出。tags 模式首版支持最多 8 个可见绑定角色，超过时预检说明限制；prose 旧行为不受此上限影响。

### 7.2 编译上下文与诊断

内部 `VisualPromptContext` 保存：目标类型、冻结来源指纹、可见角色快照、明确可见人数或 null、结构化导演约束、来源列表、用户补充描述。服务内私有类型不必搬到公共契约。

`actors` 不等于活动全部角色：只取当前目标明确参与画面的角色。未知匿名人物不伪造角色库 ID；在必要关系句说明，人数无法确定时保持 null，不补 solo。

跨端编译诊断应有 TypeBox Schema，最低字段：

```text
compilerVersion / outputFormat / knowledgeMode / knowledgeVersion
structuredPrompt（可空）
knowledgeHits：条目ID、actorId或全局、标签、分数、原因
removedTags：作用域、标签、删除原因
warnings
styleSource / policyRevision / sourceFingerprint
finalPositive / finalNegative / finalPromptHash（完成后才有）
```

预览尚未运行优化时，structuredPrompt 和 finalPositive 等保持空值，并明确 phase=source_preview；不可提前伪造优化结果。

### 7.3 迁移内容

新迁移采用现有 `{ version, name, statements }`，不修改旧迁移：

```sql
ALTER TABLE activity_image_prompt_policy_versions
  ADD COLUMN output_format TEXT NOT NULL DEFAULT 'prose'
  CHECK(output_format IN ('prose','tags'));
ALTER TABLE activity_image_prompt_policy_versions
  ADD COLUMN knowledge_mode TEXT NOT NULL DEFAULT 'none'
  CHECK(knowledge_mode IN ('none','keyword'));
ALTER TABLE activity_prompt_optimization_runs ADD COLUMN slots_json TEXT;
ALTER TABLE activity_prompt_optimization_runs ADD COLUMN compilation_snapshot_json TEXT;
ALTER TABLE activity_prompt_optimization_runs
  ADD COLUMN request_hash_version INTEGER NOT NULL DEFAULT 1;
```

新运行写 request_hash_version=2。不改变原优化运行状态 CHECK；上游请求是否可能继续仍以实际 AI 调用记录和统一任务为证，不把旧表 failed 当作可重投证明。

旧 policy_snapshot_json 不批量重写，读取时补兼容值；旧运行无 slots_json 就显示“旧模式，无结构化记录”。

### 7.4 哈希与旧缓存

V2 优化哈希包含来源文本、作用域上下文、工作流及组装方式、策略快照、编译版本、词表内容哈希、任务级优化模型配置哈希。

旧行先按 hash_version=1 使用原算法验证，并且仅允许请求仍是 prose／none 的原有语义。不要把新增字段塞进旧算法导致所有旧成功行失效。校验通过复用原结果；不同请求仍冲突；旧 preparing 不重发。

新成功缓存返回同一 structuredPrompt、诊断、优化文本、调用 ID 和 traceId，而不是重新跑词表得到不同结果。

视觉预览 planHash 在优化之前计算：包含来源、策略／编译／知识版本、工作流、预设、参数、LoRA、参考图和 seed。不把尚未产生的模型输出加入该预检 hash。

优化完成后另计算 finalPromptHash，只用于记录实际编码文本。不能因为优化把来源字符串改成标签而误判原预览过期。

### 7.5 真实数据库操作

只在准备实际启用新版本、已确认实际配置与任务授权后：

```powershell
npm run db:check
npm run db:backup
npm run db:migrate
npm run db:check
npm run db:integrity
```

记录一致快照备份位置与外键检查结果。WAL 数据库不能只复制 .db 文件。普通 db:backup 不含媒体二进制；本轮不删除或覆盖媒体，因此无需为 schema 测试复制整个媒体库。

## 8. 阶段 2B：结构化优化与 keyword

### 8.1 优化器分支

保留现有审计请求入口、onRecord、幂等插入所有权、停止检查及任务级模型选择。只扩展业务编译分支：

```ts
// 伪代码，函数名为建议；不是可直接复制运行的实现。
if (!policy.enabled) return recordSkippedSourceWithoutLlm();
if (policy.outputFormat === 'prose') return executeExistingProsePath();

const hints = retrieveKeywordHints(frozenContext, knowledgeSnapshot);
const response = await requestStructuredPromptWithExistingAuditedTransport(hints);
const structured = parseStrictJson(response); // 不先 cleanPrompt()，不移除任意解释段
validateStructureAndActorScope(structured, frozenContext);
const normalized = compileScopedTags(structured, hints, frozenContext);
saveOptimizationAndDiagnosticsAtomically(normalized);
return normalized;
```

系统指令必须包含：只返回约定 JSON；只使用给定 actorId；保留外观、动作、地点、时间和构图；不增加重大事件或人物；不输出台词、画师／质量词、LoRA 触发词、URL 或参数；词表只是可选表达，不是必须全部添加的要求。

请求 tags 时 maxTokens 初始使用 4096，仍服从现有配置／上游能力；超过预算或返回 finish_reason=length 时失败，不以截断内容生图。超时沿用现有 60 秒边界，不暗中延长或自动换模型。

检查 actorId 集合、重复 ID、已知人数与明显硬约束。翻译后每一个视觉语义是否完全准确无法靠 Schema 保证，交付中不得作此承诺。

错误码至少区分：invalid_json、invalid_shape、actor_scope_invalid、empty_output、output_too_large、truncated、upstream_error、timeout。前端显示中文原因；非法输出时图片提交次数必须为零。

关闭优化时记录 skipped：不生成 slots、不调用 keyword、不补 solo、不要求用户开模型；新工作流仍可由用户来源文本加活动画风正常生成。

### 8.2 keyword 规则与来源

参考邻舍 `imagePromptKnowledge.js` 的关键词分支及 `imagePromptPreparer.js` 的选择规则，不复制向量请求、数据库同步、后台计时器或降级状态。

词表副本记录 sourceRepository、sourceCommit、datasetVersion、contentHash 和裁剪说明。保留原有来源／许可说明；不要声称静态复制等于可无条件对外再分发。首版提取通用人物、服装、动作、环境、物体、相机词表，不引入成人专用类别。

固定流程：

1. 角色外观／动作分角色建立 query，相机／环境单独建立 query。
2. 拉丁词、中文连续 n-gram 召回；候选排序使用分数、priority、稳定 ID。
3. 每个作用域最多 9 条知识；候选标签保持邻舍分类配额：人物2、服装3、动作表情3、环境4、场景3、物体2、相机2、风格2。
4. 忽略无显式来源支持的默认人物数量规则；不因检索到某个作品角色自动增加该角色。
5. 否定语境（不要／没有／避免、no／without 等）不能简单转成肯定标签；记录被排除原因。词法不确定时只作为模型提示，不确定性规则不得强制补入最终文本。
6. 显式结构化导演约束优先于模型标签；模型语义优先于知识补全。冲突只在相同作用域裁剪。
7. 诊断记录命中、保留、删除和规则 ID。知识关闭时返回 knowledgeMode=none，不运行同一规则后又假装关闭。

不使用全局正则替换删掉另一个角色的相反姿态或自然语言中的重要关系句。

### 8.3 三入口适配

镜头编译上下文来自当前镜头及活动演员快照；漫画来自绑定冻结内容与画格 actorIds；素材来自现有配方中明确选择的角色与视觉来源。不要从全文搜索名字推断可见角色。

三入口在原有任务快照中保存新编译上下文、策略／知识／编译版本；优化后都走共享 V2 finalizer。单目标、批次、应用并绘制和显式备用优化模型子链路必须使用同一套逻辑。

素材继续使用已有配方和编译记录，不创建一个绕过 sourceRefs、recipeHash 或 executionPlanHash 的第二素材生图入口。

按历史配置重绘复用当时最终输入与版本，不使用当前词表重新解释旧标签。两种历史必须区分：

- legacy 重绘：重放原任务的工作流版本与语义输入，即原拼接节点接收到的未二次拼接文本；仅更换 seed。不能把解析出来的完整编码文本填回同一固定拼接图。
- service-finalized-v1 重绘：直接重放当时最终正负文本、工作流版本与实际输入；不再次执行优化器、画风追加或词表。
- 放大细化：无论来源图属于哪一种，均解析原图实际编码文本，再填入新的直接编码细化工作流。缺乏可安全解析的快照时阻止细化，而不是自动切到当前默认工作流。

日志中的“实际编码文本”是观测结果，不一定等于 legacy 重绘入口应重放的语义输入。不得为了统一字段自动迁移旧重绘的工作流。

### 8.4 第一轮最小 UI

现有策略面板增加“原有描述／结构化混合”与“关键词补全”选择；选择 tags 时显示输出结构说明而不是让用户编辑 JSON。

新工作流画风字段只显示来源和跳转；旧策略继续可编辑 positiveSuffix。保存冲突保留输入。前端/API response schema 必须包含新字段及诊断，不因 Fastify 序列化丢失。

## 9. 第一轮受控对照

对同一个新测试镜头使用三组配置，每组两个固定 seed，共六次图片提交：

- A：旧工作流＋旧策略，忠实记录实际重复串，不人为修饰基线。
- B：新工作流＋prose，相同语义和单份画风，隔离组装改动。
- C：新工作流＋tags＋keyword，相同单份画风，验证结构化改动。

固定模型、尺寸768×512、31步／CFG5／er_sde／beta、负向词、参考图与 LoRA 条件。保存实际编码输入；种子固定不等于跨不同提示词的像素应一致，只是控制一项变量。

B/C 对照不改变尺寸，不把 Turbo 或细化混入后宣称证明了标签优化更优。由人工记录人物、动作、空间关系、道具、场景、文字污染、观感；结果不佳也如实保留。

门槛是链路正确、兼容与可追溯通过；效果结论写实测收益与不足，不以“必然超过邻舍”为自动化验收条件。

## 10. 阶段 3：预设、尺寸与注册方式

### 10.1 固定预设

| 名称 | UNET | steps | cfg | sampler | scheduler | 初始尺寸 |
| --- | --- | ---: | ---: | --- | --- | --- |
| 邻舍对齐 · Base | anima_baseV10.safetensors | 31 | 5 | er_sde | beta | 768×512 |
| 邻舍对齐 · Turbo | anima_turboV10.safetensors | 12 | 1 | er_sde | beta | 768×512 |

文本编码器 `anima_baseV10_txt.safetensors`／type qwen_image；VAE `qwen_image_vae.safetensors`。以预检实际文件为准，缺失不自动替换其他文件。

模型、编码器、VAE、steps、cfg、sampler、scheduler、denoise=1 为预设固定组。允许 seed 和尺寸覆盖；预设值优先规则沿用现有锁定能力，不能新增一套倒序合并。

活动画风预设名为“邻舍对齐 · Anima”，质量／画师串保存一次：

```text
@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025
```

负向词使用已核对的邻舍模板值作为该画风的快照，不覆盖现有用户负向词。建议 draft=Turbo、final=Base、defaultCanvas=768×512；只有用户显式应用才写入当前活动。

### 10.2 尺寸不等于档位

Base/Turbo 是模型／采样组合；尺寸是独立画布设置。不要显示成“草稿必低清、成稿必1080p”。

提供常用尺寸768×512、1024×768、1280×720和1920×1080；后者标注高显存／高耗时，不成为自动默认。沿用工作流真实约束校验，尺寸控件最小／最大／步长来自字段契约；任意非法值在发送模型前指出。

不提供1920×1128为“邻舍默认”。旧1080p命名的 ID 不变，在选择器旁显示真实默认尺寸，并推荐新预设。

### 10.3 配置注册脚本

新增 `scripts/activity-image-parity-config.ts`：

```powershell
node --import tsx scripts/activity-image-parity-config.ts --check
node --import tsx scripts/activity-image-parity-config.ts --apply --confirm
```

默认／--check 只读，列出将创建的工作流、版本、策略、非默认预设、画风、引擎与缺项；真实变更必须 --apply --confirm。

使用现有管理存储／校验能力，不绕过发布机制。新工作流族、预设、画风使用稳定逻辑标识并记录内容哈希；重复 apply 不创建重复修订；同标识内容变化需要明确发布新版本，不修改旧发布行。

注册预设 enabled=true、isDefault=false，使当前选择器能发现它们；不更改旧 `app_generation_assignments`。细化新增的专用 purpose 绑定可建立，但不得覆盖已有同用途绑定。

如果配置中存在多个适用引擎，--check 列出候选，--apply 必须显式给 `--engine-id`，不能猜选第一条。此项是外部配置选择，不属于执行模型可擅自决定的开发事项。

## 11. 阶段 4A：基础细化接口与冻结计划

### 11.1 管理接口

```text
POST /api/v1/admin/activities/:id/studio/hires/preview
POST /api/v1/admin/activities/:id/studio/hires
```

浏览器调用集中在 studio-api.ts，使用业务相对路径 `activities/{id}/studio/hires/...`，由既有管理客户端处理代理、鉴权与 CSRF。

状态、items、stop、reconcile、resume 继续使用现有 `/studio-jobs/:jobId` 系列，不另开一套轮询。

TypeBox 请求最小形状：

```ts
interface HiresPreviewRequest {
  versions: StudioVersionContext;
  target: StudioTarget;
  sourceArtifactId: string;
  maxSize: number; // 整数512..2048，默认2000由UI填写
  denoise: number; // 0.05..0.35，默认0.2
  seed?: number; // 项目现有安全seed范围
}
interface HiresSubmitRequest extends HiresPreviewRequest {
  seed: number; // 必须回传预览seed
  planHash: string;
  idempotencyKey: string;
}
```

预览响应包含 canSubmit、issues、sourceArtifactId、sourceGenerationTaskId、sourceCallId、原图尺寸、预期输出尺寸、sourceFingerprint、seed、实际模型／编码器／VAE、采样参数、正负提示词、LoRA、细化工作流版本、engineId、planHash、透明垫白提示。

submit 返回202与既有 StudioJobSchema；请求、响应在新增 `activity-image-hires.ts` 定义并由 index.ts 导出。未知字段拒绝，不能接受服务器路径、任意 URL、输入文件名、工作流图、模型密钥或传入的实际配置快照。

### 11.2 来源读取

来源必须是该目标原生历史中的图片产物；“同活动但属于其他目标”也拒绝。优先查已关联生成任务的历史行，不信任前端 origin 描述。

冻结原图实际快照：

- 实际编码正负文本、UNET／CLIP／VAE加载输入。
- 明确的唯一 KSampler 的steps／cfg／sampler／scheduler。
- 动态 LoRA 文件、权重和触发词；只有静态链可明确解析且不冲突时才允许。
- sourceArtifactId、sha256、原图尺寸、来源指纹、原任务／调用ID。
- 当前目标定位和版本上下文、新细化工作流／版本／引擎。

旧导入图片无执行快照、多采样器无法确定来源、未知文本拼接、自定义编码器或无法安全识别 LoRA 链时返回 hires_source_snapshot_unavailable。不能用当前默认配置假装沿用原图。

来源图基于旧描述也可细化：预览警告“来源描述已变化”；不会自动写回，之后选择结果仍沿用原生 stale-source 确认。原来源指纹必须随细化结果继承，不能改成当前描述让旧图看起来新鲜。

提交前版本用于保护目标定位与未保存输入；派发过程中不因用户切换当前图片而丢弃细化历史。目标确实被删除则不再发任务；派发后目标被删仍保留产物与任务，不回写草稿。

### 11.3 两类哈希与种子

细化 planHash 包含：来源artifact/hash、来源执行快照、目标、细化工作流／版本、引擎、尺寸、denoise、seed。它不依赖当前画风、当前提示词策略和角色最新 LoRA。

preview 不提交模型或创建生成任务。随机 seed 只在一次预览产生，返回前端；submit 必须带同一个 seed。hash不一致返回409 hires_plan_changed；不重新随机seed来“修正”。

普通三入口也补回归：请求带 planHash 时必须携带预览 seed；旧无planHash调用保持兼容。避免历史脚本中“预览随机seed、提交幂等派生seed”造成永远冲突的问题。

## 12. 阶段 4B：基础工作流与任务执行

### 12.1 固定图形方案

新增工作流族 `anima-activity-hires-basic`，purpose=`activity_image_upscale`，组装方式同 service-finalized-v1。

```text
LoadImage
  → 白底alpha合成（原图有alpha时生效）
  → ImageScale(lanczos, 计算后的宽高, crop=disabled)
  → VAEEncode
  → KSampler(原图采样参数，独立denoise，新的seed)
  → VAEDecode
  → SaveImage
```

加载器和LoRA MODEL链来自原图冻结配置；正负提示词直接绑定编码器，不追加质量串、不优化、不读当前画风。

计算尺寸：scale=maxSize/max(sourceWidth,sourceHeight)，按该比例计算宽高并向下取8的倍数，最小8。若maxSize不大于原图最长边，本轮返回 hires_not_an_upscale，提示使用原图或普通重绘，不把缩小包装成放大。

预览显示实际计算后尺寸，不承诺固定2000×某一高度。生成产物读取真实尺寸核对。

### 12.2 透明图处理

不添加重型图像处理依赖。基础图声明可校验的官方白底合成节点：EmptyImage白色原图尺寸、LoadImage的alpha mask经InvertMask后供ImageCompositeMasked将原图合成到白底；随后放大。

LoadImage的mask通常为反alpha，必须验证mask方向，不能把人物抹掉。用透明红方块与不透明边缘fixture做节点输入/输出验证。非透明图不得产生黑底或变色。实例不具备所需节点时停止，不能忽略mask静默运行。

原图尺寸来自可信媒体元信息／已有探测能力；如果只有PNG产物，可安全读PNG头取得尺寸并验证文件格式。无法可靠取得尺寸返回明确错误，不依赖未经验证的前端宽高。

结果为不透明新图；界面提前说明，不做重新抠图。不得覆盖原始文件或修改其sha256。

### 12.3 存储与调度

复用 activity_studio_jobs，kind仍为render_batch；冻结输入中 `operation='hires'`，只有一条item，placement=history_only。没有新增job kind，无需重建现有kind CHECK。

新增私有 FrozenHiresPlan，不用 Record<string,unknown> 掩盖实际内部结构。对外StudioJob.result仍使用已有StudioRenderResult；完整预览用专用HiresPreview响应。轮询能识别operation并显示“放大细化”，不能显示为“智能分镜”。

冻结对象最低结构如下。使用项目已有类型，补上私有运行时校验；不要把它作为允许浏览器上传的请求 Schema：

```ts
interface FrozenHiresPlan {
  snapshotVersion: 1;
  operation: 'hires';
  target: StudioTarget;
  versions: StudioVersionContext;
  placement: 'history_only';
  sourceArtifactId: string;
  sourceSha256: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceFingerprint: string;
  sourceGenerationTaskId: string;
  sourceCallId: string | null;
  workflowId: string;
  workflowVersion: number;
  engineId: string;
  maxSize: number;
  outputWidth: number;
  outputHeight: number;
  denoise: number;
  seed: number;
  finalPositive: string;
  finalNegative: string;
  actualLoras: ActivityLora[];
  inputs: Record<string, unknown>; // 仅已校验的工作流语义参数，不含路径或密钥
  planHash: string;
}
```

三类原生历史定位的额外信息用以 target.kind 区分的私有联合类型附加：beat 保存来源候选与版本；comic_panel 保存绑定内容版本；media_slot 保存配方、原 attempt 及来源版本。不要把漫画或素材的来源强行转成 beat。

`studio-routes.ts` 的schedule必须先判断operation===hires，再处理原有batch/single分支；否则新任务会误走processStudioSingleRender。recovery／resume／fallback入口同样识别operation，普通文本apply不能作用于细化任务。

### 12.4 指定实际引擎的接入补丁

当前 `resolveWorkflowAndEngine()` 已支持内部 engineId，但 `CreateTaskOptions` 尚未声明和透传 engineId。因此下方示例需要先完成这一小块改动，不能直接复制一个不会生效的字段：

1. 在内部 `CreateTaskOptions` 增加 `engineId?: string | null`，并透传到 resolveOptions。
2. 仅 `isInternal=true` 的业务服务允许使用；非内部调用指定 engineId 返回明确错误。不扩展公共生成请求以接收任意引擎。
3. 显式 presetId 与 engineId 同时出现时，若不同，拒绝冲突；不能越过预设的已授权连接。普通调用不提供该字段时行为不变。
4. 细化不复用原文生图 presetId，以免旧预设选回文生图工作流或把 denoise 锁回 1。它使用新细化工作流版本、已验证的源引擎和冻结实际参数。
5. 原引擎禁用、离线或缺原模型时停止；不静默选其他引擎。加入“预览引擎与任务最终引擎相同”的测试。

若实施时此能力已经存在，先核对现有实现与测试，再复用；不重复改造。

### 12.5 执行伪代码

处理流程：

```ts
// 伪代码：新增模块负责细化，不把整个原生绘制处理器复制过来。
async function processStudioHires(options) {
  // config/database/secrets/fetcher 由现有处理器上下文注入；job/item 已持久化。
  if (!claimExistingQueuedJob()) return;
  const plan = readFrozenHiresPlan();
  checkStopAndTargetExists();
  checkSourceFileHashAndPublishedHiresVersion(plan);
  await inspectActualEngineModelsNodesAndLoras(plan);
  checkStopAndTargetExists();
  await createGenerationTask(config, database, secrets, {
    appId: 'activities', purpose: 'activity_image_upscale',
    workflowId: plan.workflowId, workflowVersion: plan.workflowVersion,
    engineId: plan.engineId, isInternal: true, validationMode: 'strict',
    inputs: plan.inputs,
    inputArtifacts: [{ artifactId: plan.sourceArtifactId, inputKey: 'init_image' }],
    activityLoras: plan.actualLoras,
    seed: plan.seed, idempotencyKey: `studio-hires:${job.id}:${item.id}`,
    audit: { /* 见第14节：原图调用为parent，业务页面为sourceUrl */ },
    onInsertTask(snapshot) {
      // 同一事务：复查停止；建立原生历史；关联job/item/task/call。
      // 任何关联失败都让任务插入事务回滚，不在这里访问网络。
    },
  }, fetcher);
  // 后续只核对这一任务与产物；绝不靠轮询再次createGenerationTask。
}
```

`init_image` 在细化工作流声明必需的image输入capability与LoadImage绑定；用户输入中不传ComfyUI本地filename，由执行器上传后替换并记录映射。

运行时预检可在任务record之后、网络派发之前执行；任务记录先落库。检查节点、模型、编码器、VAE、每个LoRA和实例连接。缺项保存明确原因；没有图片任务或上游请求时记录not_dispatched，不捏造providerTaskId。

## 13. 阶段 4C：原生历史、引用与恢复

### 13.1 三种历史适配

在统一生成任务插入的事务回调中，为对应目标建立原生历史记录：

- beat：创建候选，auto_apply_state=ineligible，source_fingerprint取原图来源，task_id／call_id关联本次细化。
- comic_panel：创建kind=render的漫画job，input_json注明operation=hires及来源图；不应用漫画草稿。
- media_slot：创建对应图像attempt、prepared执行快照及media_job_link，继承原图的来源版本／配方上下文；parent_attempt_ids_json关联原attempt。

原生适配只落历史并关联任务，不能调用其完整生图执行函数、重新优化或自动选图。若需要抽出插入行／关联任务的内部辅助函数，只抽共享存储行为，不改变原入口规则。

历史响应复用一个可选 `ImageOperationMetadataSchema`：operation=render|hires、parentArtifactId（可空）、studioJobId（可空）。添加到三类图片历史响应；旧行不回填，未提供时UI按render显示。

结果收集复用collectStudioRenderResult及对应原生同步器，全部产物建引用、全部可读图进入历史。材料及漫画不能只在工作室任务中看见图片，却在原生历史中找不到。

### 13.2 引用与父子关系

- 源图冻结时由StudioStore.create建立activity_studio_job引用，保留同活动归属校验。
- 结果沿用activity_studio_render及原生历史引用。
- 产物父子关系在冻结与结果记录中始终用artifactId；已有activity_assets提供assetKey时复用recordAssetLineage登记role=hires，不创建一个平行素材图谱。
- media attempt继续登记parentAttemptId及既有recipe reference。
- 若删除工作室草稿引用，不删除不可变任务、原生历史及父图仍需的引用。

### 13.3 幂等、恢复与停止

| 情况 | 处理 |
| --- | --- |
| 同key同请求 | 返回原job；不重复生成、上传或插入历史 |
| 同key不同请求 | 409 idempotency_conflict |
| 浏览器响应丢失 | 保留原key／请求，重发查询原job |
| 服务重启，未关联生成任务 | interrupted；只允许明确确认未发出的工作后继续 |
| 已关联queued生成任务 | 先冻结不自动派发；人工resume释放原task，沿用原seed／图 |
| 已提交／正在运行 | 核对原providerTaskId，不重新提交 |
| 上游不确定 | unknown；仅reconcile，不允许普通retry或备用预设重投 |
| 已成功但本地文件丢失 | 保留历史，标文件不可用；不伪造可恢复 |
| 用户停止 | 阻止后续发送；已提交的任务继续核对保留结果，不全局interrupt |
| 目标删除 | 派发前阻止；派发后保留task/artifact，不写回草稿 |

修改resumeStudioJob时先按operation分派，不能调用resolveStudioBatchTarget重算一个普通文生图计划。细化任务不进入原图片备用预设入口；本轮失败后用户可明确新建细化，unknown不能借此复制原任务重投。

生成事件订阅／计时器在onClose注销。确认server启动顺序仍在统一生成调度器派发前冻结上次细化queued任务。

## 14. 调用日志与可观测性

不新增平行日志数据库。优化继续使用activity.image.prompt.optimize；细化新增activity.image.hires，加入业务事件中文名称与业务返回链接映射。

优化链保存：原始来源、策略快照、原始模型文本响应、结构化结果、知识命中／删除、编译版本、画风来源、最终正负提示词。

生图调用保存：工作流／版本、预设／修订、actualInputs、实际编码文本、加载器和LoRA图、seed、尺寸、上游任务ID、产物引用。直接绑定图要求日志字符串与CLIPTextEncode.text一致；旧图无法解析时明确显示未知。

细化调用：traceId为本细化job；parentId为原图调用ID（可获得时）；parameters包含operation、sourceArtifactId、sourceTaskId、sourceFingerprint、maxSize、计算宽高、denoise、实际继承配置。输入文件上传映射由执行器记录，正负文本复用原图最终编码输入。

sourceUrl指向业务工作室，并带studioJobId及目标定位；不得被上游URL覆盖。成功后从日志能回到正确目标历史。

递归脱敏继续复用ai-call-trace，日志不存密钥、鉴权头、base64或图片二进制。提示词与正常文本响应完整保存，不因本轮诊断量增加而静默截断现有用户日志。

## 15. 阶段 5：UI实施规格

### 15.1 常用设置

活动级画风弹窗：画风预设、草稿／成稿、尺寸、当前模型摘要、显式“应用到本活动”。不自动更改已有全局默认。

目标绘制弹窗：继承活动画风摘要、补充描述、可选目标覆盖；高级区包含策略模式说明、负向词、LoRA、参考图、seed、采样。用户不需要手工输入JSON、用途字符串或模型文件路径。

策略编辑仍放生成设置，不在每个目标新增完整策略表单。常用页清楚说明模式来自哪个工作流／策略修订。

### 15.2 历史菜单与细化弹窗

每张可读历史图的菜单：使用为当前画面（沿用现有选图行为）、按原配置重绘、放大细化、调用日志。

细化弹窗默认只展示原图、预计尺寸、最长边选项1536／2000／2048、重绘幅度0.2及“开始细化”。高级区展示实际继承配置只读摘要。当前不满足可放大尺寸／缺快照／文件不可用时给具体原因，不只灰掉按钮。

打开弹窗本身不提交草稿、不创建任务、不调用模型。用户点击预览／开始前先flush现有草稿队列，处理409时保留本地文本。来源图是旧描述时提示但不自动采纳结果。

任务创建后保持原图可见，处理中历史记录显示细化进度；结果标“细化”，菜单可查看来源图；失败在任务记录区，图片数只统计产物。

### 15.3 响应式与日志

- 桌面复用现有Dialog，窄屏复用Drawer，参数区滚动、底部动作可达。
- 不增加第四栏，不给工作室根容器叠加h-screen；保持min-h-0/min-w-0和各栏独立滚动。
- 日志详情分“来源→优化→规则→最终输入→实际图→产物”，折叠长JSON，不删去必要信息。
- 长中文、长文件名与错误信息可换行，不靠固定高度截断。
- 保存／生成失败留在当前浮层，并保留原图、描述和请求key。

## 16. 阶段 6：LoRA与参考图验收

复用当前全局→角色→目标覆盖，同名文件只注入一次；多个角色同名配置不同且目标未覆盖时阻止提交。禁止“最后一个角色配置赢”作为隐性策略。

触发词在V2最终收尾中完整匹配一次。细化读取原图实际LoRA，不重新合并最新全局／角色设置；原文件缺失直接停止。

参考图仍按工作流capability和输入绑定预检。新的纯文生图对齐图未声明参考图能力时明确说明“仅文字描述”，不能显示角色已锁定。细化的init_image是源图，不伪装成角色参考控制。

没有兼容LoRA文件时完成mock测试，真实项写阻塞；不得下载任意角色LoRA来凑验收。用户安装后做一次带LoRA生成并核对图、权重、触发词、日志及人工画面。

## 17. 自动化测试范围

### 17.1 必测用例

| 测试组 | 最小用例 |
| --- | --- |
| 契约 | 旧请求默认prose/none，新模式组合，额外字段，结构化上限，hires响应完整 |
| 迁移 | 旧policy/run保留，slots可空，hash版本默认1，外键／integrity，重复迁移 |
| V2合成 | 同作用域去重、跨角色同发色保留、不同姿态保留、空场景无solo、未知人数不猜 |
| 规则 | 导演优先、否定语境、括号逗号、同权重去重、不同权重不擅自合并、触发词完整匹配 |
| 优化 | 合法JSON、损坏JSON、未知/遗漏角色、超时、截断、超限、关闭优化、失败零图片请求 |
| 缓存 | 同key复用完整结果，异内容409，旧hash复用，preparing不重发，新知识版本进入hash |
| 三入口 | 镜头/漫画/素材共享收尾、素材配方保留、批次停止与未知状态、历史重绘不优化 |
| 预设 | Base/Turbo锁定组，真实尺寸字段映射，目标覆盖，不修改旧默认，check脚本只读 |
| 引擎解析 | 内部 engineId 透传，非内部指定被拒，预设/引擎冲突被拒，预览与实际一致 |
| 快照 | 直接编码相等、旧concat顺序/分隔、环路/未知节点拒绝、多采样器不猜 |
| 细化安全 | 非管理员、跨活动、跨目标、缺图、缺快照、输入路径/URL/任意图拒绝 |
| 细化事务 | job/item先落库，onInsert晚期失败回滚关联和task，同key不重复原生历史 |
| 细化历史 | 三类选图能看到全部图片，原图不变，漫画不写beat，stale指纹继承 |
| 细化恢复 | queued人工释放、running核对、提交不明unknown、重启不重投、stop不全局interrupt |
| 透明图片 | mask方向、白底、原图不变、输出不透明、尺寸预期与产物一致 |
| UI | 预览seed回传、响应丢失原key重发、409留输入、窄屏菜单/浮层可操作 |

新增测试建议：

```text
packages/contracts/src/activity-image-prompts.test.ts
packages/contracts/src/activity-image-hires.test.ts
apps/service/src/activity-prompt-v2.test.ts
apps/service/src/activity-prompt-knowledge.test.ts
apps/service/src/activity-prompt-snapshot.test.ts
apps/service/src/activity-prompt-migration.test.ts
apps/service/src/activity-studio-hires.test.ts
apps/service/src/activity-studio-hires-recovery.test.ts
```

如果已存在同职责测试，扩展它而不是另造重复文件。不要把目标阈值改低或删除unknown断言来让测试通过。

### 17.2 执行命令

先跑当前阶段定向文件，再跑以下相关回归；PowerShell命令不用未展开的目录通配符猜文件：

```powershell
npm run test:contracts
node --import tsx/esm --test apps/service/src/activities/prompt-tag-composer.test.ts apps/service/src/activity-visual-plan.test.ts apps/service/src/activity-art-direction.test.ts
node --import tsx/esm --test apps/service/src/activity-studio-render-optimizer.test.ts apps/service/src/activities/beat-renders.test.ts apps/service/src/activity-comic-renders.test.ts apps/service/src/activities-images.test.ts
node --import tsx/esm --test apps/service/src/activity-studio-batches.test.ts apps/service/src/activity-studio-single-render.test.ts apps/service/src/activity-studio-recovery.test.ts apps/service/src/activity-studio-image-fallback.test.ts
node --import tsx/esm --test apps/service/src/generation-configuration.test.ts apps/service/src/generation/runtime-preflight.test.ts
npm run test:portal
npm run typecheck
npm run build:portal
npm run build:service
git diff --check
```

新增测试完成后按实际新增的以上文件逐个执行node测试命令。`npm run test --workspace @sthstart/service` 会先构建再跑全部服务测试，必要时用于最后跨模块回归，不在每次小改后重复全量运行。

门户默认test:portal不会自动覆盖新业务组件测试，新增V2前端纯函数/请求工具测试必须另行运行并记结果。

## 18. 阶段 7：真实样例、截图与预算

### 18.1 预算

默认最多12次实际图片提交，失败提交也计数；无目标批量试图和自动重试不允许。

| 用途 | 次数 |
| --- | ---: |
| A/B/C各两个固定seed | 6 |
| 漫画双角色 | 1 |
| 素材空场景/无人道具 | 1 |
| Turbo真实参数 | 1 |
| 基础细化 | 1 |
| 有文件时真实LoRA | 1 |
| 必要补验 | 1 |

新增脚本 `scripts/activity-image-parity-sample.mjs` 默认只列配置/预算；真实写入必须--confirm，先创建专门测试活动并记录ID。不得复用用户已有活动来填满验收表。

请求串行，启动前观察实际队列；其他应用正在使用时等待或报告，不调用interrupt或unload影响它们。无法得知峰值显存时报告“未测”，不要从总显存猜本次峰值。

1920×1080真实效果不是核心对齐门槛，若要补验应占用预算并单列变量；不能把高分辨率结果与768基线混比较。需要额外额度时报告并请求用户，不无限重试。

### 18.2 浏览器检查

使用现有本地fixture／临时测试服务检查，不自动部署Docker来获取截图。检查1440×900和390×844；主画面与历史补1920×1080一次。

截图新目录：`artifacts/activity-image-parity-v2/<timestamp>/`，不得覆盖旧截图。必须查看图片，不仅记录截图脚本退出码。

覆盖：常用设置、高级策略、单角色/多角色、历史菜单、细化预览/进度/失败、日志实际提示词、空图、缺快照、409输入保护。无控制台异常、无全页横向溢出、当前图与文字编辑不丢失。

真实效果与原生节点输出使用可用实例；实例离线或实际页面未运行本次代码时如实说明。用户授权部署后才执行项目部署脚本并检查健康，部署不是文档或代码单元测试的默认动作。

## 19. 错误码与前端文案最低表

| 场景 | 代码 | 中文含义 |
| --- | --- | --- |
| 新工作流另填画风后缀 | prompt_policy_style_managed_by_activity | 画风由活动设置管理，避免重复添加 |
| tags不兼容旧图 | prompt_policy_workflow_incompatible | 请选择支持服务端组装的新版本 |
| 模型JSON无效 | prompt_optimizer_invalid_json | 模型未返回合法结构化结果，未提交图片 |
| 角色作用域错误 | prompt_optimizer_actor_scope_invalid | 优化结果遗漏或增加了角色，未提交图片 |
| 输出截断 | prompt_optimizer_truncated | 模型结果未完整结束，未提交图片 |
| 来源非本目标历史 | hires_source_not_owned | 图片不属于当前目标的可用历史 |
| 历史缺执行快照 | hires_source_snapshot_unavailable | 无法安全复用原图参数，建议重新绘制 |
| 来源文件不可读 | hires_source_unavailable | 原图文件不可用，记录仍保留 |
| 放大目标不大于原图 | hires_not_an_upscale | 所选尺寸不大于原图，请换更大尺寸 |
| seed/配置变化 | hires_plan_changed | 预览配置已变化，请重新预览 |
| 运行环境离线 | 复用现有连接错误码 | ComfyUI不可达，不能判断模型是否缺失 |
| 上游不确定 | studio_upstream_unknown | 原任务可能仍在运行，只能核对，不重复发送 |

其他错误尽量沿用现有准确代码；不把所有异常转换成“候选未生成完成”。UI不显示原始堆栈或密钥。

## 20. 完成交接与停止条件

### 20.1 必须交付

```text
阶段0–7逐项：通过／未通过／外部阻塞，附证据
修改文件及职责；已保护的既有改动说明
迁移编号、实际数据目标、备份路径、integrity与外键结果
新工作流/版本/内容哈希、非默认预设/修订、画风及策略修订
编译版本、词表来源SHA/内容哈希、是否仅keyword
定向测试/契约/Portal/typecheck/构建的实际结果
真实活动ID、完整任务ID、调用ID、artifactId、尺寸、seed、耗时
六张对照与三入口结果；细化前后原图sha256未变的证据
桌面/窄屏截图和实际查看结论
效果收益、属性串位等仍存在的问题与未验证项
用户如何选择新画风、双档、细化以及回到旧配置
是否部署/提交/推送：默认均否
```

### 20.2 不能算完成的情况

- 只改默认英文指令，没有三入口、快照、哈希和兼容验证。
- 合成器去重通过，但工作流仍追加另一份质量串。
- 新编辑配置字段被parseEditorConfig丢弃。
- 细化任务成功却无法从原生历史选图，或漫画选图改了原镜头。
- 旧图用当前模型/LoRA生成却声称沿用原参数。
- 未知上游请求被当失败重投，或重启再次发送同一任务。
- 只报告HTTP成功、任务completed或截图脚本成功，没有产物可读与人工检查。
- 缺LoRA文件却把真实带LoRA验收写成通过。

### 20.3 遇到以下情况停止相关阶段并报告

需要破坏既有对外接口、修改邻舍子模块/运行模式、删除旧工作流/媒体、暴露管理员Token、绕过生成执行器、安装额外高级节点/下载模型，或必须覆盖用户现有未提交改动才能继续。

普通实现困难不是扩大范围的理由。可以修复本阶段代码和测试，但不得借“完整交付”进行未授权部署、提交、推送或清理。

## 21. 实施状态：完成度与未完成项

> 记录截止：实施第 28 轮。逐轮细节、失败记录与更正见 `docs/development/logs/activity-image-linshe-parity-v2-progress.md`（该文件开头有“当前状态摘要”，可直接接手）。
> 本节只写**已实际观察到**的结果；未验证的一律标注。

### 21.1 阶段完成度

| 阶段 | 状态 | 关键证据 |
| --- | --- | --- |
| 0 基线与保护 | **通过** | 既有未提交改动全程未动；无 `reset/clean/checkout/stash` |
| 1 唯一组装来源与新工作流 | **通过** | 真实实例预检零问题；真实出图 |
| 2A 契约与数据库 | **通过** | 真实库迁移到 **49**，两库 `integrity_check` ok，数据未丢，备份 `data/backups/2026-10-03T07-11-28.124Z/` |
| 2B 结构化优化与 keyword | **部分通过** | 实现与单测完成；**真实模型调用被凭据阻塞**（见 21.3） |
| 2C 第一轮最小 UI | **通过** | 隔离夹具浏览器验收 |
| 3 预设、尺寸与注册方式 | **通过** | `--apply --confirm` 已在真实库执行且幂等 |
| 4A 细化接口与冻结计划 | **通过** | — |
| 4B 细化工作流与任务执行 | **通过** | 修掉两个缺陷后，v3 真实出图 768×512 → **2000×1328** 满幅，来源 sha256 前后一致 |
| 4C 原生历史、引用与恢复 | **通过** | — |
| 5 UI 实施规格 | **通过** | 12 张截图（桌面／宽屏／窄屏），page errors 与 unexpected HTTP 均为 none |
| 6 LoRA 与参考图验收 | **可自动化部分通过；真实 LoRA 不可达** | 实例 `models/loras` 为 **0 个文件** |
| 7 真实样例、截图与预算 | **进行中：真实提交 7 / 12 全部有效** | 见 21.2 |

**回归基线**：typecheck 通过 · 契约 36/36 · 服务 **595/595** · Portal 17/17 · `git diff --check` 0 · `db:check` 49/49（narrative 2/2）。
**安全**：203 项工作区变更中 **0 个跟踪文件被删除**；**未部署、未提交、未推送**。

### 21.2 真实提交口径（7 / 12）

| 组 | 次数 | 状态 |
| --- | ---: | --- |
| A 旧工作流 ×2 | 2 | 成功 |
| B 新工作流 + prose ×2 | 2 | 成功 |
| 漫画画格 ×1 | 1 | 成功（与画格描述一致） |
| Turbo 真实参数 ×1 | 1 | 成功 |
| 基础细化 ×1 | 1 | 成功 |
| C 组 tags + keyword ×2 | 2 | **跳过：凭据** |
| 素材空场景 ×1 | 1 | **未实现** |
| 真实 LoRA ×1 | 1 | **不可达** |
| 补验额度 ×1 | 1 | 按设计未触发 |

**A/B 对照的核心结论**（计划 §9 要求的完整形态）：同一镜头、同一画风下，A 组把画师／质量串注入**两份**（`@ebora`／`masterpiece`／`score_9` 各出现 2 次），B 组**恰好一份**——即 §20.2 所列“工作流仍追加另一份质量串”已被消除，且有逐字计数证据。

`peakVram`：**未测**。

### 21.3 未完成项与阻塞

| # | 项 | 归属 | 说明 |
| --- | --- | --- | --- |
| 1 | **C 组真实对照 ×2** | **用户操作** | 活动文本模型 `ds-jy` 凭据不可用。**在设置页重填该供应商 API Key 即可解锁**；这是唯一能让提交数上涨的动作 |
| 2 | **素材空场景入口 ×1** | 待实现 | 它是独立子系统（attempt／recipe／compilation／binding），**不是“第三个入口”**。入口链路：`media-batches/prepare → media-batches → 轮询`；第一步是给内容草稿加 `kind: 'image'` 的 media slot |
| 3 | **真实 LoRA 验收** | **不可达** | 实例 LoRA 目录为 0 个文件，非实现方可解 |
| 4 | 补验额度 ×1 | 条件项 | 计划规定“确有需要时才占用”，未触发 |
| 5 | 漫画提示词缺英文标签 | 改进项（非阻塞） | `anima` 主要按**英文标签**理解画面。实测：同一画格只加一段英文描述，产物即从与描述无关变为正确。当前依赖用户把英文写进 `composition`／`visualDescription`；编译器本身不产出英文标签 |
| 6 | `previewResponse` 3 个调用点的 `profileReady` 语义 | 待修（优先级最低） | `beat-renders.ts:576、593、602`，位于**同步**适配器内（带“Caller owns the enclosing Studio transaction”契约），异步化会破坏事务契约。**用户可见的预览路由已修正**，此项只影响候选快照 |

### 21.4 实施中发现并修复的缺陷（真实实例验证）

这些多数属于 §20.2 的“不能算完成”，且**只看状态码会漏掉**（任务报 `succeeded` 而结果错误）：

| # | 缺陷 | 后果 | 修复 |
| --- | --- | --- | --- |
| 1 | 活动生图 `encodedTexts` 恒为空（路由只读 `requestSnapshot.workflow`，活动存的是裸图） | 日志详情看不到实际编码文本 | 路由同时接受两种快照形状 |
| 2 | 白底合成缺 `InvertMask`（mask 方向反了） | 细化输出**纯白图** | 新增 `InvertMask` 节点（计划 §12.2 原本就要求） |
| 3 | `EmptyImage` 未绑定来源尺寸（固定 1024×1024） | 画面只占左上角、其余留白 | 新增 `sourceWidth`／`sourceHeight` 绑定 |
| 4 | 注册脚本不推进绑定版本 | 修好的工作流永远不生效 | 同族工作流版本落后时 `advance` |
| 5 | 镜头与漫画**两条**预览路径都不检查文本模型凭据 | 界面显示可提交，点下去才失败 | 两条路径共用 `inspectStudioTextProfile` |
| 6 | `profileReady` 与 `canSubmit` 自相矛盾 | 字段在说谎 | 用探针结果覆盖 |
| 7 | 漫画提示词只产出中文 | 产物与画格描述无关 | 非缺陷，见 21.3 #5（使用约束） |

### 21.5 交付清单对照（§20.1）

| §20.1 要求 | 结果 |
| --- | --- |
| 阶段 0–7 逐项通过／未通过／外部阻塞 | 见 21.1 |
| 修改文件及职责；已保护的既有改动 | 见实施日志各阶段；`upstream/linshe` 未改，既有未提交改动未动 |
| 迁移编号、备份路径、integrity 与外键 | 迁移 **49**；备份 `data/backups/2026-10-03T07-11-28.124Z/`；两库 integrity ok |
| 新工作流／版本／内容哈希、预设、画风、策略 | 文本 `anima-activity-linshe-parity` v1；细化 `anima-activity-hires-basic` **v3**；Base／Turbo 预设；画风 `邻舍对齐 · Anima`；策略 r1 |
| 编译版本、词表 SHA／内容哈希、是否仅 keyword | `activity-image-v2.1`；词表 SHA256 `aeddfd9a…`；**仅 keyword**，`vector`／`hybrid` 显式拒绝 |
| 定向测试／契约／Portal／typecheck／构建 | 见 21.1 回归基线 |
| 真实活动 ID、任务 ID、调用 ID、artifactId、尺寸、seed | 见 `artifacts/activity-image-parity-v2/`（3 份目录，含 `report.json`） |
| 六张对照与三入口结果；细化前后 sha256 未变 | A/B/Turbo/细化/漫画共 7 张；细化 `sourceUnchanged: true`；**素材入口未实现** |
| 桌面／窄屏截图与实际查看结论 | `artifacts/activity-image-parity-v2/2026-10-03T08-09-13.552Z/`（12 张，已逐张查看） |
| 仍存在的问题与未验证项 | 见 21.3 |
| 用户如何选择画风、双档、细化、回到旧配置 | 见实施日志交付清单；**并须知道 21.3 #5 的英文描述要求** |
| 是否部署／提交／推送 | **均为否** |

### 21.6 复现方式

```powershell
# 宿主服务（注意：Docker 那套用的是另一个库，看不到迁移 49）
$env:SERVICE_PORT='4300'; npm run dev:service
# 另一个终端
$env:STHSTART_ADMIN_TOKEN=(Get-Content .env | Where-Object { $_ -match '^STHSTART_ADMIN_TOKEN=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })
node scripts/activity-image-parity-sample.mjs --portal http://127.0.0.1:4300 --confirm
```

配套脚本：`activity-image-parity-config.ts`（`--check`／`--apply --confirm`）、`activity-image-parity-preflight.ts`、`activity-image-parity-alpha-check.ts`（带 `--negative-control`）、`activity-image-parity-browser.mjs`。

### 21.7 第二轮修复对上一轮报告的更正

> 依据：`docs/development/plans/ACTIVITY_IMAGE_LINSHE_PARITY_ROUND2_REPAIR_PLAN.md` §10 要求「对上一轮报告追加短更正说明」。
> 本节**更正 §21 的若干结论**；与 §21 冲突时以本节为准。执行记录见 `docs/development/logs/activity-image-parity-round2-result.md`。

1. **§21.1「4C 原生历史、引用与恢复：通过」需要重新判定。**
   第二轮发现细化恢复存在两处把 `job.callId` 当作「请求已发给模型」的误判，以及一处条件 UPDATE 未校验命中。
   其中「细化任务永远拿不到 `studio_resume_required` 暂停标记」已用夹具复现（`actual: null`）。该修复与验证见 `activity-image-parity-round2-result.md` §4c。
   在第二轮完成 §7.2 全部状态表行的验证之前，**4C 不应记为通过**。

2. **§21.3 #2「素材入口是独立子系统，不以本轮完成代替」的措辞需要更正。**
   素材（活动素材）是本计划 §1.1 与 §3 明确要求的**三个入口之一**，不能用「独立子系统」把它排除在验收之外。
   它仍是**未实现**，但应登记为**原计划未完成项**，而不是「不属于本轮范围」。

3. **§21.2 的 A/B 与漫画样例只能证明出图/组装路径。**
   这些样例是在**关闭自动优化**的情况下取得的（脚本在凭据不可用时降级），因此：
   - 它们证明「服务端组装」这条链路可用；
   - 它们**不证明自动优化（结构化 tags）有效**。
   结构化优化的真实调用在第二轮开始时**仍未验证**（被活动文本模型凭据阻塞）。

4. **§21.1 里「两库 `integrity_check` ok」是当时结果，不能代替当前健康状态。**
   第二轮只读诊断确认：业务库 `data/sthstart.db`（v49）**当前已损坏**——
   `PRAGMA integrity_check` 报 2 个 btree、100 个页面 `btreeInitPage() returns error code 11`，
   `PRAGMA foreign_key_check` 报 `database disk image is malformed`。叙事库仍健康。
   诊断见 `docs/development/logs/activity-image-parity-round2-db-diagnosis.md`。
   **在真实库确认健康之前，不得进行真实联调。**

5. **§21.2 的真实预算不能只按最后一次脚本的成功样例计数。**
   第二轮要求**独立记录实际提交总数**，并区分「成功」「失败」「跳过」三种结果，
   不能以「脚本跑完没有报错」代替计数。

6. **补充一条第一轮遗漏的发现（§21.3 #5 的由来）。**
   漫画画格的提示词编译只产出**中文字段标签与中文散文**，而 `anima` 系列主要按**英文标签**理解画面。
   单变量对照实验确认：同一画格、同一工作流、同一画师串，**只加一段英文画面描述**，
   产物即从与描述无关变为正确。这是**使用约束**（画格字段是自由文本，没有独立英文字段），
   不是渲染链路的缺陷；但用户与后续实现者必须知道这一点。

## 附录：邻舍参考文件与文档关系

- `upstream/linshe/agent-core/src/services/imagePromptPreparer.js`：标签选择和规则，不是将任意中文完整翻译为英文的LLM。
- `upstream/linshe/agent-core/src/services/imagePromptKnowledge.js`：keyword／vector／hybrid，不复制向量同步部分。
- `upstream/linshe/agent-core/src/db/imagePromptKnowledgeData.js`、`imagePromptTagKnowledgeData.js`：词表来源，需要固定提交与裁剪说明。
- `upstream/linshe/agent-core/src/services/workflowTemplates.js`：本轮Base/Turbo实际模板参数。
- `upstream/linshe/agent-core/src/services/imageRefine.js`：基础细化与原参数继承参考，不照搬其原文件覆盖行为。
- 用户安装版 `F:/ComfyUI/邻舍.EXE/邻舍.EXE-v1.1.2/workflow/制图工作流.json`：画布连接参考；不能只读未生效控件值。
- 用户提供的Anima提示词助手：用于提炼通用视觉规则，不整份注入模型、不把特定题材默认为所有活动。
- `docs/activity_studio_abc_implementation_progress.md`：保留旧验收证据，对其中已被本轮纠正的分辨率/原因判断追加更正，不删除历史记录。
