# 故事世界实施与协作边界

> **长期架构标准**：持久化数据表、推演引擎生命周期、公共生图名额防护（`upstream_may_continue`）、前端草稿生命周期（`useStoredDraft`）及全量需求-证据验收矩阵详见长期架构标准文档：[`docs/development/STORY_WORLDS_ARCHITECTURE.md`](./STORY_WORLDS_ARCHITECTURE.md)。  
> 完整范围见 `STORY_WORLDS_PLAN.md`；本文档固定并行开发接口与协作记录。前一轮架构完成不代表此计划完成。

## 当前任务与状态

- 主代理：共享契约、HTTP路由、注册迁移/运行时、API联调、全链集成验收与生产部署。
- Sol xhigh（1）：持续模拟运行时、持久化步骤和调用恢复、人物信息隔离、模型接入和模拟行为测试；该分工为历史实施记录，最终有限审计已结束。
- 前端与UI（由Gemini接替完成）：工作台 `workspace.tsx`、API/Queries/Query-Keys、全量表单 `forms/**`（含 `useStoredDraft` 干净直通与冲突变基、未知文本/生图人工核销弹窗、配角晋升）、时间长卷 `flow/**`（`@xyflow/react` 12.12.1 与 `dataComplete` 防重排）、沉浸式阅读 `reading/**`（多视角同源切换、事实折叠与分支对比），前端单元测试全量通过（35/35）。
- 均直接编辑指定互斥路径；不得覆盖脏工作区或提交/部署/执行真实模型调用。主代理集成共享文件与执行线上部署。

## HTTP约定（相对管理API）

所有接口在 story-worlds 下，服务前缀 /api/v1/admin/，浏览器使用已有 api-client。
- GET/POST story-worlds => WorldList / StoryWorld
- GET/PUT story-worlds/:worldId => WorldOverview / StoryWorld (UpdateStoryWorld)
- POST story-worlds/:worldId/branches => WorldBranch (CreateWorldBranch)
- GET story-worlds/:worldId/branches/:branchId => WorldBranchDetail
- GET .../events => WorldEventPage (from/to/cursor/limit/actorId/storyLineId)
- GET .../memories?actorId= => WorldMemoryList
- POST .../story-lines => WorldStoryLine (CreateWorldStoryLine)
- POST .../interventions => WorldIntervention (CreateWorldIntervention)
- POST .../runs => WorldRun (StartWorldRun)
- POST .../runs/:runId/pause 或 resume => WorldRun (WorldRevisionRequest)
- POST .../images/plan => WorldImageList (PlanWorldImages)
- POST .../images/:imageId/submit => WorldImage (SubmitWorldImage)
- POST .../adopt => WorldAdoptionResult (WorldAdoption)
- GET .../sources/preview => WorldSourceUpdatePreview；逐项影响及世界/分支修订。
- POST .../sources/refresh => WorldBranchDetail (RefreshWorldSources); 显式纳入新版，同时校验预览的世界和分支修订，已有历史不改写。

请求与响应统一以 packages/contracts/src/story-worlds.ts 为准。主代理拥有该文件；发现不足及时提出，不各自定义相冲突接口。时间单位为从世界起点起的分钟，默认运行1440分钟。

## 数据层协作接口

apps/service/src/story-worlds/store.ts 导出 StoryWorldStore。constructor(database: ServiceDatabase)。公开 database 属性。
- list(): {items: StoryWorld[]}
- create(definition: WorldDefinition): StoryWorld
- getWorld(worldId): StoryWorld; overview(worldId): WorldOverview
- updateWorld(worldId, {expectedRevision, definition}): StoryWorld
- createBranch(worldId, CreateWorldBranch): WorldBranch
- getBranch(worldId, branchId): WorldBranch
- detail(worldId, branchId): WorldBranchDetail （运行记录通过 sw_runs 的 data_json读取；不存在则null）
- events(worldId, branchId, WorldEventQuery): WorldEventPage
- memories(worldId, branchId, actorId?): {items: WorldMemory[]}
- addStoryLine(worldId, branchId, CreateWorldStoryLine): WorldStoryLine
- intervene(worldId, branchId, CreateWorldIntervention): WorldIntervention
- refreshSources(worldId, branchId, expectedRevision): WorldBranchDetail
- commitStep(worldId, branchId, expectedRevision, { tick, events: WorldEvent[], memories: WorldMemory[], states: WorldActorState[], consumedInterventionIds: string[], supportingActors?: WorldActor[], run?: WorldRun }): WorldBranch
  事件/记忆/人物状态/分支时刻/可选run必须在同一事务提交，校验世界/分支/时间、成员、地点、因果和获知关系。可重入事务用 savepoint，禁止嵌套BEGIN。
- definition(worldId, branchId): WorldDefinition 冻结快照，包括该分支配角

统一表名 sw_worlds, sw_branches, sw_events, sw_memories, sw_story_lines, sw_interventions, sw_images, sw_runs, sw_adoptions。数据层负责migration.ts所有表，使用data_json存完整公共对象并索引world_id/branch_id/tick等；具体SQL可沟通但以最终migration/store为准。
运行表 sw_runs(id TEXT PRIMARY KEY, world_id TEXT, branch_id TEXT, status TEXT, data_json TEXT, idempotency_key TEXT, created_at TEXT, updated_at TEXT)，UNIQUE(branch_id,idempotency_key)，活动状态独占分支。
Sol拥有模拟内部 sw_run_steps、sw_run_calls 的迁移SQL，导出 runtime-migration.ts；主代理组合进增量迁移。
图片/采用服务若需SQL字段先读migration；不得自行连接真实DB或调用模型。

## UI协作接口

app/features/story-worlds/api.ts/queries.ts/query-keys.ts 与 workspace.tsx、forms/、story-worlds.css 归DS；主代理负责 /apps/story-worlds 路由、导航与npm依赖。
Gemini时间长卷拥有 app/features/story-worlds/flow/**：默认导出 StoryWorldFlow，props {actors: WorldActor[], locations: WorldLocation[], events: WorldEvent[], selectedEventId?: string, onSelectEvent(id:string):void, from:number, to:number, onWindowChange(from:number,to:number):void}。使用 @xyflow/react 与semantic token，时间位置不能拖拽修改，轨迹按人物稳定。
Gemini阅读拥有 app/features/story-worlds/reading/**：导出 WorldReader(props {events, actors, locations, images, actorId?:string, onSelectEvent?})、WorldImageReader(同props)、WorldEventDetail(props {event,actors,locations,images})、WorldBranchComparison(props {left:{branch,events},right:{branch,events},actors,locations})。完整类型在 contracts，导出都从 reading/index.tsx。
UI不可模拟成功或静态伪数据；世界创建可原创人物，也能加载角色库快照、已存来源。工作台轮询后台，不卸载或覆盖脏表单。加载、失败、无资料和额度用尽有真实提示。

## 当前验收证据

2026-11-11最终集成：实现与边界见[交付记录](reviews/2026-11-11-story-worlds-delivery.md)。239个核心测试文件、9项故事浏览器和32项不同旧页面用例最终通过；六人全天124调用/42事件/131记忆，两历史分支各20调用完成，GPT成功14张。审计修复含计划/摘要、来源预览、数值时钟、场景/道具参考、原子事件分叉和明确拒绝恢复；已备份部署schema57至9320。Comfy及真实双引擎混合受阻；后续内容复验和阅读修复见下文，长期原作质量仍为有限证据。上文分工保留为历史，以当前代码及架构为准。

2026-11-12补充：过夜复验86调用完成17新事件/57记忆/52视角，有晚餐、睡眠及次日早餐与补眠，含前次失败共96调用。102项内容补丁回归通过并备份部署，schema57/完整性ok/外键0，1440/390入口正常。该样本计划与摘要复用均0，不能宣称节省；后续同地点纯进度计划与正文修复另见交付记录，不覆盖原证据。

最新同室纯进度及正文补丁118项回归通过；三步真实睡眠48调用、18新事件/18记忆，6次模型意图+12次复用，摘要reuse仍0。另20调用完成新知后续，艾文记住已获消息但休息，其他四人不知秘密。共68调用、父历史不变。已备份story-worlds-pre-final-content-20261112并部署，schema57/完整性ok/外键0/正式世界0，1440/390入口通过。扩展原浏览器主用例验证采纳后正文编辑保存、制作冻结最新修订、对白保存刷新，属于同一用例的覆盖增加。Comfy混合仍待验收；长期内容质量作为后续改善记录，不新增无界首版门槛。

11-12叙事反馈：个人审查收敛为作者同一知识范围，具体意见有界返回唯一修正，旧全局审查不转述细节；117项回归通过。固定事实四人6段8调用仅重写正文，减少重复过程说明，问答仍相近；备份后02:58部署，健康/数据与桌面手机发布页面正常，详见交付记录。

11-12最终有限审计确认：前端S0–S6、故事世界核心首版与有限内容/GPT图片已有交付证据，原计划只剩VAL-017中的Comfy实际单图和真实双引擎跨模块混合队列。09:03（UTC+8）的准备脚本只读预检按预期退出2：原Comfy队列0运行/1待处理，旧隔离任务仍未知占位，正式活动生图0；未创建新测试库或提交新任务。恢复对象、候选参数与有限批次见[恢复交接](reviews/2026-11-12-comfy-recovery.md)，当前不执行被拦截的清理/重启。VAL-018保留为持续质量改进。

## 取证范围

11-12阅读补丁：默认每个事件只展示一次客观概要，个人视角显式切换；角色缺少正文时保留该角色选择并说明未记录，用户可主动切回客观叙述，不再把其他人物全文拼到个人视角。保留非在场列表内已有记录入口，睡眠等有限第三人称仅标为个人记录。事实/状态修复首次点击展开并增加aria-expanded，选择与折叠仍按分支/事件隔离；标准已同步架构文档。13项组件及原浏览器主用例通过，备份后部署至9320；证据见交付记录的阅读页补充节。

1. 世界/分支/来源版本、历史fork隔离和旧库升级。
2. 模拟个人上下文、共享事件、记忆传播、原作/未来隔离、校验与一次修正、硬额度、pause/resume与服务重启。
3. 公共图片并发与不明任务占用、真实两路径有限额度。
4. 创建→运行→故事流/阅读/图片→历史fork/比较→项目采用整链浏览器证据。
5. 12角色1000事件窗口性能与四视口/主题截图人工查看。
6. 真实文本与图像实际阅读检查，现有核心流程回归，备份/迁移/9320部署与健康检查。

未取证项不能因已有局部测试通过而标完成。视频、自动分支合并、手机复杂编排不在首版。
