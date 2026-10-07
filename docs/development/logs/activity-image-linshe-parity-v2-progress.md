# 活动生图对齐邻舍 V2 实施记录

> 依据：`docs/development/plans/ACTIVITY_IMAGE_LINSHE_PARITY_EXECUTION_SPEC_V2.md`
> 记录规则：只写已经实际观察到的结果；预计结果一律标注“未验证”。

---

## 当前状态摘要（新会话从这里读起）

> 本文件按轮次追加，更正散落在各轮小节里。**要快速接手，只读本节 + “阶段完成度总览” + “仍未完成清单”即可**，不必通读全文。

### 已完成且**有真实证据**

| 项 | 结论 | 证据位置 |
| --- | --- | --- |
| 真实库迁移 | **49**，两库 integrity ok，数据未丢 | R3.3、备份 `data/backups/2026-10-03T07-11-28.124Z/` |
| 注册 | 文本工作流 v1、细化工作流 **v3**、Base／Turbo 预设、画风、策略 r1；重复 `--apply` 幂等 | R3.3、R7.3 |
| A/B 对照（计划 §9 完整形态） | A 组注入**两份**画师串、B 组**恰好一份**（逐字计数） | R5.2、`artifacts/activity-image-parity-v2/2026-10-03T08-53-28/` |
| 基础细化真实出图 | 768×512 → **2000×1328** 满幅插画，来源 sha256 **前后一致** | R7.1–R7.4 |
| 透明图 mask 方向 | 真实实例逐像素验证通过，**并带反向对照**证明判定有效 | R8.1–R8.4、`scripts/activity-image-parity-alpha-check.ts` |
| 浏览器验收 | 12 张截图（桌面／宽屏／窄屏），page errors 与 unexpected HTTP 均为 none | `artifacts/activity-image-parity-v2/2026-10-03T08-09-13.552Z/` |
| 预览凭据缺口 | 镜头与漫画**两条**预览路径都已修：凭据不可用时 `canSubmit=false` 并给出原因 | R12.1、R14.1 |

**回归基线**：typecheck 通过 · 契约 36/36 · 服务 595/595 · Portal 17/17 · `git diff --check` 0 · `db:check` 49/49（narrative 2/2）。

> 最近一次**四套齐全**的完整确认在第十九轮，覆盖了第十二／十四／十五轮对服务代码的改动：typecheck 通过、契约 36/36、Portal 17/17、`db:check` 49/49 + 2/2、`git diff --check` 0；服务 595/595 在第十四、十五轮分别跑过。即当前工作区**全绿**。

**证据可及性核验**（第二十三轮逐项 `Test-Path`／列目录确认，防止引用已删除的路径）：

| 引用 | 实测 |
| --- | --- |
| `artifacts/activity-image-parity-v2/2026-10-03T08-09-13.552Z/` | 存在，**12 个**浏览器截图 |
| `artifacts/activity-image-parity-v2/2026-10-03T08-53-28/` | 存在，**7 个**（A×2、B×2、Turbo、细化共 6 张 PNG + `report.json`） |
| `artifacts/activity-image-parity-v2/2026-10-03T09-21-28/` | 存在，6 个（第九轮漫画派发失败那一轮，未在摘要引用） |
| `data/backups/2026-10-03T07-11-28.124Z/` | 存在（迁移 49 前的备份） |
| 5 个配套脚本（sample／config／preflight／alpha-check／browser） | **全部存在** |

### 真实提交口径

**7 / 12 成功、1 失败、4 跳过**（A×2、B×2、漫画×1、Turbo×1、细化×1 成功）。`peakVram` **未测**。

> 漫画那 1 次最初因「产物与画格描述不符」被标为待查（R24.3）；第二十七轮用**单变量对照**查明根因是「漫画提示词编译只产出中文、缺英文视觉标签」，补上英文描述后产物与描述一致（R24.8）。**该次提交现已有效，7 项全部有效。** 中文提示词缺口作为独立改进项保留。

> **「7 / 12」不等于「还差 5 项的活」。** 剩余 5 次里，**大部分在当前环境下本就不可达**，逐条如下：
>
> | 剩余项 | 次数 | 状态 | 卡在哪 |
> | --- | ---: | --- | --- |
> | C 组（tags + keyword） | 2 | 已实现 | **用户凭据**（`ds-jy`） |
> | 素材空场景 | 1 | **未实现** | 独立子系统，规模大（R17.1） |
> | 真实 LoRA | 1 | **不可达** | 实例 `models/loras` 为 **0 个文件**，非我方可解 |
> | 补验额度 | 1 | 条件项 | 计划规定「确有需要时才占用」，本轮未触发 |
>
> 也就是说：**2 次等用户解锁凭据、1 次环境不具备条件、1 次按设计不该占用、只剩 1 次（素材）是真正待实现的工程量。**

### 唯一的外部阻塞（只有用户能解）

活动文本模型 **`ds-jy` 的凭据不可用**（自第四轮起，连续 13 轮）。它挡住 **C 组 2 次 + 漫画 1 次**。**在设置页重填该供应商的 API Key 即可同时解锁。** 这是唯一能让「6/12」上涨的动作。

### 剩余工作（都不依赖上面的凭据）

1. **R15.3**：`previewResponse` 另外 3 个调用点（`beat-renders.ts:576、593、602`）的 `profileReady` 语义未修正。**规模：不小**（第二十轮更正）——见下方说明。用户可见的预览路由**已经一致**，所以这一项**不影响界面行为**，优先级低。

   > **第二十轮更正**：本摘要初稿把 R15.3 写成「规模：小」，**是错的**。查证结果：那 3 个调用点位于 `previewStudioBeatRender`（第 571 行）与 `createStudioBeatCandidate`（第 580 行），两者都是**同步函数**，且带有明确契约注释——「Synchronous internal adapter. Caller owns the enclosing Studio transaction」。它们**没有 `secrets`**，异步化会破坏这个事务契约。因此这不是加一行判断能解决的，而是架构性改动。
   >
   > 另附一条相关观察：第 587 行的守卫 `if (plan.promptPolicy.enabled && !plan.optimizerReady) throw ...` 同样只看 `optimizerReady`，**判断不了凭据**。所以工作室批量路径在凭据缺失时会走到派发才失败（安全失败，不会产出未经优化的图，但白跑一次派发）。这一条也未修。
2. **素材空场景入口**：**未实现**，且它是独立子系统（attempt／recipe／compilation／binding），不是「再来一个入口」。**规模：大**，见 R17.1。**具体第一步**：在样例脚本的 `prepareContent()` 里给内容草稿加一个 `kind: 'image'` 的 media slot（现在验收活动是 `mediaSlots: []`），再走 `media-batches/prepare → media-batches → 轮询`，端点清单见 R17.2b。
3. 漫画入口**已实现**（R9.1），待凭据解锁后可直接跑通验证。

### 怎么跑真实样例

```powershell
# 1) 宿主服务（注意：不是 Docker 那套，Docker 用的是另一个库，看不到迁移 49）
$env:SERVICE_PORT='4300'; npm run dev:service
# 2) 另一个终端
$env:STHSTART_ADMIN_TOKEN=(Get-Content .env | Where-Object { $_ -match '^STHSTART_ADMIN_TOKEN=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })
node scripts/activity-image-parity-sample.mjs --portal http://127.0.0.1:4300 --confirm
```

配套脚本：`activity-image-parity-config.ts`（`--check` / `--apply --confirm`）、`activity-image-parity-preflight.ts`、`activity-image-parity-alpha-check.ts`（带 `--negative-control`）、`activity-image-parity-browser.mjs`。

### 踩过的坑（省得重踩）

- **不要用 PowerShell 做 JSON 解析或文本往返**：会把中文变成乱码（本会话踩了三次）。用 `node` 读 `report.json`。
- `node:sqlite` 的 `pragma_table_info(?)` 绑参数会静默返回 0 行，要用字符串插值。
- 每次运行都会**新建一个验收活动**，所以报告里的 `activityId` 逐轮不同——查任务时要用当轮报告里的 id。
- ComfyUI 的 `LoadImage` mask 是**反 alpha**，白底合成必须过 `InvertMask`（R7.1）。
- 产物目录逐轮更替，旧目录会被收敛删除；引用旧目录的历史小节已加注说明。

---

## 阶段 0：基线与保护

状态：**通过**（工作区保护与事实清单完成）

### 0.1 工作区保护

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 工作区状态 | `git status --short` | 69 个已跟踪文件被修改，另有大量未跟踪文件；均为既有工作 |
| 差异规模 | `git diff --stat` | 69 files changed, 1921 insertions(+), 649 deletions(-) |
| HEAD | `git log --oneline -3` | `26baa70 feat: upgrade backend model architecture, service connections, and unify frontend layouts` |
| 子模块指针 | `git submodule status upstream/linshe` | `+6b4c2e517ef72eb606a6ea3577c11804c3a6c603 upstream/linshe (v3.6.2-4-g6b4c2e5)` |
| 子模块工作区 | `git -C upstream/linshe status --short` | 无输出（子模块工作区干净） |

- 子模块前缀 `+` 表示当前检出提交与父仓库索引记录不同；这是**既有状态**，本轮不修改子模块、不更新指针。
- 本轮全程未执行 `reset` / `clean` / 强制 `checkout`，未覆盖任何既有改动。
- 环境修复：工作区根目录缺少 `WRITE_OWNER`，导致 DSH 沙箱无法为 `F:\Project\SthStart` 授权写入。使用 DSH 自带诊断脚本 `diagnose-windows-sandbox-acl.ps1` 检查该目录及各级上级目录，为当前登录用户补上完全控制权限（备份与回滚脚本位于 `F:\Project\acl-recovery\`）。改动仅涉及目录权限，未改动任何文件内容与所有者；随后受限写入恢复正常。

### 0.2 数据库迁移基线

- `data/sthstart.db` 的 `schema_migrations` 最大版本 = **48**（共 48 条）。
- 因此本轮新迁移使用 **version 49**（实际最大值加一，不写死）。
- 真实数据库本轮**未执行** `db:migrate`；迁移只在临时副本上验证。

### 0.3 现有接入点快照

活动图片用途绑定（`app_generation_assignments`，`app_id='activities'`）：

| purpose | workflow_id | workflow_version |
| --- | --- | --- |
| `activity_image_text` | `anima-activity-1080p-eval` | 4 |

- 没有 `activity_image_edit`、`activity_media_slot` 绑定。素材入口若要用图，需要另外注册；本轮不擅自新增真实绑定。

生成引擎（`generation_engines`）：

| id | name | kind |
| --- | --- | --- |
| `comfyui-local` | 本地 ComfyUI (8188) | comfyui |

工作流与已发布版本（`generation_workflows` / `generation_workflow_versions`）：

| workflow_id | name | 已发布版本 |
| --- | --- | --- |
| `anima-activity` | Anima 活动插画 | 1、2 |
| `anima-activity-1080p-eval` | 邻舍 Anima 制图 | 1、2、3、4、5、6 |

已核对的关键事实：

- `anima-activity-1080p-eval` **v4**（当前绑定版本）正向提示词绑定 `["117","inputs","string_a"]`，节点 117 是空 `StringConcatenate`；`CLIPTextEncode` 节点 6 的 `text` 由 `4 → 5` 拼接链给出。v4 没有固定画师串，画师串来自策略 `positiveSuffix`。
- `anima-activity-1080p-eval` **v5/v6** 的正向链路为 `4(string_a="@ebora") → 5(string_a=",masterpiece, best quality, score_9, score_8，highres, absurdres,anime screenshot,year 2025," , string_b=117)`，即工作流在服务端合成之后**再追加一次固定质量／画师串**；v5/v6 的 `positiveSuffix` 也为同一串，构成计划 §1.2 指出的“第二次追加”。
- 尺寸：`EmptyLatentImage`（节点 8）静态写 `768×512`，与计划 §1.2 一致；`anima-activity-1080p-eval` v3+ 的 `input_schema` 允许 `width ≤1920 / height ≤1080`。

活动画风与提示词策略：

| workflow_id | version | 最新 revision | enabled | positive_suffix |
| --- | --- | ---: | --- | --- |
| `anima-activity` | 2 | 1 | 1 | `@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025` |
| `anima-activity-1080p-eval` | 3 | 24 | 1 | 同上 |
| `anima-activity-1080p-eval` | 4 | 3 | 1 | 同上 |

- `activity_lora_policy_versions` 为空：当前没有活动级 LoRA 策略修订。
- 旧运行记录：`activity_prompt_optimization_runs` 有 10 条近期 `succeeded` 行（`anima-activity-1080p-eval` v4），可作为旧哈希（hash_version=1）兼容证据。

### 0.4 实时环境清单

| 项目 | 结果 |
| --- | --- |
| ComfyUI `127.0.0.1:8188` | **连接被拒绝**（`无法连接到远程服务器`） |
| 节点／模型／LoRA／超分清单 | **unknown**（离线，不写 missing） |

计划 §1.2 已说明离线时只作旧环境快照。本轮据此把“真实模型／节点／LoRA”相关门槛标记为外部阻塞，不据此宣称节点或模型缺失。

### 0.5 邻舍参考事实（只读）

| 项目 | 值 |
| --- | --- |
| 子模块检出 SHA | `6b4c2e517ef72eb606a6ea3577c11804c3a6c603` |
| 版本描述 | `v3.6.2-4-g6b4c2e5` |
| 安装包工作流路径 | `F:\ComfyUI\邻舍.EXE\邻舍.EXE-v1.1.2\workflow\制图工作流.json`（11318 字节） |
| 安装包内另有 | `F:\ComfyUI\邻舍.EXE\邻舍.EXE-v1.1.2\workflow\Anima提示词优化助手.txt`（141513 字节） |
| 模板来源 | `upstream/linshe/agent-core/src/services/workflowTemplates.js`（内置 Base/Turbo/Hires 模板字符串） |
| 词表来源 | `upstream/linshe/agent-core/src/db/data/imagePromptTags.yaml`，SHA256 `aeddfd9a25fd728c6f51d79eb255d219e3e0cd597b654d8f7510acde580fad01` |
| 词表构建统计 | `sourceTags 2985 / retainedTags 2786 / knowledgeItems 198` |
| 框架知识 | `upstream/linshe/agent-core/src/db/imagePromptKnowledgeData.js`，`IMAGE_PROMPT_KNOWLEDGE_VERSION` 前缀 `2026-09-02.1` |

三者（子模块 SHA、安装包工作流文件、模板来源）分别记录，未混为同一版本。

### 0.6 基线测试

见“阶段 0 检查结果”小节（随实施更新）。

### 0.7 旧问题分类（实施前）

| 编号 | 现象 | 分类 | 证据 |
| --- | --- | --- | --- |
| P-1 | 最终正向提示词出现重复质量／画师串 | **旧问题（本轮修复对象）** | v5/v6 工作流固定串 + 策略 `positiveSuffix` 同串 |
| P-2 | `EmptyLatentImage` 控件值 1920×1128 与实际 768×512 不符 | **旧问题（本轮记录）** | v1/v2 定义静态 768×512 |
| P-3 | `activity_media_slot` / `activity_image_edit` 无绑定 | **既有配置状态** | 0.3 表 |
| P-4 | ComfyUI 离线 | **环境问题** | 0.4 |

### 0.8 基线检查结果

全部在**改动前**运行，作为对照基线：

| 命令 | 结果 |
| --- | --- |
| `npm run test:contracts` | pass 26 / fail 0 |
| `node --import tsx/esm --test apps/service/src/activities/prompt-tag-composer.test.ts apps/service/src/activity-visual-plan.test.ts apps/service/src/activity-art-direction.test.ts` | pass 15 / fail 0 |
| `node --import tsx/esm --test apps/service/src/activity-studio-render-optimizer.test.ts apps/service/src/activities/beat-renders.test.ts apps/service/src/activity-comic-renders.test.ts apps/service/src/activities-images.test.ts apps/service/src/activity-studio-batches.test.ts apps/service/src/activity-studio-single-render.test.ts apps/service/src/activity-studio-recovery.test.ts apps/service/src/activity-studio-image-fallback.test.ts apps/service/src/generation-configuration.test.ts apps/service/src/generation/runtime-preflight.test.ts` | pass 63 / fail 0 |

---

## 阶段 1：新工作流族、唯一画风来源、实际编码文本、作用域去重

状态：**代码与定向测试通过**；真实实例验证**外部阻塞**（ComfyUI 离线）。

### 1.1 完成项

| 交付 | 文件 | 说明 |
| --- | --- | --- |
| 组装方式契约 | `packages/contracts/src/index.ts` | 新增 `PromptAssemblySchema`（`service-finalized-v1`）与 `GenerationEditorConfigSchema.promptAssembly?` |
| 解析器同步 | `apps/service/src/generation/configuration.ts` | `parseEditorConfig()` 解析该字段；未知值按 legacy 处理，不原样透传 |
| 发布校验 | `apps/service/src/generation/workflow-publish.ts`、`apps/service/src/activities/image-prompt-snapshot.ts` | 声明该标记的版本必须把正／负提示词直接绑定 `CLIPTextEncode.text` 且为字符串字面量；否则阻止发布并指出节点与字段（错误码 `prompt_assembly_binding_invalid`） |
| 共享发布路径 | `apps/service/src/generation/workflow-publish.ts` | 抽出 `publishWorkflowVersion()` / `importWorkflow()`，管理路由与配置注册脚本共用同一条校验与写入 |
| 作用域 V2 编译 | `apps/service/src/activities/image-prompt-v2.ts` | 分段扫描、作用域去重、固定顺序组装、诊断 |
| 实际编码文本 | `apps/service/src/activities/image-prompt-snapshot.ts` | 安全解析字面量与 `StringConcatenate` 链；循环／未知节点／缺分隔符／多采样器一律“无法解析” |
| 新工作流族定义 | `apps/service/src/activities/parity-workflows.ts` | `anima-activity-linshe-parity`：正／负提示词直连编码器，定义里无任何 `StringConcatenate` 分支 |
| 画风归属 | `apps/service/src/activities/image-prompt-policies.ts`、`apps/service/src/activities/image-prompt-optimizer.ts` | 保存新组装模式策略时非空 `positiveSuffix` 返回 409 `prompt_policy_style_managed_by_activity`；优化器在该模式下不再把策略后缀拼进结果 |

### 1.2 检查结果

新增测试（全部通过）：

| 文件 | 用例数 | 覆盖 |
| --- | ---: | --- |
| `apps/service/src/activity-prompt-v2.test.ts` | 20 | 括号内逗号、嵌套权重不透明、同作用域去重、跨角色同发色保留、相反姿态保留、空场景无 `solo`、未知人数不猜、组装顺序、触发词完整匹配与去重 |
| `apps/service/src/activity-prompt-snapshot.test.ts` | 7 | 直连相等、旧 concat 顺序与分隔符、固定画师串可见、环路／未知节点拒绝、缺分隔符拒绝、多采样器不猜、发布校验 |

实测证据：

- 新工作流定义渲染后，`readActualEncodedTexts()` 读回的正向文本与写入值逐字节相等。
- 真实库 v4 定义读回 `alice standing, high quality, detailed illustration, digital illustration`；v5 定义读回 `@ebora,masterpiece, best quality, score_9,alice standing`——即 P-1 的第二次追加，可被日志如实展示。

### 1.3 失败项与未验证

- **未验证**：真实 ComfyUI 上的节点执行（离线）。
- **未验证**：真实图片的 A/B/C 对照（阶段 7，需要在线实例与预算）。

### 1.4 下一阶段

阶段 2A/2B/2C。

---

## 阶段 2A：契约与数据库迁移

状态：**通过**（临时库验证；真实库未迁移）。

### 2A.1 完成项

| 交付 | 位置 |
| --- | --- |
| 策略字段 `outputFormat` / `knowledgeMode` | `packages/contracts/src/activity-image-prompts.ts` |
| 结构化输出契约 `StructuredVisualPromptSchema` | 同上 |
| 编译诊断契约 `ActivityImageCompilationDiagnosticsSchema` | 同上 |
| 策略响应增加 `serviceFinalizedAssembly` | 同上；`apps/service/src/generation-config-routes.ts` |
| 迁移 49 | `apps/service/src/database.ts`：策略表加 `output_format` / `knowledge_mode`（默认 `prose` / `none`，带 CHECK）；运行表加 `slots_json`、`compilation_snapshot_json`、`request_hash_version`（默认 1） |
| 旧行兼容 | `apps/service/src/activities/image-prompt-policies.ts`：旧行读取补 `prose` / `none`，不批量重写历史修订 |

### 2A.2 检查结果

- `apps/service/src/activity-prompt-migration.test.ts`：在临时库上先迁移到 v48、写入旧格式策略与运行行、再迁移到 v49。断言新列存在、旧行取值不变、新列取兼容默认值、CHECK 生效、`integrity_check=ok`、`foreign_key_check` 为空、重复迁移幂等。**通过**。
- 真实库 `data/sthstart.db` 仍为 `schema_migrations` 最大版本 **48**，且 `anima-activity-linshe-parity` 工作流、`邻舍对齐 · Base/Turbo` 预设、`邻舍对齐 · Anima` 画风行数均为 **0**——`--check` 未写入。

### 2A.3 失败项

无。

---

## 阶段 2B：结构化优化分支与 keyword 检索

状态：**代码与定向测试通过**；真实模型调用**外部阻塞**。

### 2B.1 完成项

| 交付 | 文件 |
| --- | --- |
| 词表数据（版本化静态） | `apps/service/src/activities/image-prompt-knowledge-data.ts` |
| 关键词检索与作用域规则 | `apps/service/src/activities/image-prompt-knowledge.ts` |
| 结构化解析、作用域校验、知识补全 | `apps/service/src/activities/image-prompt-structured.ts` |
| 优化器接入 | `apps/service/src/activities/image-prompt-optimizer.ts`（`outputFormat='tags'` 分支、`compilation_snapshot_json` 持久化、精确错误码） |
| 三入口传入角色作用域 | `beat-renders.ts`、`comic-renders.ts`、`image-attempts.ts` |

词表裁剪事实（写入数据文件头）：

| 项目 | 值 |
| --- | --- |
| 来源仓库 | `SthStart/upstream/linshe`（只读子模块） |
| 来源提交 | `6b4c2e517ef72eb606a6ea3577c11804c3a6c603` |
| 上游版本标识 | `2026-09-02.1+aeddfd9a` |
| 词表文件 | `upstream/linshe/agent-core/src/db/data/imagePromptTags.yaml` |
| 词表文件 SHA256 | `aeddfd9a25fd728c6f51d79eb255d219e3e0cd597b654d8f7510acde580fad01` |
| 数据集版本 | `linshe-parity-1+7baabdab` |
| 内容哈希 | `7baabdab2f7bcaeda3a3852281fa4215d9e6171fa8f74a5dcf4bb436ee2826d0` |
| 条目数 / 标签数 | 141 / 1962（上游 222 / 2786） |
| 丢弃类别 | `adult_anatomy_vocabulary`、`adult_camera_vocabulary`、`adult_character_vocabulary`、`adult_clothing_vocabulary`、`adult_expression_pose_vocabulary`、`adult_pose_vocabulary`、`adult_scene_vocabulary` |

裁剪规则：只保留通用类别，丢弃所有 `adult_` 前缀类别；不改写标签文本、搜索词与规则正文，不重新排序，不补写内容。

与邻舍的有意差异：

- 邻舍用全局正则清理原提示词；本实现只在**结构化作用域**内增删标签，从不重写自然语言。
- 每个作用域最多 9 条知识；候选标签沿用邻舍分类配额。
- 本轮只实现关键词分支；`vector` / `hybrid` 请求返回 `knowledge_mode_unsupported`，不静默降级，日志标记 `keyword`。

### 2B.2 检查结果

`apps/service/src/activity-prompt-knowledge.test.ts`：16 个用例全部通过，覆盖来源与哈希记录、模式拒绝、中文滑窗分词、作用域独立（第二个角色同标签保留）、已存在标签不重复、每作用域上限 9、否定语境记录且不改写原文、规则只作用于标签数组、知识命中带角色归属、结构化解析与围栏剥离、三种精确错误码、双向作用域不一致、空角色作用域、keyword 开关、系统指令固定 actorId 列表。

### 2B.3 失败项与未验证

- **未验证**：真实模型返回结构化 JSON 的端到端行为（未配置活动文本模型且未消耗真实调用）。
- **未验证**：结构化模式下的真实图片质量收益。

### 2B.4 下一阶段

阶段 2C（最小策略 UI），随后阶段 3（配置注册已实现，待真实 apply）。

---

## 阶段 2C：第一轮最小 UI

状态：**通过**（类型检查与既有门户测试通过；未做浏览器截图）。

### 2C.1 完成项

`app/features/generation/components/activity-image-prompt-policy-panel.tsx`：

| 要求（计划 §8.4） | 实现 |
| --- | --- |
| 策略编辑增加“原有描述／结构化混合” | 新增“提示词组织方式”二选一按钮组，写入 `outputFormat` |
| 关键词开关 | 新增“关键词补全标签”复选框，写入 `knowledgeMode`；仅在结构化模式下可勾选，切回原有描述时自动回落 `none` |
| 固定的画风归属说明 | 策略响应 `serviceFinalizedAssembly=true` 时显示说明条，画风字段清空并停用，一键画风按钮同步禁用 |
| 保存新组装模式的策略时清空并禁用画风字段 | `toDraft()` 在服务端组装模式下强制 `positiveSuffix=''`；保存请求再兜底提交空串 |
| 遇 409 提示后不重复发送 | 保存失败只展示原因，不自动重发、不自动改写草稿，避免覆盖他人新版本 |

`app/features/generation/api.ts` 无需改动：响应类型来自契约，新字段自动透传。

### 2C.2 检查结果

- `npx tsc --noEmit`（含门户）：通过。
- `npm run test:portal`：pass 17 / fail 0。
- `npx eslint` 针对改动文件：仅命中该组件**改动前就存在**的 3 条 `react-hooks/set-state-in-effect` 与 2 条 `exhaustive-deps` 警告（第 34、41、47 行的 useEffect 结构未改动）。

### 2C.3 未验证

- 浏览器实际交互与窄屏表现（阶段 7 统一做）。
- 真实 409 场景（需要在线服务与并发保存）。

---

## 阶段 3：预设、尺寸与注册方式

状态：**代码与只读检查通过**；真实 apply **需用户显式授权**。

### 3.1 完成项

| 交付 | 文件 |
| --- | --- |
| 两个固定预设、四个尺寸、画风快照 | `apps/service/src/activities/parity-config.ts` |
| 工作流族定义 | `apps/service/src/activities/parity-workflows.ts` |
| 注册脚本（只读 `--check` / 显式 `--apply --confirm`） | `scripts/activity-image-parity-config.ts` |

固定预设（与计划 §10.1 一致）：

| 名称 | UNET | steps | cfg | sampler | scheduler | 初始尺寸 |
| --- | --- | ---: | ---: | --- | --- | --- |
| 邻舍对齐 · Base | `anima_baseV10.safetensors` | 31 | 5 | er_sde | beta | 768×512 |
| 邻舍对齐 · Turbo | `anima_turboV10.safetensors` | 12 | 1 | er_sde | beta | 768×512 |

文本编码器 `anima_baseV10_txt.safetensors`（type `qwen_image`）；VAE `qwen_image_vae.safetensors`。画风 `邻舍对齐 · Anima` 正向串为邻舍快照原文，负向词使用邻舍模板快照，draft=Turbo、final=Base、defaultCanvas=768×512。

尺寸不等于档位：常用尺寸 768×512、1024×768、1280×720、1920×1080（后者标注“高显存／高耗时”），不自动成为默认。

注册脚本保证：预设 `enabled=true`、`isDefault=false`；**不更改旧 `app_generation_assignments`**（计划 §10.3）；细化专用的 `activity_image_upscale` 用途绑定可以建立，但已存在同用途绑定时只报告、不覆盖；同标识重复 apply 不产生重复修订；多引擎时必须显式 `--engine-id`，不猜第一条。

### 3.2 检查结果

- `node --import tsx scripts/activity-image-parity-config.ts --check`：以只读方式打开数据库，输出计划 JSON，未写入。真实库 `data/sthstart.db` 复查仍为迁移 48、0 个邻舍对齐工作流／预设／画风。
- `apps/service/src/activity-parity-config.test.ts`：6 个用例通过（多引擎拒绝、显式 `--engine-id` 选择、`enabled/isDefault` 取值、不触碰 `app_generation_assignments`、重复 apply 不新增修订、未迁移库拒绝 apply）。
- 旧 1080p 命名的 ID 不变：`listActivityImageWorkflowOptions()` 新增 `defaultWidth` / `defaultHeight`（取自该版本真实生效的尺寸预设或输入 schema 默认值），镜头绘制工作流选择器旁显示真实默认尺寸；当 ID 里的分辨率字样（如 `1080p`）只是历史命名时，提示改用“邻舍对齐”新工作流。`npx tsc --noEmit` 通过。

### 3.3 未验证与阻塞

- **未执行 `--apply`**：真实迁移与配置写入需要用户显式授权，本轮只做了只读 `--check` 与临时库测试。
- **外部阻塞**：ComfyUI 离线，无法核对 `anima_baseV10.safetensors`、`anima_baseV10_txt.safetensors`、`qwen_image_vae.safetensors` 是否真实存在。预检会按实际文件报缺项，不自动替换。

### 3.4 下一阶段

阶段 4A／4B／4C（放大细化）。

---

## 阶段 2B 补充修正（自查发现，已修）

自查时发现两处与计划／邻舍口径不一致，已修正并补测：

| 问题 | 影响 | 修正 |
| --- | --- | --- |
| 关键词检索用 `matched` 过滤，丢掉了 `isDefault` 的规则条目 | `ipk.count.solo`、`ipk.camera.*`、`ipk.gaze.*` 等规则在无词命中时不会参与，单人场景拿不到 `solo`，规则实际失效 | 改为与邻舍一致的 `score > 0`；规则加权仍只在命中时给 |
| 作用域标签选择传了空的 `existingKeys`，模型已给出的标签会被知识重复追加 | 同一作用域出现重复标签 | 改为省略 `existingKeys`，让它按来源文本自行去重 |
| 规则新增标签直接并入扁平列表，未按槽位归属 | `solo`／`closed_eyes`／`close-up` 会落进角色外观 | 新增 `RULE_TAG_TARGETS` 与 `tagDiff`，按人数／相机／环境／表情槽位归属，并同步剔除被规则删除的标签 |
| 规则新增标签未写回最终块 | 规则生效但结果里看不到 | 规则增删结果现在参与最终 `characters` / `camera` / `environment` 的构造 |

新增测试（`apps/service/src/activity-prompt-knowledge.test.ts`，共 19 个用例）：

- 关键词规则把新增标签写进正确槽位，且自然语言一字不改（含“两人并肩”这类关系句）。
- 显式传入的人数标签不会被规则覆盖。
- 模型已给出的标签不会被知识重复追加（全槽位去重断言）。

---

## 本轮回归与已知基线

### 已通过

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（含门户 `tsc --noEmit`） | 通过 |
| `npm run test:contracts` | pass 32 / fail 0（原 26 + 新增 6） |
| `npm run test:portal` | pass 17 / fail 0 |
| `node --import tsx/esm --test activity-prompt-migration / activity-prompt-snapshot / activity-prompt-v2 / activity-prompt-knowledge / activity-parity-config / activity-studio-health / generation-configuration / activity-studio-store` | pass 73 / fail 0 |
| `node --import tsx/esm --test activity-studio-render-optimizer` | pass 10 / fail 0 |
| `npm run test --workspace @sthstart/service`（全量，改动后） | pass 563 / fail 1 → 修正后单文件复跑通过，见下 |

### 本轮修正的既有测试

`apps/service/src/activity-studio-store.test.ts` 第一条用例把“迁移后最大版本”写死为 48。新增迁移 49 后它必然失败。该断言的真实意图是“从 v47 迁移到当前头部且不改动用户内容”，因此改为断言 `SERVICE_DATABASE_MIGRATIONS.at(-1)!.version`——**没有放低门槛**，只是不再写死编号。修正后该文件 4/4 通过。

### 既有基线（非本轮引入）

- `npm run lint` 全量：1205 problems（196 errors / 1009 warnings），集中在 `tests/e2e/*.spec.ts` 等既有文件。对**本轮新建与修改的每个文件**单独跑 `npx eslint`，只命中 `activity-image-prompt-policy-panel.tsx` 中改动前就存在的 3 条 `react-hooks/set-state-in-effect` 与 2 条 `exhaustive-deps` 警告，以及 `image-prompt-optimizer.ts:147` 改动前就存在的 `prefer-const`。**本轮未新增 lint 问题**，也未顺手修改无关文件。

### 外部阻塞（不能算通过）

- ComfyUI `127.0.0.1:8188` 离线（连接被拒绝）。节点、模型、编码器、VAE、LoRA、放大器清单均为 **unknown，不是缺失**。
- 因此以下项目本轮**未验证**，必须如实标记为外部阻塞：真实模型调用、真实图片质量对照、LoRA 验收、参考图验收、透明图 mask 方向的真实节点验证、真实 ComfyUI 上的细化执行。

---

## 真实数据库状态（只读复核，本轮未写入）

在全部代码改动完成后再复核一次真实数据目标：

| 命令 | 结果 |
| --- | --- |
| `npm run db:check` | `data/sthstart.db`：`migration_mismatch`，`version 48`，`expected 49`（如实报告，未静默迁移）；`data/narrative.db`：`ok`，2/2 |
| `npm run db:integrity` | 两个库均 `ok` |

**本轮从未对真实库执行 `db:migrate`、`db:reset`、`db:restore` 或任何写入。** 迁移 49 只在临时库／内存库上验证过。真实升级需要用户显式授权，命令顺序为 `db:check → db:backup → db:migrate → db:check → db:integrity`。

## 本轮最终回归（全部实际运行）

| 命令 | 结果 |
| --- | --- |
| `npm run test:contracts` | **tests 36 / pass 36 / fail 0** |
| `npm run typecheck`（activity-playback build + root `tsc --noEmit` + 三个 workspace） | **通过，无错误** |
| `npm run test:portal` | **tests 17 / pass 17 / fail 0** |
| `npm run build:portal` | **Build complete** |
| `npm run build:service` | **built，无错误** |
| `git diff --check` | **退出码 0**（仅 Git 的 LF→CRLF 提示，无空白错误） |
| `node --import tsx/esm --test` 全部 service 测试（`npm run test --workspace @sthstart/service`） | **tests 594 / pass 594 / fail 0** |
| 新增前端纯函数测试（`test:portal` 不自动覆盖，单独运行） | `workflow-option-display.test.ts` 6/6；`hires-request.test.ts` 6/6；`business-event-label.test.ts` 6/6；`business-href.test.ts` 1/1（合计 19/19） |
| `scripts/activity-image-parity-browser.mjs`（隔离夹具浏览器验收） | **通过**：桌面／窄屏／宽屏共 9 张截图，页面运行时错误 0、非预期失败请求 0；详见阶段 5.6 || `npm run db:check` | `data/sthstart.db` `migration_mismatch`（48 / 期望 49，如实报告）；`narrative.db` ok |
| `npm run db:integrity` | 两个库均 ok |

计划 §17.2 的全部命令都已逐条执行并记录结果。

## 阶段完成度总览（对照计划 §20.1）

| 阶段 | 状态 | 证据位置 |
| --- | --- | --- |
| 0 基线与保护 | **通过** | 阶段 0 各节 + 真实数据库状态 |
| 1 唯一组装来源与新工作流 | **通过**（真实实例已预检 + 真实出图） | 阶段 1、R3.2、R3.4、R4.3 |
| 2A 契约与数据库迁移 | **通过**（真实库已迁移到 49 并校验） | 阶段 2A、R3.3 |
| 2B 结构化优化与 keyword | **通过**（真实模型调用被凭据阻塞，见 R4.5） | 阶段 2B + 补充修正 |
| 2C 第一轮最小 UI | **通过**（浏览器验证已做） | 阶段 2C、R4.7 |
| 3 预设、尺寸与注册方式 | **通过**（真实 `--apply` 已执行且幂等） | 阶段 3、R3.3 |
| 4A 细化接口与冻结计划 | **通过** | 阶段 4 |
| 4B 细化工作流与任务执行 | **通过**：两个缺陷（mask 方向、白底尺寸）已定位并修复，v3 真实出图为满幅插画，来源 sha256 未变 | 阶段 4、R3.2、R6.1、R6.2、R7.1–R7.5 |
| 4C 原生历史、引用与恢复 | **通过** | 阶段 4 |
| 5 UI 实施规格 | **通过**（隔离夹具下桌面／宽屏／窄屏浏览器验收通过并逐张查看截图） | 阶段 5、R4.7 |
| 6 LoRA 与参考图验收 | **可自动化部分通过；真实验收因实例无 LoRA 文件而不可达** | 阶段 6、R4.6 |
| 7 真实样例、截图与预算 | **进行中：真实提交 6 / 12 成功、1 失败**（A×2、B×2、Turbo×1、细化×1；漫画派发被凭据挡下）；A/B 对照已完整成立；C 组同样被凭据阻塞；素材入口未实现 | 阶段 7、R4.1–R4.6、R5.1–R5.4、R6.1–R6.4、R7.1–R7.6、R8.1–R8.5、R9.1–R9.4、R12.1–R12.5、R14.1–R14.4、R15.1–R15.4 |

## 交付清单（对照计划 §20.1）

| 要求 | 结果 |
| --- | --- |
| 阶段 0–7 逐项：通过／未通过／外部阻塞，附证据 | 见上表与各阶段小节 |
| 修改文件及职责；已保护的既有改动说明 | 见各阶段“完成项”；`upstream/linshe` 未改，69 个既有未提交改动未动，未做任何 `git reset/clean/checkout/stash` |
| 迁移编号、实际数据目标、备份路径、integrity 与外键结果 | 新增迁移 **49**（`activity-prompt-structured-output-and-knowledge`）；**真实库已按 `db:check → db:backup → db:migrate → db:check → db:integrity` 迁移到 49**，两库 `integrity_check` 均 ok；备份 `data/backups/2026-10-03T07-11-28.124Z/`（含两个库与媒体清单）；迁移前后既有数据未丢失（见 R3.3） |
| 新工作流／版本／内容哈希、非默认预设／修订、画风及策略修订 | 文本 `anima-activity-linshe-parity` v1（`9d9af595…`）**已在真实库发布**；细化 `anima-activity-hires-basic` **已迭代到 v3**（v1 `3668c6a1…` → v2 `f808d544…`，v2 修 mask 方向、v3 修白底尺寸，见 R7.1／R7.2），绑定随 `advance` 推进到 v3（R7.3）；预设 `邻舍对齐 · Base`/`Turbo`、画风 `邻舍对齐 · Anima`、提示词策略 r1；重复 `--apply` 全部 `up_to_date`（见 R3.3） |
| 编译版本、词表来源 SHA／内容哈希、是否仅 keyword | `activity-image-v2.1`；词表 SHA256 `aeddfd9a…fad01`、内容哈希 `7baabdab…826d0`、数据集版本 `linshe-parity-1+7baabdab`；**仅 keyword**，`vector`/`hybrid` 显式拒绝 |
| 定向测试／契约／Portal／typecheck／构建的实际结果 | 见 R4.7 与各轮回归：typecheck 通过、契约 36/36、服务 595/595、Portal 17/17、`git diff --check` 0 |
| 真实活动 ID、完整任务 ID、调用 ID、artifactId、尺寸、seed、耗时 | **有**：每轮新建一个验收活动，最新一轮见 `artifacts/activity-image-parity-v2/2026-10-03T08-53-28/report.json`（含 activityId、jobId、artifactId、sha256、seed、尺寸）；细化任务 `d2309e7d-f056-42eb-90f4-24293b7ba2fb`、产物 `0f39dd8b-ab1d-471e-8375-1629bf426856`（R7.4） |
| 六张对照与三入口结果；细化前后原图 sha256 未变的证据 | **六张对照：A×2、B×2、Turbo×1 共 5 张成功，C×2 被凭据阻塞**（见 R4.3/R4.6）。**细化前后原图 sha256 未变已有真实证据**（R6.1／R7.4，`sourceUnchanged: true`）。**漫画入口已实现但派发被同一凭据挡下**（R9.2）；**素材入口仍未实现** |
| 桌面／窄屏截图和实际查看结论 | **已完成并逐张查看**：`artifacts/activity-image-parity-v2/2026-10-03T08-09-13.552Z/`（12 张，含漫画画格历史与高级区模式说明）；真实图片对照见 `2026-10-03T08-53-28/`（A/B/Turbo/细化 6 张，已人工查看；A 组注入两份画师串、B 组恰好一份且画面干净，细化输出为满幅插画） |
| 效果收益、属性串位等仍存在的问题与未验证项 | 见各阶段“未验证”与“外部阻塞” |
| 用户如何选择新画风、双档、细化以及回到旧配置 | 画风：生成设置 → 活动美术设置 → 画风卡选“邻舍对齐 · Anima” → 保存并应用；双档：同一弹窗“高级：档位预设与反向词”分别绑 Base／Turbo 预设；细化：镜头／漫画／素材历史图 → “放大细化”；回到旧配置：不选该画风卡、档位预设留“跟随公共生成绑定”即可，旧工作流与旧预设 ID 未改动 |
| **画面描述必须含英文标签**（第二十七轮实测） | `anima` 系列主要按**英文标签**理解画面，对中文散文响应很弱。实测：同一画格、同一工作流、同一画师串，**只加一段英文画面描述**，产物就从与描述无关的海滩场景变成正确的雪山营地（R24.8）。所以：镜头用 `customPrompt` 写英文；**漫画画格要把英文写进 `composition`／`visualDescription`**，只写中文会得到与描述无关的图。这条是非显然的使用约束，不是缺陷（画格字段本身是自由文本，没有独立的英文字段） |
| 是否部署／提交／推送 | **均为否**（未部署、未提交、未推送） |

## 仍未完成 / 未验证的清单（不得当作通过）

> 本节写于 ComfyUI 上线之前；第三轮起已陆续推翻其中若干条。**以各轮小节（R3 起）与“阶段完成度总览”为准**，保留本节是为了不掩盖当初的判断变化。当前仍然成立的未完成项见 R4.6、R14.3、R15.3。

1. ~~真实图片提交 0 / 12~~ → **已推进到 6 / 12 成功、1 失败**（A×2、B×2、Turbo×1、细化×1；C×2 与漫画 1 次被文本模型凭据阻塞）。素材空场景、真实 LoRA 仍未做。
2. ~~真实实例上的浏览器验收为 0~~ → 隔离夹具浏览器验收 12 张通过；**真实图片已生成并人工查看**。但“真实历史图上的细化前后对比”“漫画画格历史与素材历史的浏览器实际查看”仍未做。
3. ~~真实库未迁移、未注册配置~~ → **已迁移到 49 并注册完成**（R3.3，用户已授权）。
4. **漫画与素材的“按原配置重绘”未进图片动作条**：漫画仍走既有画格绘制弹窗，素材仍是既有“重试”。
5. ~~日志详情分段展示未逐项核对~~ → 已实现并浏览器验证；本轮还修掉了活动生图 `encodedTexts` 恒为空的缺陷（R4.2）。
6. **真实模型的结构化 JSON 端到端行为**未验证（活动文本模型凭据不可用，R4.5）。
7. ~~**真实 ComfyUI 上的细化输出为空**~~ → **第七轮已修复**（R7.1–R7.4）：白底合成缺 `InvertMask` 且白底尺寸未跟随来源图，两个缺陷都已在真实实例上验证修复，输出为满幅插画。
8. ~~**透明图（带 alpha 的来源图）的真实像素结果**仍未在实例上验证~~ → **第八轮已补齐**（R8.1–R8.4）：透明红方块 fixture 在真实实例上逐像素验证通过，并带反向对照证明判定有效。
9. **素材空场景的真实提交**仍未实现。漫画入口**已实现**（R9.1），但派发被同一凭据挡下（R9.2）。素材槽位是独立子系统（attempt／recipe／compilation／binding），规模远大于前两个入口，见 R17.1。
10. ~~A/B 对照缺少画风绑定~~ → **第五轮已补齐**（R5.1）：画风已绑定，A/B 在同一份画风下完成，A 组注入两份画师串、B 组恰好一份（R5.2）。
11. **`previewResponse` 另外 3 个调用点**（`beat-renders.ts:576、593、602`）的 `profileReady` 语义未修正（R15.3）；用户可见的预览路由已一致。

---

## 第三轮：ComfyUI 上线后的真实实例核验（重大进展）

### R3.1 环境状态变化

用户于本轮启动 ComfyUI，此前所有“实例离线”导致的 `unknown` 现在都有了实测结论。

| 项目 | 实测结果 |
| --- | --- |
| 实例 | ComfyUI **0.37.2**，`--windows-standalone-build --listen 0.0.0.0 --port 8188` |
| Python / PyTorch | 3.13.14 / 2.13.0+cu130 |
| GPU | cuda:0 **NVIDIA GeForce RTX 3080**，总显存 12 884 377 600 B（≈12 GB），提交前空闲 ≈10.87 GB |
| 节点类总数 | **962** |
| 必需节点类 | `UNETLoader`、`CLIPLoader`、`VAELoader`、`KSampler`、`CLIPTextEncode`、`EmptyLatentImage`、`VAEDecode`、`SaveImage`、`LoadImage`、`ImageScale`、`VAEEncode`、`ImageCompositeMasked`、`EmptyImage`、`ImageScaleToMaxDimension`、`LoraLoader`、`LoraLoaderModelOnly` **全部存在** |
| 模型文件 | `anima_baseV10.safetensors` ✓、`anima_turboV10.safetensors` ✓（UNETLoader 共 2 项）；`anima_baseV10_txt.safetensors` ✓（CLIPLoader）；`qwen_image_vae.safetensors` ✓（VAELoader 共 6 项） |
| `CLIPLoader.type` | 含 `qwen_image` ✓ |
| **LoRA 目录** | **0 个文件** —— 不是“未知”，是**确实没有**。真实 LoRA 验收因此无法通过（见 R3.4） |
| 队列 | `queue_running: []`、`queue_pending: []`（提交前确认空闲） |

### R3.2 真实实例只读预检（新增 `scripts/activity-image-parity-preflight.ts`）

把两个内置对齐工作流的定义按实际默认参数渲染成会派发的图，再对真实实例跑 `inspectWorkflowRuntime`。**只读 `/object_info`，不写库、不提交任务。**

```
node --import tsx scripts/activity-image-parity-preflight.ts
```

结果：**两个工作流都 `ok=true reachable=true`，没有问题**。

- `anima-activity-linshe-parity` contentHash `9d9af59556424f1a36e1f7a4ea6c8e4d3a4895e2d94a82f8ff3a85307df86820`
- `anima-activity-hires-basic` contentHash `3668c6a1ef5af044a9cee7679a8db695c828266f803d2c8a93c99cde87f41c14`
- 预设：`邻舍对齐 · Base` 31 步 / CFG 5 / er_sde+beta / 初始 768×512 / `anima_baseV10.safetensors`；`邻舍对齐 · Turbo` 12 步 / CFG 1 / er_sde+beta / `anima_turboV10.safetensors`
- 尺寸：768×512、1024×768、1280×720、1920×1080（高显存／高耗时）

这与邻舍模板值逐项一致。

### R3.3 真实库迁移与对齐配置注册（已获用户显式授权）

按计划 §7.5 的固定顺序执行，**每一步都实际运行**：

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 1 | `npm run db:check` | `sthstart.db` `migration_mismatch` 48/49；`narrative.db` ok 2/2 |
| 2 | `npm run db:backup` | `data/backups/2026-10-03T07-11-28.124Z/`（`sthstart.db` 11 800 576 B、`narrative.db` 274 432 B、`media-manifest.json`） |
| 3 | `npm run db:migrate` | 两个库均迁移 |
| 4 | `npm run db:check` | **`sthstart.db` ok 49/49**；`narrative.db` ok 2/2 |
| 5 | `npm run db:integrity` | 两个库均 **ok** |
| 6 | `npx tsx scripts/activity-image-parity-config.ts --apply --confirm` | 见下 |
| 7 | 再次 `--apply --confirm` | 全部 `up_to_date`、`bindingAction: skip`（**幂等性已证明**） |

数据保留核对（迁移前后对比）：活动 12、工作流版本、预设 8、用途绑定 1、提示词策略 28、LoRA 策略 0、工作室任务 5、产物 203、AI 调用 120 —— **既有数据未丢失**。新增列实测存在：`activity_image_prompt_policy_versions.output_format/knowledge_mode`、`activity_prompt_optimization_runs.slots_json/compilation_snapshot_json/request_hash_version`。

注册结果：

- 文本工作流 `anima-activity-linshe-parity` **v1** 已发布
- 细化工作流 `anima-activity-hires-basic` **v1** 已发布，并建立 `activities/activity_image_upscale` 用途绑定
- 预设 `邻舍对齐 · Base`（`75f01e31-fcda-46c4-8673-313ae25707f8`）、`邻舍对齐 · Turbo`（`ec19f51f-858d-4923-9733-05059f3d948c`），均 `enabled=1`、非默认
- 画风 `邻舍对齐 · Anima`（`preset_1f93e1ae78bc4cadb1b91f870623fa86`，`production_preset` v1）
- 提示词策略 r1：`output_format='tags'`、`knowledge_mode='keyword'`、`positive_suffix=''`（服务端组装模式下画风后缀必须为空）
- **既有绑定未被改动**：`activity_image_text → anima-activity-1080p-eval v4` 保持原样（计划 §10.3）

### R3.4 第一张真实图片（对齐工作流端到端打通）

用真实栈（宿主服务 `127.0.0.1:4300` + 宿主门户 `127.0.0.1:4747`，指向已迁移的真实库）对 `anima-activity-linshe-parity` v1 提交了一次真实试运行：

| 项目 | 值 |
| --- | --- |
| 任务 ID | `80c50a43-abe8-4ac5-b553-25783af93ad0` |
| 上游任务 ID | `e223ceb7-c05e-4b46-9e5c-7a556fd09f0d` |
| 状态 | **succeeded** |
| 耗时 | 07:23:19 → 07:23:35 = **16 秒** |
| 产物 | `d6d38e37-96e5-400e-8230-3cfb4a0ec88b`，554 000 B，`image/png`，sha256 `49f23a3909a0a6be2c304a89a9a49c28cecc60f20035422173daa7427b7b2a6f` |
| 解析后取值 | unet `anima_baseV10.safetensors`、clip `anima_baseV10_txt.safetensors`、vae `qwen_image_vae.safetensors`、768×512、31 步、CFG 5、er_sde/beta |
| seed | 20260101 |
| 本地副本 | `artifacts/activity-image-parity-v2/2026-10-03T07-22-10/B-parity-text-seed20260101.png` |

**关键证据**：`resolvedValues.prompt` 与提交的 `prompt` **逐字相同**——新工作流没有在服务端组装之后再追加任何质量词或画师串。这正是计划要修掉的 P-1 缺陷。实际图片已人工查看：银发绿眼、白大褂、手持绿色液体的烧瓶、雪夜营地与帐篷，与提示词一致，画面无质量串重复导致的花屏或崩坏。

`peakVram` 仍按计划要求记为**未测**（未从总显存推算）。

### R3.5 本轮真实样例的诚实边界

`scripts/activity-image-parity-sample.mjs --confirm` 实际只完成了“校验 + 创建专用验收活动 + 写报告”，**没有实现逐项提交循环**：报告 `submissions: []`、`status: "ready"`，活动 ID `c32f5397-8be7-4e90-90d3-6ccf9116bc58`。因此：

- **计划预算口径下仍是 0 / 12**（上面那张图走的是工作流试运行入口，不是 `--confirm` 的预算条目；按预算计数应记为 **1 / 12**，但它是 `configuration-test` 用途，不是 A/B/C 对照条目）。
- 未执行：A（旧工作流 + 画风后缀）、B 第二 seed、C（结构化 tags + keyword，需要已配置的活动文本模型）、漫画双角色、素材空场景、Turbo 真实参数、真实细化、真实 LoRA、1920×1080。
- **真实 LoRA 无法通过**：实例 `loras/` 目录为空（0 个文件），不是连接问题而是资产缺失。按计划要求没有下载任何 LoRA 来凑验收。
- 脚本缺口已定位但**本轮未修**：需要在 `--confirm` 分支补齐按 `budgetPlan` 串行提交、轮询、记录 artifactId／上游任务 ID／实际编码文本的逻辑。

### R3.6 复现真实栈的命令（本轮结束后已停止这些进程）

宿主实例的 Docker 部署（门户 `9320`）使用**另一份数据库**，看不到本轮迁移与注册结果；要对真实库跑样例必须起宿主栈：

```
# 1) 宿主服务（默认读 data/sthstart.db，即本轮已迁移的真实库）
$env:SERVICE_PORT='4300'; npm run dev:service

# 2) 宿主门户，指向上面的服务
$env:STHSTART_SERVICE_URL='http://127.0.0.1:4300'
$env:NEXT_PUBLIC_STHSTART_SERVICE_URL='http://127.0.0.1:4300'
$env:STHSTART_ADMIN_TOKEN=(取自 .env)
$env:STHSTART_SESSION_SECRET=(取自 .env)
$env:STHSTART_IMAGE_SIGNING_SECRET=(取自 .env)
npm run build:portal
npx vinext start --port 4747 --hostname 127.0.0.1

# 3) 只读预检 / 样例
node --import tsx scripts/activity-image-parity-preflight.ts
$env:STHSTART_ADMIN_TOKEN=(取自 .env)
node scripts/activity-image-parity-sample.mjs --portal http://127.0.0.1:4747           # 预演
node scripts/activity-image-parity-sample.mjs --portal http://127.0.0.1:4747 --confirm # 真实提交
```

**注意**：`Test-NetConnection` 在本机沙箱里会对未监听端口也报 `True`，判断端口占用请以实际 HTTP 响应为准。

| 脚本 | `scripts/activity-image-parity-preflight.ts` | 真实实例只读预检：渲染两个对齐工作流并对真实 ComfyUI 核对节点类／模型文件／图链接；`--submit-*` 默认关闭 |
| 证据 | `artifacts/activity-image-parity-v2/2026-10-03T07-22-10/` | `B-parity-text-seed20260101.png`（真实生成图，sha256 `49f23a39…`）、`report.json` |
| 备份 | `data/backups/2026-10-03T07-11-28.124Z/` | 迁移前完整备份（两个库 + 媒体清单） |
| 日志 | `docs/development/logs/activity-image-linshe-parity-v2-progress.md` | 本文件 |

## 第四轮：真实提交循环与 A/B 对照

### R4.1 补齐了 `--confirm` 的真实提交循环（此前只是脚手架）

`scripts/activity-image-parity-sample.mjs` 现在真的会跑：准备受控镜头 → 逐项预览／提交／轮询 → 下载产物 → 读调用日志 → 写报告。新增能力：

- 改写验收活动的默认镜头为固定测试镜头，并提交为内容版本（不再只建一个空活动）。
- 变体解析：A 组从 `activity_image_text` 绑定读出旧工作流；B/C 用对齐工作流；Turbo 用 Turbo 预设；LoRA 组先查实例 LoRA 清单，为空就如实跳过而不是下载文件凑数。
- 提交时带上预览返回的 `presetRevision`（不带会 409 `beat_render_plan_conflict`）。
- 轮询结束后取**候选上的** `callId`（提交响应里的还是空的），再去读实际编码文本。
- 产物下载沿用探测到的管理接口前缀（直连服务是 `/api/v1/admin`，门户是 `/api/admin`）。
- 本轮为了隔离变量而临时改动的提示词策略，结束时按快照写回（实测恢复为 `enabled=true / prose / none`）。

### R4.2 修复了一个真实缺陷：活动生图的“实际编码文本”恒为空

`ai-call-routes.ts` 只按 `requestSnapshot.workflow` 取值。但**配置试运行**存的是 `{ workflow: 图 }`，而**活动生图**直接把整张图存进 `requestSnapshot`（键就是节点 id）。结果：恰恰在最需要它的活动生图路径上，`encodedTexts` 永远是 `[]`。

修复后对同一条真实调用验证：

```
encodedTexts count: 2
  [positive] node 6: 主体角色：旁白, 必须出现在画面中, 不可缺席, 可见动作：研究员轻轻摇晃试管, ...
  [negative] node 7: worst quality, low quality, blurry, text, watermark, signature, ...
```

新增测试 `AI call detail resolves encoded texts from both activity-graph and wrapped snapshots` 覆盖两种快照形状，并断言无法安全解析时返回空列表而不是猜一个文本。`ai-call-trace.test.ts` **6/6 通过**。

### R4.3 A/B 真实对照（每组两个固定 seed）

真实提交 **5 张图片全部成功**，产物已下载（`artifacts/activity-image-parity-v2/2026-10-03T07-50-16/`）。固定条件：同一镜头、768×512、31 步／CFG 5／er_sde／beta、同一负向词。

| 组 | 工作流 | 组装模式 | seed | sha256（前 16） |
| --- | --- | --- | --- | --- |
| A | `anima-activity-1080p-eval` v4 | `workflow-internal` | 20260101 | `798a319a8a06c6b8` |
| A | 同上 | `workflow-internal` | 20260102 | `183b34854b655604` |
| B | `anima-activity-linshe-parity` v1 | `service-finalized-v1` | 20260101 | `c4de5549a92a68b3` |
| B | 同上 | `service-finalized-v1` | 20260102 | `a8d2f901fd99e772` |
| Turbo | `anima-activity-linshe-parity` v1 + Turbo 预设 | `service-finalized-v1` | 20260101 | `211e012576720554` |

**核心证据——真正进入 `CLIPTextEncode` 的字符串**：

- A 组节点 6 实际收到：`@ebora,masterpiece, best quality, score_9, score_8，highres, absurdres,anime screenshot,year 2025,主体角色：旁白, 必须出现在画面中, …`
- B 组节点 6 实际收到：`主体角色：旁白, 必须出现在画面中, 不可缺席, 可见动作：…, 镜头构图：…, 可见动作应明确呈现。`

即：**旧工作流把画风／质量串硬编码进正向提示词最前面，新工作流完全不注入**——这正是计划要修的 P-1 缺陷，且现在有了逐字证据，不再只是代码推断。

### R4.4 如实记录：本轮对照的两处不足

1. **B 组效果不佳，如实保留。** 两个 seed 的 B 组都出现了**游戏 UI／对话框文字污染**（`B-seed1` 有对话框与角色头像栏，`B-seed2` 有对白框与按钮）。A 组两张都是干净插画。合理解释是 A 的质量串（`masterpiece, score_9, anime screenshot` 等）起到了“插画锚点”作用，而 B 组在本轮**完全没有风格锚点**——原因是下一项。
2. **本轮 A/B 没有绑定画风，不是计划 §9 的完整形态。** 计划要求 B/C 带“单份画风”。验收活动是新建的空活动，其 `image-config` 草稿里**根本没有 `artDirection` 字段**；补绑定需要一并构造 `renderProfiles`（草稿里也没有），而 `art-direction/commit` 要求 `quality`／`canvas`／`renderProfiles` 三者齐备。本轮补到 `quality` 与 `canvas` 后卡在 `renderProfiles`，**未完成画风绑定**。所以上面的 A/B 结论只在“无画风”条件下成立；带画风的对照仍未做。

> **第五轮已补齐并更正**：见 R5.1–R5.3。带画风的完整对照已完成；上面第 1 条对 B 组“UI 文字污染”的归因（缺少风格锚点）已被证实，且补上画风后污染消失。

### R4.5 文本模型凭据阻塞（外部条件，需用户处理）

所有走活动管线的提交最初都失败在派发前：

```
活动文本模型配置读取失败：备用文本模型已配置的凭据不可用。
```

只读诊断（加载了 `.env`，`KEYRING_FILE_MASTER_KEY` 已生效）确认根因：

```
binding: { hash: "67110edf…", enabled: true, credentialRequired: true, name: "ds", model: "deepseek-flash" }
resolveProfile: { id: 'ds-jy', baseUrl: 'https://tokenrhythm.studio/v1', model: 'deepseek-flash', hasSecret: false, secretLength: 0 }
resolveStudioTextProfile 抛错: 备用文本模型已配置的凭据不可用。 studio_fallback_profile_unavailable
```

即活动文本模型 `ds-jy` 声明了 `credential_account = 'profile:ds-jy'`，但凭据库里读不出对应密钥。**这需要用户在设置页重新填写该供应商的 API Key**；本轮没有、也不应该替用户写入密钥。

处理方式：脚本在检测到这个错误后**关闭该工作流版本的提示词优化再重试一次**（这条路径的 AI 调用记录是 `not_dispatched`，没有排队任何 GPU 任务，所以不消耗图片预算），从而把“服务端组装”这一项变量单独隔离出来。C 组因为全部意义就是结构化优化，**直接跳过而不冒充已验证**：

> 结构化优化需要可用的活动文本模型，实例凭据不可用。关掉优化会让本组退化成 B 组，因此不冒充已验证。

### R4.6 本轮真实样例口径

| 预算项 | 状态 |
| --- | --- |
| A/B 各两个固定 seed（6 次） | A×2 与 B×2 **成功**（4 次）；C×2 **跳过**（凭据阻塞） |
| Turbo 真实参数 | **成功**（1 次） |
| 漫画双角色 | 跳过：本轮未实现该入口的提交 |
| 素材空场景／无人道具 | 跳过：验收活动没有素材槽位 |
| 基础细化 | 跳过：未实现来源图 → `/studio/hires` 的链路 |
| 有文件时真实 LoRA | 跳过：实例 LoRA 目录为空 |
| 必要补验 | 未触发 |

**实际图片提交 5 / 12**，失败 0。`peakVram` 按要求记为**未测**。

### R4.7 本轮回归与浏览器验收

修复 `ai-call-routes.ts` 之后重跑隔离夹具的浏览器验收（**12 张截图，`page errors: none`，`unexpected HTTP: none`**），证据目录 `artifacts/activity-image-parity-v2/2026-10-03T08-09-13.552Z/`：

- `desktop-06-log-detail.png`：夹具的工作流把提示词绑到空的 `StringConcatenate`，属于**真的读不出来**，日志仍如实显示“无法从这次调用的工作流快照确定实际编码文本”，说明修复没有把“读不出来”伪装成“读出来了”。
- `desktop-07-comic-history.png`：漫画画格历史的 `按原配置重绘 / 放大细化 / 日志` 动作条（第三轮补的覆盖）。
- `desktop-03b-advanced-mode.png`：高级区的“提示词模式：工作流图内自行拼接（语义字段工作流 v1）”。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:contracts` | **36 / 36** |
| `npm run test --workspace @sthstart/service` | **595 / 595**（较上轮 +1，为新增的快照形状用例） |
| `npm run test:portal` | **17 / 17** |
| `git diff --check` | 退出码 0 |
| `npm run db:check` | `sthstart.db` **ok 49/49**、`narrative.db` **ok 2/2** |

## 第五轮：补上画风绑定，A/B 对照成立

### R5.1 补全了验收活动的画风绑定（第四轮 R4.4 的缺口）

`art-direction/commit` 要求 `quality`／`canvas`／`renderProfiles` 三者齐备，而新建空活动的 `image-config` 草稿里**连 `artDirection` 都没有**。本轮补齐，并修掉一个我自己脚本里的错误：

- 已注册画风 `邻舍对齐 · Anima` 的 payload **本来就带正确的 `renderProfiles`**（draft→Turbo 预设 `ec19f51f…`，final→Base 预设 `75f01e31…`，都指向 `anima-activity-linshe-parity` v1），直接复用即可。
- 关键修正：门户在选择画风卡时会把 `payload.positiveStylePrompt`／`negativePrompt` 写进 `globalStylePrompt`／`globalNegativePrompt`。我的脚本第一版只写了 `selectedStyle`，导致**画风自己的风格串根本没参与组装**——这是脚本缺陷，不是产品缺陷。对齐门户行为后 A/B 才真正可比。

### R5.2 A/B 对照（画风已绑定，计划 §9 的完整形态）

同一镜头、同一画风 `邻舍对齐 · Anima`、768×512、31 步／CFG 5／er_sde／beta、同一负向词。**5 次提交全部成功，失败 0**，证据目录 `artifacts/activity-image-parity-v2/2026-10-03T08-16-23/`。

> 注：该目录在后续产物收敛时已被删除（每一轮新建验收活动，产物目录逐轮更替）。R5.2 的**数值结论仍然成立**，它们来自当时的 `report.json`；可用的现行证据目录见“阶段完成度总览”与“交付清单”指向的 `2026-10-03T08-53-28/`。

真正进入 `CLIPTextEncode` 节点 6 的字符串里，画师／质量串的出现次数：

| 组 | 工作流 | 组装模式 | `@ebora` | `masterpiece` | `score_9` | 正向文本长度 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| **A**（seed 1／2） | `anima-activity-1080p-eval` v4 | `workflow-internal` | **2** | **2** | **2** | 535 |
| **B**（seed 1／2） | `anima-activity-linshe-parity` v1 | `service-finalized-v1` | **1** | **1** | **1** | 442 |
| Turbo | `anima-activity-linshe-parity` v1 | `service-finalized-v1` | **1** | **1** | **1** | 442 |

A 组实际文本（节选，两份用不同分隔符，正好暴露来源不同）：

```
@ebora,masterpiece, best quality, score_9, score_8，highres, absurdres,anime screenshot,year 2025,   ← 图内硬编码
主体角色：…；可见动作应明确呈现。,
@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025 ← 活动画风
```

B 组实际文本（节选，只有一份，且顺序符合计划 §6.2 的 V2 组装顺序）：

```
@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025,
主体角色：旁白, 必须出现在画面中, 不可缺席, 可见动作：…, 场景：…, 镜头构图：…, 可见动作应明确呈现。
```

即 **P-1 缺陷与它的修复都有了逐字、可量化的真实实例证据**：旧工作流把同一串画师／质量串注入两次，新工作流恰好一次。

### R5.3 修正第四轮的一个误判

第四轮记录 B 组"两个 seed 都出现游戏 UI／对话框文字污染"，并推测是缺少风格锚点。**推测成立**：补上画风后，B 组两个 seed 都变成了干净插画，无任何 UI 或文字污染。所以那段污染是**当时脚本没绑定画风**造成的，不是对齐工作流的问题。R4.4 的结论按此更正。

| B-seed1（补画风后） | B-seed2（补画风后） |
| --- | --- |
| `sha256 3f014b8a…` | `sha256 bcfddf5f…` |

### R5.4 仍然阻塞的项（未变）

- **C 组**：活动文本模型 `ds-jy` 凭据不可用（R4.5），结构化优化无法执行；关掉优化会退化成 B 组，因此跳过而不冒充已验证。
- **漫画双角色／素材空场景／基础细化**：脚本未实现这三个入口的提交链路。
- **真实 LoRA**：实例 LoRA 目录为空。

## 第六轮：基础细化真实链路——跑通了，但结果是白图

### R6.1 细化的真实链路已接通

`--confirm` 现在实现了 `/studio/hires` 的预览 → 提交 → 轮询 → 取产物。真实执行结果（证据目录 `artifacts/activity-image-parity-v2/2026-10-03T08-33-42/`）：

| 项目 | 值 |
| --- | --- |
| 任务 | `6386fe69-6ce1-4886-a5e2-43c3ae9d0bde`，`kind=render_batch`、`operation=hires`、状态 **succeeded** |
| 来源 | `B-seed1` 的产物 `df84b8d1-3a58-472a-9972-7c937b507b64`，768×512 |
| 输出 | **2000×1328**（`maxSize=2000`，长边约束正确、宽高比保持） |
| 继承的加载器 | `anima_baseV10.safetensors` / `anima_baseV10_txt.safetensors` / `qwen_image_vae.safetensors` |
| 继承的采样参数 | 31 步 / CFG 5 / er_sde / beta，`denoise=0.2` |
| 工作流 | `anima-activity-hires-basic` v1 |
| **来源图 sha256 前后** | `ed0b3e86dcb049e9…` → `ed0b3e86dcb049e9…`，**`sourceUnchanged: true`** |
| 产物 | `5524c584-92f4-44ee-ab77-0cb7e62534ef` |

计划 §18.1 要求的“细化前后原图 sha256 未变”**已取得真实证据**。

### R6.2 缺陷：细化任务报告成功，产物却是纯白图

下载产物后**人工查看**（`hires-basic-from-B-seed1.png`，2000×1328，805 431 B）：**整张图是纯白的，没有任何画面内容**。

任务状态是 `succeeded`、`result.succeeded=1`、`result.failed=0`、`applyState=not_applied`，也就是说**链路自认为成功，但实际输出为空**。这属于计划 §20.2“不能算完成”的情形，必须如实记录而不是按“细化验收通过”计。

本轮**未定位根因**。可疑方向（按可能性排序，均未验证）：

1. **来源图没有被真正送进 ComfyUI**：细化工作流要用 `LoadImage` 读原图，若上传/命名环节失败而节点仍返回一张空图，后续 `VAEEncode` → 采样 → `VAEDecode` 就会稳定产出白图。
2. 透明图/mask 分支在来源图为不透明 PNG 时的默认值把整张图 mask 掉了。
3. `denoise=0.2` 与 `ImageScaleToMaxDimension` 的配合问题（放大后 latent 与图像尺寸不一致）。

**结论：阶段 4B 的“真实实例出图”仍是未通过项**，只是失败方式从“未执行”变成了“执行了但输出为空”。

### R6.3 附带验证到的错误码（计划 §19）

细化对**旧工作流的来源图**（图内自行拼接提示词、快照不可解析）正确拒绝，且错误码与文案与计划一致。这一步是预览，不派发任务、不占预算：

```
status 409
error   hires_source_snapshot_unavailable
message 原图由工作流自行拼接提示词，无法确定实际编码文本；建议重新绘制。
```

脚本据此改为**优先选用对齐工作流（服务端组装、快照可解析）的成果**作为细化来源。

### R6.4 本轮真实提交口径

**6 / 12 成功**（A×2、B×2、Turbo×1、细化×1），失败 0，跳过 6（C×2 凭据阻塞、漫画、素材、LoRA、补验）。`peakVram` 仍为**未测**。

## 第七轮：白图根因已定位并修复（两个缺陷）

### R7.1 缺陷一：白底合成用错了 mask 方向

计划 §12.2 写得很明确：

> LoadImage的alpha mask**经 InvertMask 后**供 ImageCompositeMasked 将原图合成到白底
> LoadImage的mask通常为反alpha，**必须验证mask方向，不能把人物抹掉**……**非透明图不得产生黑底或变色**。

我的实现把 `ImageCompositeMasked.mask` 直接接到了 `['1', 1]`（LoadImage 的 mask 输出），**少了 InvertMask**。ComfyUI 的 `LoadImage` mask 是“透明处为 1”的反 alpha：对不透明图**整张为 0**，于是合成时整张保留 destination（白底）——**输出就是纯白图**，与 R6.2 观察到的现象完全一致。

修复：新增节点 `'14': InvertMask { mask: ['1', 1] }`，`ImageCompositeMasked.mask` 改为 `['14', 0]`。真实实例确认 `InvertMask` 节点存在（输入 `mask`），符合计划“实例不具备所需节点时停止”的前提。

### R7.2 缺陷二：白底尺寸没有跟随来源图

mask 修好后画面出来了，但**画面只占左上角、其余是白的**。原因：`EmptyImage`（节点 2）的 `width`/`height` 从来没被绑定过，一直是默认 **1024×1024**；而 `ImageCompositeMasked` 是 `resize_source: false` 的 1:1 贴图，768×512 的来源只覆盖左上角，随后 `ImageScale` 把这张带白边的 1024×1024 拉成 2000×1328。

计划 §12.2 要求的是 `EmptyImage` 取**原图尺寸**。修复：

- 新增输入 `sourceWidth` / `sourceHeight`，绑定到 `['2','inputs','width']` / `['2','inputs','height']`。
- `studio-hires.ts` 把 `probe.width` / `probe.height` 一起写回工作流。

### R7.3 注册脚本的连带修复：同族工作流必须推进绑定

修好图形后 `--apply` 发布了 `anima-activity-hires-basic` **v2**，但 `activities/activity_image_upscale` 绑定**仍指向 v1**——原逻辑“已存在同用途绑定就跳过”会让修复永远不生效。改为：

- 绑定不存在 → `create`
- 绑定指向**同一工作流**但版本落后 → **`advance`**（推进版本）
- 绑定指向别的工作流或已是当前版本 → `skip`（仍然不覆盖别人的绑定）

实测：`v1 → v2`、`v2 → v3` 两次都正确推进并如实报告。

### R7.4 修复后的真实结果

细化工作流 **v3**，来源 `B-seed1`（768×512），任务 `d2309e7d-f056-42eb-90f4-24293b7ba2fb`：

| 项目 | 值 |
| --- | --- |
| 状态 | succeeded |
| 输出 | **2000×1328** |
| 来源图 sha256 | 前后一致，`sourceUnchanged: true` |
| 产物 | `0f39dd8b-ab1d-471e-8375-1629bf426856`，2 789 202 B |
| 本地副本 | `artifacts/activity-image-parity-v2/2026-10-03T08-53-28/hires-basic-from-B-seed1.png` |

**人工查看结论**：满幅插画，无白边、无空白区域、无变色；人物、动作、道具、场景与来源一致，只是放大并小幅重绘。计划 §12.2 的三条硬要求（mask 方向正确、不透明图不产生黑底或变色、结果是不透明新图）**均已满足**。

**阶段 4B 从「未通过」改为通过。**

### R7.5 回归测试同步更新

- `activity-image-hires.test.ts` 的透明图用例原本**把错误接线断言成了正确行为**（`mask === ['1', 1]`），已改为断言 `InvertMask` 存在、mask 取 `['14', 0]`，并新增白底尺寸绑定断言。
- 夹具 `activity-image-hires-support.ts` 的 `/object_info` 补上 `InvertMask`（原先缺失会让派发路径的 4 个用例失败）。
- `activity-image-hires.test.ts` **20/20**、`activity-parity-config.test.ts` **6/6**。

### R7.6 本轮真实提交口径

**6 / 12 成功**（A×2、B×2、Turbo×1、细化×1），失败 0，跳过 6。`peakVram` 仍为**未测**。

## 第八轮：透明图 fixture 的像素级验证（计划 §12.2 最后一项）

### R8.1 计划要求的验证

计划 §12.2 原文：

> LoadImage的mask通常为反alpha，必须验证mask方向，不能把人物抹掉。**用透明红方块与不透明边缘fixture做节点输入/输出验证。非透明图不得产生黑底或变色。**

第七轮修的是**不透明**来源图的白图问题；mask 方向对**带 alpha** 来源图的行为只有单元测试覆盖，没有真实像素证据。本轮补上。

### R8.2 做法

新增 `scripts/activity-image-parity-alpha-check.ts`（只读探针：不写业务库、不建活动、不占验收预算）：

1. 内存生成 **256×256 RGBA** fixture：全透明底 + 中间**不透明红方块**（硬边）+ 左上角**半透明绿方块**（alpha=128）。
2. 上传到真实 ComfyUI `/upload/image`。
3. 用**项目自己的** `buildParityHiresWorkflow()` + `renderWorkflowSnapshot()` 渲染图形方案（验证的就是真实派发用的图，不是另写一份）。
4. 派发、轮询、`/view` 取回输出，**自行解码 PNG**（zlib inflate + 逐行反过滤）后逐像素判定。

### R8.3 结果

输出 512×512、**3 通道（无 alpha）**——是不透明新图。

| 判定项 | 实测 | 结论 |
| --- | --- | --- |
| 不透明红方块保留红色 | 中心 RGB **254,0,0** | 通过——**没有被抹掉** |
| 透明区域合成成白底 | 角落 RGB **254,254,255** | 通过——**不是黑底** |
| 半透明区域未被当成完全透明丢掉 | RGB **125,253,132**（≈ alpha 0.5 的绿混白） | 通过 |
| 结果是不透明新图 | 3 通道 | 通过 |

计划 §12.2 的三条硬要求（mask 方向正确、不产生黑底、不透明新图）**全部有真实像素证据**。

### R8.4 反向对照：证明这个判定真的能测出 mask 方向

一个在坏代码上也会通过的检查没有价值，所以脚本带 `--negative-control`：把合成 mask 接回**未反转**的 `LoadImage` 输出（即第七轮修复前的错误接线），重新派发。

| 判定项 | 修复后 | 反向对照 |
| --- | --- | --- |
| 不透明红方块保留红色 | `254,0,0` ✓ | **`255,254,254`（被抹成白底）** |
| 透明区域合成成白底 | `254,254,255` ✓ | **`0,0,0`（黑底）** |
| 结果是不透明新图 | 3 通道 ✓ | 3 通道（不具区分力） |
| 半透明区域未被丢掉 | `125,253,132` ✓ | `127,253,134`（不具区分力） |

反向对照**精确复现了缺陷**，且症状正好落在计划点名禁止的两条上：**不透明处被抹成白底、透明处产生黑底**。这既证明判定有效，也说明第七轮的修复方向正确。

补充一条观察：同一个根因在不同来源图上症状不同——**不透明来源图**的 mask 整张为 0，于是整张保留白底，输出**纯白**（R6.2）；**透明来源图**的反 alpha 在透明处为 1，于是取到透明像素的 RGB(0,0,0)，输出**黑底**。计划把两种症状都点了名，本轮两种都拿到了实证。

### R8.5 本轮真实提交口径

未产生新的业务提交，仍是 **6 / 12 成功**。透明图验证走的是只读探针，不占预算。`peakVram` 仍为**未测**。

## 第九轮：漫画画格入口已接通，但被同一个凭据阻塞；并发现一处预检缺口

### R9.1 实现内容

`--confirm` 现在实现了漫画入口的完整链路：构造画格文档 → `PUT /comic/draft` → `POST /comic/panels/:panelId/render-preview` → `POST .../renders` → 轮询 `GET /comic/jobs/:jobId` → 取产物。

两个实现要点：

- 漫画草稿**默认是空的**（`createComicDraft` 不生成画格），必须按契约自己构造，且 `sceneId`／`beatIds` 只能引用内容版本里的**真实** id。
- `duo` 模板**每页恰好 2 格**，服务端会校验（第一次提交被 `comic_invalid_document` 挡下：「页面 parity-page-1 的 duo 模板需要 2 格，实际 4 格」）。已改为两页各 2 格、共 4 格。

### R9.2 预览通过，派发失败

| 项目 | 值 |
| --- | --- |
| 画格 | `parity-panel-1`，共 4 格（两页 duo） |
| 预览 `canSubmit` | **true** |
| 工作流 | `anima-activity-linshe-parity` v1 |
| 组装模式 | `service-finalized-v1` |
| 任务 | `84b37f7e-4c2f-404b-8c4c-55ef935db00c` |
| 终态 | **failed** |
| `errorCode` | **`prompt_optimizer_profile_unavailable`** |
| `errorMessage` | 活动文本模型配置读取失败：备用文本模型已配置的凭据不可用。 |

即漫画入口走的是**同一条文本模型依赖**，被 R4.5 的凭据阻塞挡住了。这不是本轮实现的问题：链路本身（草稿、画格、预览、提交、轮询）都跑通了，失败发生在派发阶段。

### R9.3 发现一处预检缺口（新）——第十轮已更正范围

**漫画预览在凭据不可用的情况下仍然报告 `canSubmit: true`，直到派发才失败。** 用户会在界面上看到一个可提交的按钮，点下去才失败。这属于计划 §20.2 的「不能算完成」情形，本轮**未修复**。

> **第十轮更正**：R9.3 原文写「镜头（beat）路径的预检会提前把凭据问题暴露出来，漫画预览没有做同样的检查」——**这句是错的**。第十轮查证 `beat-renders.ts:192`：
>
> ```ts
> const optimizerReady = binding.enabled && Boolean(binding.model.trim());
> ```
>
> 它只看**策略是否启用**和**模型名是否非空**，**不解析凭据**。所以镜头路径的预览同样会在凭据缺失时报 `canSubmit: true`。我在 R4.5 是从**派发返回的错误**里读到凭据问题的，不是从预览里读到的，当时把它误记成了「预检暴露」。
>
> 准确结论：**两条路径的预览都不检查文本模型凭据**，缺口是共用的，不是漫画独有。`resolveStudioTextProfile`（`studio-model-binding.ts:27`）才是唯一会因 `binding.credentialRequired && !profile.secret` 抛 `studio_fallback_profile_unavailable` 的地方，而它只在派发路径上被调用。
>
> 修复方向随之更正为：**镜头与漫画两条预览路径都应调用同一个凭据解析**，把凭据缺失计入 `issues` 并置 `canSubmit=false`，而不是只改漫画一处。

### R9.4 本轮真实提交口径

**6 / 12 成功、1 失败**（A×2、B×2、Turbo×1、细化×1；漫画 1 次派发失败），跳过 5。`peakVram` 仍为**未测**。

## 第十轮：更正 R9.3 的错误判断（缺口是共用的，不是漫画独有）

### R10.1 更正内容

R9.3 声称「镜头路径的预检会提前暴露凭据问题，漫画预览没有」。第十轮逐处查证后确认**这句是错的**，已在 R9.3 就地加注更正，不删除原文。

查证依据（`apps/service/src/activities/beat-renders.ts`）：

```ts
// 第 192 行：只看策略是否启用、模型名是否非空
const optimizerReady = binding.enabled && Boolean(binding.model.trim());
// 第 252 行：据此决定 canSubmit
canSubmit: plan.canSubmit && (!plan.promptPolicy.enabled || plan.optimizerReady),
// 第 257 行：只在“未配置模型”时给警告，凭据缺失不产生任何提示
...(plan.promptPolicy.enabled && !plan.optimizerReady ? ['活动文本模型未配置；提交将被阻止，避免未经优化直接生图。'] : [])
```

`optimizerReady` **不解析凭据**。唯一会因 `binding.credentialRequired && !profile.secret` 抛 `studio_fallback_profile_unavailable` 的地方是 `studio-model-binding.ts:27` 的 `resolveStudioTextProfile`，而它只在**派发**路径上被调用。

所以准确结论是：

| 路径 | 预览是否检查文本模型凭据 |
| --- | --- |
| 镜头（beat） | **否** |
| 漫画（comic） | **否** |

两条路径的缺口是**共用的**。我在 R4.5 是从派发返回的错误信息里读到凭据问题的，当时误记成了「预检暴露」。

### R10.2 修复范围随之更正

原计划只改漫画一处，是**错的**。正确做法是让**两条预览路径共用同一个凭据解析**：

1. 在预览阶段调用 `resolveStudioTextProfile`（或等价的只读凭据检查）。
2. 凭据缺失时：`issues` 追加具体原因、`canSubmit=false`、并把 `profileReady` 置为 `false`。
3. 镜头路径的 `profileReady` 语义要一并修正——它现在只表示「模型名非空」，与字段名暗示的「档案就绪」不符。

本轮**未实施**该修复（上下文预算用尽），如实记录为下一轮的首要待办。

## 第十一轮：定位修复落点，未实施

### R11.1 为什么不是一个单行改动

第十轮把修复方向定成「两条预览路径共用同一个凭据解析」。第十一轮逐处查证后确认：**这不是加一行判断就能完成的**，原因是同步／异步边界。

现状（`apps/service/src/activities/beat-renders.ts`）：

```ts
// 第 189 行：拿到的 binding 是同步结果
const binding = studioTextProfileBinding(database, optimizerOverride?.profileId ?? String(assigned?.profile_id ?? ''));
// 第 192 行：只看启用与模型名，凭据不可见
const optimizerReady = binding.enabled && Boolean(binding.model.trim());
```

- `studioTextProfileBinding`（`studio-model-binding.ts:8`）是**同步**的，只读 `model_profiles`／`service_connections` 行，**不碰密钥库**，所以它拿不到 `secret`。
- 能判断凭据的只有 `resolveStudioTextProfile`（`studio-model-binding.ts:21`），它是**异步**的，因为它要 `await resolveProfile(...)` 去密钥库取 secret（第 26–27 行）。
- 因此要修镜头路径，就得让承载第 192 行的计划构造函数变成异步，或者把凭据检查前移到调用方——两种都不是单行改动。

漫画路径相对简单：`preflightPlan`（`comic-renders.ts:194`）**已经是 async**，且已经在那里做 LoRA 清单的异步查询（第 203 行 `await listModels(...)`），加一次凭据解析是同构的。

### R11.2 具体落点（下一轮可直接执行）

1. 在 `studio-model-binding.ts` 增加**不抛错**的只读探针：

   ```ts
   /** 预览用：不抛错，返回原因，供预览把凭据问题提前暴露。 */
   export async function inspectStudioTextProfile(database, secrets, profileId) {
     try { await resolveStudioTextProfile(database, secrets, profileId); return { ready: true, reason: null }; }
     catch (error) { return { ready: false, reason: error instanceof Error ? error.message : String(error) }; }
   }
   ```

2. **漫画**：在 `preflightPlan`（`comic-renders.ts:194`）里解析应用级文本档案，把 `ready === false` 计入 `issues` 并让 `canSubmit` 为假（现有第 213 行的表达式已按 `issues.length` 收敛，接上即可）。
3. **镜头**：`beat-renders.ts:192` 的 `optimizerReady` 需要异步化，或把检查提到调用方。**同时要修正 `profileReady` 的语义**——它现在只表示「模型名非空」，与字段名暗示的「档案就绪」不符，这个命名本身就是这次误判的源头之一。
4. 两条路径各加一个测试：凭据不可用时预览必须 `canSubmit=false` 且 `issues` 含具体原因。

### R11.3 本轮状态

**未改任何产品代码。** 第十一轮的产出是查清「为什么不能只改一处」并锁定落点，避免下一轮按第十轮那句过于乐观的估计去做、改到一半发现要动异步边界。

## 第十二轮：漫画路径的凭据缺口已修复并在真实实例上验证

### R12.1 改动

1. `studio-model-binding.ts` 新增两个导出：
   - `activityTextProfileId(database)`：应用级活动文本档案，预览与派发**共用同一处来源**（原来是 `beat-renders.ts:188` 里内联的 SQL）。
   - `inspectStudioTextProfile(database, secrets, profileId)`：**不抛错**的只读凭据探针，返回 `{ ready, reason }`。它内部调用真正会因凭据缺失失败的 `resolveStudioTextProfile`，把异常转成返回值。
2. `comic-renders.ts` 的 `render-preview` 路由：`preflightPlan` 之后补一次凭据检查。策略启用而档案不可用时，`canSubmit` 置为 `false` 并把原因追加进 `warnings`。`preflightPlan` 的签名没有改动（它不持有 `database`），检查放在已有 `database` 作用域的调用处，缩小改动面。

### R12.2 真实实例验证（决定性证据）

对第九轮那个派发失败的活动 `bad65884-55f3-4b18-be95-878bbd29ef5a`（4 个画格、draftVersion 2）重新预览：

| | 修复前（R9.2） | 修复后 |
| --- | --- | --- |
| `canSubmit` | **true** | **false** |
| 提示 | 无 | `提示词优化所需的活动文本模型不可用：备用文本模型已配置的凭据不可用。` |

用户在界面上不会再看到一个点下去才失败的按钮，具体原因也直接显示出来。这正是 R9.3／R10.2 要修的行为。

### R12.3 镜头路径仍未修（范围如实保留）

R10.2 定的「两条路径共用凭据解析」本轮**只完成了漫画一条**。镜头路径的 `optimizerReady`（`beat-renders.ts:192`）仍只检查 `enabled && model.trim()`，凭据缺失时预览依然报 `canSubmit: true`。

原因是 R11.1 查明的同步／异步边界：承载该行的是同步的计划构造函数，异步化会波及调用方，改动面明显大于漫画这一处。本轮预算优先用在「能一次改完并验证」的漫画路径上，没有对镜头路径做半成品改动。

**下一轮待办**：把 `inspectStudioTextProfile` 接到镜头预览，并修正 `profileReady` 的语义（它现在只表示「模型名非空」，与字段名暗示的「档案就绪」不符）。

### R12.5 镜头路径的精确落点（第十三轮查证，供下一轮一次改完）

第十三轮确认了镜头路径为什么不能照搬漫画的做法：

- 承载该判断的是 `previewResponse(_database, draftVersion, plan)`（`beat-renders.ts:241`），它是**同步函数**，而且**虽然已经收到 `database`，却没有 `secrets`**——第一个参数目前写作 `_database`，下划线说明它还没被用过。
- 要接凭据探针，必须同时把 `secrets` 加进签名（`SecretStore` 读取是异步的，绕不开）。
- 它一共有 **4 个调用点**：第 576、593、602、683 行。
- 因此改动是：`previewResponse` 变异步 → 4 个调用点加 `await` 并把 `secrets` 传下去 → 外层函数若原本同步还要一并异步化。

改动面明显大于漫画那一处（漫画的 `preflightPlan` 本来就是 async 且已持有 `secrets`）。**本轮未动它**——连续几轮的教训是：开一个改不完的改动，产出是零；把落点记准，下一轮能一次做完。

> **第二十轮补充**：`previewResponse` 的 3 个调用点其实位于**同步**适配器 `previewStudioBeatRender`（`beat-renders.ts:571`）与 `createStudioBeatCandidate`（第 580 行），两者带契约注释「Synchronous internal adapter. Caller owns the enclosing Studio transaction」。它们没有 `secrets`，异步化会破坏事务契约。所以 R15.3 **不是小改动，而是架构性改动**；又因为用户可见的预览路由已在第十四／十五轮修好，这一项的**优先级应降到最低**。

### R12.4 验证

- `npm run typecheck` 通过。
- `activity-comic-renders.test.ts` **2/2** 通过——原有的「模型缺失时 `canSubmit=false`」用例不受影响，说明新增检查没有误伤正常路径。

## 第十四轮：镜头路径的凭据缺口已修复（范围比预估小得多）

### R14.1 找到了比 R12.5 预估更小的落点

R12.5 判断要改 `previewResponse` 的签名、波及 4 个调用点。第十四轮发现**根本不用动它**：镜头预览的**路由处理函数**（`beat-renders.ts:674`）本身已经是 async，而且**已经持有 `secrets`**（第 684、686 行就在用它读引擎凭据和 LoRA 清单），也已经在那里汇总 `warnings` 与 `canSubmit`（第 692–693 行）。

所以只需在**同一处**追加一次凭据检查，与已有的 LoRA／运行时检查并列：

```ts
const optimizerIssue = response.promptOptimization.enabled
  ? await inspectStudioTextProfile(database, secrets, activityTextProfileId(database))
  : { ready: true, reason: null };
const credentialIssues = optimizerIssue.ready ? [] : [`提示词优化所需的活动文本模型不可用：${optimizerIssue.reason}`];
const warnings = [...response.warnings, ...preflight.issues, ...missingLora, ...inventoryIssue, ...credentialIssues];
const canSubmit = response.canSubmit && preflight.ok && !missingLora.length && !inventoryIssue.length && optimizerIssue.ready;
```

复用的是第十二轮为漫画写的**同一个探针**，两条路径没有各写一份。

### R14.2 真实实例验证

对活动 `bad65884-55f3-4b18-be95-878bbd29ef5a`、策略启用的 `anima-activity-linshe-parity` v1 调镜头预览：

| 项目 | 值 |
| --- | --- |
| `canSubmit` | **false** |
| `warnings` 中的凭据项 | `提示词优化所需的活动文本模型不可用：备用文本模型已配置的凭据不可用。` |
| `promptOptimization.profileReady` | **仍然是 `true`** ← 见 R14.3 |

修复前这条路径在凭据缺失时报 `canSubmit: true`，直到派发才失败（R9.2 的 `prompt_optimizer_profile_unavailable`）。

### R14.3 如实保留的不一致：`profileReady` 仍在说谎

`promptOptimization.profileReady` 实测仍是 **`true`**，而同一份响应里 `canSubmit` 已经是 `false`、`warnings` 也明确说凭据不可用。**这两者互相矛盾。**

原因是 `profileReady` 来自 `plan.optimizerReady`（`beat-renders.ts:192`，同步计划构造函数里算的 `binding.enabled && Boolean(binding.model.trim())`），本轮**没有动它**——动它就要碰同步／异步边界，正是 R12.5 判断改动面过大的那部分。

本轮只修了**用户据以行动的两个字段**（`canSubmit` 与 `warnings`），`profileReady` 留作待办。字段名暗示「档案就绪」，实际只表示「模型名非空」，这个命名本身就是 R9.3 误判的源头之一，下一轮应当把它改成真实语义或直接由探针驱动。

### R14.4 验证

- `npm run typecheck` 通过。
- `beat-renders.test.ts` + `beat-render-source.test.ts` **2/2** 通过。
- `activity-comic-renders.test.ts` 第十二轮已通过，本轮未触碰漫画路径。

## 第十五轮：修掉 `profileReady` 的自相矛盾（R14.3 的待办）

### R15.1 改动

第十四轮已经**在同一个路由处理函数里算出了真实探针结果** `optimizerIssue`，所以不需要碰同步／异步边界——直接用它覆盖那个说谎的字段即可：

```ts
// `profileReady` 原来来自同步计划里的 `optimizerReady`，只表示「模型名非空」，
// 于是同一份响应里会出现 profileReady=true 而 canSubmit=false 的自相矛盾。
const promptOptimization = { ...response.promptOptimization, profileReady: optimizerIssue.ready };
return { ...response, loras, loraModels: models, canSubmit, warnings, promptOptimization };
```

一行覆盖，没有改 `previewResponse` 的签名，也没有动同步计划构造函数。

### R15.2 真实实例验证

同一活动、同一策略（`anima-activity-linshe-parity` v1，策略启用）：

| 字段 | 第十四轮 | 第十五轮 |
| --- | --- | --- |
| `canSubmit` | false | false |
| `promptOptimization.profileReady` | **true** ← 与 `canSubmit` 矛盾 | **false** ← 一致 |

脚本显式判定「`profileReady=true` 且 `canSubmit=false`」这一自相矛盾组合，结果为**否**。

### R15.3 覆盖范围如实说明

本轮只覆盖了**镜头预览路由**的响应。`previewResponse` 还有另外 3 个调用点（`beat-renders.ts:576、593、602`，候选创建路径），它们返回的 `profileReady` **仍来自同步计划的 `optimizerReady`**，语义未修正。本轮未动它们——那些路径的 `canSubmit` 也不经过新的凭据检查。

用户可见的预览路径（本次修复的目标）已一致；其余调用点的语义统一留作待办。

### R15.4 验证

- `npm run typecheck` 通过。
- `beat-renders.test.ts` + `beat-render-source.test.ts` 通过。

## 第十七轮：查清素材入口的真实规模（未实施）

### R17.1 素材槽位不是「第三个入口」，而是另一套子系统

第九轮把漫画入口当成「和镜头类似的第三个入口」来估，结果证明可行（草稿 + 画格 + 预览 + 提交）。第十七轮查证后确认**素材槽位不能照这个思路估**：

- 镜头走 `beat-renders.ts`，漫画走 `comic-renders.ts`，两者都是「构造目标 → 预览 → 提交」的同构流程。
- 素材走的是 **`activity_media_slot` 用途 + 尝试（attempt）／配方（recipe）／编译（compilation）／绑定（binding）** 这一套独立链路，散落在：
  - `media.ts`（第 337 行 `purpose: 'activity_media_slot'`）
  - `media-batches.ts`（槽位校验、锁定、批量）
  - `image-attempts.ts`（第 162、235 行：配方与槽位、业务事件 `activity.media_slot.generate`）
  - `studio-batches.ts`（第 110 行按 `slotId` 解析目标）
  - `studio-hires.ts`（第 76 行 `media_slot` 的冻结上下文需要 `sourceAttemptId`／`recipeId`／`compilationId`／`recipeHash`）
- 也就是说，素材细化必须挂在**已有的 attempt** 上（`sourceAttemptId` 等四个 id 缺一不可），而 attempt 又来自配方与编译。这与镜头／漫画「给个 beatId／panelId 就能预览」的形态完全不同。

### R17.2 对剩余工作量的影响

计划 §9 的预算表把素材列为 1 次提交，但**取得那 1 次提交所需的前置链条远长于前两个入口**：先要有内容版本里的 image 槽位，再要有配方与编译，才谈得上 attempt 与渲染。

本轮**未实施**。把这条查清是为了避免下一轮又按「补一个入口」的乐观估计开工、改到一半发现要动整套尝试链路。

### R17.2b 具体入口链路（第二十二轮补，供下一轮直接照做）

素材没有 `media.ts` 里的独立路由；它是**批量**形态，注册在 `routes.ts`：

| 步骤 | 端点 | 位置 |
| --- | --- | --- |
| 0 | 内容版本里必须先有 `kind: 'image'` 的 media slot（当前验收活动是 `mediaSlots: []`） | 需在样例脚本的 `prepareContent()` 里构造 |
| 1 | `POST /activities/:id/media-batches/prepare` | `routes.ts:857` |
| 2 | `POST /activities/:id/media-batches`（创建批量） | `routes.ts:872` |
| 3 | `POST /activities/:id/media-batches`（启动，另有 start 语义） | `routes.ts:898` |
| 4 | `GET /activities/:id/media-batches/:batchId`（轮询） | `routes.ts:912` |
| — | 取消／重试失败：`/cancel`、`/retry-failed` | `routes.ts:927`、`941` |

另有单条媒体任务端点 `POST /activities/:id/media-jobs`（`routes.ts:1325`）与同步端点 `/media-jobs/sync`（`1365`、`1369`），以及媒体选择／修订端点（`1438`–`1466`）。

**所以素材入口的第一行代码是「在样例脚本的内容草稿里加一个 image 槽位」，而不是去写渲染调用**——这是与镜头／漫画最大的不同，也是最容易走错的一步。

### R17.3 仍然阻塞、且只有用户能解的一项

活动文本模型 `ds-jy` 的凭据自第四轮起不可用（已连续 13 轮），挡住 **C 组 2 次 + 漫画 1 次 = 12 次预算里的 3 次**。设置页重填 API Key 即可同时解锁。

这一项**不构成整个目标的阻塞**——素材入口与 R15.3 都不依赖它，所以目标保持 active，不标记 blocked。

## 第二十四轮：漫画入口跑通（7/12），但发现一处内容不匹配的缺陷

### R24.1 先修了我自己引入的回归

第十四轮给**镜头预览**加了凭据检查后，A/B 组在样例脚本里从 `succeeded` 变成了 `skipped`。原因：脚本原来依赖「预览报 `canSubmit: true`，派发失败后再降级关优化」，而修复后**预览阶段**就报 `canSubmit: false` 了，脚本的降级分支只对 C 组（`requiresTextModel`）生效，于是 A/B 直接跳过。

**产品修复是对的**（预览本就该提前暴露凭据问题），是脚本没跟上。已在样例脚本的 `attempt()` 里补上：预览因文本模型不可提交时，非 C 组一律关掉优化重试一次（与漫画路径同一模式），C 组仍然如实跳过。

修复后：**A×2、B×2 全部恢复 succeeded**。

### R24.2 漫画入口跑通

同样把「关优化重试」接到漫画路径后，漫画派发成功：

| 项目 | 值 |
| --- | --- |
| 任务 | `6f48998c-16a6-4649-b86c-90ba5594f397`，状态 **succeeded** |
| `callId` | `07c39006-2fd8-49ab-9498-3a090cdf48f6` |
| 产物 | `f4ff5bbe-844b-4976-8a16-78d3ef0ff9d5`，`origin: comic_render`，`renderJobId` 与任务一致 |
| 尺寸 | 768×512 |
| 本地副本 | `artifacts/activity-image-parity-v2/2026-10-03T10-13-15/comic-panel1.png`（530 818 B） |
| 优化 | **已关闭**（`optimizerDisabled: true`），所以本次**未验证结构化优化**，只验证入口链路 |

**真实提交推进到 7 / 12**（A×2、B×2、漫画×1、Turbo×1、细化×1）。

### R24.3 缺陷：漫画出图与画格描述完全无关

**人工查看产物后必须如实记录**：图片是一张**海滩场景**（粉色头发角色、泳装、沙滩海浪），而该画格的描述是：

- `visualDescription`：`研究员轻轻摇晃试管，观察结晶变化，另一只手扶住实验台（第 1 格：wide）`
- `composition`：`风雪渐起，烧瓶内透出金色微光`（雪山营地）

**两者毫无关系。** 画格还设了 `actorIds: []`，所以也不存在「角色人设带来的偏差」这一解释。

也就是说：**入口链路是通的（任务成功、产物真实、历史挂载正确），但画格描述没有正确地进入提示词。** 这属于计划 §20.2「不能算完成」的情形，**不能记作「漫画入口已验证」**。

**本轮未定位根因。** 可疑方向（均未验证）：

1. 画格的 `visualDescription`／`composition` 没有进入漫画路径的提示词编译（可能编译读的是别的字段）。
2. 关掉优化后，服务端组装对漫画路径退化成空提示词或占位提示词，模型于是自由发挥。
3. 画格缺少 `actorIds` 且没有参考图，提示词里可用的信息本就极少，不足以约束画面。

第 2 条最可疑：同一轮里镜头路径关掉优化后仍然出的是**正确**画面（A/B 组与雪山营地一致），而漫画路径不是，说明差异在漫画自己的提示词编译环节，而不是「关优化」本身。

### R24.5 第二十五轮：排除方向 1

查证 `comic-renders.ts`，**方向 1 可以排除**——画格字段确实进了提示词构造：

```ts
// 第 104 行
{ label: '画格动作', value: panel.visualDescription || (beats).map((beat) => beat.action).join('；') },
// 第 106 行
{ label: '构图与主体位置', value: panel.composition },
// 第 114 行
const positivePrompt = values.map((item) => `${item.label}：${item.value}`).join('\n');
```

所以 `plan.positivePrompt` 里**含有**「画格动作：研究员轻轻摇晃试管……」与「构图与主体位置：风雪渐起……」。缺陷因此在下游——**构造好的提示词没有真正到达编码器**，或者被优化器路径丢弃了。

**下一步的确切动作**：查这次调用的实际编码文本。`callId` 是 `07c39006-2fd8-49ab-9498-3a090cdf48f6`，用 `GET /api/v1/admin/ai-calls/:id` 看 `requestSnapshot` 与 `encodedTexts`（`apps/service/src/ai-call-routes.ts` 已支持从活动图的裸快照解析编码文本，见 R4.2 的修复）。如果 `encodedTexts` 显示的是空串或占位串，方向 2 成立；如果显示的是正确文本而画面仍不符，则问题在采样参数或模型侧。

本轮未执行该查询（上下文预算用尽）。

### R24.6 第二十六轮：查到决定性证据，方向 1 与方向 2 都被排除

查询 `GET /api/v1/admin/ai-calls/07c39006-2fd8-49ab-9498-3a090cdf48f6`（`businessEvent: activity.comic.panel.render`，`status: succeeded`）得到：

**该调用真正进入 `CLIPTextEncode` 节点 6 的文本（原样）：**

```
@ebora, masterpiece, best quality, score_9, score_8, highres, absurdres, anime screenshot, year 2025,
场景地点、时间与环境：邻舍对齐受控对照, 雪山营地, 傍晚 18:30, 风雪渐起, 烧瓶内透出金色微光,
来源镜头动作与结果：研究员轻轻摇晃试管, 观察结晶变化, 另一只手扶住实验台,
画格动作：研究员轻轻摇晃试管, 另一只手扶住实验台（第 1 格：wide）,
景别：远景, 构图与主体位置：风雪渐起,
文字留白：画面左上方预留干净、低细节的气泡空间,
绘制约束：画面中不要生成任何可读文字、台词、水印、签名或漫画边框, 台词由应用后期绘制。
```

**提示词完全正确。** 雪山营地、研究员、试管、烧瓶微光全都在。所以：

- **方向 1 排除**（画格字段确实进了提示词）。
- **方向 2 排除**（关掉优化后并没有退化成空提示词）。

并且 `artifactIds` 只有 `f4ff5bbe-844b-4976-8a16-73d3ef0ff9d5`（sha256 `fca97271…`），与 `artifactDetails` 一致——**我下载并查看的那张海滩图，确实就是这次调用的产物**。不是拿错了文件。

### R24.7 修正后的判断：缺陷在提示词语言，不在链路

对比同一轮里**跑通**的 B 组编码文本（R5.2 记录）：

| | B 组（画面正确：雪山营地） | 漫画（画面不符：海滩） |
| --- | --- | --- |
| 中文场景描述 | 有 | 有 |
| **英文画面描述** | **有**——`single female researcher, short silver hair, green eyes, blue lab coat, holding a glass flask with green liquid, snowy mountain camp at night, tents and pine trees, medium shot, calm expression, clean anime screenshot` | **没有**，整条提示词除画师串外**全是中文** |
| 英文来源 | 来自请求里的 `customPrompt` | 漫画路径没有等价的英文字段 |

**修正后的判断（假说，未经受控验证）**：`anima` 系列模型主要按**英文标签**理解画面，对中文散文描述响应很弱。B 组之所以正确，是因为提示词里带了那段英文 `customPrompt`；漫画路径的编译只产出**中文字段标签 + 中文散文**，模型实际只拿到了 `@ebora, masterpiece, score_9, anime screenshot, year 2025`，于是产出一张与场景无关的画师风格图。

这解释了为什么「提示词正确、画面错误」——两者并不矛盾：**提示词对，但模型读不懂它的主体部分。**

**支持这条假说的旁证**：同一轮 A 组（旧工作流）也带英文 `customPrompt` 与图内硬编码英文画师串，画面同样正确；唯一没有英文画面描述的组就是漫画。

**验证方法（下一轮可做）**：给漫画画格的 `composition` 或 `visualDescription` 填一段英文描述，重跑同一画格，看画面是否变为雪山营地。这是单变量对照，一次提交即可判定。

**注意**：这条若成立，缺陷的**归属**会改变——不是漫画路径的 bug，而是「漫画提示词编译器只产出中文、缺少英文视觉标签」这个设计缺口，修复面在 `comic-renders.ts` 的 `values` 构造（第 104–114 行）或画格字段本身。

### R24.8 第二十七轮：单变量对照**确认了假说**

做法：只改一个变量——给第一个画格的 `composition` 追加英文画面描述（`single female researcher, short silver hair, green eyes, blue lab coat, holding a glass flask with green liquid, snowy mountain camp at night, tents and pine trees, medium shot, calm expression, clean anime screenshot`），其余全部不变（同一工作流 v1、同一画师串、同一段中文、同一画格结构、同样的优化关闭状态），重跑一轮。

**该调用真正进入节点 6 的文本**（`callId 31cfcd42-fe2e-480d-bcd1-a7685841a4e2`）确认英文确实到位：

```
…, 画格动作：研究员轻轻摇晃试管, 观察结晶变化, 另一只手扶住实验台（第 1 格：wide）,
景别：远景, 构图与主体位置：风雪渐起, 烧瓶内透出金色微光｜single female researcher, short silver hair,
green eyes, blue lab coat, holding a glass flask with green liquid, snowy mountain camp at night, tents and pine trees, …
```

**结果：画面变成了正确的雪山营地**——银发绿眼、白大褂、手持绿色液体烧瓶、雪山、松树、帐篷、夜空。

| | 对照组（R24.3，无英文） | 实验组（R24.8，加英文） |
| --- | --- | --- |
| 工作流 / 画师串 / 中文描述 | 相同 | 相同 |
| 英文画面描述 | **无** | **有** |
| 产物 | 海滩场景（粉发泳装，与描述无关） | **雪山营地研究员，与描述一致** |
| 产物 artifactId | `f4ff5bbe-…` | `bc57ee12-…` |

**结论：假说成立。** `anima` 系列模型主要按**英文标签**理解画面；漫画路径的提示词编译只产出**中文字段标签 + 中文散文**，模型因此只拿到画师串，产出了与场景无关的图。这不是漫画渲染链路的 bug（链路完全正确），而是**漫画提示词编译器缺少英文视觉标签**的设计缺口。

**因此 R24.3 的「不能记作已验证」予以撤销**：漫画入口链路**已验证**，且修正后的产物与画格描述一致。上述缺口作为**独立的改进项**保留（修复面在 `comic-renders.ts:104–114` 或画格字段本身）。

**对验收口径的影响**：真实提交 **7 / 12 全部有效**（A×2、B×2、漫画×1、Turbo×1、细化×1）。

### R24.4 验证

- `node --check scripts/activity-image-parity-sample.mjs` 通过。
- 回归（typecheck／契约／服务／Portal）在第十九轮确认全绿，本轮只改样例脚本，未动产品代码。

## 错误码实现对照（计划 §19）

| 场景 | 代码 | 实现位置 | 状态 |
| --- | --- | --- | --- |
| 新工作流另填画风后缀 | `prompt_policy_style_managed_by_activity` | `activities/image-prompt-policies.ts` 保存校验 | 已实现，测试覆盖 |
| tags 不兼容旧图 | `prompt_policy_workflow_incompatible` | 同上 | 已实现，测试覆盖 |
| 模型 JSON 无效 | `prompt_optimizer_invalid_json` | `activities/image-prompt-structured.ts` | 已实现，测试覆盖 |
| 角色作用域错误 | `prompt_optimizer_actor_scope_invalid` | 同上 | 已实现，测试覆盖（遗漏与增加两个方向） |
| 输出截断 | `prompt_optimizer_truncated` | 同上（含 `finish_reason=length` 与缺失结束花括号） | 已实现，测试覆盖 |
| 来源非本目标历史 | `hires_source_not_owned` | `activities/studio-hires.ts` | 见阶段 4 记录 |
| 历史缺执行快照 | `hires_source_snapshot_unavailable` | 同上 | 见阶段 4 记录 |
| 来源文件不可读 | `hires_source_unavailable` | 同上 | 见阶段 4 记录 |
| 放大目标不大于原图 | `hires_not_an_upscale` | 同上 | 见阶段 4 记录 |
| seed／配置变化 | `hires_plan_changed` | 同上 | 见阶段 4 记录 |
| 运行环境离线 | 复用现有连接错误码 | 未新增 | 不新增代码，符合要求 |
| 上游不确定 | `studio_upstream_unknown` | 既有代码 | 未改动 |

本轮另外新增的两个代码，都是对既有语义的精确化，不属于“把异常折叠成通用失败”：

- `prompt_policy_knowledge_mode_incompatible`：`prose` + `keyword` 组合本身矛盾，保存时 409 拒绝。
- `knowledge_mode_unsupported`：只在本轮未实现的 `vector` / `hybrid` 被显式请求时抛出，不静默降级成关键词。

`prompt_policy_revision_conflict`、`workflow_version_not_found` 等沿用既有代码，未改名。

## 临时文件处理

- `scratch/generate-knowledge.mjs` 移到 `scripts/generate-parity-knowledge-data.mjs`，并在文件头写明它是**离线生成工具、不属于任何运行时路径**、以及重新生成前必须先核对上游提交与裁剪规则。服务端只读取生成出来的静态数据文件，运行时不 import 邻舍子模块。
- 本轮的临时脚本（`parity-baseline.mjs`、`parity-baseline2.mjs`、`sqlite-alter-check.mjs`、`schema.mjs`、`linshe-templates.mjs`、`linshe-templates2.mjs`、`linshe-template-dump.txt`、`knowledge-survey.mjs`、`list-rule-ids.mjs`）已删除。
- `scratch/verify-untouched.mjs` 保留：它是只读的真实库核对工具，用于证明本轮没有写入真实数据。
- `scratch/` 整个目录被 `.gitignore` 忽略，不影响交付物。

## 阶段 4A／4B／4C：基础细化（放大重绘）

状态：**代码、契约与自动化测试通过**；真实实例验收**外部阻塞**。

### 4.1 完成项

契约层（`packages/contracts/src/`）：

| 文件 | 内容 |
| --- | --- |
| `activity-image-operations.ts`（新） | `ImageOperationMetadataSchema`（`operation: 'render' \| 'hires'`、`parentArtifactId`、`studioJobId`，strict）。抽成无依赖叶子模块，避免 `activity-image-hires` ↔ `ai-calls` ↔ `activity-comic` 循环导入 |
| `activity-image-hires.ts`（新） | `HiresPreviewRequest`／`HiresSubmitRequest`／`HiresPreviewResponse`／`HiresLora`／`HiresSampler`／`HiresLoaders`，全部 `additionalProperties: false`；常量 `HIRES_MAX_SIZE_MIN=512 / MAX=2048 / DEFAULT=2000`、`HIRES_DENOISE_MIN=0.05 / MAX=0.35 / DEFAULT=0.2` |
| `index.ts`、`activity-comic.ts`、`ai-calls.ts` | `GenerationAttempt`／`ComicHistoryImage`／`BeatRenderCandidate` 增加可选 `imageOperation`。旧行缺字段仍合法；未声明的字段会被 fast-json-stringify 丢弃，所以必须显式声明 |

服务层（`apps/service/src/`）：

| 文件 | 内容 |
| --- | --- |
| `activities/studio-hires.ts`（新） | 只读预览 + 同事务提交；私有 `FrozenHiresPlan`／`FrozenHiresTargetContext`；`computeHiresOutputSize`（scale = maxSize/最长边，向下取整到 8 的倍数，最小 8）；`probePngHeader`（只读 PNG 签名 + IHDR，支持颜色类型 0/2/3/4/6 的 alpha 判定，不引入重型图像依赖）；`resolveHiresSource`（必须同活动**且**同目标）；`freezeSourceSnapshot` |
| `activities/studio-hires-runner.ts`（新） | `processStudioHires`（§12.5）、`insertHiresNativeHistory`（beat／comic_panel／media_slot 三类原生历史）、`readHiresCallSummary`。派发前复查目标存在、重建计划比对 planHash、运行时预检；原生历史在同一个 `onInsertTask` 事务内建立，任何失败整体回滚 |
| `activities/studio-image-operation.ts`（新） | 按 `native_job_id`／`candidate_id` 反查 studio job；旧行无关联时返回 `undefined`，**不回填旧数据** |
| `activities/parity-workflows.ts` | 新增 `buildParityHiresWorkflow()`：`anima-activity-hires-basic`，`1 LoadImage → 2 EmptyImage(16777215) → 3 ImageCompositeMasked(dest=['2',0], source=['1',0], mask=['1',1], paste=false) → 4 ImageScale(lanczos, crop=disabled) → 5 VAEEncode → 6/7 CLIPTextEncode → 8 VAELoader → 9 CLIPLoader → 10 UNETLoader → 11 KSampler → 12 VAEDecode → 13 SaveImage`；`promptAssembly='service-finalized-v1'`、正负提示词直接绑定 `CLIPTextEncode.text` 字面量、`inputCapabilities.init_image.required=true` |
| `activities/parity-config.ts` | `planParityConfig` 列出细化工作流／版本与 `activities/activity_image_upscale` 绑定项；`applyParityConfig` 按内容哈希幂等注册细化工作流族，并**仅在没有同用途绑定时**建立绑定，不创建预设、不覆盖既有绑定、不改写活动画风 |
| `activities/studio-routes.ts` | 新增 `POST /api/v1/admin/activities/:id/studio/hires/preview`（200）与 `POST .../hires`（202）；`schedule()` 在既有 batch／single 分支**之前**判断 `job.input.operation === 'hires'`；停止路由对细化任务同样 abort |
| `activities/studio-recovery.ts` | `recoverStudioJobs` 与 `resumeStudioJob` 都先按 `operation === 'hires'` 分支，不调用 `resolveStudioBatchTarget` 重算普通文生图计划 |
| `activities/beat-renders.ts` | 新增只读 `previewBeatRenderSourceFingerprint`（只走 `compileSource`，不需要画风预设／模型选择可用）；列表路由为每行附加 `imageOperation` |
| `activities/comic-store.ts`、`image-attempts.ts` | 历史响应附加 `imageOperation` |
| `generation/execution.ts` | 新增内部专用 `presetValues`（已授权参数基线，仅 `isInternal` 可用，不进入 canonicalPayload，因此不改变请求哈希） |

错误码：`hires_source_not_owned`、`hires_source_snapshot_unavailable`、`hires_source_unavailable`、`hires_not_an_upscale`、`hires_plan_changed`，另加 `hires_workflow_unavailable`、`hires_target_missing`、`hires_plan_unavailable`。

planHash 只覆盖 `sourceArtifactId`／`sourceSha256`／`sourceSnapshotHash`／`target`／`workflowId`／`workflowVersion`／`engineId`／`maxSize`／`outputW`／`outputH`／`denoise`／`seed`——**不含当前画风、当前提示词策略、最新角色 LoRA**，并有测试断言。

### 4.2 检查结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过（独立复跑确认） |
| `node --import tsx/esm --test apps/service/src/activity-image-hires.test.ts` | pass 20 / fail 0（独立复跑确认） |
| `node --import tsx/esm --test packages/contracts/src/activity-image-hires.test.ts` | pass 4 / fail 0 |
| hires + parity-config + hires 契约 | tests 30 / pass 30 / fail 0 |
| 指定回归清单（10 文件） | tests 78 / pass 78 / fail 0 |
| 全量 service 套件 | 见“本轮最终回归”一节 |
| `npx eslint`（本次改动文件） | 0 error；3 warning 全部为既有告警（已用 `git show HEAD:` 版本复现确认） |

覆盖的计划 §17.1 测试组：细化安全、细化事务、细化历史、细化恢复、透明图片、引擎解析，另加 HTTP 路由管理员校验与未知字段拒绝、调用日志、来源哈希不符／来源被删、夹具清理。

### 4.3 未验证与外部阻塞

- **真实 ComfyUI 验收全部未执行**（`127.0.0.1:8188` 离线）：真实 `anima_baseV10.safetensors`／`anima_baseV10_txt.safetensors`／`qwen_image_vae.safetensors` 是否存在、真实 LoRA 注入结果、真实放大出图质量、透明图白底合成的真实像素结果，全部**未验证**，不声称通过。所有图形方案断言都基于 `buildParityHiresWorkflow()` 的定义对象与 mock 上游（`object_info`／`upload/image`／`prompt`／`history`／`view`）。
- **没有新增迁移**：细化复用 `activity_studio_jobs`（`kind='render_batch'`）并以 `input.operation === 'hires'` 区分，一 job 一行 item。未运行任何 `db:migrate`／`db:reset`／`db:restore`，未写入 `data/sthstart.db`（测试用内存库 + `mkdtempSync` 临时产物目录）。

### 4.4 与计划的有意偏差

1. **未单独创建 `activity-hires-transaction.test.ts`**：计划原文是“优先”新建。事务覆盖（job/item 先落库、提交复查 planHash、触发器强制回滚、同幂等键不重复插入历史）已完整写在 `activity-image-hires.test.ts` 的两个 `hires transaction:` 用例里，与夹具同模块可复用真实 PNG／引擎／工作流；拆分会重复搭夹具而无额外覆盖。
2. **细化编辑器字段的 `allowIndividualSwitch` 由 `false` 改为 `true`**，并配合新增的内部 `presetValues` 基线：`mergeGenerationValues` 在 `modelSelection: 'preset-locked'` 下会把“与预设／默认不同的模型取值”判为 `model_not_allowed`，而细化的加载器取值**必须**来自来源任务的冻结快照。取值仍受 `allowedModels` 白名单约束，没有放宽白名单；`presetValues` 只在 `isInternal` 时可用。
3. **`parity-config.ts` 现在会注册细化工作流**：若 `--apply` 仍把细化记为“尚未发布”，细化在任何环境下都无法启用。改为按内容哈希幂等注册工作流族 + 仅建立缺失的用途绑定。
4. **`currentTargetFingerprint` 的 beat 分支改用 `previewBeatRenderSourceFingerprint`**：原实现调用完整 `previewStudioBeatRender`，它需要可解析的画面方案（画风预设 + 模型选择），在细化流程里既非必要也可能因模型白名单失败。新函数只走 `compileSource`，语义仍是“来源描述是否变化”。
5. **`resumeStudioJob` 细化分支缺 planHash 时返回 `studio_plan_changed`**（而非 `studio_resume_unsafe`）：细化没有批次计划可重算，语义上属于“需先确认原计划”。

### 4.5 过程中发现并修复的两个问题（如实记录）

1. **我自己在阶段 4B 前置改动里写错了表名**：`generation/execution.ts` 的“预设与引擎冲突”检查原本查询 `app_generation_presets`，而实际表名是 `generation_presets`（`database.ts:877`）。该错误会让冲突检查抛 SQL 错误而不是返回 `generation_engine_preset_conflict`。已在阶段 4 修正为 `generation_presets`。
2. **一次文件损坏事故（已完全恢复）**：实施过程中曾用 PowerShell `Get-Content -Raw` + `[System.IO.File]::WriteAllText` 修改 `parity-config.ts`，系统默认 ANSI(936) 读取把该文件的 UTF-8 中文注释转成非法序列，写回后文件损坏。随后按先前完整读取的内容整体重写。**复核结果**：`U+FFFD` 计数 0、无 BOM、中文注释正常、`npm run typecheck` 通过、`activity-parity-config.test.ts` 6/6 通过。此后所有写入改用 `write`／`edit` 工具。这一条记录在此是为了不掩盖过程中的问题。

### 4.6 下一阶段

阶段 5（UI，已完成，见下）与阶段 6／7（验收，外部阻塞）。

---

## 阶段 5：UI 实施规格

状态：**代码完成，类型检查、纯函数测试与隔离夹具浏览器验收均通过**（桌面／宽屏；窄屏只验证了无横向溢出与美术设置可用）。

### 5.1 完成项

| 要求（计划 §15） | 实现位置 |
| --- | --- |
| 活动级画风弹窗：画风预设、草稿／成稿、尺寸、当前模型摘要、显式“应用到本活动” | `app/features/activities/components/art-direction-dialog.tsx`（原有画风卡／品质／画幅／档位预设保留，新增只读“当前模型摘要”，画幅改为计划 §10.2 的四个常用尺寸并标注 1920×1080 高显存／高耗时） |
| 策略编辑仍放生成设置，常用页说明模式来自哪个工作流／策略修订 | `app/features/generation/components/activity-image-prompt-policy-panel.tsx`（阶段 2C） |
| 每张可读历史图的菜单：使用为当前画面／按原配置重绘／放大细化／调用日志 | 镜头 `beat-render-workbench.tsx`（四项齐全 + “来源图”内联预览）；漫画 `comic/comic-image-history.tsx`（使用／放大细化／日志／来源图）；素材 `components/image-workbench.tsx`（放大细化按钮 + 结果标“细化” + 来源图链接） |
| 细化弹窗：原图、预计尺寸、最长边 1536／2000／2048、重绘幅度 0.2、开始细化 | `app/features/activities/components/studio-hires-dialog.tsx` |
| 高级区只读继承配置摘要 | 同上（加载器、采样、LoRA、正负提示词全部只读展示） |
| 不满足条件时给具体原因，不只灰掉按钮 | `app/features/activities/lib/hires-request.ts` 的 `hiresBlockedReason()`：来源缺失、服务端 issues、预览请求失败分别给文案 |
| 打开弹窗不提交草稿、不创建任务、不调用模型 | 弹窗打开时零请求；只有点击“预览”才 `flush → fetchStudioVersions → previewStudioHires` |
| 409 保留本地文本、响应丢失用原 key 重发 | 幂等键在弹窗会话内生成一次（`hiresIdempotencyKey`），失败只展示原因并保留原图、参数与请求键 |
| 任务创建后保持原图可见、处理中标“细化”、可查看来源图 | 历史缩略图右上角“细化”角标；`imageOperation.parentArtifactId` 命中已加载分页时提供“来源图”内联预览，未加载时按钮禁用并说明在更早分页 |
| 桌面 Dialog／窄屏 Drawer、不加第四栏 | 复用既有 `ResponsiveEditOverlay`；历史动作行改为缩略图下方的换行动作条，避免在 `overflow-x-auto` 容器里被绝对定位裁切 |
| 长中文／文件名／错误可换行 | 相关节点统一使用 `break-words` / `whitespace-pre-wrap`，不靠固定高度截断 |

### 5.2 检查结果

- `npx eslint app/features/activities/components/studio-hires-dialog.tsx`：0 error / 1 warning（`@next/next/no-img-element`，与仓库既有 `<img>` 用法一致）。
- 新增前端纯函数测试（门户 `test:portal` 不会自动覆盖，按计划 §17.2 单独运行并记录）：
  - `app/features/activities/lib/workflow-option-display.test.ts`：6 通过。
  - `app/features/activities/lib/hires-request.test.ts`：6 通过。

### 5.3 与计划的有意偏差

- 计划把每张历史图的操作描述为“菜单”。本轮实现为**缩略图下方的换行动作条**（按钮 + 日志链接），而不是浮层菜单：历史缩略图容器是 `overflow-x-auto`，绝对定位的浮层菜单会被裁切；动作条在 390px 窄屏同样可达，且不需要新增一套菜单组件。

### 5.5 本轮补齐的三项（第二轮）

计划 §1.1 明确定义了两种操作的语义差异：**“按原配置重绘”是复用参数、换种子生成新图；“放大细化”是以原图为输入低幅重绘**，两者不能共用同一按钮含义。第一轮只做了镜头入口，本轮补齐另外两项。

| 要求 | 实现 |
| --- | --- |
| §1.1 每张历史图区分“按原配置重绘”与“放大细化” | 镜头（`beat-render-workbench.tsx`，`rerender` 用新随机种子）／漫画（`comic-image-history.tsx`，新增 `rerender`：先 `preview` 拿当前 `planHash`，再用**新种子**提交，结果作为新历史保留）／素材（`image-workbench.tsx`，新增按钮，`retryImageAttempt` 增加可选 `seed`，传新种子） |
| 素材重绘不得沿用原种子冒充“换种子重绘” | `api.ts` 的 `retryImageAttempt(id, attemptId, seed?)` 与 `mutations.ts` 的 `useRetryImageAttempt` 增加可选 `seed`；失败重试仍不传 seed（沿用原种子），“按原配置重绘”传新种子 |
| 漫画历史图来自镜头绘制时不能冒充“漫画原配置” | `rerender` 先判断 `item.origin !== 'comic_render'`，提示“这张图来自镜头绘制，请在镜头页面按原配置重绘”，不提交任务 |
| 来源描述已变化时先确认 | 沿用既有 `item.sourceChanged` 信号，`window.confirm` 后才继续 |
| §14 业务事件中文名称 | 新增 `app/features/ai-calls/business-event-label.ts`：`activity.image.hires` → “图片放大细化”，并覆盖镜头／漫画／素材绘制、智能分镜／细化、画面描述优化。列表标题显示“中文名 · 原始事件 ID”，原始 ID 保留以便检索 |
| §14 业务返回链接映射 | 复用既有 `aiCallBusinessHref`（`activity-studio-job` → `?tab=studio&studioJobId=`），细化任务写的就是该 objectType，无需新增分支 |
| §15.3 日志详情分“来源→优化→规则→最终输入→实际图→产物” | `app/settings/ai-logs/ai-logs-client.tsx` 重构为固定顺序的六个 `DetailGroup`，每组带一句说明；长 JSON 继续折叠（`<details>`），信息未删减；正向／反向提示词默认展开，缺失时明确写“本次调用没有正向提示词”而不是隐藏整块 |
| §16 未声明参考图能力时明确说明“仅文字描述” | 镜头 `beat-render-workbench.tsx`：`plan.referenceSupported` 为假时禁用参考图选择并显示“当前工作流未声明参考图输入能力：本次**仅文字描述**，角色形象不会被锁定”；漫画 `comic-render-dialog.tsx`：`preview.referenceSupported` 为假时同样禁用并提示 |
| §1.1 生成记录可查看“从中文来源到实际文本编码输入”的完整过程 | 新增 `encodedTextEntries()`（`activities/image-prompt-snapshot.ts`），从**实际派发**的工作流快照里读出真正进入 `CLIPTextEncode.text` 的字符串；契约 `AiCallDetailSchema` 增加只读派生字段 `encodedTexts`（不新增日志数据库）；日志详情“最终输入”组新增“实际文本编码输入”块，逐节点显示正／负向与文本；**读不出来时不猜文本**，改为显示“无法从这次调用的工作流快照确定实际编码文本” |
| §15.1 常用页说明模式来自哪个工作流／策略修订 | 镜头与漫画的绘制预览契约各增加 `promptAssembly`（`service-finalized-v1` / `workflow-internal`，由工作流版本的 `editorConfig.promptAssembly` 派生）；镜头绘制设置高级区显示“提示词模式：服务端最终组装（<工作流> v<版本>）…／工作流图内自行拼接（<工作流> v<版本>）…”，漫画绘制弹窗同样显示；两者都同时显示“提示词优化：开启 · 策略 r<修订>／关闭” |

新增测试：`app/features/ai-calls/business-event-label.test.ts`，**6 / 6 通过**（细化事件有中文名、已知活动事件全覆盖、未知事件回退到原始 ID 而不是空标签、标题保留可检索 ID、详情分组顺序与计划逐字一致、多阶段标题为中文）。

新增测试：`apps/service/src/activity-prompt-snapshot.test.ts` 增加 1 个用例，**8 / 8 通过**：
- 实际派发的图能读出真实编码文本（正／负向各自带节点号）；
- 老式拼接工作流只要分隔符可确定就照实读出（这正好是 P-1 双重追加的直接证据）；
- 分隔符缺失时**只给能确定的那一侧**，不猜缺失的一侧；
- `null` 与非工作流形状的输入返回空列表而不是抛错或编造。

### 5.6 浏览器验收（第二轮补齐，计划 §15.4 / §18.2）

工具：`scripts/activity-image-parity-browser.mjs`，只对**隔离夹具**运行（服务 `127.0.0.1:4289` 内存库 + 临时媒体目录，门户 `127.0.0.1:4199`，合成上游），不读真实数据库、不调用真实 ComfyUI。

```
node --import tsx scripts/activity-studio-fixture.ts --isolated
node scripts/activity-studio-portal.mjs --isolated
node scripts/activity-image-parity-browser.mjs
```

结果：**通过**。截图目录 `artifacts/activity-image-parity-v2/2026-10-03T06-38-46.409Z/`。

| 检查 | 结果 |
| --- | --- |
| 1440×900 工作台加载 | 通过（`desktop-01-studio.png`） |
| 美术设置：1920×1080 画幅、标注“高显存／高耗时”、只读“当前模型摘要” | 通过（`desktop-02-art-direction.png`，实际显示“草图：草图 · turbo.safetensors／成稿：成稿 · base.safetensors”） |
| 历史图动作：使用／按原配置重绘／放大细化／日志 | 通过（`desktop-03-history-actions.png`） |
| 细化弹窗：原图、最长边、重绘幅度、结果说明 | 通过（`desktop-04-hires-dialog.png`，显示“最长边 2000 像素”“重绘幅度 0.2”“结果是不透明新图，不会覆盖原图”） |
| 打开细化弹窗不创建任务 | 通过（对比打开前后 `studio-jobs` 条数不变） |
| 不可细化时给**具体原因**而不是只灰按钮 | 通过：夹具用的是图内拼接提示词的老式工作流，弹窗显示“当前无法开始细化／原图由工作流自行拼接提示词，无法确定实际编码文本；建议重新绘制。”（`desktop-05-hires-blocked-reason.png`） |
| 预览失败不创建任务 | 通过（对比预览前后 `studio-jobs` 条数不变） |
| 日志详情六分组“来源→优化→规则→最终输入→实际图→产物” | 通过（`desktop-06-log-detail.png`，六个标题齐全且顺序正确） |
| 业务事件中文名称 + 原始 ID 保留 | 通过：详情显示“镜头绘制”并在下方保留 `activity.beat.render`；列表显示“镜头绘制 · 多阶段作业” |
| 390×844 窄屏无横向溢出 | 通过（`scrollWidth - clientWidth <= 2`） |
| 390×844 美术设置可用 | 通过（`narrow-02-art-direction.png`，画幅与模型摘要均可达） |
| 390×844 历史图动作与细化弹窗可达 | **通过（第三轮补齐）**：窄屏的“展开右侧镜头工坊”按钮只显示图标、可访问名称来自 `title`，点击后渲染“镜头绘制历史”，`按原配置重绘` 与 `放大细化` 均可见，细化弹窗以抽屉形态打开且无横向溢出（`narrow-03-hires-dialog.png`） |
| 高级区说明提示词组装模式来自哪个工作流 | **通过（第三轮补齐）**：展开 `高级设置` 后显示“提示词模式：工作流图内自行拼接（语义字段工作流 v1）：服务端无法确定实际编码文本”（`desktop-03b-advanced-mode.png`）。断言前必须先展开 `<details>`——只查 DOM 存在会漏掉折叠内容 |
| 1920×1080 抽查 | 通过（`wide-01-studio.png`） |
| 页面运行时错误 | **0** |
| 非预期失败请求 | **0**（细化预览的 409 是预期内的“具体原因”） |

### 5.7 截图暴露出的一个真实问题（已修）

`desktop-03-history-actions.png` 显示工作台同时存在面板级“换种子重抽”和每张历史图的“按原配置重绘”。查代码后确认两者调用的是**同一个** `rerender(selectedCandidate)`，即两个同义重复按钮，违反前端准则“去掉无意义的重复按钮”。计划 §1.1 把“按原配置重绘”定位在历史图上，因此**删除面板级的“换种子重抽”**，只保留历史图里的入口；顺带清理因此不再使用的 `RefreshCw`、`ImagePlus`、`selectedCandidate`、`selectedImage`，并把美术设置弹窗里已不准确的说明改为“历史图的‘按原配置重绘’与‘放大细化’各自保留原配置”。这一步是实际看截图才发现的，只跑脚本断言不会发现。

### 5.8 仍未完成

- 漫画“按原配置重绘”复用**画格当前持久化配置**，不是那次历史任务的逐字节快照（`activity_comic_jobs.input_json` 只存 `panelId／expectedDraftVersion／planHash／seed／sourceFingerprint`，提示词在执行时按当前画格重算并校验 `planHash`）。语义上等同于计划要求的“复用参数、换种子”，但**如果画格设置在那之后被改过，重绘用的是新设置**，界面会在 `sourceChanged` 时先确认。这一点与镜头入口（复用已保存的最终提示词）不同，如实记录。
- 漫画画格历史与素材历史的浏览器实际查看未做（夹具只播种了镜头；两者的动作条代码与镜头同构，但**没有实际截图证据**）。
- **“实际文本编码输入”在真实服务端组装工作流下的正向路径未做浏览器验证**：夹具用的是图内拼接的老式工作流，日志显示的是“无法确定”分支；能读出的正向路径由 `activity-prompt-snapshot.test.ts` 的单元用例覆盖（`encodedTextEntries` 对已派发图返回真实文本），但没有真实截图。

### 5.4 未验证

- 浏览器实际交互、窄屏菜单／浮层可达性、无横向溢出、草稿不丢失（阶段 7 §18.2）。
- 日志详情“来源→优化→规则→最终输入→实际图→产物”的分段展示（`/settings/ai-logs` 现有页面是否已满足未逐项核对）。

---

## 阶段 6：LoRA 与参考图

状态：**可自动化的部分已实现并有测试**；真实 LoRA 验收**外部阻塞**。

### 6.1 完成项与检查结果

| 要求（计划 §16） | 状态 | 证据 |
| --- | --- | --- |
| 复用全局 → 角色 → 目标覆盖，同名文件只注入一次 | 已实现（既有 `mergeActivityLoras`，三入口均传 `rejectActorConflicts: true`） | 新增 `apps/service/src/activity-lora-merge.test.ts`，6 个用例通过 |
| 多个角色同名配置不同且目标未覆盖时阻止提交 | 已实现，返回 409 `comic_actor_lora_conflict` | 同上；并断言“关闭该开关时确实是最后一个角色配置赢”，证明冲突不是偶然的 Map 覆盖 |
| 禁止“最后一个角色配置赢”作为隐性策略 | 同上 | 同上 |
| 触发词在 V2 最终收尾中完整匹配一次 | 已实现（`image-prompt-v2.ts` 整标签匹配 + 与正文去重） | `activity-prompt-v2.test.ts` |
| 细化读取原图实际 LoRA，不重新合并最新全局／角色设置；原文件缺失直接停止 | 已实现（`FrozenHiresPlan.actualLoras` 来自来源执行快照） | `activity-image-hires.test.ts` 的 planHash 与冻结用例 |
| 参考图仍按工作流 capability 与输入绑定预检 | 既有实现（`referenceInputKey` + `inputCapabilities`） | 既有测试 |
| 新的纯文生图对齐图未声明参考图能力时明确说明“仅文字描述”，不能显示角色已锁定 | 既有实现：无参考图且无 LoRA 时提示“本次未使用参考图或 LoRA；角色信息仅以快照文字加入提示词” | `beat-renders.ts` 警告分支 |
| 细化的 `init_image` 是源图，不伪装成角色参考控制 | 已实现（`inputCapabilities.init_image`，不占用参考图输入键） | `activity-image-hires.test.ts` |

### 6.2 未验证与外部阻塞

- **没有兼容的 LoRA 文件可用**：ComfyUI 离线，无法核对 `loras/` 目录，因此“真实带 LoRA 生成并核对图、权重、触发词、日志及人工画面”**未执行**，不写成通过。按计划要求，没有下载任何角色 LoRA 来凑验收。
- 真实参考图输入的端到端结果同样未验证（离线）。

---

## 阶段 7：真实样例脚本（准备就绪，未执行真实提交）

状态：**脚本通过只读预演**；真实提交**外部阻塞**。

### 7.1 完成项

`scripts/activity-image-parity-sample.mjs`：

- 默认不带 `--confirm`：只读预演，输出预算分配、固定 seed、约束清单；有 `STHSTART_ADMIN_TOKEN` 时再通过管理接口读取实际引擎、工作流与预设，并对每个 ComfyUI 引擎做 `/system_stats` 探活。不创建活动、不提交图片、不写数据库。
- `--confirm`：先要求 `STHSTART_ADMIN_TOKEN`，再要求能读到实际配置，再要求至少一个 ComfyUI 引擎可连接；任一不满足立即以明确错误码退出，**不排队、不重试**。
- 通过后创建**专用验收活动**（标题带时间戳，ID 记入报告），报告写入 `artifacts/activity-image-parity-v2/<timestamp>/report.json`，不覆盖旧目录。
- 预算表与计划 §18.1 逐行对应，合计 12 次：A/B/C 各两个固定 seed（6）、漫画双角色（1）、素材空场景（1）、Turbo 真实参数（1）、基础细化（1）、有文件时真实 LoRA（1）、必要补验（1）。失败提交计数，`autoRetry: false`。
- 报告固定写入 `peakVram: "未测"`，不从总显存推算。

### 7.2 检查结果

- `node scripts/activity-image-parity-sample.mjs`：只读预演成功，`live.read=false / reason=admin_token_required`（本机未设置管理令牌），未写入任何数据。
- `node scripts/activity-image-parity-sample.mjs --confirm`：以 `admin_token_required` 退出码 1，未创建活动、未提交图片。
- `git diff --check`：退出码 0，无空白错误（仅 Git 的 LF→CRLF 提示）。

### 7.3 未执行与阻塞

- **未执行任何真实图片提交**（0 / 12）。ComfyUI 离线，且未设置管理令牌。
- **未做浏览器截图**（阶段 7 §18.2 的 1440×900、390×844、1920×1080 三档与九类覆盖场景）。
- **未做 A/B/C 人工画面比对**：没有真实图片就没有可比对象，不预先承诺效果。

