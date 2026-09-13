# ComfyUI Integration V2：可行性评估与实施计划

> 状态更新（2026-09-13）：用户已将需求明确收敛为工作流、模型、简单参数与试生成的配置体验。当前开发请以同目录 `COMFYUI_CONFIGURATION_WORKSPACE_DEVELOPMENT_PLAN.md` 为准。本文仅作远期研究参考，不作为本轮执行任务清单。

日期：2026-09-13  
项目：SthStart  
用途：交给后续开发模型分阶段执行；本文是规划，不代表功能已开发或模型已实机验收。

## 1. 决策摘要

建议实施，但将链接中的“大而全模型工作站”拆成可验证的增量交付。

保留现有 Service → Windows Worker → ComfyUI 主链路、工作流不可变版本、应用用途绑定、任务快照、媒体仓库和单 Worker 并发 1。第一阶段补齐运行环境发现、依赖预检、输入约束和一套图片工作流，不重写生成引擎，不再引入前端框架。

核心判断：

- 工程方向可行，现有代码有明确扩展点。
- RTX 3080 12GB 作为目标配置有实验价值，但本轮没有连接目标 GPU、核对本机模型清单或执行真实生成，不承诺模型速度、峰值显存或稳定性。
- FLUX.2 Klein 4B 与 Wan2.2 5B 是候选，不是已经正式支持的默认模型。
- “在线”“依赖齐全”“参数有效”“已通过该机器实测”是四件事，不能合并成一个绿色 Ready。
- 首个可交付版本不包含自动下载模型、安装节点、远程执行命令、全自动多显卡路由或角色 LoRA 训练。
- 不恢复已经决定精简的人设细分字段与服装库。生成配置应独立于角色人设内容。

## 2. 链接方案的可行性与修正

已从分享页内嵌正文读取方案，并以当前源码和官方资料独立复核。原方案的完成百分比缺少统一量化口径，不沿用。[原方案](https://chatgpt.com/s/t_6aa635d5400081919fa2f63a2a508419)

| 建议方向 | 判断 | 本计划取舍 |
| --- | --- | --- |
| 保留 Engine / Workflow / Worker | 直接采纳 | 增量扩展，不替换执行主线 |
| GPU 与模型发现 | 直接采纳 | 先做只读发现；快照有时间与完整性标记 |
| Manifest 与预检 | 采纳并细化 | 静态声明、运行状态分开；不复制 inputSchema 和媒体能力 |
| 12GB 硬件档位 | 有条件采纳 | 自动推荐档位，人工确认；显存不是运行保证 |
| 六套正式工作流 | 延后批量实施 | 先一套图片，验证后编辑/放大，再视频与控制 |
| 自动分析导入工作流 | 有条件采纳 | 仅接受 API JSON；识别结果需确认，不自动猜复杂节点语义 |
| 参数跟随工作流 | 高优先级 | 前端提示与后端强校验使用同一契约 |
| 视频用途去模型化 | 采纳，但需要兼容迁移 | 保留旧任务与用途别名，不简单全局替换字符串 |
| 角色绑定 LoRA/参考图 | 后置 | 先复用已有参考图与媒体语义；不把推理参数塞回人设 |
| 固定环境与模型目录 | 采纳原则 | 记录版本和来源；目录搬迁、安装升级另行授权 |

### 2.1 官方资料核实后的边界

1. ComfyUI 提供 `/models`、`/models/{folder}`、`/object_info` 和 `/system_stats`，足以作为发现与预检的基础；它们不是自动安装或无副作用执行验证接口。[官方路由文档](https://docs.comfy.org/development/comfyui-server/comms_routes)
2. BFL Klein 模型页列出的 4B / 4B Base 显存参考分别为 8.4GB / 9.2GB；但其另一份总览仍写约 13GB。文档口径并不完全一致，不能把其中较小数值作为目标机器硬阈值。速度参考也不能迁移到 3080。[BFL 模型页](https://bfl.ai/models/flux-2-klein)、[BFL 总览](https://docs.bfl.ai/flux_2/flux2_overview)
3. ComfyUI 的 Wan2.2 教程说明 5B 在原生 offloading 下可适配 8GB 显存；这是带运行条件的适配说明，不等于任意分辨率、帧数与时长都可流畅生成。[Wan2.2 官方教程](https://docs.comfy.org/tutorials/video/wan/wan2_2)
4. 当前 ComfyUI 主分支源码还包含按任务取消和带 prompt_id 的中断实现，但目标安装版本未知。必须按版本/能力适配，不能假定所有环境都有，也不能试调用写接口来探测支持情况。[ComfyUI server.py](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)

本计划不复述其他大型模型的排行榜，也不据此建议立刻下载权重。所有正式候选要锁定具体权重、编码器、VAE、节点、精度与运行参数。

## 3. 当前代码事实与缺口

以下是本轮静态检查结果；上轮 17 项前端回归不代表生成系统已通过真实 GPU 验证。

| 位置 | 已有实现 | V2 所需工作 |
| --- | --- | --- |
| `workers/windows-worker/worker-core.mjs` | 并发固定 1；磁盘保护；模型标签；能力环境变量；health 用 `/queue` 检查 ComfyUI | 增加独立的环境探测与缓存，不把完整模型扫描塞入 health |
| `workers/windows-worker/server.mjs` | token + IP 白名单；任务、输入上传、状态、输出与确认路由 | 新增鉴权后的发现/预检接口；目前没有远端取消路由 |
| `apps/service/src/worker.ts` | Worker HTTP 适配 | 扩展协议能力协商与发现适配，兼容旧 Worker |
| `apps/service/src/generation/workflows.ts` | API JSON 结构、绑定路径、输出节点校验；快照替换 | 增加真实节点输入类型/依赖校验，保留已有安全检查 |
| `apps/service/src/generation/inputs.ts` | 媒体权限、类型、大小、语义；最多 4 个输入且 inputKey 唯一 | 复用现有媒体通道；多参考图不可直接假定同一键支持数组 |
| `apps/service/src/generation/execution.ts` | 调度、幂等、快照、轮询、恢复；Worker 取消为 local-tracking | 集中参数校验与提交前检查；真实取消独立补齐 |
| `apps/service/src/generation/task-store.ts` | 按应用用途固定工作流版本；旧媒体表回退读取 | 增加显式 V2 解析，不改变历史任务含义 |
| `apps/service/src/management.ts` | 发布时主要验证结构，随后直接写入已发布版本 | 分离保存版本与验证可用性；绑定稳定版本增加门禁 |
| `apps/service/src/database.ts` | 工作流版本列与 `generation_workflow_media_versions` 存在媒体配置重复 | 本轮明确权威来源，不新增第三份副本；清理另批迁移 |
| `packages/contracts/src/index.ts` | inputSchema 是宽松对象；视频枚举包含 h3-* | 增加明确 V2 契约、兼容旧枚举 |
| `app/features/creative/components/image-generator.tsx`、`apps/service/src/creative.ts` | 图片尺寸仍使用通用 64–4096 范围 | 改为工作流约束；通用范围只保留为全局安全上限 |
| `app/features/generation/components/workflow-editor.tsx` | 多块 JSON 手填发布 | 改为导入与映射向导，保留高级 JSON 模式 |

额外注意：数据库/类型中的 `cloud` 不等于通用云执行已实现；当前 task-store 对执行引擎仍限制为 comfyui 或 worker。V2 不顺带承诺云后端支持。

## 4. 范围与交付层级

### 必须完成的 MVP

- 一台 Worker 的真实环境快照：设备、内存、节点、模型与能力支持状态。
- 工作流 V2 元数据、明确输入约束、可解释的依赖报告。
- Service 统一强校验；Worker 在提交 ComfyUI 前复核依赖与关键约束。
- 一套图片工作流全链路运行与可回溯产物。
- 工作流配置向导和基于契约的生成表单。
- 旧 Worker、旧工作流、旧任务的兼容回归。

### 随后交付

- 任务实际取消、环境漂移检测、视频用途去模型化。
- 图像编辑、分块放大、短视频候选验证。
- 最后才做 LoRA / ControlNet 与角色参考联动。

### 不在本轮范围

模型商店、远程 shell、模型/节点自动安装、自定义节点市场、GUI 工作流通用转换器、训练平台、全自动调参、分布式 GPU 调度、修改邻舍内部实现、全站 UI 重做。

## 5. 目标架构与状态职责

```text
创作中心 / 活动配图 / 角色图像入口
          ↓ 按用途请求，不能指定任意引擎或文件路径
Service：用途解析 → 参数/媒体校验 → 任务快照与队列
          ↓ 固定版本 + 解析后参数 + 校验上下文
Windows Worker：环境缓存 → 提交前复核 → 单任务执行
          ↓
ComfyUI：现有 prompt / ws / history / 媒体接口
          ↓
Worker 拉取 → Service 媒体仓库 → 原业务采用/回放
```

| 概念 | 所有者 | 不得混同 |
| --- | --- | --- |
| Installed model | ComfyUI 发现快照 | 文件名存在不等于权重正确、可加载或许可证已审查 |
| Workflow definition | 已发布工作流版本 | 不等于当前机器安装环境 |
| Manifest | 同一不可变版本的依赖与兼容声明 | 不持有第二份输入字段、媒体能力、输出 Schema |
| Hardware policy | 引擎上的执行策略 | 不等于对某 GPU 的自动性能承诺 |
| Preflight report | 工作流版本 × 引擎 × 环境版本 | 不是全局永久 Ready |
| Verification run | 固定参数与环境下的实测记录 | 一次成功不能证明整个参数空间稳定 |

保留直连 ComfyUI 的兼容路径，但新增能力通过统一 `EnvironmentInspector` 适配器访问。若同一个 ComfyUI 同时登记为直连引擎和 Worker 引擎，必须提示重复执行端点；目标 12GB 正式通道只选择一条，避免两套调度同时占用同一 GPU。

## 6. 最小数据设计：避免过度建表

以下是新增设计名，不表示仓库已有这些对象。迁移编号由实施者读取最新迁移后分配，不能硬编码旧编号。

### 6.1 已有实体的增量字段

`generation_workflow_versions`：

- `contract_version INTEGER NOT NULL DEFAULT 1`：旧版本保留 V1；新向导创建 V2。
- `manifest_json TEXT NULL`：依赖、兼容性、许可来源引用、参数组合约束。
- `ui_schema_json TEXT NULL`：字段标签、顺序、分组、预设值引用；不再保存第二套 min/max/default。
- 已有 `input_schema_json` 是 V2 参数规范唯一来源；`input_capabilities_json` 仍是媒体输入规范；输出字段仍沿用原列。

`generation_engines`：

- `execution_policy_json TEXT NULL`：人工确认的档位、Stable/Experimental 使用策略、容量与外部占用策略、资源等待超时。
- 不新增与 `concurrency_limit` 重复的权威并发列；Worker 实际能力与 Service 配置取更严格值。

`generation_tasks`：

- `validation_context_json TEXT NULL`：仅存 manifest/schema 内容哈希、预检报告 ID、环境 revision、策略 revision、预设 ID 与版本。
- 参数继续放 `request_params_json`；图继续放 `workflow_snapshot_json`。不要在新列复制完整工作流、全部模型清单。

### 6.2 新增三张表即可

| 表 | 关键字段 | 生命周期 |
| --- | --- | --- |
| `generation_environment_snapshots` | engine_id 主键/FK、revision、observed_at、expires_at、status、inventory_json | 每引擎保留最新成功快照与最近失败状态；静态内容变化才改变 revision |
| `generation_workflow_preflights` | id、workflow_id/version 复合 FK、engine_id FK、environment_revision、manifest_hash、checked_at、expires_at、status、issues_json | 可追加审计；按版本/引擎/时间索引，定期清理未被引用的旧记录 |
| `generation_workflow_verifications` | id、workflow_id/version、engine_id、environment_revision、profile_revision、parameter_envelope_json、task_ids_json、result、metrics_json、verified_at、reviewed_at | 实测证据，保留测试参数范围与人工质量确认 |

MVP 不建一堆 Model、ModelFile、ModelVersion、ModelInstall、GPUProfile 关系表。管理页所谓 Model Registry 先是按引擎检索的只读库存视图；只有出现跨机器分发/去重等真实需求才拆模型表。

工作流目录先是版本化配置文件与已有工作流表的视图，不另建独立目录服务。实验/稳定状态从目标引擎的验证记录与当前预检推导，避免工作流全局标记 Stable 后在另一台机器被误用。

### 6.3 迁移与旧重复列

1. 先添加可空字段/新表，保持旧响应兼容；不修改旧 `definition_json` 或历史任务。
2. 新版本写 V2，旧版本按 V1 适配读取，标为“旧版 / 未验证”，不批量伪造依赖通过。
3. 当前发布逻辑双写媒体表：本轮不扩大。新字段只写工作流版本表；新读取明确版本列优先，空值回退旧表。
4. 对旧表与版本列的差异另做只读报告；只有一致性检查、备份恢复演练和消费者迁移完成后，再安排单独删除旧表的迁移。冲突不能静默选一份覆盖。
5. `WORKER_MODEL` 保留为旧版展示标签，UI 降级为“人工备注”；不能直接删除导致旧 Worker 契约失败。
6. 发布新版本/更新 latest_version 必须事务化，并处理并发发布冲突。不要在 SQLite 写事务期间发网络预检请求。
7. 回滚先切回旧用途绑定；新增列通常保留。需要恢复数据库时必须停写、备份当前状态，评估上线后新增数据，不能直接覆盖生产库。

## 7. Worker 发现协议与缓存

保留 `/health` 及现有字段，新增可选 `protocolVersion`、`supportedFeatures`、设备摘要与采样时间。设备摘要取缓存，不每次 health 扫描全部节点和模型。

### 新增 Worker 接口（拟定）

| 接口 | 职责 |
| --- | --- |
| `GET /v1/worker/environment` | 返回设备、ComfyUI 版本摘要、环境 revision、可用发现接口与缓存新鲜度 |
| `GET /v1/worker/models?category=...&cursor=...&limit=...` | 从快照分页返回类型、相对模型名、来源；不暴露绝对路径 |
| `POST /v1/worker/environment/refresh` | 手动刷新，合并并发请求并限频；不下载或安装 |
| `POST /v1/worker/workflows/preflight` | 接受有大小限制的工作流/manifest/契约，做只读校验，返回问题报告 |
| `POST /v1/worker/tasks/:id/cancel` | 后续阶段实现，按实际能力返回取消结果，详见第 11 节 |

原则：

- 所有接口沿用 token/IP 白名单；浏览器只通过 Service 访问，不能获取 Worker 密钥或直连内网 ComfyUI。
- `devices[]` 支持 CPU/多设备/未知值；显存与内存用 bytes，UI 用 GiB 并显示时间。显存空闲量不等于可供当前任务分配量。
- 不输出 `/system_stats` 的原始 argv、环境变量、凭据、绝对路径；只返回允许字段。
- 模型类型以 `/models` 实际返回为准，不硬编码为唯一全集；模型名按 category + 相对名识别，不擅自大小写归一或仅按 basename 匹配。
- 模型列表通常只能证明名字可见；文件 hash、大小、许可证、模型家族与节点包 commit 若无可信来源，标记 unknown，不能从文件名猜成事实。
- 节点信息缓存按 ComfyUI 重启、人工刷新或 TTL 更新。旧版缺少接口时允许部分发现，报告 unsupported/partial，不能解释为模型全部缺失。
- 拟定初始 TTL：设备动态摘要 10 秒；静态节点/模型 5 分钟；预检报告 5 分钟。人工刷新与实际依赖错误立即失效。TTL 可配置，不是产品固定承诺。
- 静态 revision 不包含 vramFree、queueDepth 等每秒变化的值，避免每轮轮询使所有预检作废。
- 模型接口单次请求限时与响应体大小限制；节点信息响应过大时可按工作流所需 class_type 按需拉取。上游全量拉取与前端分页是两回事。
- 探测失败不覆盖最后成功库存为“空列表”；返回旧快照 + stale + 本次错误。
- 对旧 Worker：显示“设备详情需升级”；既有任务按 legacy 路径继续，新 Stable 绑定不能凭旧 capability 标签通过认证。

## 8. Workflow V2 契约与预检

### 8.1 Manifest 的边界示例

以下是设计示例，不是可执行工作流；模型名必须由目标库存与导入定义确认。

```json
{
  "schemaVersion": 2,
  "modelFamily": "candidate-family",
  "requiredNodes": [{ "classType": "UNETLoader", "source": "unknown" }],
  "requiredModels": [{ "category": "diffusion_models", "name": "CONFIRMED_INVENTORY_NAME", "sha256": null }],
  "capabilities": ["text-to-image"],
  "compatibility": { "comfyuiRevision": null, "environmentLockRef": null },
  "resources": { "estimatedPeakVramBytes": null, "evidenceRef": null },
  "constraints": { "maxPixels": 1048576, "batchSize": 1 },
  "licenseEvidence": [],
  "source": { "url": null, "retrievedAt": null }
}
```

示例的像素上限只演示格式，不作为所有模型默认。单字段 min/max/default/multipleOf 放在 inputSchema；跨字段乘积限制放在 manifest.constraints，避免重复。

### 8.2 输入契约

采用明确标识的 JSON Schema 子集：object/properties/required/additionalProperties、string/number/integer/boolean、enum、minimum/maximum、multipleOf、长度约束。MVP 不支持远程 `$ref`、脚本表达式或任意函数。

- 旧 `{ prompt: { type: 'string' } }` 不是完整标准 object Schema，必须经 V1 适配，不能直接交给标准验证器误判。
- 默认值只由 Service 的归一化步骤补一次；拒绝未知输入，不在验证器里隐式丢字段或擅自钳制数值。
- 数值要求有限、安全整数范围适用时严格检查；seed 保留现有业务语义，不擅自扩成 JS 无法精确表示的整数。
- 图片除了 width/height 单项，还要校验乘积、步长、批量、参考图数量。
- 视频明确 width/height、fps、frameCount、duration 的唯一换算规则，帧数对齐由工作流声明；不能所有视频都套 `秒数 × 帧率` 后四舍五入。
- 相同语义字段映射到多个节点不是当前一对一 nodeBindings 自动支持的功能。MVP 不改绑定格式；遇到多目标时先用确定模板或后续带版本升级的绑定扩展。
- 当前快照生成会遍历替换 seed/noise_seed，复杂多采样器工作流须验证这是否符合预期，不能宣称全部参数已精准映射。
- 验证器可优先采用现有 TypeBox 工具能力；若不足，单独评估引入一个 JSON Schema 校验库，不能增加第二套前端框架。

### 8.3 预检等级

| 等级 | 检查 | 失败处理 |
| --- | --- | --- |
| L0 结构 | API 格式、绑定、输出、敏感字段、Schema 合法性 | 拒绝创建 V2 版本 |
| L1 依赖 | class_type、绑定输入、枚举模型名、所需文件可见性、输出类型 | 明确缺失则阻止 Stable 绑定/提交；无法发现标 unknown |
| L2 参数 | 实际参数、媒体权限/数量、尺寸/帧数/像素组合约束 | 任务入队前拒绝，返回字段路径和修正建议 |
| L3 环境 | 版本兼容、磁盘、可用执行设备、策略与外部队列占用 | 资源暂忙则等待/阻止提交；不能伪造成生成失败 |
| L4 实测 | 固定环境和参数范围的真实生成、产物与恢复验证 | 人工批准后才成为该引擎上的 Stable 候选 |

预检报告状态采用 `pass / warning / blocked / unknown`，每条问题有 code、severity、nodeId/inputPath、expected、actual、remediation。低显存估算没有实测依据时是 warning，不是证明可运行。

发布与启用分开：结构合法可保存为不可变版本并标“未验证”；保存不是生产就绪。绑定到 Stable 用途必须有匹配目标引擎与环境的实测记录和未过期 L1 检查。Experimental 可由管理员明确接受非结构性未知风险，但不能绕过缺失模型、权限、输入非法或磁盘保护。

不调用 `POST /prompt` 做所谓 dry-run，因为它会入队。真正试运行必须由管理员显式触发，创建可见的测试任务并计入资源占用。

### 8.4 入队与执行时序

1. 解析用途绑定和确切版本；校验版本冲突，归一化预设/输入/seed。
2. 校验契约与媒体权限，复用预检缓存；必要网络请求在数据库事务外完成。
3. 将用途、版本、规范化参数与媒体摘要纳入幂等请求语义；相同幂等键但不同工作流/参数必须冲突。
4. 短事务写任务与校验上下文；不要在预检阶段重复上传媒体。
5. 出队时复查引擎、依赖快照新鲜度与资源策略。Service 等待资源期间保留 queued，通过 progress.stage 标记原因，设可配置超时，避免无期限卡住。
6. Worker 依据携带的 V2 契约进行关键输入复核，确认模型/节点可用后才提交；历史 V1 请求走兼容逻辑。
7. 环境漂移或提交结果未知时禁止盲目自动重提，保留现有不确定状态与人工核查机制。
8. 产物必须经过现有下载、媒体类型/大小/完整性处理后才能标成功，不能只凭 history 有记录。

## 9. Service API 与前端完整改造

### 9.1 新增管理/业务接口（建议路由）

| 接口 | 说明 |
| --- | --- |
| `GET /api/v1/admin/generation/engines/:id/environment` | 安全投影后的环境与状态 |
| `GET /api/v1/admin/generation/engines/:id/models` | 库存搜索/分页 |
| `POST /api/v1/admin/generation/engines/:id/refresh` | 转发受控刷新 |
| `POST /api/v1/admin/generation/workflows/analyze` | 校验并分析上传的 API JSON，不执行 |
| `POST /api/v1/admin/generation/workflows/:id/versions/:version/preflight` | 目标引擎预检与报告 |
| `POST /api/v1/admin/generation/workflows/:id/versions/:version/verify` | 管理员显式试运行，返回任务 ID |
| `GET /api/v1/creative/capabilities` | 当前应用可用用途、契约、预设与不可用原因，不暴露管理凭据 |

版本创建仍扩展既有接口。管理接口沿用项目会话/鉴权；业务接口从服务端确定应用范围。报告若有节点名/文件名也按管理权限投影。

### 9.2 生成设置页

沿用现有 AppShell、页头、Panel、Dialog/Drawer，不新增 UI 框架。把页面内容组织为“运行设备 / 工作流 / 用途绑定 / 诊断”，保留既有引擎设置，不另建平行后台。

运行设备页：

- 顶部显示 Worker 连接、ComfyUI 连接、最近采样时间、GPU 与可用显存、队列与磁盘。
- 模型列表置于独立页签或按需展开区，不在设备卡塞入几百个文件。
- 每个状态有文字，不仅用颜色；未知、陈旧、无权限、未升级、离线分别展示。
- “刷新”是唯一主要操作；安装/删除模型不提供按钮。

工作流列表：名称、用途、版本、目标引擎、依赖结果、验证时间。默认隐藏底层 JSON，不把“已发布”文案渲染成“可运行”。

导入向导：

1. 上传/粘贴 API JSON：检测 GUI 格式并给出正确导出提示，保留用户输入。
2. 参数映射：展示候选字段、来源节点、识别置信度；用户确认 prompt/尺寸/seed 等语义。不自动将两段文本都认作正负提示。
3. 依赖确认：从目标库存选模型，列缺失节点与未知来源；明确修改会产生新版本。
4. 预设与约束：设置业务名称、画幅、输入媒体槽、高级参数；默认值必须在允许范围内。
5. 预检与试运行：只读检查和真正运行使用不同按钮；显示资源占用提示与任务状态。
6. 发布/绑定：保存不可变版本；只有符合门禁才可加入 Stable 绑定；JSON 高级模式仍可使用，但保存也走同一验证器。

桌面 >=1280px 可用主编辑区 + 320px 依赖摘要；不足时摘要改为抽屉。手机保持单列顺序表单，错误定位到对应步骤，草稿不因切页签丢失。

### 9.3 创作中心

默认只展示：提示词、画幅、可用画质预设、所需参考图和“生成”。可复现 seed、步数等放高级设置；不支持 negative prompt 的工作流不显示该输入。

- 预设来自当前工作流版本，不允许前端固定“所有模型 20 steps”。
- MVP 的快速/标准/精细仅在同一工作流版本内部映射合法参数，名字描述实际预设，不暗中切模型。
- 跨工作流的快速/高质量切换延后：应由受控用途绑定映射，并返回新的契约；浏览器不能提交任意 workflowId 绕过管理限制。
- 切换预设/用途若使旧输入不兼容，展示哪些值将重置，媒体仍保留可恢复引用，不能静默删除。
- 分辨率合法但超出已验证 envelope 时显示实验提示，不能沿用 Stable 标志。
- 状态区区分检查中、排队、执行、正在取消、取消结果不确定、失败、成功；错误可操作，避免只给 raw traceback。
- 产物卡保留确切版本、seed、输入摘要、用途与溯源入口；复用活动已有“采用”流程，不自动替换已采用图片。
- 360/390px 无页面横向滚动；触控按钮 >=44px；沿用双主题令牌与现有焦点管理。

## 10. 视频用途迁移

新业务命名采用 `text-to-video`、`image-to-video`、`first-last-to-video`，图片用途保留已有 `text-to-image`、`image-to-image`，避免无价值重命名。

迁移次序：

1. contracts 与 Service 接受新标识；旧 `h3-t2v` / `h3-i2v` / `h3-fl2va` 继续可读可重放。
2. 集中建立兼容映射，不在页面、调度器和 API 各写一套分支。
3. 核对 FL2VA 的真实输出语义，若带音频，以输出媒体能力单独声明；不可把含音频契约静默缩成普通首尾帧视频。
4. 新用途优先查精确绑定，只有不存在时回退旧别名。若新旧都存在且不同，显示冲突并由管理员选择，不覆盖。
5. 新任务固定保存解析后的版本与能力；旧任务保持原 mode/purpose/snapshot。旧工作流使用兼容适配器，不原地篡改不可变版本。
6. UI 迁移完成后再降低旧名称曝光，至少一个明确兼容窗口后才考虑废弃请求别名。

涉及：contracts、`creative.ts`、`generation/task-store.ts`、创作前端 types/api/video-generator、生成设置用途绑定、Worker capability 校验与对应测试。不是改一个显示名称即可完成。

## 11. 取消、恢复与安全

这是链接方案提到验收、但当前实现尚未完成的关键能力。

- Service 中 queued 且未提交的任务可本地取消；Worker 内排队未提交的任务必须从该 Worker 队列移除并持久化结果。
- 执行中任务必须关联自身 taskId → promptId；优先使用目标版本确实支持的精确取消接口。
- 旧环境若只有全局中断，默认禁止在共享 ComfyUI 上调用。仅在明确独占且可证明执行归属的受控适配模式下考虑，否则返回 `unsupported`，保留“停止本地跟踪，远端可能继续”的真实提示。
- 不能通过一次 GET 发现当前 promptId 后就认为后续全局 interrupt 无竞态；无法保障时保持不支持。
- 新取消接口应幂等，返回 `cancelled / already_finished / requested / unsupported / outcome_unknown` 之一。收到 requested 不立即标远端已停止。
- 任务公开状态可暂保留原枚举，用 progress.stage=`cancelling` 表示过程；只有确认后标 cancelled，确认不了沿用 abandoned/upstreamMayContinue，不伪造新终态。
- Service 重启按 Worker 状态与 prompt history 对账；提交结果未知仍不得自动生成第二份任务。Worker 重启要恢复本地任务记录，不能仅恢复一个空内存队列。
- 无关任务不得被中断；取消失败也不得允许同一物理 GPU 上突破实际执行容量。
- 环境锁文件只记录 ComfyUI/Python/PyTorch/CUDA/节点版本与模型来源/hash，不包含 token、私有 URL 凭据或机器绝对路径。
- 新增发现/预检不得变成任意 URL 代理。只用管理员已配置并校验的引擎地址；文件名来自库存枚举；拒绝路径穿越，禁止 shell 拼接与远程安装。

## 12. 目标机器与工作流目录

### 12.1 硬件策略

档位名称可以保留 `12gb-balanced`，但它是人工确认策略，不是仅按显存总量分桶后自动启用。记录 GPU、驱动、主存、ComfyUI/框架版本、dtype、offload 设置和共享占用条件。

并发维持 1。系统显存余量从默认设置开始测量，再按目标安装版本支持的启动参数调整；不在计划中预先写死 lowvram 或假定某组 CLI 参数必然存在。

先校验一组有效尺寸与 batch=1；保守上限也必须符合该模型/节点尺寸对齐。放大是独立用途与工作流，不把图片生成上限放到 4096 就称支持 4K。

### 12.2 候选目录与启用顺序

| 阶段 | 候选 | 首要证据 | 默认状态 |
| --- | --- | --- | --- |
| 首套图片 | 现有已可用工作流，或 Klein 4B / SDXL 中先通过目标机验证者 | prompt→真实图片、稳定参数范围、质量确认 | Experimental，证据通过后 Stable |
| 图片扩展 | Klein 4B 编辑、分块放大 | 参考图通道、身份保真/编辑效果、分块接缝 | 未验证 |
| 高质量图片 | Klein 4B Base | 相比首套确有可接受质量收益和耗时 | 未验证，不自动替换默认 |
| 视频 | Wan2.2 TI2V 5B | 合法帧数/尺寸、主存与显存、短视频产物、取消恢复 | 未验证 |
| 可控角色 | SDXL ControlNet / LoRA | 模型家族兼容、所需预处理节点、角色参考闭环 | 延后 |
| 其他大型模型 | 现有 H3 或其他候选 | 独立实验报告 | 保持实验，不批量下载 |

每个候选记录来源 URL、下载日期、许可证据与具体权重名称。需要下载或升级目标环境时，后续执行者应先提交容量、来源和变更清单，再取得用户授权；本计划不是安装授权。

### 12.3 实机验收最小集

- 锁定环境后连续 10 次成功生成，包含至少 1 次冷启动与多次热运行；记录每次原始耗时，10 次样本不宣称具有统计可靠性的 P95。
- 验证默认值、允许上限、非法输入、缺失模型、节点缺失、显存/磁盘不足、ComfyUI 离线。
- 编辑工作流验证输入图确实影响输出；视频验证媒体可解码、实际帧数/时长、无损坏输出。
- 排队取消、执行中取消（若不支持明确标出，不通过完整可取消认证）、Service/Worker 重启与提交不确定场景。
- 报告记录峰值显存的采集工具、采样间隔和主存占用；只有离散 `/system_stats` 采样时称“观测最大值”，不伪称真实峰值。
- 验证范围限定到具体工作流版本、参数 envelope、环境与硬件策略。更换模型、节点、环境后失效或要求复测。
- 性能验收不预设“几秒一张”；先给用户实测耗时样本，再确认日常可接受阈值与正式绑定。

## 13. 角色、外观与生成配置的衔接

保留已确定的人设四块内容模型。人设、说话方式、基础外貌、默认穿着是内容，不是模型运行参数。

- 本轮先复用现有参考图的 identity/outfit/pose/style 等语义、裁剪与启用状态，经现有 artifact 授权通道进入生成请求。
- 不把默认 LoRA 文件名写进 persona 文本，不增加一套角色显存、步数、CFG、采样器字段。
- 后续确需角色默认生成配方时，独立增加可选 recipe 引用与覆盖层：系统默认 → 角色选择 → 活动上下文 → 当前显式选择；任务保存最终快照。
- recipe 引用受控模型库存或稳定工作流预设，不存任意本地路径。选择 LoRA 时必须验证基础模型家族兼容，不能跨模型直接复用。
- 多参考图先用现有最多 4 个不同 inputKey 的能力边界；需要同键数组时单独升级契约与上传/映射，不只改一个 maxCount。
- 不恢复未接入业务的服装表，不改邻舍内部换装系统。

## 14. 文件级实施清单

### 既有文件：增量修改

| 层 | 文件 |
| --- | --- |
| 契约与数据库 | `packages/contracts/src/index.ts`；`apps/service/src/database.ts` |
| Worker | `workers/windows-worker/worker-core.mjs`、`server.mjs`、`windows-worker.env.example` |
| Service 适配与管理 | `apps/service/src/worker.ts`、`management.ts`、`creative.ts` |
| 生成核心 | `apps/service/src/generation/workflows.ts`、`inputs.ts`、`task-store.ts`、`execution.ts` |
| 生成设置前端 | `app/features/generation/generation-settings.tsx`、`types.ts`、`api.ts`、`components/workflow-editor.tsx`、`worker-panel.tsx`、`assignment-panel.tsx` |
| 创作前端 | `app/features/creative/api.ts`、`types.ts`、`components/image-generator.tsx`、`video-generator.tsx`，以及调用这些组件的容器 |
| 业务消费者 | 活动配图、角色图像入口：统一走 Service 校验，不复制参数边界 |
| 运维 | `docs/OPERATIONS_AND_BACKUP.md`、`docs/EXPERIMENTAL_MEDIA.md` |

### 建议新增模块（由实施者按仓库导出约定组织）

- `workers/windows-worker/comfy-environment.mjs`：只读发现、TTL、脱敏、partial 状态。
- `apps/service/src/generation/environment.ts`：Worker/直连适配与快照。
- `apps/service/src/generation/preflight.ts`：报告、门禁、过期与漂移。
- `apps/service/src/generation/input-contract.ts`：V1/V2 适配与统一校验。
- `apps/service/src/generation/purpose-aliases.ts`：用途兼容解析。
- `app/features/generation/components/workflow-import-wizard.tsx`：导入向导。
- `app/features/generation/components/environment-summary.tsx`：设备/模型摘要。
- `app/features/creative/components/workflow-parameter-form.tsx`：契约驱动表单。
- `tests/e2e/generation-v2.spec.ts`：管理与创作端契约回归。

已有模块可合理拆分，但不能借此移动整个生成目录或重写全文件。前一轮 UI 修改仍在工作区，必须保留，避免多个模型同时改动 contracts/management/execution。

## 15. 分阶段任务、依赖与退出条件

| 阶段 | 工作 | 必须交付与退出条件 | 粗估有效开发日 |
| --- | --- | --- | --- |
| P0 基线 | 核对旧 API/数据库/测试；只读目标环境调查；确认首套候选 | ADR、兼容矩阵、无写入盘点；目标机器不可用时明确硬件验证阻塞 | 1–2 |
| P1 发现 | Worker 协议、只读库存、Service 快照与设备页 | 鉴权/离线/partial/旧 Worker 测试；不影响原任务 | 2–3 |
| P2 契约与预检 | 加法迁移、V1/V2 校验、Manifest、报告和绑定门禁 | 入队前非法参数拒绝，缺失依赖定位准确，旧任务可读 | 3–5 |
| P3 图片闭环 | 导入向导、业务表单、第一套图片 workflow | 完整真实生成、原业务采用、10 次证据及用户质量确认 | 3–5 |
| P4 任务可靠性 | 精确取消、对账、漂移与重复执行端点防护 | 无误取消、无盲重提、重启恢复；旧协议真实降级 | 2–4 |
| P5 扩展 | 视频用途迁移；编辑/放大/短视频逐套实验 | 每套独立验收，不整批打 Stable | 4–7 |
| P6 角色配方 | 按实际需求接入 LoRA/ControlNet/参考图 | 不增加人设复杂度，溯源与媒体权限完好 | 另估 |

单人 MVP 到 P3 粗估 9–15 个有效开发日，前提是目标机器和模型可用；不是承诺工期，不包括大文件下载、环境修复和用户质量评审。完整 P0–P5 粗估 15–26 日。先完成 P0 才能进一步收窄估算。

P1 与 P2 的接口设计可并行讨论；contracts 由一位实施者整合，前端使用明确 mock 开发，不用 mock 冒充设备就绪。P4 是正式视频通道启用前的必经门禁。

## 16. 测试与验收

### 自动化

- contracts：V1/V2、optional 新字段、未知枚举策略、空/非法数值、默认值、步长、像素乘积、视频帧数关系。
- Worker：鉴权、库存分页与路径、接口缺失、超时、响应超限、TTL 并发刷新、缓存失效、脱敏、取消归属与幂等。
- Service：加法迁移、旧媒体回退、并发发布、报告关联/过期、两台引擎结果隔离、绕过前端非法提交、内部活动消费者同样校验。
- 执行：幂等键在工作流版本变化时的行为、真实参数快照、提交未知不自动重试、媒体下载失败不标成功、独占容量保护。
- E2E：离线仍可编辑向导，GUI JSON 拒绝，依赖报告，Schema 驱动范围，旧工作流运行入口，新旧用途冲突，手机单列，两套主题和焦点。
- 使用隔离 E2E 数据库与端口。测试不自动调用真实 GPU；硬件验收独立显式运行。

### 仓库命令（实施阶段执行）

```text
npm run typecheck
npm run test:contracts
npm run test:windows-worker
npm run test --workspace @sthstart/service
npm run test:portal
npm run build
npx playwright test tests/e2e/generation-v2.spec.ts --workers=1
```

再回归 `frontend-experience`、`workspace-review`、`portal`、`activities`、`contrast`、`typography` 等受影响用例。真实 GPU 验收必须附环境信息和原始任务结果，不因单元测试全绿而跳过。

当前前端测试曾出现服务退出和流关闭日志；该问题另行跟踪。测试进程退出应标环境/服务失败待查，不能删除断言或自动更新所有截图来换取全绿。

### 完成定义

- “代码完成”：契约、迁移、兼容与自动化通过。
- “图片 MVP 可用”：目标机第一套工作流真实闭环、性能样本与质量确认完成。
- “Stable 可选”：该工作流版本在该环境与参数范围有有效证据，依赖预检新鲜。
- “正式视频可用”：还需视频产物、任务取消/恢复与用途迁移验收。
- “全部完成”必须逐项说明，不用一个总百分比掩盖未验证模型。

## 17. 上线与回滚

1. 备份并验证恢复；记录当前用途绑定、Worker 协议与镜像/构建版本。
2. 先发兼容扩展的 Worker，再发 Service 的加法迁移和只读发现，最后前端。
3. V2 新入口先限定实验用途，不改现有默认工作流。既有消费者保持旧路径。
4. 单套完成验证后由管理员显式更新绑定；保留上一版映射供一键选择回退。
5. 不强制升级 ComfyUI。确需更新时先在隔离环境验证工作流与依赖，记录锁文件和模型路径配置。
6. 功能回退优先关闭 V2 新用途/恢复旧绑定，旧任务继续对账，不能删除队列或产物。
7. 最后才清理重复媒体存储与旧字段，单独迁移、单独恢复演练。正式发布使用可复现镜像/产物，不仅复制到运行中容器。

## 18. 可直接交给执行模型的任务说明

请基于本计划实施 ComfyUI Integration V2，先只执行 P0–P3，保留已有 UI 和业务数据。开始时读取当前 git diff、最新数据库迁移、Worker 协议与生成测试；先提交具体接口/迁移清单，再增量实现。不要重写生成主线，不自动下载模型或升级 ComfyUI，不修改邻舍内部，不扩大角色人设字段。所有新功能须兼容旧 Worker/旧工作流，所有参数必须在 Service 强校验，预检不得偷偷执行生成。没有目标 GPU 时继续完成可独立验证的代码工作，但将实机验证单独列为未完成，不伪造 Ready、显存或耗时。交付代码差异、迁移说明、自动化结果、真实环境验证报告和剩余风险。

## 19. 资料与证据说明

外部资料核对时间为 2026-09-13；目标安装版本仍需 P0 记录。上文链接仅支持相邻的上游事实，数据结构、API、分期与门禁是本计划的项目设计建议，不是 ComfyUI 官方规范。

Klein 具体工作流与依赖参考：[ComfyUI Klein 4B 教程](https://docs.comfy.org/tutorials/flux/flux-2-klein)。模型文件和精度应以实际选定模板与库存为准，不能复制示例名称后就认定可运行。

本地设计约束同时参考 `FRONTEND_WORKSPACE_REDESIGN_MASTER_PLAN.md`、`CHARACTER_MODEL_SIMPLIFICATION_V2_IMPLEMENTATION_PLAN.md` 以及 `2026-09-13-frontend-workspace-followup-review.md`。本文仅新增规划文件，本轮未实施数据库迁移、运行生成任务、下载模型或部署。
