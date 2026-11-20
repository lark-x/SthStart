# AI 创作系统外部 Agent 接口

`server.ts` 启动时注册创作编排路由和外部 Agent 桥接，关闭时释放编排 runtime。grant SQL 位于 `agent-migration.ts`，由 `database.ts` 的迁移 65 登记 `co_*` 表。

## 安全边界

外部 Agent 使用一次性创建的 scoped grant。grant 只允许四项能力：`read`、`propose`、`run`、`stop`。它不能批准人工审核、正式采用、发布、修改或撤销 grant、提高预算、读取全局供应商秘密，也不能绕过工作流中的审批和采用节点。

所有 `/api/v1/creative-agent/*` 请求只要带有 `Origin` 就返回 403，避免浏览器复用 Agent 凭据。grant 只通过 `Authorization: Bearer ...` 传递。管理员创建和撤销 grant 只使用 `x-sthstart-admin-token` 和 `authenticateAdmin`；Bearer grant 不能代替管理员凭据。

## Grant 生命周期

管理员创建 grant：

```http
POST /api/v1/creative-agent/grants
x-sthstart-admin-token: <ADMIN_TOKEN>
content-type: application/json

{
  "name": "外部创作 Agent",
  "scope": {
    "workName": "作品名",
    "worldId": null,
    "branchId": null,
    "projectId": null
  },
  "permissions": ["read", "propose", "run", "stop"],
  "expiresAt": "<future ISO timestamp>",
  "budget": {
    "maxTextCalls": 8,
    "maxImages": 4,
    "maxTokens": 20000,
    "maxRevisions": 2
  }
}
```

响应中的 `token` 只在本次创建响应返回。数据库只保存其 SHA-256 `token_hash`，接口和 MCP 不提供再次读取 token 的管理工具。凭据遗失时撤销旧 grant 并重新创建。

撤销是幂等的：

```http
DELETE /api/v1/creative-agent/grants/:grantId
x-sthstart-admin-token: <ADMIN_TOKEN>
```

未知、过期或已撤销的 grant 返回 401；缺少当前方法所需权限返回 403。

迁移 65 由根服务登记 `CREATIVE_AGENT_GRANT_STATEMENTS`，表字段固定为：

```text
co_agent_grants(
  id, name, scope_json, permissions_json, budget_json, usage_json,
  token_hash, expires_at, revoked, created_at
)
```

bridge 不在启动时迁移真实数据库，也不写入生产 grant。

## 范围规则

grant 和 run 都必须至少有 `workName`、`worldId`、`projectId` 之一。只有 `branchId` 不算可识别范围。`workName` 在比较前 trim，ID 保持原值。

run 可以完全匹配 grant，或使用更窄的子集。grant 中非 null 的维度必须与 run 完全一致；grant 中 null 的维度表示该维度不受限制，不会放宽其他已约束维度。列表只返回落在 grant 范围内的运行；详情和停止还要求该 run 由当前 grant 的幂等预留记录拥有，避免跨凭据读取同一作品下的内部运行。

## 累计预算

`budget_json` 是 grant 的总可用上限，`usage_json` 的 `textCalls`、`images`、`tokens` 记录已累计预留量。创建外部 run 前，bridge 在同一个 SQLite 事务里按 `CreativeStartRun.budget.maxTextCalls/maxImages/maxTokens` 预留完整运行包络：

- 不同的 run 不能通过重复提交绕过 grant 总预算。
- 同一 `idempotencyKey` 的相同请求重放原 run，不重复扣预留。
- 同一 key 对应不同请求返回 409。
- 执行器失败且没有创建 run 时退回该次预留。
- 如果 run 已落库但唤醒响应失败，预留保留并绑定已有 run，避免退款后形成可执行但不受 grant 计量的任务。
- `maxRevisions` 是每次 run 不能超过 grant 上限的返修上限，不按次数累计。

运行自身的 `CreativeRun.usage` 仍由执行器按真实调用维护；grant 使用量是防止无限启动运行的额度账本，两者不能互相替代。

## HTTP 方法

除管理员 grant 方法外，以下请求都使用：

```http
Authorization: Bearer <SCOPED_GRANT_TOKEN>
```

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/creative-agent/runs` | `read` | 列出 grant 范围内运行 |
| GET | `/api/v1/creative-agent/runs/:runId` | `read` | 读取 grant 拥有的运行详情 |
| POST | `/api/v1/creative-agent/context` | `read` | 读取 scope 的真实创作上下文与 hash |
| POST | `/api/v1/creative-agent/propose` | `propose` | 返回对话式工作流建议 |
| POST | `/api/v1/creative-agent/candidates` | `propose` | 提交直接外部候选到统一审核 |
| POST | `/api/v1/creative-agent/runs` | `run` | 固定工作流版本并创建持久运行 |
| POST | `/api/v1/creative-agent/runs/:runId/stop` | `stop` | 停止 grant 拥有的运行 |

`propose` 只生成建议，不执行工作流、不产生正式内容、不代表人工批准，也不能作为外部场景候选直接入稿。创建运行必须携带已发布工作流版本、范围、完整预算和稳定幂等键。重复提交使用同一个幂等键。

外部 Agent 的 `propose` 只能使用 advisory 语义。携带 `mode: "ai"`、预算或运行幂等键会返回 403；AI 总管必须由站内管理员通过对话运行入口显式启动。外部 grant 也不能通过 `start_run` 指向总管模板。

所有响应设置 `cache-control: no-store` 和 `pragma: no-cache`。错误不返回 token hash、管理员凭据、供应商秘密或全局配置。

## 管理员岗位模板

管理员可以从服务端固定模板派生非核心岗位：

```http
POST /api/v1/admin/creative-orchestration/roles/from-template
x-sthstart-admin-token: <ADMIN_TOKEN>
content-type: application/json

{
  "templateId": "research_specialist",
  "id": "world_lore_researcher",
  "name": "世界考据员",
  "modelId": "optional-profile-id"
}
```

`capability`、职责与初始 `tools` 来自 `DEFAULT_CREATIVE_ROLES`；派生岗位固定 `core: false`，请求不能夹带并改写这些字段。后续保存岗位可以调整已登记工具，但现有 `knowledge_search` 与 `web_search` 声明会保留，实际运行仍拒绝尚未接入适配器的工具。

## 范围自动审批策略

审批策略只允许管理员读取和更新。GET 使用 URL 编码的 scope JSON，避免在浏览器日志中发送 GET body；仍在服务端支持经过 schema 校验的 body：

```text
GET /api/v1/admin/creative-orchestration/scope-policy?scope=<url-encoded JSON Scope>
```

更新使用 CAS；`expectedRevision: 0` 表示创建首版，之后必须提交当前 revision：

```http
PUT /api/v1/admin/creative-orchestration/scope-policy
x-sthstart-admin-token: <ADMIN_TOKEN>
content-type: application/json

{
  "scope": {
    "workName": "作品名",
    "worldId": "world-id",
    "branchId": "branch-id",
    "projectId": null
  },
  "expectedRevision": 0,
  "policy": {
    "schemaVersion": 1,
    "enabled": true,
    "kind": "ordinary_image",
    "allowedSceneArtifactIds": ["adopted-scene-artifact-id"]
  }
}
```

每个白名单场景在保存时和自动审批时都要同时满足：artifact 仍是 live scene、状态为 `accepted`、内容 hash 有效、内容 scope 与策略 scope 一致，并存在 `co_scene_adoptions` 正式采用记录。缺策略、停用策略、非普通图片、已有审核失败或审批包变化都会关闭自动审批。

## AI 总管对话

`POST /conversations/message` 的 `mode: "ai"` 必须同时提供 `budget` 与稳定的 `idempotencyKey`。服务端在首次启动时发布并持久化固定的「AI 创作总管对话」模板，通过该模板的持久 workflow ID、已发布版本和完整 canonical document hash 判定总管例外，不能由一个普通节点自报身份获得全局 scope。

总管运行允许管理员在尚无世界或项目时使用 workName-only 或全空 global scope；普通故事、插图和 external Agent 仍要求可解析的作品/世界时间线/项目 scope。运行 input 中的对话、完整 workflow 目录和 Actions 目录全部由服务端构造，前端不能提供或替换。

直接 `POST /runs` 不能启动总管模板。`mode: "ai"` 会创建真实 `CreativeRun`、冻结 production manager 模型并返回 `runId`；对话中的 assistant message 只报告“运行已创建”和当前状态，实际 `answer`、`start_workflow` 提案或单动作提案从运行产物读取。每次模型动作仍需审批；`start_workflow` 只返回 `awaiting_budget_confirmation`，不自动启动另一个付费 run。

## 直接外部候选协议

外部 Agent 先用 `read` 权限读取真实上下文：

```json
{
  "scope": {
    "workName": "作品名",
    "worldId": null,
    "branchId": null,
    "projectId": null
  }
}
```

bridge 先验证 scope 包含在 grant 内，再调用 `handlers.readContext(scope)`。domain context 自带顶层 `contextHash`，其值必须是 `creativeHash(context 去掉 contextHash 字段后的 payload)`。桥只验证并原样传递这个 hash，不把完整 context 再哈希一次。单个上下文响应上限为 4 MiB。Agent 不得自行伪造或复用其他 scope 的 hash。

然后用 `propose` 权限提交 `scene`、`visual-brief` 或 `video-plan` 候选，并携带刚读取的 hash：

```json
{
  "idempotencyKey": "external_candidate_1",
  "scope": {
    "workName": "作品名",
    "worldId": null,
    "branchId": null,
    "projectId": null
  },
  "kind": "scene",
  "content": {
    "title": "候选场景"
  },
  "contextHash": "<SHA-256 of the context read by the Agent>"
}
```

bridge 执行 grant scope、`propose` 权限、输入 schema 与 256 KiB content 上限校验，然后调用根服务的 `service.submit(input)`。它不自行生成 artifact，也不写正式内容。`service.submit` 必须：

- 用当前服务的规范上下文按同一算法核对 `contextHash`，不能信任客户端声明或重新定义第二套 hash；
- 复用 creative store 的 candidate artifact、审批和安全校验链；
- 按 `idempotencyKey` 返回同一候选，拒绝同 key 不同内容；
- 将候选绑定 run/node/当前 revision，不直接写 accepted、approved、Story、StoryWorld、Generation 或 Publication；
- 让重要场景、基准图/关键图以及无法判断重要性的候选继续等待同一人工或服务策略审核。

安全回执只接受：

```json
{
  "candidate": {
    "id": "<candidate id>",
    "runId": "<run id>",
    "nodeRunId": "<node run id>",
    "kind": "scene",
    "status": "candidate",
    "contentHash": "<canonical SHA-256>",
    "contextHash": "<submitted SHA-256>",
    "createdAt": "<ISO timestamp>"
  },
  "review": {
    "required": true,
    "status": "pending"
  },
  "replayed": false
}
```

bridge 拒绝其他 status、未要求审核的回执，以及 kind/contextHash/contentHash 不一致的回执。新候选返回 201，同一幂等请求返回 200。`service.submit` 尚未接线或违反该回执时，端点不会伪造成功。

候选提交与审核执行必须分离：

- 只有 `propose` 权限也能保存候选，但不会创建 CreativeRun、不会调用 runtime、不会扣 text/image/token 预留。
- `review.status: pending` 只表示进入站内审核队列；启动审核必须由站内人工动作触发。
- 服务端将候选保存成 `paused` run，写入最小占位预算 `{ maxTextCalls: 1, maxImages: 0, maxTokens: 100, maxRevisions: 0 }`，且不写 `co_run_models`；提交不会隐式启动付费调用。
- 站内管理员通过 `POST /api/v1/admin/creative-orchestration/runs/:id/activate` 提交当前 `expectedRevision` 和真实预算。service 在同一 CAS 事务里冻结审核岗位模型并写 `co_run_models`，随后才调用 `runtime.resume`。普通 resume 对没有模型快照的候选返回 409。
- 同 key 不同内容必须 409，不得覆盖或创建第二个候选。请求 schema 禁止夹带 `budget`、`autoStart`、`status` 等执行字段。

## MCP stdio

`mcp-server.ts` 只调用固定服务器 URL 下的 Agent 路由：

```powershell
$env:STHSTART_SERVICE_URL = "http://127.0.0.1:4100"
$env:STHSTART_CREATIVE_AGENT_TOKEN = "<SCOPED_GRANT_TOKEN>"
node --import tsx/esm apps/service/src/creative-orchestration/mcp-server.ts
```

`STHSTART_CREATIVE_AGENT_SERVICE_URL` 是服务 URL 的兼容变量。MCP 不读取管理员 token，不开放任意 URL、文件、正式发布或 grant 管理参数。

工具只有：

- `list_runs`
- `get_run`
- `read_context`
- `creative.memory.facts`
- `creative.memory.entries`
- `propose_creative_run`
- `submit_candidate`
- `start_run`
- `stop_run`

没有 `approve`、`publish`、grant 管理、预算增加或正式采用工具；`submit_candidate` 只能生成等待统一审核的 candidate 回执。

`creative.memory.facts` 调用 `POST /api/v1/creative-agent/memory/facts`，分页读取当前世界时间线截至最新 tick 的事实索引。传入 `actorId` 时只返回 `knownBy` 或经 `heard` 来源验证的内容；不传时为导演全知视角。`creative.memory.entries` 调用 `POST /api/v1/creative-agent/memory/entries`，只读分页读取已正式采用的设定和伏笔。两者都需要 grant 的 `read` 权限，scope 必须落在 grant 范围内。

## 根服务接线

bridge 暴露：

```ts
registerCreativeBridge(
  app,
  config,
  store,
  {
    async startRun(input) {
      const run = store.startRun(input, roleSnapshot);
      runtime.wake(run.id);
      return run;
    },
    stopRun(id) {
      const run = store.getRun(id);
      if (!run) throw new Error('run not found');
      return runtime.cancel(id, run.revision);
    },
    propose(input) {
      return conversationAdapter.propose(input);
    },
    submitCandidate(input) {
      return service.submit(input);
    },
    readContext(scope) {
      return service.readContext(scope);
    },
    readMemoryFacts(scope, query) {
      return service.readMemoryFacts(scope, query);
    },
    readMemoryEntries(scope, options) {
      return service.readMemoryEntries(scope, options);
    },
  },
);
```

`runtime.start()` 只启动调度器，不是创建 run；创建仍由 `store.startRun` 完成。正式 Story、StoryWorld、Generation 和 Publication 写入只能经过统一适配器及人工采用链路。

服务侧另有：

- `CreativeService.startRun`：真实 context/scope 预检、图片 media 工作流发布与 image category 预检、递归 subworkflow 岗位模型冻结、run 与 `co_run_models` 同事务写入；幂等重试沿用原角色/model snapshot。
- `CreativeService.activateRun`：仅激活 paused 外部候选，CAS 更新预算与模型 snapshot。
- `CreativeService.recoverRun`：仅供管理员处理状态不明节点，映射到 `runtime.recover`。
- `CreativeService.message/conversation`：持久保存 `co_conversations/co_messages`，首版只做确定性 advisory，不调用模型。
- `CreativeService.submitCandidate`：用 `collectScopeContext(scope)` 的真实 hash、domain scene 校验、预完成候选和双审核工作流生成 paused run；同 key 不同内容返回 409。

预写通过 `input.candidateArtifactId` 关联真实父运行。service 只接受与当前 scope 一致、父运行处于 `waiting_approval`、候选为 candidate scene、且没有父预写链的记录，并把真实父 `parentRunId` 写入 `store.startRun`。bridge 不允许额外 parent 字段，也不会扩大 grant scope。

## 验证范围

定向测试使用内存 SQLite、临时 HTTP 服务和注入的 handler：

```powershell
node --import tsx/esm --test apps/service/src/creative-orchestration/bridge.test.ts
npx tsc -p apps/service/tsconfig.json --noEmit
```

测试覆盖一次性 token/hash、浏览器和全局凭据拒绝、范围与累计预算、运行归属、停止、建议不执行；候选还覆盖 propose-only 不启动 run/不扣预算、夹带执行字段、scope 越界、256 KiB 上限、同 key 异内容、伪 approved 回执，以及 stdio MCP 的方法、路径、请求体和禁止工具。它使用注入的 `service.submit` 测试桥协议，不证明根服务真实候选落库、模型质量、真实图片审核、生产迁移或本地部署。
