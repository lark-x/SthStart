# 叙事档案

叙事档案是 SthStart 内用于保存、回顾和研究既有剧情的本地应用，入口为 `/apps/narrative`。它与未来用于创作新剧情的编辑器保持独立。

## 数据边界

- `data/narrative.db` 保存作品、版本、任务树、场景、台词、实体、知识结论、来源和导入批次。
- 原始剧情通过来源连接器转换为统一的 `NarrativeImportBundle`，阅读时不直接依赖 MCP。
- 虚空终端 Story MCP 已接入为按需连接器，支持原神、崩坏：星穹铁道和崩坏 3。打开页面不会联网，只有主动搜索、读取和收藏才调用远端。
- JSON 连接器已经可用；同一来源、作品、版本和 `externalId` 重复导入会更新原记录而不是生成副本。
- 上游缺失内容不会自动删除，本地人工知识也不会被同步覆盖。

## JSON 导入契约

根对象必须使用 `schemaVersion: 1`，并包含：

- `source`：稳定来源 ID、名称、`json | mcp` 类型和可选版本。
- `work`：来源内作品 ID、标题、简介和语言。
- `release`：作品内版本 ID 和显示名称。
- `nodes`：可递归的章节、任务或任意叙事节点。
- `scenes`：通过 `nodeExternalId` 关联节点。
- `utterances`：通过 `sceneExternalId` 关联场景，支持 `dialogue`、`narration`、`choice`、`system`。
- `entities`：可选的角色、地点、组织、物品、事件、概念或自定义类型。

应用的导入工作台内置一份可直接修改并验证的完整示例。所有数组内的 `externalId` 必须唯一，引用必须在同一导入包内存在。

## 管理 API

- `GET /api/v1/admin/narrative/connectors`
- `POST /api/v1/admin/narrative/connectors/:id/probe`
- `POST /api/v1/admin/narrative/connectors/akasha-mcp/search`
- `POST /api/v1/admin/narrative/connectors/akasha-mcp/read`
- `POST /api/v1/admin/narrative/connectors/akasha-mcp/imports/preview`
- `POST /api/v1/admin/narrative/imports/preview`
- `POST /api/v1/admin/narrative/imports/:id/commit`
- `DELETE /api/v1/admin/narrative/imports/:id`
- `GET /api/v1/admin/narrative/works`
- `GET /api/v1/admin/narrative/works/:id/tree`
- `GET /api/v1/admin/narrative/nodes/:id/read`
- `GET /api/v1/admin/narrative/works/:id/entities`
- `GET /api/v1/admin/narrative/search?q=...&workId=...`
- `GET /api/v1/admin/narrative/claims`
- `PUT /api/v1/admin/narrative/claims/:id`
- `POST /api/v1/admin/narrative/utterances/:id/to-note`

这些接口全部经过门户 `/api/admin/*` BFF，浏览器不会取得管理令牌。

## 接入新的 MCP 或作品

新作品不增加核心表字段，而是增加一个连接器，将来源内容映射为统一导入包。连接器需要先声明是否具备枚举、分页、稳定 ID、增量、多语言、分支和实体能力。只有能够枚举完整内容的来源可作为档案来源；只有搜索或问答工具的 MCP 应标记为辅助检索来源。

Akasha 适配器只保留搜索结果中的文档信息，主动丢弃体积较大的派生知识图谱。`pathHash` 作为稳定外部 ID；收藏时通过 `akasha_read` 分页读取完整文档，再进入与 JSON 相同的差异预览和确认流程。百科整理标为二级来源，其他游戏文本默认标为原始资料，后续仍可继续细化文档类型白名单。

自动测试使用固定模拟响应，不请求真实 MCP。远端地址和超时通过 `STHSTART_AKASHA_MCP_URL`、`STHSTART_MCP_TIMEOUT_MS` 配置。
