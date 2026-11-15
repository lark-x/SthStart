# SthStart 公共服务

## 边界

公共服务只负责可复用的基础能力：LLM 转发、向量计算与检索、图片任务与产物、通用角色模板。邻舍的长期记忆、情绪、关系、梦境、动态、事件、日程、主动聊天、信箱和群聊行为始终由邻舍管理，不写入 SthStart。

服务强制监听 `127.0.0.1`、`::1` 或 `localhost`。元数据保存在 `data/sthstart.db`，图片字节保存在 `data/artifacts/<app-id>`；两者都已被 Git 忽略。这里使用本机 SQLite 和文件系统是因为当前产品明确是本地多应用服务，并非 Sites 托管的数据层。

## 身份与密钥

- 应用请求：`Authorization: Bearer <app-token>`。令牌为 256 位随机值，SQLite 只保存 SHA-256 摘要；明文只在创建或轮换时返回一次。
- 管理请求：`X-SthStart-Admin-Token`。门户通过 `/api/admin/*` 服务端 BFF 注入，客户端 bundle 和浏览器响应不会包含它。
- 供应商密钥：保存到操作系统凭据库。Profile ID `deepseek-main` 对应的环境变量回退名为 `STHSTART_SECRET_DEEPSEEK_MAIN`。
- `cross-keychain` 的 `null` 后端（不存储任何内容）被明确排除；`file` 后端（AES-256-GCM 加密文件）仅在显式提供 `KEYRING_FILE_MASTER_KEY` 时启用，用于没有系统密钥环的容器环境。
- 选定 Linux 原生后端（`native-linux` / `secret-service`）后会做一次真实读取探测，因为 cross-keychain 只检查平台与原生模块，容器里缺少 D-Bus 时会被误判为可用。探测失败会退回加密文件后端（若已配置主密钥），否则标记为不可用并退回环境变量。
- 保存模板时凭据写入失败不会丢弃配置：模板正常入库并返回 `secretStored: false` 与 `warning`，设置页提示 API Key 未保存并给出环境变量替代名；密钥来源（`credentialSource`）在模板列表中可见。

## API

### LLM

- `GET /api/v1/app/config`
- `GET /v1/models`
- `POST /v1/chat/completions`
- 可选请求头：`X-SthStart-Model-Role: text|multimodal`

#### 核心概念：供应商 → 模型 → 路由

公共 LLM 服务采用 **「服务连接 → 模型 → 模型路由」** 分层架构：
1. **服务连接 (`service_connections`)**：一个供应商 Base URL 与凭据账户。凭据只保存在系统凭据库或服务端环境变量，不进入浏览器。
2. **模型 (`model_profiles`)**：属于某个连接的实际模型，以 `modelType: chat|embedding|image` 区分用途。同一 OpenAI 兼容连接可保存多种模型，共用地址和密钥；文本模型额外配置看图能力、上下文、最大输出、思考强度与超时。温度、top_p 等采样参数不作为日常配置项。未显式配置时请求不发送 `temperature`，避免较新的推理模型因拒绝采样参数而失败；历史 `advancedJson` / `extraBody` 中的显式值仍原样保留。
3. **模型路由 (`model_routes`)**：公共文本与看图各有一条常用模型链，主模型后最多接两个备用模型。所有应用默认继承公共链；个别应用可在「应用例外」中覆盖文本或看图主模型，未覆盖的能力继续继承。
4. **调用解析顺序**：显式模型 > 用途绑定 (`purpose_bindings`) > 应用路由 > 旧分配 (`app_llm_assignments`) > 公共路由。旧分配接口仍可用，但保存时会与 app route 在同一事务内同步，避免两种界面显示不一致。
5. **使用中保护**：被模型路由、用途绑定、旧分配、角色分配或绘图方案引用的模型不能直接停用或删除；更换主模型不会删除历史模型记录。供应商不能通过停用或更换不兼容协议绕过这些保护。

公共设置页保留「模型」「扩展服务」两个页签。模型页先列「供应商与模型」，包括暂未添加模型的供应商；每个供应商可再次编辑、获取目录、批量勾选或手动添加模型，随后设置常用模型和应用例外。连接协议、请求头等收进供应商的高级设置。旧连接和 ID 保留，不自动合并不同账户。

绘图模型也在这里添加。从模型菜单创建「文生图方案」或「参考图方案」，再到「生成方案」配置用途绑定与工作流。创建方案不会提交绘图请求，执行时复用供应商的最新连接、密钥、请求头和参数。ComfyUI 与 Windows Worker 仍通过工作流选择模型文件；不会将它们当成 OpenAI 模型目录接口。

扩展服务只默认展示「联网搜索」和「资料连接」。应用访问令牌收进「应用访问授权（高级）」，供外部应用接入时使用；内置模块的令牌由系统管理。资料连接的工具清单与诊断数据收进「连接详情」。

#### 联网搜索

- 管理设置：`GET|PUT /api/v1/admin/web-search/settings`，保存 `enabled`、`provider`、`anonymous` 与可选 `apiKey`。
- 测试、搜索与正文：`POST /api/v1/admin/web-search/test|search|extract`。
- 支持 `anysearch`、`exa`、`tavily`；旧请求省略供应商时保留当前选择，初次默认 Tavily 且停用。切入 AnySearch 默认匿名，只有显式启用并保存后才能调用。
- 三家密钥按供应商分别保存到安全凭据库，响应只返回来源与是否已配置。切换服务保留各自密钥；未保存的密钥输入在切换时清空，避免错存。
- 保存前只编辑草稿，测试与试搜始终使用已保存配置。正文最多选择 10 项，每项最多 20,000 字符；某项失败保留摘要与原因，不自动切换供应商或重试。

2026-11-15 核对的免费方案：

| 服务 | 免费方案 | 条件 |
| --- | --- | --- |
| [AnySearch](https://www.anysearch.com/pricing) | 每天 1,000 次，最高 10 QPS | 支持匿名，按客户端 IP 计量和限流，不是每位用户独享；搜索和有效正文提取分别计量。 |
| [Exa](https://exa.ai/pricing) | 每月 10 美元额度及 10 美元开户奖励 | 需要 API Key，金额额度不等同于固定调用次数。 |
| [Tavily](https://www.tavily.com/pricing) | 每月 1,000 API credits | 需要 API Key，不同接口消耗不同。 |

额度与规则可能变更，以对应服务账户和官方说明为准。当前工作树实现与本地部署状态见[供应商与搜索交付记录](development/reviews/2026-11-15-suppliers-search-unification.md)。

#### 模型路由 API

- `GET /api/v1/admin/model-routes`：读取公共与应用路由。
- `PUT /api/v1/admin/model-routes`：保存公共或应用路由；`fallbackModelIds` 最多两个。
- `DELETE /api/v1/admin/model-routes/apps/:appId/:capability`：删除应用覆盖，恢复继承公共链。
- `POST /api/v1/admin/model-routes/apply-public`：按能力清除全部应用覆盖。

#### 安全状态查询 (`GET /api/v1/app/config`)

- 鉴权方式：`Authorization: Bearer <app-token>`，要求 `llm` 能力。
- 返回结构：返回应用信息与各角色绑定模板的安全摘要（包含 `profileId`、`name`、`model`、`ready`、`updatedAt`）及总体 `ready` 状态。
- **敏感信息隔离**：该接口绝不向应用客户端返回 API Key、Authorization 头、供应商 Base URL、自定义 headers 或 extraBody。
- 错误状态：无效令牌返回 401 `invalid_app_token`；无权限返回 403 `capability_denied`；未绑定角色返回 `null` 且 `ready: false`。

#### 标准 OpenAI 兼容调用 (`POST /v1/chat/completions`)

- 网关自动识别或根据 `X-SthStart-Model-Role` 请求头路由到应用的 `text` 或 `multimodal` 绑定模板。
- **模板强制生效**：请求体中的 `model` 始终由绑定模板的模型覆盖；`thinkingMode`（`enabled` / `disabled` / `omit`）由模板强制决定，客户端无法通过请求体参数绕过模板思考策略。
- **业务参数保留**：客户端传入的 `messages`、`stream`、`temperature`、`response_format`、`max_tokens` 等业务字段正常透传；模板的 `extraBody` 作为默认参数底色。
- **错误语义明确**：同时支持 JSON 与 SSE 流式响应。公共服务或上游报错（如 502/503）直接向应用传递，托管模式下不进行隐式本地降级。

#### 未来应用的标准接入流程

1. 注册一个带 `llm` 能力的应用，并安全保存应用令牌。
2. 在 SthStart 公共服务设置中先选定公共常用文本/看图模型，需要时为该应用添加例外。
3. 应用启动或设置页通过 `GET /api/v1/app/config` 展示当前绑定状态；该请求只使用服务端保存的应用令牌。
4. 应用使用同一令牌调用 OpenAI 兼容的 `POST /v1/chat/completions`，不要自行复制供应商凭据、Base URL、模型或思考模式。

本轮不新增 TypeScript SDK；创作笔记和叙事档案仅保留模板分配能力，待后续业务接入时复用这套流程。

### 向量

- `POST /api/v1/vector/embed`
- `POST /api/v1/vector/search`
- `POST /api/v1/vector/upsert`
- `POST /api/v1/vector/upsert-batch`
- `POST /api/v1/vector/delete`
- `POST /api/v1/vector/delete-by-conversation`

普通 `namespace` 会映射为 `app:<app-id>:<namespace>`；客户端无法伪造其他应用前缀。`shared:*` 只有管理员创建读/写授权后可访问，并且 `purpose: "memory"` 永远不能使用共享空间。

### 中央媒体库 (Artifact 2.0)

- `POST /api/v1/artifacts/uploads`：原始二进制流式上传协议（通过 `Content-Type`、`Content-Length`、`X-Artifact-Original-Name`、`X-Artifact-Ref-Type`、`X-Artifact-Ref-Id` 请求头驱动，边传边计算真实字节与 SHA-256，不使用全量内存缓存）。
- `GET|HEAD /api/v1/artifacts/:id`：流式分发入口，支持 Bearer 令牌鉴权或绑定 app 的短时签名 URL，支持 `HEAD`、`Accept-Ranges`、单区间 `Range` (206)、`ETag`、`If-None-Match` (304) 与 `416 Range Not Satisfiable`。
- `POST|DELETE /api/v1/artifacts/:id/grants`：跨应用显式授权（支持 `read` / `reference` 权限与过期时间），防止跨应用越权。
- `POST|DELETE /api/v1/artifacts/:id/references`：建立/解除引用关系（笔记、角色等），受引用的产物受系统级保护，不会被配额清理淘汰。
- `PUT /api/v1/artifacts/:id/pin` & `DELETE /api/v1/artifacts/:id`：产物固定与删除管理。

#### 存储配额与巡检策略
- **全局 50 GiB 媒体配额**：默认总配额为 50 GiB，支持通过环境变量 `STHSTART_ARTIFACT_MAX_BYTES`（1 GiB ~ 10 TiB）自定义。超限时按最旧优先策略淘汰未固定、无引用且非进行中任务的文件；无法腾出空间时返回 `artifact_quota_exceeded`。
- **启动巡检 (Reconciliation)**：服务启动时在后台自动执行，清理历史残留临时文件，标记数据库缺失文件，安全隔离/清理无主孤儿文件。
- **备份清单 (Manifest)**：`npm run db:backup` 在备份数据库的同时输出 `media-manifest.json`，记录全部产物 SHA-256、相对路径与就绪状态，明确媒体原件独立存储。

### 图片任务与工作流 (兼容接口)

- `GET|POST /api/v1/admin/workflows` 管理命名工作流
- `POST /api/v1/images/tasks`，必须带 `Idempotency-Key`
- `GET /api/v1/images/tasks/:id`
- `POST /api/v1/images/tasks/:id/cancel`
- `DELETE /api/v1/images/tasks/:id`
- `GET|HEAD /api/v1/images/artifacts/:id`（兼容旧版签名，内部全面流式化）

任务可以直接携带 `workflow`，也可以引用中央管理的 `workflowId`。服务在 ComfyUI 接受任务后保存任务 ID。完成时将产物以流式安全写入 SthStart 中央媒体库，再返回五分钟有效的签名 URL。保留策略支持永久保留、TTL 和按应用配额；置顶与受引用产物不会自动清理。

#### Windows Worker（阶段七）

Windows Worker 是一层无状态的 Windows/RTX 桥接服务，SthStart 只保存 Worker 的地址、非敏感设置和凭据库账户；Worker token 只在创建或轮换时通过一次性的管理员响应显示，随后不出现在列表、健康检查或任务响应中，也不进入数据库。Worker 固定单任务并发，底层 ComfyUI 仍只接收经过 SthStart 校验的 API 工作流。

- `GET /health`：返回就绪状态、模型/温度、队列、运行任务和磁盘阈值，不返回 token 或 ComfyUI 凭据。
- `POST /v1/worker/tasks`：按 SthStart 的 `taskId` 幂等接收工作流和输出声明。
- `PUT /v1/worker/tasks/:taskId/input/:uploadId`：接收原始图片字节，校验 `Content-Length` 与 `X-Artifact-SHA256`，文件名由 Worker 按 upload ID 生成。
- `GET /v1/worker/tasks/:taskId/status`：查询任务状态；`GET /v1/worker/tasks/:taskId/output/:outputId`：读取已完成产物。
- `POST /v1/worker/tasks/:taskId/confirm`：SthStart 将产物流式保存并校验后调用，Worker 才删除输入和输出文件。

在 Worker 机器上复制 `workers/windows-worker/windows-worker.env.example` 的配置，至少设置一个长度不低于 32 位的 `WORKER_TOKEN`。`WORKER_MODEL_DIR` 用于挂载 ComfyUI 模型目录，`WORKER_DATA_DIR` 只用于任务清单、输入和输出临时文件；`WORKER_MAX_TEMP_BYTES` 限制后者的累计占用，`WORKER_DISK_WARNING_BYTES` / `WORKER_DISK_STOP_BYTES` 分别定义磁盘告警与停止阈值。并发固定为 1，Worker 不会自动下载模型或替你启动 ComfyUI，因此 ComfyUI 及模型目录必须在 Windows/RTX 机器上单独准备好。跨机器使用时将 `WORKER_HOST` 设为可访问地址、在 `WORKER_ALLOWED_IPS` 填入 SthStart 主机 IP/CIDR，并同时配置 Windows 防火墙；不要把 Worker 端口直接暴露到公网。启动命令为：

```bash
cd workers/windows-worker
npm start
```

Worker 会把任务清单放在 `WORKER_DATA_DIR/tasks`，重启时自动恢复排队任务和已有上游任务的轮询；提交状态不确定的任务标记为 `abandoned`，绝不自动重复提交。未确认的成功产物会保留，便于 SthStart 恢复或人工处理。Worker 健康响应还会报告模型目录是否可用、临时目录占用与上限。达到临时空间上限或最低剩余磁盘阈值时，新的输入会被拒绝，排队任务会明确失败。Worker 与底层 ComfyUI 不可达时，错误会返回给 SthStart，公共生成链不会静默切换到其他引擎。

#### 实验性视频能力

H3 FL2VA 当前只提供真实 Worker 就绪探测，默认关闭且没有公共生成入口。启用方式、硬限制和延期的 Ref2VA、云端 H3、2K 评估项见 [`docs/EXPERIMENTAL_MEDIA.md`](EXPERIMENTAL_MEDIA.md)。RTX 3080 12 GB 不视为已经验证的运行保证。

#### 媒体诊断

- `GET /api/v1/admin/media/diagnostics`：管理员诊断 `ffmpeg`、`ffprobe` 和 H3 FL2VA 的实际就绪状态。
- `ffmpeg/ffprobe` 缺失时，设置页只显示人工安装提示；SthStart 不会自动安装软件，也不会因此停止图片服务。
- 视频元数据、缩略图和播放预处理只有在两个工具都可用时才允许开启。

### 角色模板

- `GET /api/v1/personas`
- `GET /api/v1/personas/:id/versions`
- `POST /api/v1/personas/:id/import`
- `GET|POST /api/v1/app-personas`
- `POST /api/v1/app-personas/:localId/upgrade`

模板版本不可变。导入会复制固定版本快照，后续更新必须由应用显式调用 upgrade。应用手工角色只留在应用命名空间；发布为平台模板需要显式管理操作。模板只包含名称、人格提示词、外观提示词、头像引用、标签、来源和通用 metadata，不包含邻舍领域数据。

### 通用生成任务核心 (Generation Core & Task Lifecycle)

 - `POST /api/v1/generation/tasks`：创建生成任务（要求 `generation` capability 与 `Idempotency-Key` 请求头）。由服务端按应用绑定的用途 (`purpose`，默认 `default`) 统一解析已授权的工作流版本与引擎；普通客户端禁止指定未授权的 workflowId/workflowVersion（若指定将返回 `workflow_assignment_managed`），客户端只提供业务参数输入，不传递任意外部 URL 或本地路径。
- `GET /api/v1/generation/tasks/:id`：查询任务状态与产出 artifacts（应用数据完全隔离）。
- `POST /api/v1/generation/tasks/:id/cancel`：安全取消任务（排队中删除对应队列项，运行中标记 `abandoned` 且不调用全局中断）。
- `POST /api/v1/generation/tasks/:id/retry`：基于历史任务输入重试生成，创建新任务并保留 `retryOf` 追溯关联。
- `GET /api/v1/generation/events`：隔离的 SSE 事件流，支持 `Last-Event-ID` 断线续传、持久化事件回放与心跳维持。

#### 任务状态流转与安全保障
1. 状态生命周期：`queued -> submitting -> accepted -> running -> succeeded | failed | cancelled | abandoned`。
2. **提交不确定性保护**：当向上游提交任务发生网络超时等未决错误时，任务状态置为 `abandoned`，错误码标记为 `submission_outcome_unknown`，严格禁止自动重复提交以避免重复扣费/渲染。
3. **幂等与冲突判定**：同一应用的同一幂等键，完全相同的输入参数返回已有任务；不同参数明确返回 409 `idempotency_conflict`。
4. **工作流安全要求**：仅接受 ComfyUI API 格式 JSON；直接拒绝 UI 导出的含 nodes 数组的 GUI 格式。发布版本不可变，被任务引用后不可被覆盖。导入内容不得包含 API key、token、secret、password、credential 或带账号密码的 URL。

## 邻舍渐进迁移

根目录 `.env` 是 SthStart 集成配置的单一来源：

```dotenv
STHSTART_APP_TOKEN=sth_app_...
STHSTART_VECTOR_PROFILE=linshe-vector
# 托管图片调用使用的 Generation 用途，需在公共服务中绑定
STHSTART_GENERATION_PURPOSE=linshe-chat-image
# 旧版图片 Profile 仅供兼容接口
STHSTART_IMAGE_PROFILE=local-comfy
STHSTART_PUBLIC_LLM=true
STHSTART_PUBLIC_VECTOR=false
STHSTART_PUBLIC_IMAGE=false
```

图片公共服务开关为独立设置，**默认 `false`**：邻舍默认使用自己的 ComfyUI 生图，项目托管启动与控制中心开关都不会自动把它切到 SthStart 网关。只有在已经配置图片工作流绑定、且明确希望邻舍走 SthStart Generation 网关时才在控制中心打开「邻舍生图使用 SthStart 公共网关」（或对独立运行显式设置 `STHSTART_PUBLIC_IMAGE=true`）。开启后公共图片请求是单一调用链：公共服务不可达、Worker 不可用或上游返回错误时直接向用户报告，不会自动转投邻舍本地 ComfyUI；旧配置中的 `STHSTART_PUBLIC_IMAGE_FALLBACK` 不再改变这一行为。

关闭该开关时，邻舍生图不进入 SthStart 的生成队列与 AI 调用日志，且托管就绪检查不会要求 `linshe-chat-image` 绑定；邻舍与活动仍共用同一个 ComfyUI 实例和显存。

独立使用 `dev:all` 时，`STHSTART_APP_TOKEN` 应保持为稳定的高熵令牌；通过 SthStart 控制中心托管邻舍时，公共服务会把当前令牌自动注入邻舍进程。

### 邻舍托管模式与独立运行模式

1. **托管模式 (`STHSTART_PUBLIC_LLM=true`)**：
   - 邻舍启动时接收 `STHSTART_PUBLIC_LLM=true` 与 `STHSTART_APP_TOKEN`。
   - 图片网关是独立开关，默认关闭：控制中心「邻舍生图使用 SthStart 公共网关」决定是否下发 `STHSTART_PUBLIC_IMAGE=true`。
   - 邻舍设置页展示当前绑定的文本/多模态模板信息、模型 ID、连接状态及返回 SthStart 的控制台入口。
   - 邻舍本地 LLM 编辑器被屏蔽，任何本地配置写操作（包括 API Key、Base URL、免费鸡蛋开关、Profile 切换与新增）均直接拒绝（返回 403 `llm_managed_by_sthstart`）。
   - 邻舍所有对话和文本/生图辅助调用严格走 SthStart 公共网关，不发生隐式本地 Provider 回退。
   - SthStart 的密钥、Base URL 和模型配置仅保存在 SthStart 端，不向邻舍前端或邻舍 SQLite 复制。

2. **独立运行模式 (`STHSTART_PUBLIC_LLM=false`)**：
   - 邻舍保留其完整的本地设置能力，包括自有 DeepSeek/OpenAI 兼容配置、多套本地 Profile 管理和每日免费鸡蛋。
   - 邻舍在独立模式下直接调用本地配置的 API，与公共服务底座解耦。

## Fork 同步

邻舍适配修改只存在 Fork 的 `lark` 分支。上游 `main` 继续自动同步，之后通过 `main → lark` PR 处理冲突；SthStart 只更新通过验证的 Submodule 指针。由于上游当前未提供许可证，本仓库没有复制邻舍源码，适配仍保留在独立 Submodule 中。
