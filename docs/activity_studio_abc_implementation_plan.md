# 活动工作室 A＋B＋C 整合实施计划

> 编写日期：2026-10-02。执行对象：Luna Max 或其他实施模型。
>
> 本文是实施规格，不是完成报告。只创建此计划文档；本轮未修改业务代码、运行迁移、部署或发起模型请求。
>
> 对应原讨论：docs/activity_configuration_simplification_plan.md。原文保留为背景；执行时以本文的边界、配置规则和阶段门槛为准。

## 1. 最终目标与已经确定的决策

将三种方案实现为一个产品，而不是三个独立模式：

| 方案 | 职责 | 最终表现 |
| --- | --- | --- |
| A：渐进式简化 | 全工作台的交互原则 | 先看内容、画面和主要操作；技术参数按需打开 |
| B：导演驾驶舱 | 页面结构和配置归属 | 创作、阅读演播、资产交付三个主入口；活动美术配置统一管理 |
| C：智能制作 | 同一工作台的自动化能力 | 正文生成分镜、自然语言调整、批量绘制、经授权连续制作 |

固定决策：

- 不引入新的前端框架、通用 Agent 框架或外部任务队列。
- 沿用项目主题、Dialog/Drawer、草稿队列、管理代理、React Query 和统一生成执行器。
- 活动美术配置复用已有 ImageConfigDocument、图像配置草稿与不可变版本，不能新增平行的“Art Deck 配置库”。
- 用户手工编辑和智能制作共用相同的镜头、画格、素材以及图片历史。
- 默认“生成草案 → 人工应用 → 绘制”；提供明确选择的“应用并连续绘制”，不是默认无人值守。
- 活动原有企划、聊天、朋友圈、事实、素材、回放和漫画功能全部保留，不把活动强制转换成纯漫画。
- “草稿／精细”绑定经过验证的生成预设，不统一写死 15／31 步，不把 Base/Turbo 等同于质量等级。
- 本轮不做模型训练、视觉自动判图、图生视频、人物连续动画、新的局部修图工作流或自动发布。
- 系统配置完毕后，创作者可以少配置；新机器缺模型、缺绑定或缺凭据时必须清楚报错，不能宣称真正零配置。

完成后的核心流程：

~~~text
活动或正式剧情正文
  → 创作工坊：手工编写 / 智能分镜
  → 审阅、应用到活动或漫画草稿
  → 同一美术配置解析器
  → 提示词编译、可选优化、工作流预检
  → 统一任务队列
  → 图片产物入库、历史记录
  → 选择图片 / 经明确授权填入空画面
  → 阅读与演播
  → 资产与交付
~~~

## 2. 当前代码基础与实施前必须复核的事实

本次静态检查确认：

1. 当前活动工作台仍有五个主入口：分镜漫剧、视听剧场、视觉资产、企划设定、导出交付。标签已不同于旧方案中的早期页面。
2. beat-render-workbench.tsx 已有导演标签、绘制设置浮层、历史图片和换种子重抽。A 已部分存在，不能按从零开发估算，也不能只改按钮文案宣布完成。
3. image-configs.ts 已有活动图像配置草稿、CAS 保存和不可变版本；现有字段包括全局画风词、负向词、默认工作流、默认参数及素材槽位覆盖。
4. 镜头、漫画和素材已经各有绘制链路，但继承解析不统一。镜头和漫画调用 resolveActivityImageWorkflow；素材还有 image-prompt-compiler.ts 的 resolveImageExecutionPlan。
5. comic-storyboard.ts、media-batches.ts、production.ts、候选审阅与统一生成调度器可以复用。现有素材批次只处理 MediaSlot，不能直接当成镜头／漫画批次使用。
6. 当前可见业务迁移最大版本是 47。执行时重新读取最大值，不固定使用 48。
7. 契约存在重复定义：index.ts 本身定义并导出 ContentDocument、SceneBeat 等，同时又 export * from activities.ts。ImageConfigDocument 实际定义在 index.ts，镜头请求在 ai-calls.ts，漫画契约在 activity-comic.ts。不能只改一个同名文件而遗漏真正的导出入口。
8. 当前有大量未提交修改，其中导演标签和提示词组合器也有未跟踪文件。邻舍子模块本地检出与父库 gitlink 不一致；本任务不修复或推进该子模块。

以下只是需纳入阶段 0 验证的风险，不宣称已经用真实请求复现：

- 图像配置 CAS 需要检查 UPDATE 的 changes，不能只在 UPDATE 前比较版本。
- 图像配置路由目前部分使用错误文本包含 conflict 来判断状态码，需要转为明确 error.code/statusCode。
- 有些 GET 首次读取会创建默认图像配置；浏览页不能因此隐式提交版本或改变活动 headVersion。
- 新旧提示词标签去重存在不同归一化规则；不应把多角色的不同动作全局去重成只剩一个动作。

## 3. 配置归属：一份活动美术配置，三个目标适配器

### 3.1 唯一归属

| 内容 | 保存位置 | 是否可在镜头中修改 |
| --- | --- | --- |
| 模型连接、密钥、ComfyUI 实例与工作流节点 | 原公共服务／生成配置 | 不复制到活动；高级入口跳转管理 |
| 可复用画风卡和草稿／精细组合 | 原 ActivityPreset，见 3.2 | 可选择，但不修改全局卡片 |
| 本活动画风词、负向词、画幅、默认预设 | ImageConfigDocument | 默认继承；局部覆盖须有标记 |
| 镜头补充描述、导演要求、局部参数与 LoRA | SceneBeat.renderSettings | 可以，仅影响当前镜头未来绘制 |
| 漫画画格局部设置 | ComicPanel.renderSettings | 可以，不影响来源镜头 |
| 素材槽位局部设置 | SlotImageConfig | 可以，不影响镜头／画格 |
| 实际模型、提示词、seed、工作流图 | 每次任务的冻结快照及 AI 日志 | 不可修改历史；重抽引用该快照 |

角色 LoRA 保持现有角色快照归属。合并顺序继续是全局画风 LoRA → 角色 LoRA → 目标覆盖；同名文件只加载一次，多角色冲突须显式解决。

### 3.2 画风卡复用现有预设存储

不新增 ActivityPresetKind 或重建预设表。使用现有 kind=production_preset，新增严格识别的 payload 子类型：

~~~ts
interface ActivityArtStylePayload {
  schemaKind: 'activity_art_style_v1';
  positiveStylePrompt: string;
  negativePrompt: string;
  renderProfiles: {
    draft: GenerationPresetRef | null;
    final: GenerationPresetRef | null;
  };
  defaultQuality: 'draft' | 'final';
  defaultCanvas: { width: number; height: number };
  previewArtifactId: string | null;
}

interface GenerationPresetRef {
  purpose: string;
  presetId: string;
  presetRevision: number;
  workflowId: string;
  workflowVersion: number;
}
~~~

实施规则：

- 所有运行时结构使用 TypeBox；TypeScript 类型由 Static 导出，示例 interface 只用于解释。
- 为画风卡增加专用列表／编辑 API，内部复用 presets.ts 的保存与修订能力。
- 检查所有 production_preset 消费者；批量素材生产等原入口要过滤掉此子类型，禁止把画风卡当成旧生产预设执行。
- 卡片名称、说明沿用现有预设字段；预览只使用实际本地产物，不盗用示例图声称真实效果。
- 没有预览时显示画风名称与简洁示意，不因此阻止选择。
- 不预置不存在的“写实、水彩”等模型。初始卡片仅由当前确实可用的生成预设建立；没有可用预设就显示配置缺项。
- 草稿或精细档缺失时禁用该档，并给出原因；不能把另一档参数冒充缺失档。
- 卡片更新不改变已经选择它的活动；活动要显式“套用新版”。
- 套用时冻结卡片版本与内容快照，并将画风词写入已有 globalStylePrompt/globalNegativePrompt。快照用于溯源，不再成为另一份运行时画风词来源。
- 画风预览产物通过现有 createArtifactReference 保护；本轮不增加通用资产删除功能。

### 3.3 扩展已有图像配置契约

在现有 ImageConfigDocumentSchema 中新增可选 artDirection，不改变 schemaVersion=1，不删除旧字段：

~~~ts
interface ActivityArtDirection {
  selectedStyle: {
    id: string;
    version: number;
    name: string;
    payloadSnapshot: ActivityArtStylePayload;
  } | null;
  quality: 'draft' | 'final';
  canvas: { width: number; height: number };
  renderProfiles: {
    draft: GenerationPresetRef | null;
    final: GenerationPresetRef | null;
  };
  parameterOverrides: {
    draft?: Record<string, unknown>;
    final?: Record<string, unknown>;
  };
}
~~~

globalStylePrompt/globalNegativePrompt 始终是活动画风词的唯一运行时来源。defaultWorkflowId/defaultWorkflowVersion/defaultParams 保留为旧文档兼容输入；有 artDirection 的新文档不能同时用旧默认字段覆盖它。

parameterOverrides 按档位独立保存，仅允许该预设工作流开放的可编辑字段，禁止覆盖被锁定的模型。这样切换草稿／精细不会将一个模型的 CFG、steps 等误传给另一模型。修改档位预设时对该档参数做兼容确认，另一个档位保持不变。

兼容规则：

- 没有 artDirection 的旧文档按原配置解析；标记“旧版自定义配置”，禁止打开页面就替换为 Anima。
- 用户明确套用画风卡后建立 artDirection。保留所有槽位覆盖、图片绑定和旧历史。
- 默认画幅从当前实际有效配置读取；缺失时从所选生成预设读取。不靠前端注入 0 或空字符串。
- 快捷画幅提供 16:9=1152×648、3:4=768×1024、9:16=648×1152、1:1=1024×1024。先按工作流字段的范围、步进、固定输入限制校验；不兼容的尺寸禁用，不偷偷取整。高级区可输入合法自定义尺寸。
- 漫画页排版画布仍是现有 1920×1080；此处画幅仅指生成源图，不改变漫画排版、PNG 和离线阅读格式。
- 切换画风、品质或画幅只影响之后的新绘制；不清除、重生成或重新选择旧图片。

### 3.4 局部覆盖与结构化导演设置

在 SceneBeatRenderSettingsSchema 中新增可选 quality、director 和 composition（最多 2,000 字符）；素材配置复用已有 composition，增加 quality/director 与预设引用字段。漫画继续复用该渲染设置，不再创建第三份：

~~~ts
interface DirectorSettings {
  shotSize?: 'wide' | 'medium' | 'closeup' | 'detail' | 'full_body';
  angle?: 'eye_level' | 'high' | 'low';
  lighting?: 'natural' | 'warm' | 'rim' | 'low_key';
  mood?: 'calm' | 'tense' | 'joyful' | 'melancholy';
}
~~~

规则：

- 导演按钮修改结构化字段，不继续通过删改整段 customPrompt 表达状态。
- 旧 customPrompt 原样保留。不自动提取并删除用户写过的标签、权重或自然语言。
- 用户修改导演字段后，该字段优先于旧描述中的矛盾要求；日志记录冲突处理。仅替换独立、可识别的相同字段标签，不能用逗号分割后粗暴删除完整自然语言句子。
- director 字段省略表示不追加要求；本轮“恢复活动默认”仅清除工作流／预设／quality／参数覆盖，不清除补充描述、导演要求、参考图和 LoRA。另提供明确的“清空本镜头绘制设置”确认。
- undefined 表示继承；空字符串只在允许清空的文本项中表示用户显式留空，不能统一用 || 当成未配置。
- 工作流、预设、用途、版本作为一组选项切换，不进行字段级拼接；参数可以逐字段覆盖，但必须经最终工作流 Schema 验证。
- 切换工作流族时展示要清除的不兼容局部参数；确认后清除，取消则保留所有输入。不能静默丢弃未知参数。
- 同一字段互斥：一个景别、一个角度、一个光线基调、一个情绪基调；组合按钮不能暗中把雪景改成白天。
- 漫画既有 shotSize 是权威景别来源：画格编辑 UI 直接改它；画格 director.shotSize 不新写入，遇到旧数据冲突时返回明确错误，不同时输出两种景别。
- 活动镜头模型输出的 composition 写入 beat.renderSettings.composition；漫画使用 panel.composition；素材使用 SlotImageConfig.composition。三个编译适配器都必须读取各自的实际字段。

### 3.5 配置解析器

扩展 image-render-common.ts，新增一个服务内部解析函数，不在前端自己推导模型／采样参数：

~~~ts
resolveEffectiveActivityVisualPlan({
  activityId,
  imageConfigRevision,
  target,          // beat | comic_panel | media_slot，服务内部已授权定位的对象
  content,
  overrides,
  seed,
})
~~~

解析顺序：

1. 明确的目标工作流／预设选择；没有则使用活动当前品质对应的冻结预设；旧活动没有 artDirection 时保留旧默认解析。
2. 工作流输入默认值 → 所选生成预设值 → 活动当前档位 parameterOverrides → 目标参数。新 artDirection 不再读旧 defaultParams；旧配置仍按旧规则读取它。
3. 活动画幅 → 目标合法 width/height 覆盖；固定尺寸工作流不显示可编辑尺寸。
4. 描述来源与结构化导演要求编译 → 按工作流策略进行可选提示词优化 → 活动画风词／策略补充词 → LoRA 触发词。
5. 负向词：目标显式覆盖 → 活动显式值 → 工作流策略／预设原值。无负向输入能力但用户有非空覆盖时阻止提交，不默默忽略。
6. 生成最终节点图，检查模型、编码器、VAE、输出、LoRA、参考图能力和文件。

特别要求：

- 模型字段名、width/height/seed 键由 inputSchema.semantic 与 nodeBindings 定位，不能只支持固定的参数名。
- 提示词质量词在哪一层追加必须可见。工作流固定拼接词要展示为“工作流内追加”，不要重复塞进请求。
- composeActivityPrompt 与导演标签应共享归一化规则。多角色动作、姿态、表情不能用全局互斥组删掉另一个人物的要求。
- 全局画风词只追加一次；策略补充词、触发词按完整标签／短语去重，不能用任意子串匹配误删。
- 不添加新的 solo、角色人数或人物姿态猜测规则；人数由实际目标角色清单决定。
- 参考图只有选中且工作流确实支持时才提交。未启用时显示“仅文字参考”，不要显示“已锁定角色”。
- 预检失败不产生 ComfyUI 任务；启用的优化模型失败不退回原始提示词。策略明确关闭时可以跳过优化，并记录 skipped。

三种目标适配器只负责“定位对象、编译来源、选择／写回规则”。不得复用 beat-renders.ts 的自动入镜代码处理漫画或素材。

预览和 hash 规则：

- 提示词优化尚未调用时，只展示“来源编译描述／本次优化前”，不能冒充最终英文提示词。优化完成后的最终提交文本在任务、图片详情和日志展示。
- planHash 使用稳定序列化，包含来源指纹、图像配置版本、工作流图与绑定 hash、预设修订、策略修订、LoRA、参考图、有效参数和冻结 seed；不包含时间戳、预览请求 ID 或临时显示状态。
- sourceFingerprint 包含角色外观／服装、场景视觉信息、动作、构图和导演要求；不包含 mediaUrl、当前选图、漫画裁切、气泡坐标或演出状态。画风／模型改变由计划配置 hash 管理，不篡改旧图的来源记录。
- 浏览器再次提交相同 planHash 时不重新随机 seed；每次主动新绘制才创建新 seed。
- 预设修订或绑定发生变化时先报 plan_changed；不能忽略冻结修订、直接解析最新值。若现有存储不提供旧预设版本执行能力，则明确要求套用新版；历史按已保存工作流快照重抽仍保持可用。

## 4. 页面结构与交互规格

### 4.1 三个主入口

| 主入口 | 内部视图 | 原功能去向 |
| --- | --- | --- |
| 创作工坊 | 剧情记录、分镜、漫画、素材制作 | 原 script 和 media；企划通过“活动设置”进入 |
| 阅读与演播 | 漫画阅读、原活动回放 | 原 playback；漫画读者复用现有渲染器 |
| 资产与交付 | 活动画廊、原导出 | 原素材浏览、export |

同一页面仍支持聊天、朋友圈与事实，不把这些功能藏到无法发现的高级入口。

“素材制作”处理立绘、背景、聊天配图等非镜头内容；画廊只负责浏览和选用。二者共用绘制设置组件，但不伪造同一个业务对象。

### 4.2 默认构图

~~~text
页头：返回 / 活动名 / 保存状态       创作 | 阅读 | 交付
摘要：画风 · 品质 · 画幅 · 角色参考状态      美术设置 / 智能制作

桌面创作：
  阶段与场次导航 | 当前编辑内容和画面 | 按需打开的属性

镜头视图：
  镜头列表 | 当前画面
             导演快捷标签
             绘制新图 / 换种子重抽
             紧凑图片历史
             可展开失败、处理中记录
~~~

- 美术摘要常驻，完整 Art Deck 不常驻铺开所有表单；点击摘要或“美术设置”打开浮层。
- 页面背景／工作表面／浮层三级分层，主要通过留白、标题和轻底色组织。每个区域最多一层明显描边。
- 同一区域一个主要按钮；“绘制新图”是当前镜头主操作，“智能制作”是活动级入口，不在四处复制同名按钮。
- 默认隐藏工作流 ID、采样器、steps、cfg、scheduler、denoise。仍能在高级区查看或修改工作流允许编辑的字段。
- 历史缩略图显示“当前／新图／文件不可用”；任务数量与图片数量分开。每张图保留日志、配置和来源详情入口。
- 每个覆盖标签可解释：“继承活动默认”“仅此镜头”“使用历史配置”。不能把换种子重抽描述成当前活动默认生成。
- “新绘制”跟随当前有效设置；“换种子重抽”用历史最终提示词、图和参数快照，不再次优化，也不跟随之后修改的活动画风。

### 4.3 弹窗、窄屏和保存

- 桌面浮层宽度约 720px，复杂诊断可用侧抽屉；宽度小于 640px 用底部 Drawer，最高 90dvh，底部操作固定并考虑安全区。
- 普通设置首层：画风卡、草稿／精细、画幅、补充画风词。高级层：工作流与模型说明、采样、负向词、LoRA、参考图、最终参数来源。
- 镜头内容编辑仍用现有独立临时表单；保存失败保持打开，关闭脏表单先确认。
- 1280px 以上可展示导航、主区和属性栏；1024～1279px 默认收起属性栏；窄屏导航与属性都用抽屉，不能出现第四栏。
- 使用现有 min-h-0/min-w-0 与独立滚动；不能嵌套 h-screen，也不能用固定图像高度撑破工作台。
- 图像 object-contain 展示完整内容，历史允许 object-cover。生成比例不等于 UI 强制比例，竖图必须能完整查看。
- 活动内容、漫画内容与图像配置是独立保存队列。600ms 防抖；切换、提交任务、应用草案、预览导出前执行所需队列的 flush。
- 未保存本地输入与后台更新相遇时保留本地输入、显示冲突，不能整份替换草稿。
- 美术设置“保存并应用”明确提交图像配置版本，刷新 headVersion／配置缓存。取消不创建版本。
- 反复打开页面、切换主入口或无变化保存不新增内容／图像配置版本。
- 新的智能任务入口复用 prepareStudioContext：先 flush 活动／图像配置／必要的漫画队列，按内容 hash 只提交已变化的内容版本和图像配置版本，再返回最新版本上下文。提交失败就停止后续任务；不能只使用页面缓存中的旧 headVersion。
- 打开智能浮层只读，不调用 prepareStudioContext。用户主动“生成草案／预览批次”才准备所需冻结版本，并说明这是保存当前内容；不调用模型的纯设置预览不提交版本。

### 4.4 URL 兼容

新 URL 使用 tab=studio|theater|delivery；studio 的 view=records|storyboard|comic|assets。panel 可为 activity-settings、art-direction、smart制作对应的 smart-create。

| 旧 URL | 新定位 |
| --- | --- |
| 无 tab、tab=script | studio / storyboard |
| tab=records | studio / records |
| tab=settings | studio，并打开活动设置 |
| tab=media | studio / assets，保留 slotId、batchId |
| tab=playback | theater / activity |
| tab=playback&mode=comic | studio / comic，保留原编辑语义 |
| tab=export | delivery / exports |

- 原有 mode=comic、stageId、sceneId、beatId、panelId、jobId、slotId、batchId、日志返回链接继续识别。
- 旧链接规范化用 replace，不用来回 push 造成历史循环。浏览器前进后退必须同步显示。
- jobId 的旧文本任务与新 studioJobId 区分；不能同名强行转换不同任务类型。
- 活动设置初次打开不能自动调用模型或启动研究。

## 5. 智能制作：完整功能与权限边界

### 5.1 三个入口，不再让用户在九种模式中找答案

智能制作浮层首屏提供：

1. 从正文生成分镜。
2. 批量绘制当前选择。
3. 当前镜头／画格的自然语言调整。

原 generation-modal 的九种模式仍保留：当前范围推荐“本幕生成／整场生成”，邀请、祝福、朋友圈、局部重写等收进“更多写作工具”。“配图方案”必须标明只生成描述，不产生图片。

C 不重写整场聊天候选机制；分镜语义任务与旧聊天／朋友圈文本任务分别适配，日志可关联。

### 5.2 正文转分镜

输入源支持：

- 已保存活动场次。
- 用户粘贴正文：最多 12,000 字符，超限拒绝，不静默截断。
- 本项目 Story 的正式章节：选择项目、章节、修订；服务端读取冻结版本，DSH 会话内容不是正式来源。

用户必须选择允许出场的活动角色。AI 可建议匹配名称，但不能自动创建角色或改变角色快照。未知角色需要用户处理后重新提交。

生成目标：

- 活动镜头：默认 6 镜，允许 2～12 镜。
- 漫画画格：默认 6 格，允许 4～8 格，复用现有模板分配和校验。
- 默认追加为新场次／新漫画页。替换当前场次必须明确确认。

活动镜头模型输出只包含语义：

~~~ts
interface StudioStoryboardOutput {
  scene: { title: string; timeText: string; locationText: string; environment: string };
  beats: Array<{
    actorIds: string[];
    primaryActorId: string | null;
    action: string;
    dialogue: string;
    outcome: string;
    director: DirectorSettings;
    composition: string;
  }>;
}
~~~

不得接受模型生成的 UUID、URL、HTML、工作流图、参数、文件路径和数据库字段。

实施细节：

- SceneBeat 增加可选 actorIds，兼容旧 characterId。旧数据缺失 actorIds 时按 characterId 生成单角色清单；多角色镜头 primaryActorId/characterId 只决定卡片主头像，不代表只画一个人。
- 若角色为空且是空景镜头，characterId 用现有可接受的空字符串，actorIds=[]；渲染器不能强行增加 solo 或人类。
- 更新角色快照编译、镜头卡片、内容指纹、LoRA 合并与校验，不仅更新前端标签。
- action 最多 2,000 字符、dialogue/outcome 各最多 1,000、composition 最多 2,000；actorIds 去重且最多 8 个。
- 主角色必须在 actorIds；所有 ID 必须属于冻结活动版本，禁止“修复”为任意第一个角色。
- 对已保存场次不能新增正文中没有的重大事实，保留台词归属。中文文本不能为了通过 Schema 而随意删掉。
- 结构、枚举、数量、角色引用全部校验；失败记录原始响应和具体路径，不自动修复语义错误或重复请求模型。
- 模型调用复用 callLlm 与活动已配置文本模型；显式 AbortSignal，单次超时 120 秒，新增限制只作用于新模块。
- 现有 StoryCompiler 适合格式化对白解析，可提供直接导入预览；不能冒充理解任意小说的 AI 导演。
- 漫画从已有场次生成优先复用 buildComicStoryboardPrompt/materializeComicStoryboard；从正文开始的漫画先生成合法新场次，再绑定它的冻结内容版本，不能造不存在的 sourceBeatIds。

输出进入任务结果，不自动改草稿。应用前展示：

- 新场次、人物、动作、台词、景别与构图。
- 来源章节／场次和版本。
- 会新增／替换多少镜头、漫画页；是否保留旧画面。
- 可用绘制预设、预计图片数。没有费用信息时只报调用次数，不伪造价格／耗时。

应用在事务内执行：验证目标与 CAS、生成 ID、更新内容草稿、必要时提交内容版本、更新漫画草稿及引用、标记任务已应用。任何失败整体回滚。

替换边界：

- 原锁定阶段、镜头或受保护记录不允许替换。
- 默认只能替换当前场次；不得用“整场”按钮删除其他阶段。
- 已有漫画页若混用多个场次来源，禁止部分删格造成孤立画格；提示用户先手工拆页。
- 删除目标条目不删除原任务日志／历史产物；原内容版本与漫画版本仍可读。
- 页面关闭或网络重发后重复应用返回原应用结果，不再追加一遍。

### 5.3 自然语言调整

入口：当前镜头／画格的“调整画面”，以及“拉远一点／换俯视／暖光／表情更平静”等快捷指令。

流程：

~~~text
选择当前目标 → 输入要求
  → 生成允许字段的修改提案
  → 展示修改前后、影响范围
  → 用户选择“应用”或“应用并绘制”
~~~

限制：

- 默认只改 director、composition、补充视觉描述及表情要求；不能更换角色、写台词、改变剧情结果、工作流／模型、LoRA 或 seed。
- 如用户明确要求更换角色／剧情，转到镜头内容编辑，不能让此工具绕开内容审阅。
- 补丁输出使用白名单字段，禁止任意 JSON Patch 路径或可执行代码。
- 此入口生成新图，不修改源图片文件，也不保证原图人物姿态和细节保持。UI 标明“按修改后的描述生成新图”。
- 修改提案在应用前不改变镜头或漫画。应用时校验目标内容指纹及对应草稿 CAS。
- “应用并绘制”在同一应用事务里建立子绘制任务记录，提交响应丢失不会丢掉任务关系；网络请求在事务外执行。
- 漫画修改不改变原镜头。普通漫画绘制依旧只入历史。
- 保留原图与原配置；用户可以切回历史。不得把此入口叫“局部修复”或“同一张图改表情”。

### 5.4 批量绘制与连续制作

默认一次最多 12 个目标、每目标 1 张；用户可选 1～3 张，总上限 24 张。超过上限需拆成明确的新批次，不自动展开全剧。

支持目标：镜头、漫画画格、素材槽位。一个批次只处理一种目标，避免跨三种草稿 CAS 的隐式写入。

启动前的预览必须列出：

- 精确目标 ID 与名称、所属场次、角色。
- 有图／空画面、是否锁定、来源是否变化。
- 每目标图片数、总模型调用与图片任务数量。
- 使用的活动图像配置版本、工作流／预设、画幅、LoRA、参考图和预检结果。
- 写回方式：“仅加入历史”默认；可选“仅填入当前为空的画面”。

“应用并连续绘制”是同一确认操作，允许在草案应用后创建对应批次。该操作仅针对此次新增或已明确勾选的目标，不包括其他历史内容。

写回规则：

- 原镜头手动单次绘制维持现有“仅首次自动入镜”语义。
- 新批次适配器新增明确 placement，默认 history_only，不能因复用单镜头提交函数而意外继承自动入镜。
- 用户选择 fill_empty 才允许自动填入。提交时已有画面、完成时新增画面、内容指纹变化、文件不可读或目标删除都只留历史，并记录原因。
- 漫画 fill_empty 是这次批次明确授权的选图操作；普通漫画任务完成事件仍然不能写草稿。使用漫画自己的 select-image 存储函数，不调用 selectBeatRenderImage。
- 同一目标多个产物按产物顺序取第一张可读图；其余全部保留历史。没有可读图不能标记“画面已完成”。
- 素材只更新自己的 slotBinding；不自动复用镜头图片为槽位绑定。
- 所有自动选择都用最新草稿的 CAS 与目标指纹复查，事务内仅改目标字段；不能用批次开始时的整份旧草稿覆盖最新内容。
- 第一个目标入图导致 draftVersion 增加后，批次的其他目标不能因为自己造成的版本变化全部失败。批次冻结相关来源，逐目标检查来源与配置，选择操作使用实时 CAS；普通 HTTP 保存仍保持严格 CAS。
- 锁定目标预览时不可选；执行前又被锁定则 skipped，并说明原因。
- 中止默认“停止后续提交”；已提交任务可继续产出并入历史。不能调用 ComfyUI 全局 interrupt 误停其他活动。

## 6. 新契约、API 与后台职责

### 6.1 契约职责

新增 packages/contracts/src/activity-studio.ts，放新增的美术卡、导演设置、智能任务请求／响应。通过 index.ts 导出。

既有契约按实际导出路径扩展：

- index.ts：ImageConfigDocument、SlotImageConfig、公开 SceneBeat 的多角色字段。
- activities.ts：SceneBeatRenderSettings 共用字段、直接消费者的对应 SceneBeat；避免两处验证行为分裂。
- ai-calls.ts：镜头预览／提交增加 imageConfigRevisionId、quality、director；预览增加继承来源与活动配置版本。
- activity-comic.ts：漫画预览增加同样的配置溯源；实际画格继续使用共用 renderSettings。

不在这次任务中拆分整个 index.ts 或重构全站契约。新增契约测试分别从公共包入口和直接模块导入校验，防止同名 Schema 遮蔽。

避免循环依赖：activity-studio.ts 的基础 Schema 只依赖 TypeBox 和无循环的叶子模块，不反向 import index.ts。如需复用 DirectorSettings，先导出该叶子 Schema，再由 activities.ts、index.ts 和漫画契约引用。

### 6.2 任务契约

~~~ts
type StudioTarget =
  | { kind: 'beat'; stageId: string; sceneId: string; beatId: string }
  | { kind: 'comic_panel'; panelId: string }
  | { kind: 'media_slot'; slotId: string };

type StudioJobKind = 'storyboard' | 'refine' | 'render_batch';

type StudioJobStatus =
  | 'queued' | 'preparing' | 'running' | 'awaiting_review' | 'paused'
  | 'succeeded' | 'partially_succeeded' | 'failed' | 'cancelled'
  | 'interrupted' | 'unknown';

interface StudioVersionContext {
  headVersion: number;
  contentDraftVersion: number;
  contentRevisionId: string | null;
  imageConfigDraftVersion: number;
  imageConfigRevisionId: string | null;
  comicDraftVersion?: number;
}
~~~

完整任务响应至少包含：

- id、activityId、kind、status、revision、traceId、父任务 ID、时间。
- 请求快照、来源版本、审批状态、结果摘要、明确错误码与中文原因。
- 分镜／调整提案结果，或批次条目分页。
- 关联的旧任务 ID、新生成 taskId、candidateId、artifactId 和 callId。
- 已提交／成功／失败／未知／跳过数量与停止标记。
- 日志链接及定位到业务对象的 sourceUrl。

新增 Schema 禁止 additionalProperties；边界、枚举、字符串长度运行时校验。任意 parameters 仍受最终工作流 Schema 约束，不能当成任意节点图输入。

### 6.3 API 清单

服务端前缀 /api/v1/admin；浏览器用现有 API 客户端传业务相对路径，不能绕过管理代理。

| 方法与业务路径 | 请求要点 | 响应／行为 |
| --- | --- | --- |
| GET activity-art-styles | 游标、limit≤20 | 画风卡及可用档位；不返回密钥 |
| POST activity-art-styles | name、description、payload | 创建专用子类型预设 |
| PUT activity-art-styles/:id | expectedVersion、合法 payload | CAS 更新；不更新已冻结活动 |
| GET activities/:id/image-config/draft | 沿用 | 包含可选 artDirection |
| PUT activities/:id/image-config/draft | expectedDraftVersion、document | 严格 Schema＋CAS，冲突为 409 |
| POST activities/:id/art-direction/commit | expectedHeadVersion、expectedImageConfigDraftVersion、document | 单事务保存并提交，返回 activity、draft、revision |
| POST activities/:id/studio-jobs | kind、版本上下文、typed input、idempotencyKey | 202；先落任务，再执行模型或生成批次预览 |
| GET activities/:id/studio-jobs | kind、status、cursor、limit≤20 | 任务摘要页 |
| GET activities/:id/studio-jobs/:jobId |  | 详情；批次条目另分页 |
| GET activities/:id/studio-jobs/:jobId/items | cursor、limit≤20 | 批次目标、尝试、产物摘要 |
| POST activities/:id/studio-jobs/:jobId/apply | expectedJobRevision、版本上下文、append/replace_scene、renderAfterApply、placement | 分镜／调整提案事务应用；可建立子批次 |
| POST activities/:id/studio-jobs/:jobId/start | expectedJobRevision、planHash | 批次预览确认后开始；不接受任意工作流图 |
| POST activities/:id/studio-jobs/:jobId/stop | expectedJobRevision | 停止后续提交，幂等 |
| POST activities/:id/studio-jobs/:jobId/resume | expectedJobRevision、明确选择的条目、必要的新计划 hash | 仅继续安全未提交条目，或建立失败条目的新尝试 |

POST studio-jobs 按 kind 做 Type.Union：

- storyboard：source 类型、actorIds、output=beats|comic、count、instructions、目标场次。
- refine：target、instruction、来源指纹。
- render_batch：targets、candidateCount、placement、当前冻结配置版本。

apply 对未经授权的 replace_scene 返回 400；前端确认不是安全边界。服务端按锁定、范围、版本再次校验。

审批与请求补充：

- replace_scene 必须携带 confirmReplace=true 及预览中冻结的 sceneId；缺失时拒绝，不能靠 mode 字符串判断已经确认。
- storyboard/refine 的 apply 必须提供 expectedJobRevision、相应草稿版本和待应用结果的 resultHash；resultHash 不匹配不得应用。
- renderAfterApply 默认为 false；placement 默认为 history_only。开启后同一事务保存应用结果并建立子批次，子批次仅使用此次应用确定的目标 ID 与有效配置。
- 批次输入 targets 必须同 kind、去重且属于本活动；candidateCount 是批次统一值 1～3，总数限制由服务端校验。
- resume 的 itemIds 只能指定本批次的明确未提交或失败条目；不接受客户端上传 frozen input、工作流图或旧 taskId 作为替代。
- 模型或备用预设选择只允许服务端列出的启用配置 ID，并校验用途和能力；客户端不能指定任意 provider URL。

错误码至少：

~~~text
studio_version_conflict / studio_job_conflict / idempotency_conflict
studio_source_changed / studio_target_locked / studio_input_too_large
studio_invalid_model_output / studio_actor_unknown
studio_profile_unavailable / studio_workflow_incompatible
studio_plan_changed / studio_submission_unknown
studio_artifact_unavailable / studio_job_not_resumable
~~~

保持现有 { error, message } 形状，不向 UI 暴露原始堆栈。管理员鉴权覆盖所有新接口；活动 A 不得引用活动 B 的候选、图片或漫画版本。

### 6.4 服务模块与代码指导

建议新增：

~~~text
apps/service/src/activities/
  art-direction.ts          美术卡与活动配置解析、提交
  studio-routes.ts          专用路由注册，不继续扩大 routes.ts
  studio-store.ts           任务/条目 CAS、幂等、分页
  studio-storyboard.ts      正文语义分镜与提案校验
  studio-refine.ts          允许字段的调整提案
  studio-orchestrator.ts    批次计划、执行、停止、恢复
~~~

扩展 image-render-common.ts 作为统一配置解析器。将现有镜头／漫画／素材提交中的可调用逻辑提取为服务内部函数，HTTP 路由作为薄适配器；不要服务端回环调用自己的 HTTP。

保留各自业务写回：

- beat-renders.ts：镜头定位、首次入镜、历史选择。
- comic-renders.ts / ComicStore：画格来源和漫画选图。
- image-prompt-compiler.ts / image-attempts.ts：素材配方、来源引用、素材产物。
- generation/execution.ts：唯一 ComfyUI 提交与调度；新模块禁止直接 /prompt。

三种目标的提交函数都接收冻结配置版本和输入快照，先持久化业务记录，再调用 optimizeActivityImagePrompt、createGenerationTask。

前端按现有模块拆分，不把全部新功能继续堆入 activity-studio-workspace.tsx：

~~~text
app/features/activities/
  studio-api.ts                         新接口集中客户端，使用契约响应校验
  studio-queries.ts                     任务、美术卡与配置 query key
  studio-mutations.ts                   应用、启动、停止、恢复及缓存更新
  hooks/use-activity-visual-config.ts    图像配置保存队列和冲突保留
  components/activity-studio-routing.ts 纯 URL 解析、兼容与导航序列化
  components/art-direction-summary.tsx
  components/art-direction-dialog.tsx
  components/visual-render-settings-form.tsx
  components/studio-smart-dialog.tsx
  components/studio-proposal-review.tsx
  components/studio-batch-progress.tsx
~~~

外层工作台负责导航和当前目标；表单负责临时值；业务适配器负责调用各自接口。组件内不散落原生 fetch，不绕过现有 adminFetch／getJson 等安全路径。

查询刷新规则：有活动任务时按 2 秒轮询，页面后台按 10 秒或暂停轮询；恢复前台立即读取。终态停止轮询。只在 task.revision／条目状态改变时失效相应目标历史，不每两秒刷新全活动；没有 dirty 输入才合并服务端草稿。

伪代码：

~~~ts
async function executeBatchItem(jobId: string, itemId: string) {
  const item = claimUnsubmittedItem(jobId, itemId);
  if (!item) return;
  const frozen = readFrozenPlan(item);
  assertSourceAndConfigStillValid(frozen);
  await preflight(frozen);
  const outcome = await submitThroughTargetAdapter(frozen);
  persistLinks(itemId, outcome); // task/candidate/call，使用执行器原有原子落库回调
}
~~~

网络提交必须在数据库事务外；taskId/callId 在执行器 onInsertTask 回调中原子关联。不能在 HTTP 已成功提交后才第一次记录这个任务。

## 7. 数据持久化、幂等和服务恢复

### 7.1 迁移范围

美术配置和画风卡使用现有 JSON 存储；增加字段本身不需要重建用户内容表。

新增智能任务与条目表，下一业务迁移使用实际最大值＋1，格式仍为 { version, name, statements }：

~~~sql
CREATE TABLE activity_studio_jobs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  parent_job_id TEXT REFERENCES activity_studio_jobs(id),
  kind TEXT NOT NULL CHECK(kind IN ('storyboard','refine','render_batch')),
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  plan_hash TEXT,
  trace_id TEXT NOT NULL,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  apply_state TEXT NOT NULL DEFAULT 'not_applied',
  applied_result_json TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(activity_id, idempotency_key)
);

CREATE TABLE activity_studio_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES activity_studio_jobs(id) ON DELETE CASCADE,
  target_key TEXT NOT NULL,
  target_json TEXT NOT NULL,
  candidate_index INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  retry_of_item_id TEXT REFERENCES activity_studio_job_items(id),
  state TEXT NOT NULL,
  input_json TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  submission_key TEXT NOT NULL UNIQUE,
  native_job_id TEXT,
  generation_task_id TEXT,
  candidate_id TEXT,
  call_id TEXT,
  result_json TEXT,
  selected_artifact_id TEXT,
  placement_state TEXT NOT NULL DEFAULT 'not_requested',
  placement_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, target_key, candidate_index, attempt_no)
);

CREATE INDEX idx_activity_studio_jobs_lookup
  ON activity_studio_jobs(activity_id, created_at, id);
CREATE INDEX idx_activity_studio_items_lookup
  ON activity_studio_job_items(job_id, state, id);
~~~

补充约束：

- status/state/apply_state/placement_state 的 CHECK 枚举与契约一致；上面 SQL 简化了枚举，执行时补齐。
- 条目 state 固定 waiting|preparing|submitted|succeeded|failed|skipped|cancelled|interrupted|unknown。
- apply_state 固定 not_applied|applied|conflict；placement_state 固定 not_requested|pending|applied|ineligible|conflict|artifact_unavailable|target_missing。合法迁移使用条件 UPDATE；状态原因存入独立字段，不拼进枚举字符串。
- 产物继续由各目标既有历史保存；result_json 只关联它们，不复制图片二进制。
- 新任务若引用冻结角色／参考图，沿用产物引用系统新增 activity_studio_job / studio-job:{jobId}；图片历史、画风预览、漫画版本各自引用不能互相删除。
- 并入现有活动备份、导出副本／恢复逻辑的活动关联表清单，测试备份后任务快照与图片引用仍存在。包含活动 ID 重映射的复制导入需正确重映射引用，不复活旧队列。
- 导入的旧任务只读、不可恢复执行；恢复后的待处理任务先 interrupted/unknown，由用户确认，不能自动重投旧 API 请求。

### 7.2 幂等与任务状态

- 同一活动、同一键、同一规范化请求：返回原任务。
- 同键不同内容：409，不生成第二个任务。
- 查询原幂等任务先于“当前版本是否已改变”的校验，避免成功响应丢失后被误判成新冲突。
- 浏览器同一次点击、超时重发保持原键；主动“再做一版”才生成新键。
- 每目标 seed 在建立条目时冻结；preview、start、重发不能重复随机。换种子创建新 attempt_no。
- 批次 start 对审批状态和 job.revision 条件更新，只能从 awaiting_review 进入 queued 一次。
- apply 与状态更新也在单事务中 CAS。重复 apply 返回 applied_result_json，不重复写入。
- 同一目标在运行批次中只允许一个正常生成链；候选数量通过该批次条目排序提交，不被“忙碌检查”卡死。
- 若其他用户已为同目标提交未完成任务，预览说明 busy，启动前再检查，不抢占或偷偷取消。

成功判定：

- 模型输出任务成功是“合法提案可审阅”，不代表已应用。
- 图像任务 completed/succeeded 只表示上游流程完成；产物入库且可读取才是可用图片。
- 有部分失败则 partially_succeeded；全部失败才 failed；存在不确定提交时状态 unknown，并展示已有成功结果。
- 因内容／配置变化暂停的任务为 paused，不称作“画图失败”。

合法父任务流转：

~~~text
storyboard/refine:
  queued → preparing → running → awaiting_review
  awaiting_review → succeeded（应用事务完成）
  执行错误 → failed；用户停止 → cancelled；服务中断 → interrupted/unknown

render_batch:
  preparing（纯计划）→ awaiting_review → queued → running
  running → succeeded / partially_succeeded / failed / paused / unknown
  stop 后无后续提交 → cancelled，已提交任务仍可补入历史
~~~

resume 只接受 paused/interrupted/partially_succeeded/failed 中的安全条目。unknown 必须先核对上游；确认无提交或确认原任务状态后才允许恢复。cancelled 不恢复，用户主动创建新批次；已成功条目绝不重新生成。对于已应用提案，不能用 resume 再次执行 apply。

### 7.3 并发、停止和恢复

- 默认每个活动批次只准备／提交一个目标；图片执行并发由现有引擎 concurrency_limit 管理，不绕过 VRAM 限制。
- 服务内部定时扫描可继续安全的 waiting；条件 UPDATE 领取，lease 默认 180 秒、运行时每 30 秒续租。lease 过期不等于可以重复发请求。
- 有关联 generation_task_id 时向统一执行器核对状态和所有产物。
- preparing 中模型请求是否完成不可确定时转 interrupted/unknown，不能因重启自动调用第二次。
- 尚未发网络请求的 waiting 可以在用户 resume 后继续。
- 任务提交结果不确定时保留 submission_key、上游 prompt_id（如有）、请求快照和日志，先查询统一执行器；查不到也不自动重投。
- stop 不删除任务／产物。已派发任务默认继续；下一目标提交前检查 stop_requested。
- 页面关闭、重新打开或服务重启后从数据库恢复进度，不依赖浏览器保活。
- 生成监听、interval、lease 续租在 onClose 注销；服务关闭时停止领取新条目。

## 8. 健康检查、备用配置与日志

### 8.1 健康检查

检查要分层显示：

1. 文本模型绑定是否存在；策略关闭时不要求优化模型。
2. ComfyUI 实例是否可达。
3. 已发布工作流、输出节点和输入绑定是否适配。
4. 模型、编码器、VAE、LoRA 文件和参考图是否可用。
5. 是否有正常排队／运行任务。

缺配置显示具体缺项和跳转入口；不能只显示“服务不可用”。读取预检可以缓存，但真正提交前重新验证。

### 8.2 受控备用，不做静默降级

本轮实现“故障后选择已配置备用方案并继续”，不做无限自动重试：

- 错误页展示原模型／工作流、失败原因、是否确定未提交。
- 用户可选择已有且可用的备用文本模型或图片预设。候选来源仍是公共服务／生成配置，不另建任务专属密钥库。
- 重新确认实际模型、画风可能变化、目标范围与调用次数后建立新尝试，记录 fallbackOf。
- 备用最多一次；再次失败保持暂停，交给用户处理。
- 403、401、额度用尽、模型输出非法、参数错误不自动切换。
- 网络超时后提交结果未知时禁止备用重投；先核对原任务。
- 不承诺“始终可用”，不自动重启服务、下载模型或修改 ComfyUI 安装。

### 8.3 日志贯穿

新的业务事件：

~~~text
activity.studio.storyboard
activity.studio.refine
activity.studio.batch
activity.studio.apply
activity.studio.select_image
~~~

模型优化与生图继续使用其原有业务事件，统一 traceId 并通过 parentId／父任务关联；一次实际模型请求仍只有一条调用记录。

- 批次规划、应用、选择属于业务事件，不伪造没有发生的模型调用记录。
- 三种图像目标记录活动美术配置版本、卡片快照、实际预设与工作流版本、模型、seed、导演设置、最终提示词、LoRA、参考图、上游 ID。
- 实际内容与预览一致性验证必须比较提交图，而非只比较前端显示。
- 密钥、认证头、base64、图片二进制继续脱敏；原文与文本响应遵循原日志保留策略。
- 候选、任务条目、图片详情与 AI 日志之间双向跳转；旧历史缺失字段明确标明“未记录”，不补造。

## 9. 分阶段实施与门槛

原则：前一阶段未通过，先修复，不进入下一阶段。不提前混入后续功能。

### 阶段 0：基线、重叠改动与旧链路地图

任务：

- 记录 git status、HEAD、迁移最大版本；逐个读取重叠的已修改／未跟踪文件。
- 完整读取本项目 contract-first-api、db-migration-backup、frontend-design-aesthetics、frontend-workspace-interaction、project-verifier。
- 把本计划映射到真实函数、Schema 导出与管理 API；记录镜头／漫画／素材当前配置解析及写回差异。
- 保留已存在的导演标签和提示词组合器，确定需要改造的行为，不重新生成覆盖文件。
- 运行对应现有靶向测试作为基线；记录旧失败。契约公共导出、角色快照、多角色、提示词归一化重点核查。
- 测试数据库使用临时目录；不启动会迁移用户真实数据库的服务。

门槛：

- 有基线记录与新旧链路表；明确所有被移动的入口及旧 URL。
- 不处理全站视觉样式、不升级依赖、不改邻舍子模块、不清理用户文件。

### 阶段 1：统一美术配置与有效计划

任务：

- 先实现契约扩展、美术卡子类型识别及旧数据兼容。
- 完成图像配置严格校验、CAS changes 检查、错误码与无变化提交幂等。
- 实现美术卡 API、原子 art-direction/commit，以及预览产物引用。
- 完成共用解析器，接入镜头、漫画、素材，移除各自重复的默认配置推导。
- 为实际图与日志增加配置来源；把多角色镜头字段与来源编译一起接通。
- 不开发智能分镜 UI、不新增批次调度。

门槛：

- 三种目标使用同一活动设置时显示一致的工作流／品质／尺寸；各目标局部覆盖仍有效。
- 配置变更只影响未来任务，历史重抽仍使用历史配置。
- 缺模型／节点／LoRA、参数错误、策略优化失败都阻止提交。
- 旧图像配置和旧请求可读可用；现有 beat-render、comic-render、image-attempt 相关测试通过。

### 阶段 2：B 的工作台结构＋A 的交互

任务：

- 三主入口、旧 URL 映射、视图路由辅助函数、返回与前进后退。
- 紧凑美术摘要、统一响应式绘制设置、来源／覆盖标签。
- 共用绘制表单组件；三个薄业务适配器保留独立任务与选图逻辑。
- 移动企划到活动设置；素材制作进入创作子视图，画廊进入交付。
- AI 文本工具按上下文折叠；把新智能制作入口留好，未完成功能不显示可点击假按钮。
- 高级参数控件从服务端 fields 生成，保留宽高范围／步进与锁定说明。

门槛：

- 新建活动、编辑场次与镜头、绘制、选历史、漫画、素材绑定、回放、导出和日志均可到达。
- 桌面／窄屏无第四栏、横向溢出或破图；旧链接正确定位。
- 保存失败、浮层关闭、属性收起、切换视图不丢输入。

### 阶段 3：持久智能任务与正文分镜

任务：

- 在临时数据库验证新增任务表迁移、旧内容保留、引用保护。
- 完成 studio-store、路由、结构化分镜、来源版本与超限校验。
- 活动镜头／漫画目标分别审阅，追加／替换应用使用事务。
- Story 只读取正式章节版本；不改 Story 保存与 DSH 桥接。
- 任务取消、幂等、刷新恢复、版本冲突可用。

门槛：

- 从正文生成合法 6 镜，审阅后追加新场次；漫画生成合法两页六格。
- 未点击应用时内容完全不变；非法 JSON／未知角色／超时有日志。
- 替换不会修改其他场次，锁定内容不可被替换。
- 响应丢失后重发不重复调用、应用或创建镜头。

### 阶段 4：自然语言调整

任务：

- 白名单补丁契约、目标来源指纹、调整提案 UI。
- “应用”与“应用并绘制”，冻结参数和子任务关系。
- 快捷指令复用同一服务，不各自拼接字符串绕过验证。
- 旧图保留、明确“重新生成而非局部改图”。

门槛：

- 拉远／俯视／暖光能转为可解释的修改，用户能审阅。
- 请求更改角色、台词、模型、任意 JSON 路径时被拦截或引导到正确编辑入口。
- 源内容变化后旧提案应用为 409；漫画不能修改原镜头。

### 阶段 5：批次与连续制作

任务：

- 三类目标的单类型批次预览、精确计数、上限、写回方式。
- 任务条目领取、固定 seed、原子生成任务关联、进度、停止和明确失败重试。
- 分镜应用后创建子批次；仅经确认的目标可自动填入空画面。
- 每次自动选图的 CAS、文件校验、指纹校验及原因记录。
- 分页历史、多个产物、未知提交、部分失败与忙碌目标。

门槛：

- 6 个目标能够依次生成；第一个写回不会让后续因自发版本增长全部失败。
- 已有图始终不被覆盖；同时手工换图、改描述、删目标、锁目标时结果只留历史。
- 停止不影响其他活动，重发不重复提交；图片数不含失败项。
- 普通漫画任务仍不自动入图；授权批次只填入空画格，原镜头 mediaUrl 不变。

### 阶段 6：恢复、备用、备份与日志闭环

任务：

- 启动恢复和租约管理、监听注销、未知状态查询。
- 健康分层与明确备用选择，记录新尝试关系。
- 纳入活动备份／复制导入／恢复清单；恢复内容不自动重投。
- 来源、计划、实际模型请求、图片、应用和选择时间线贯通。

门槛：

- 模拟“请求前／请求后未落响应／已关联任务”的三种重启位置，无重复提交。
- 403／额度不足不静默换模型，unknown 不允许直接备用重投。
- 冻结版本和引用经过备份恢复仍存在；恢复后的未完成任务等待用户确认。

### 阶段 7：真实小样与交付

只在明确的新测试活动制作“阿贝多与砂糖的雪山实验”：

- 手工完成 1 镜，验证 A 的设置与历史。
- 从已保存正文生成 6 镜，审阅后应用；选两个镜头分别调整构图与暖光。
- 做一批 6 张草稿，明确开启填入空画面，观察失败、历史和日志。
- 漫画制作两页六格，验证与镜头数据独立，完成阅读和现有 PNG／离线包导出。
- 真实调用上限：正常小样总计不超过 12 张图片；环境失败不无目标批量重试。
- 现有 ComfyUI 没有 LoRA 文件时只完成不带 LoRA 的真实验证；LoRA 模拟链路可测，但报告真实带 LoRA 未验证。
- 若没有可用模型额度／ComfyUI，完成模拟测试，明确真实效果未验；不得把模拟图冒充真实模型结果。

完成一轮验收后提交报告并暂停，不擅自继续扩展功能、推送 GitHub 或部署。

## 10. 针对个人项目的最小有效测试

不要为所有页面重跑完整 CI；新模块＋受影响旧链路足够。下列风险必须覆盖，不用重复创建大量纯快照测试。

### 10.1 自动化矩阵

| 范围 | 必须覆盖 |
| --- | --- |
| 契约／旧数据 | 公共导出与直接模块一致、旧配置无 artDirection、旧单角色镜头、多角色、非法子类型 |
| 美术解析 | 品质预设、缺档、模型锁定、合法尺寸／非法步进、目标覆盖、恢复默认不清空描述 |
| 提示词 | 角色与动作保留、导演约束生效、画风／触发词一次、双角色动作不被互斥清理、策略关闭与优化失败 |
| 实际请求 | 镜头／漫画／素材实际节点图与日志的模型、文本、参数、LoRA 和 seed 一致 |
| 存储事务 | CAS、两个并发 apply、重复提交、响应丢失、无变化保存、任务原子关联 |
| 分镜／调整 | 非法 JSON、错误枚举、未知角色、数量错误、正文超限、超时、白名单越权、陈旧来源 |
| 批次 | 12目标／24图上限、逐目标并发、停止、部分失败、锁定、目标删除、用户中途改图 |
| 图片 | 多产物、文件缺失、Windows／Docker 相对路径、first valid、漫画选图不改镜头 |
| 恢复 | 未提交、提交未知、已关联 task 的重启；lease 过期不重投；恢复备份不自启 |
| 安全 | 管理鉴权、跨活动对象拒绝、脱敏、服务端不接受任意图／路径 |
| 前端 | 旧 URL、前进后退、临时浮层、队列 flush、冲突保留、本地恢复、历史重抽语义 |

建议新测试文件：

~~~text
packages/contracts/src/activity-studio.test.ts
apps/service/src/activity-art-direction.test.ts
apps/service/src/activity-studio-store.test.ts
apps/service/src/activity-studio-routes.test.ts
apps/service/src/activity-studio-storyboard.test.ts
apps/service/src/activity-studio-refine.test.ts
apps/service/src/activity-studio-batches.test.ts
apps/service/src/activity-studio-recovery.test.ts
app/features/activities/components/activity-studio-routing.test.ts
tests/e2e/activity-studio-abc.spec.ts
~~~

原有 director-chips.test.ts、prompt-tag-composer.test.ts 根据改动继续维护，不能为了通过删除冲突行为断言。

### 10.2 执行命令

阶段 0 按对应范围运行旧测试；实现时新增文件存在后再运行下面的新测试，不把缺文件报错当成测试失败。

~~~powershell
npm run test:contracts

node --import tsx/esm --test apps/service/src/activity-art-direction.test.ts apps/service/src/activity-studio-store.test.ts apps/service/src/activity-studio-routes.test.ts apps/service/src/activity-studio-storyboard.test.ts apps/service/src/activity-studio-refine.test.ts apps/service/src/activity-studio-batches.test.ts apps/service/src/activity-studio-recovery.test.ts

node --import tsx/esm --test apps/service/src/activities/beat-renders.test.ts apps/service/src/activity-comic-renders.test.ts apps/service/src/activity-comic-storyboard.test.ts apps/service/src/activity-media-batches.test.ts apps/service/src/activity-production.test.ts apps/service/src/activity-presets.test.ts apps/service/src/activity-rework.test.ts

node --import tsx/esm --test app/features/activities/components/director-chips.test.ts apps/service/src/activities/prompt-tag-composer.test.ts app/features/activities/components/activity-studio-routing.test.ts

npm run test:portal
npm run typecheck
npm run build:portal
npm run build:service

npx playwright test tests/e2e/activity-studio-abc.spec.ts tests/e2e/activity-simplification.spec.ts tests/e2e/activity-rework.spec.ts tests/e2e/activities.spec.ts --workers=1
~~~

若修改 PNG／离线导出相关代码或配置快照兼容，补 activity-comic-export.test.ts 与 activity-playback-export.test.ts；未修改渲染器就不另造一轮全站视觉基线。

Playwright 使用现有独立 e2e 数据库与端口，不指向用户生产实例。fixture 只创建新测试活动；不得删除用户现有项目。调整旧标题断言时保留行为断言，不通过放宽尺寸或超时掩盖缺陷。

### 10.3 浏览器与真实请求验收

- 1440×900：三主入口、设置浮层、镜头列表、历史和智能审阅。
- 1920×1080：长正文、多图片和两页漫画，检查独立滚动。
- 390×844：导航／属性 Drawer、绘制设置、中文换行、错误恢复。
- 1280×720 补一次工作台空间检查；200% 缩放抽查设置及主要操作。
- 暖杏和中性主题各抽查一个复杂视图；不新增业务组件固定色值。
- 检查控制台错误、视口横向溢出、最后按钮被遮挡、Escape／焦点回归、刷新后恢复。
- 截图放 artifacts/activity-studio-abc/<本次时间戳>/，实际打开查看，不覆盖已有截图。
- 真实请求保存任务 ID／callId／工作流版本／模型／产物路径；以实际提交图与日志核对，不只看 completed。
- 主观画面效果仍人工判断，不能承诺所有镜头都语义准确或人物绝对一致。

## 11. 数据操作与交付边界

本计划本身不授权实施模型部署、清理模型、修改邻舍或恢复数据库。

写真实数据库前：

1. 确认实际运行配置和数据库路径，Docker 路径不能误当成本机开发路径。
2. db:check 与 db:integrity 只读检查。若数据库损坏，停止迁移；不得用新功能迁移去修损坏库。
3. 使用项目 db:backup 生成 WAL 一致快照，并记录路径；它不复制媒体二进制。涉及媒体搬移／删除时另做可验证的完整便携备份。
4. 完成临时旧库升级与完整性测试后，在用户明确授权真实迁移的阶段运行 db:migrate，再 db:check、db:integrity。
5. 不删除旧历史、工作流、模型、日志或媒体，不修改已执行迁移。

交付时逐项填：

~~~text
阶段0～7：通过／未通过，各阶段证据。
保留的既有修改与实际新增／修改文件职责。
契约、迁移编号、真实数据库是否操作、备份位置及完整性结果。
A：首屏简化、高级配置、覆盖来源与保存保护。
B：三入口、旧URL、所有旧功能去向。
C：分镜、调整、批次、连续制作、停止与恢复。
靶向测试命令、结果、旧失败与新增失败。
桌面、窄屏、截图目录及已人工查看的记录。
真实模型／工作流、任务ID、callId、图片和漫画导出证据。
未验证内容、环境限制与仍存在的画面问题。
是否部署：默认未部署；部署须另有授权。
~~~

最终完成条件不是“换了导航标题”“有图片”“接口返回202”。必须能从正文生成草案、审阅应用、统一配置绘制、选图或授权填空、手工调整、刷新恢复、阅读并导出；原镜头、漫画、素材数据边界和用户未保存输入都得到保护。
