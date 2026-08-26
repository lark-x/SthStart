# SthStart 公共服务

## 边界

公共服务只负责可复用的基础能力：LLM 转发、向量计算与检索、图片任务与产物、通用角色模板。邻舍的长期记忆、情绪、关系、梦境、动态、事件、日程、主动聊天、信箱和群聊行为始终由邻舍管理，不写入 SthStart。

服务强制监听 `127.0.0.1`、`::1` 或 `localhost`。元数据保存在 `data/sthstart.db`，图片字节保存在 `data/artifacts/<app-id>`；两者都已被 Git 忽略。这里使用本机 SQLite 和文件系统是因为当前产品明确是本地多应用服务，并非 Sites 托管的数据层。

## 身份与密钥

- 应用请求：`Authorization: Bearer <app-token>`。令牌为 256 位随机值，SQLite 只保存 SHA-256 摘要；明文只在创建或轮换时返回一次。
- 管理请求：`X-SthStart-Admin-Token`。门户通过 `/api/admin/*` 服务端 BFF 注入，客户端 bundle 和浏览器响应不会包含它。
- 供应商密钥：保存到操作系统凭据库。Profile ID `deepseek-main` 对应的环境变量回退名为 `STHSTART_SECRET_DEEPSEEK_MAIN`。
- `cross-keychain` 的 `file` 与 `null` 后端被明确排除；没有安全后端时，设置页会显示只能使用环境变量。

## API

### LLM

- `GET /api/v1/app/config`
- `GET /v1/models`
- `POST /v1/chat/completions`
- 可选请求头：`X-SthStart-Model-Role: text|multimodal`

#### 核心概念：LLM 模板与角色绑定

公共 LLM 服务采用 **「LLM 模板 → 应用角色绑定 → 应用调用」** 分层架构：
1. **LLM 模板库 (`provider_profiles`)**：定义完整、共享、可变的上游配置模板（API Base URL、系统凭据库账户、模型 ID、思考模式 `thinkingMode`、自定义请求头 `headers` 与默认请求体参数 `extraBody`，以及能力标签 `text` / `multimodal`）。修改模板内容后，所有绑定该模板的应用发起的新请求即时生效。
2. **应用角色绑定 (`app_llm_assignments`)**：每个应用按角色（`text` 文本对话角色、`multimodal` 图文多模态角色）分别绑定对应的模板。系统不存在隐式全局默认模型；当应用调用未绑定的角色时，网关明确返回 503 `llm_profile_not_assigned` 错误。
3. **使用中保护**：已被应用绑定的模板受到保护，禁止直接停用、删除或移除正在使用的能力标签，必须先在应用绑定中换绑。

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
2. 在 SthStart 公共服务设置中，为该应用分别绑定文本和多模态 LLM 模板。
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

### 角色模板

- `GET /api/v1/personas`
- `GET /api/v1/personas/:id/versions`
- `POST /api/v1/personas/:id/import`
- `GET|POST /api/v1/app-personas`
- `POST /api/v1/app-personas/:localId/upgrade`

模板版本不可变。导入会复制固定版本快照，后续更新必须由应用显式调用 upgrade。应用手工角色只留在应用命名空间；发布为平台模板需要显式管理操作。模板只包含名称、人格提示词、外观提示词、头像引用、标签、来源和通用 metadata，不包含邻舍领域数据。

### 通用生成任务核心 (Generation Core & Task Lifecycle)

- `POST /api/v1/generation/tasks`：创建生成任务（要求 `generation` capability 与 `Idempotency-Key` 请求头）。支持按应用绑定的用途 (`purpose`) 或显式指定工作流版本，客户端只提供业务参数输入，不传递任意外部 URL 或本地路径。
- `GET /api/v1/generation/tasks/:id`：查询任务状态与产出 artifacts（应用数据完全隔离）。
- `POST /api/v1/generation/tasks/:id/cancel`：安全取消任务（排队中删除对应队列项，运行中标记 `abandoned` 且不调用全局中断）。
- `POST /api/v1/generation/tasks/:id/retry`：基于历史任务输入重试生成，创建新任务并保留 `retryOf` 追溯关联。
- `GET /api/v1/generation/events`：隔离的 SSE 事件流，支持 `Last-Event-ID` 断线续传、持久化事件回放与心跳维持。

#### 任务状态流转与安全保障
1. 状态生命周期：`queued -> submitting -> accepted -> running -> succeeded | failed | cancelled | abandoned`。
2. **提交不确定性保护**：当向上游提交任务发生网络超时等未决错误时，任务状态置为 `abandoned`，错误码标记为 `submission_outcome_unknown`，严格禁止自动重复提交以避免重复扣费/渲染。
3. **幂等与冲突判定**：同一应用的同一幂等键，完全相同的输入参数返回已有任务；不同参数明确返回 409 `idempotency_conflict`。
4. **工作流安全要求**：仅接受 ComfyUI API 格式 JSON；直接拒绝 UI 导出的含 nodes 数组的 GUI 格式。发布版本不可变，被任务引用后不可被覆盖。

## 邻舍渐进迁移

根目录 `.env` 是 SthStart 集成配置的单一来源：

```dotenv
STHSTART_APP_TOKEN=sth_app_...
STHSTART_VECTOR_PROFILE=linshe-vector
STHSTART_IMAGE_PROFILE=local-comfy
STHSTART_PUBLIC_LLM=true
STHSTART_PUBLIC_VECTOR=false
STHSTART_PUBLIC_IMAGE=false
```

独立使用 `dev:all` 时，`STHSTART_APP_TOKEN` 应保持为稳定的高熵令牌；通过 SthStart 控制中心托管邻舍时，公共服务会把当前令牌自动注入邻舍进程。

### 邻舍托管模式与独立运行模式

1. **托管模式 (`STHSTART_PUBLIC_LLM=true`)**：
   - 邻舍启动时接收 `STHSTART_PUBLIC_LLM=true` 与 `STHSTART_APP_TOKEN`。
   - 邻舍设置页展示当前绑定的文本/多模态模板信息、模型 ID、连接状态及返回 SthStart 的控制台入口。
   - 邻舍本地 LLM 编辑器被屏蔽，任何本地配置写操作（包括 API Key、Base URL、免费鸡蛋开关、Profile 切换与新增）均直接拒绝（返回 403 `llm_managed_by_sthstart`）。
   - 邻舍所有对话和文本/生图辅助调用严格走 SthStart 公共网关，不发生隐式本地 Provider 回退。
   - SthStart 的密钥、Base URL 和模型配置仅保存在 SthStart 端，不向邻舍前端或邻舍 SQLite 复制。

2. **独立运行模式 (`STHSTART_PUBLIC_LLM=false`)**：
   - 邻舍保留其完整的本地设置能力，包括自有 DeepSeek/OpenAI 兼容配置、多套本地 Profile 管理和每日免费鸡蛋。
   - 邻舍在独立模式下直接调用本地配置的 API，与公共服务底座解耦。

## Fork 同步

邻舍适配修改只存在 Fork 的 `lark` 分支。上游 `main` 继续自动同步，之后通过 `main → lark` PR 处理冲突；SthStart 只更新通过验证的 Submodule 指针。由于上游当前未提供许可证，本仓库没有复制邻舍源码，适配仍保留在独立 Submodule 中。
