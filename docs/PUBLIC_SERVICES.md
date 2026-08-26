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

- `GET /v1/models`
- `POST /v1/chat/completions`
- 可选请求头：`X-SthStart-Model-Role: text|multimodal`
- 每个接入应用必须在公共服务设置中分别选择文本模型和多模态模型。标准 OpenAI 图片内容会自动走多模态模型；请求头可用于无法自动识别的请求。
- 网关会覆盖客户端请求体中的 `model`，确保使用该应用当前选择的配置。没有分配对应模型时返回 `llm_profile_not_assigned`，不会随机选择其他模型。
- 同时支持 JSON 与 SSE streaming。公共服务返回的配置或上游错误会直接展示；只有公共服务本身发生传输层故障时，邻舍才会回退到原供应商。

管理页面可以从兼容接口的 `/models` 获取模型列表，也允许手动输入。每个模型由用户标记 `text`、`multimodal` 或两者；复制配置会创建独立的地址、请求参数和系统凭据副本。

### 向量

- `POST /api/v1/vector/embed`
- `POST /api/v1/vector/search`
- `POST /api/v1/vector/upsert`
- `POST /api/v1/vector/upsert-batch`
- `POST /api/v1/vector/delete`
- `POST /api/v1/vector/delete-by-conversation`

普通 `namespace` 会映射为 `app:<app-id>:<namespace>`；客户端无法伪造其他应用前缀。`shared:*` 只有管理员创建读/写授权后可访问，并且 `purpose: "memory"` 永远不能使用共享空间。

### 图片

- `GET|POST /api/v1/admin/workflows` 管理命名工作流
- `POST /api/v1/images/tasks`，必须带 `Idempotency-Key`
- `GET /api/v1/images/tasks/:id`
- `POST /api/v1/images/tasks/:id/cancel`
- `DELETE /api/v1/images/tasks/:id`
- `PUT /api/v1/images/artifacts/:id/pin`
- `DELETE /api/v1/images/artifacts/:id`

任务可以直接携带 `workflow`，也可以引用中央管理的 `workflowId`。服务在 ComfyUI 接受任务后保存任务 ID。完成时将产物下载到 SthStart，再返回五分钟有效的签名 URL。保留策略支持永久保留、TTL 和按应用配额；置顶产物不会自动清理。邻舍只有在尚未取得公共任务 ID 时才会回退到直连 ComfyUI。

### 角色模板

- `GET /api/v1/personas`
- `GET /api/v1/personas/:id/versions`
- `POST /api/v1/personas/:id/import`
- `GET|POST /api/v1/app-personas`
- `POST /api/v1/app-personas/:localId/upgrade`

模板版本不可变。导入会复制固定版本快照，后续更新必须由应用显式调用 upgrade。应用手工角色只留在应用命名空间；发布为平台模板需要显式管理操作。模板只包含名称、人格提示词、外观提示词、头像引用、标签、来源和通用 metadata，不包含邻舍领域数据。

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

LLM 生效模型不再通过 `STHSTART_LLM_PROFILE` 选择，而是在“公共服务设置 → 应用生效模型”中按应用配置。升级时若旧环境变量与应用令牌能够明确对应，公共服务会只迁移一次原文本模型选择。

建议按 LLM → 向量 → 图片依次开启。关闭 LLM 公共服务开关即可恢复邻舍原路径。ComfyUI 不再是邻舍启动的前置条件；它离线时仅图片能力不可用。

## Fork 同步

邻舍适配修改只存在 Fork 的 `lark` 分支。上游 `main` 继续自动同步，之后通过 `main → lark` PR 处理冲突；SthStart 只更新通过验证的 Submodule 指针。由于上游当前未提供许可证，本仓库没有复制邻舍源码，适配仍保留在独立 Submodule 中。
