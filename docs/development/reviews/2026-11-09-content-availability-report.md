# 内容可用性审计与恢复报告

状态：审计、5个原件恢复、前端修复、测试隔离保护和正式部署均已完成。最终证据位于 artifacts/content-audit-2026-11-09/production-final/；未删除任何业务引用记录。

## 结论

- 初次扫描的 274 个媒体产物全部无法从配置的文件根读取，数据库 `PRAGMA quick_check` 为 `ok`。
- 从旧备份中按路径、大小和 SHA-256 核实并恢复了 5 个文件：3 个活动产物、2 个角色资产。
- 恢复后仍有 269 个文件缺失；其中 268 个有数据库中的直接引用。其余 JSON 内嵌引用未计入该统计。
- 恢复文件时未手工改写数据库。部署后由服务正常巡检重新识别，状态已为 ready=5、missing=269。
- ComfyUI 引擎已启用，但探测返回 `ECONNREFUSED`；创作中心的 5 个生成模式均为 `not_configured`，没有工作流或引擎绑定。
- 2 个生成任务为 `abandoned`，错误码均为 `submission_outcome_unknown`；5 个活动作业为历史 `failed`。现有证据不能证明其具体失败原因。
- 日历 hydration 问题与媒体“文件恢复后仍显示缺失”的问题已完成针对性修复，本轮浏览器内容验收 4 项通过。
- 第一次恢复 5 个文件后再次运行 `npm test:regression`，媒体根又一次被清空。该**第二次删除**已定位为测试中创建内存数据库服务时使用默认生产产物根，启动巡检把文件当作 orphan 删除；这不是 portable-backup 打包路径问题，尚不能确定它是否也曾造成初始缺失。
- 主代理随后停止广泛测试，重新恢复同一组 5 个文件，并打包到 `data/backups/pre-workspace-consolidation-final-20261109`；恢复后仍为 5 个可用、269 个缺失。
- 初始 274 个文件失踪的起始时间、持续时间和根本原因仍无证据可以确认，不能把初始缺失简单归因于备份路径或测试巡检。

## 审计基线

`content-availability.json` 生成于 `2026-11-08T17:47:19.690Z`，扫描标记为只读。扫描范围是数据库登记的 274 个媒体产物；没有发现文件根下额外的孤立文件。

| 项目 | 初次结果 |
| --- | ---: |
| 数据库登记产物 | 274 |
| 文件可用 | 0 |
| 文件缺失 | 274 |
| 数据库 `stored_status=missing` | 274 |
| 缺失且有直接引用 | 273 |
| 文件根额外文件 | 0 |
| `quick_check` | `ok` |

按应用划分，角色产物 189 个，其中 188 个有直接引用；活动产物 85 个，全部有直接引用。数据库完整性正常只能说明 SQLite 页面和索引没有报告损坏，不能证明媒体文件仍然存在。

## 备份核实与恢复

`backup-matches.json` 在 `data/backups/pre-activity-render-loras-2026-09-25/` 中找到 5 个与数据库记录匹配的文件。目标文件与备份文件的大小、SHA-256 均一致；`restored-files.json` 记录了受控复制结果。

| 应用 | 产物 ID | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| activities | `676123ec-4c9c-49da-8025-1b27da831c9f` | 512951 | `c85025ae87dc818cc65f52d0feca071e69847a63583ca43da95a87b48088fa8b` |
| activities | `799acd8e-183f-41d3-a587-62f517e55c68` | 498789 | `d7163d31c383284d2e5aa1bec900522fb30d732ff75797a973ae1f6ad52989e4` |
| activities | `a41aaa4f-e9dd-4ea2-b901-6dccb2961311` | 519866 | `038e930e851156a7a72b6eb4bf15dd002dbc7d6774b228fa1016f542774896df` |
| characters | `26f7a2d6-10b6-42f4-9a03-78bc6112f811` | 34255 | `8cc262f51bac7dd0cb3be3ca7222aba732b61d9dc6e4e25cdb621b56267db4ee` |
| characters | `2f4d412d-7c2a-4d95-8d5d-d75de7b64f4e` | 83281 | `149af23932b1d963122572a9c27bdfc117fa02592f617607788f5d36cab09e97` |

`content-availability-after.json` 生成于 `2026-11-08T17:54:42.215Z`。恢复后的文件可用性分类为 2 个 `stored-path` 和 3 个 `portable-path`，共 5 个可读取；其余 269 个仍为 `missing`。

| 应用 | 登记总数 | 文件可用 | 文件缺失 | 缺失且有直接引用 |
| --- | ---: | ---: | ---: | ---: |
| characters | 189 | 2 | 187 | 186 |
| activities | 85 | 3 | 82 | 82 |
| 合计 | 274 | 5 | 269 | 268 |

恢复操作没有删除或重建 `artifact_references`、`character_assets`、`shared_assets` 等引用记录，也没有修改数据库状态。恢复后 JSON 中 `storedStatus.missing` 仍为 274，与“已有 5 个文件实际可读”并不矛盾：前者是数据库保存的状态字段，后者是审计程序按当前文件根重新解析路径并读取文件得到的结果。页面需要以实际文件可用性修正旧的 missing 展示，不能把该状态字段直接当成文件仍然丢失的证明。

## 缺失、引用与删除边界

剩余 269 个缺失文件不能按“有或没有直接引用”直接清理：

- 268 个缺失产物至少有一条数据库直接引用。
- 1 个缺失角色产物没有可计数的直接表引用，但仍可能被草稿、文档或其他 JSON 字段以内嵌 ID、路径或 URL 引用。
- 当前审计明确排除了内嵌 JSON 引用的穷举，`missingWithDirectReferences` 是“有至少一条直接引用的产物数”，不是引用行总数。
- 没有直接引用不等于可以删除；在完成内嵌 JSON 引用扫描、业务确认和独立备份之前，不应删除任何产物记录、引用记录或数据库行。

`content-availability.json` 和 `content-availability-after.json` 都注明：远端来源只做计数，不请求签名 URL 或凭据；零直接引用也不构成删除许可。

## 任务与引擎状态

`content-diagnosis.json` 检查于 `2026-11-08T18:34:05.460Z`。

| 类别 | 数量 | 已记录状态或错误 |
| --- | ---: | --- |
| `generation_tasks` abandoned | 2 | 两条均为 `submission_outcome_unknown` |
| `activity_jobs` failed | 5 | 1 条记录到连接失败信号；其余 4 条归入其他已记录错误，JSON 没有更具体原因 |
| `activity_jobs` succeeded | 4 | 已成功 |
| `generation_tasks` succeeded | 48 | 已成功 |

两条 abandoned 任务的 ID 为 `7f2a4490-4193-42a4-8c27-a00f04cebcf5` 和 `4fd36f2d-8e24-4677-95ab-5c6e31872637`。历史 failed 活动作业不能统一归因于 ComfyUI、文件丢失或某种格式错误；其中 `413d7b2e-7529-409f-b10b-d3ee6262e2fe` 有连接失败信号，其余作业没有 JSON、结构、提供商、缺失或超时的明确信号。具体外部错误未知，本文不作推断。

唯一的引擎记录为 `comfyui-local`：已启用，探测错误为 `ECONNREFUSED`。`browser-results.json` 同时记录创作中心的以下 5 个模式均无绑定：

| 模式 | purpose | 状态 | 工作流 | 引擎 |
| --- | --- | --- | --- | --- |
| `textToImage` | `text-to-image` | `not_configured` | 无 | 无 |
| `imageToImage` | `image-to-image` | `not_configured` | 无 | 无 |
| `h3T2v` | `h3-t2v` | `not_configured` | 无 | 无 |
| `h3I2v` | `h3-i2v` | `not_configured` | 无 | 无 |
| `h3Fl2va` | `h3-fl2va` | `not_configured` | 无 | 无 |

因此当前不能通过重新生成批量补齐缺失内容，也没有证据表明重新生成会得到相同提示词、模型、工作流与种子。

## 浏览器审计与修复

较早的 `browser-results.json` 检查于 `2026-11-08T18:05:10.449Z`，覆盖 28 个路由，HTTP 状态均为 200。该快照记录了：

- `/apps/calendar` 出现 React 最小化错误 #418，这是 hydration 不一致信号，不是路由加载失败。
- `/settings/generation` 显示“读取模型列表失败：fetch failed（显示的可能是过期缓存）”；这与当时引擎/外部服务不可达相符，未触发付费生成。
- 媒体 API 当时仍返回 `missing=274`、`ready=0`；该快照早于缺失状态展示修复部署，不能作为恢复后的最终状态。

本轮后续完成了日历 hydration 修复，并修正“文件已恢复但页面仍按旧状态显示缺失”的展示链路。最终浏览器内容验收共 4 项，结果为 4 项通过。`browser-results.json` 不是这 4 项最终验收的报告文件，生产部署后的浏览器复验仍应保留新的结构化结果。

## 恢复后二次删除与测试隔离修复

第二次媒体清空有独立、可复核的触发链：部分测试用 `new ServiceDatabase()` 创建空内存库，却让 `readConfig()` 使用默认 `data/artifacts`；`createService()` 启动时无条件执行媒体 reconcile，空库无法提供真实产物的已知路径，巡检因此把恢复文件视为 orphan 并 `unlink`。至少 `activities-external-sync.test.ts` 还误用了服务端不读取的 `STHSTART_DATA_DIR`，没有真正隔离产物目录。

修复改为统一边界，而不是逐个修改几十个 fixture：

- 测试运行器为每个测试文件创建独立临时数据根，并显式注入临时 artifacts、SQLite、narrative 和日志路径。
- `createService()` 在测试运行器或内存库场景发现默认生产产物根时，先把它重定向到已验证位于系统临时目录的隔离根。
- 内存数据库跳过启动媒体 reconcile；测试运行器若直接把默认生产根交给巡检，会在任何目录扫描或删除前失败关闭。
- 测试临时根在 `finally` 中清理，并带 Windows 文件占用重试；清理失败只记录告警，不中止整套测试。
- 新增 canary 用临时标记文件验证空内存库启动不会触发扫描删除，并拒绝把生产根设置为测试 artifacts 根。

本轮事件再次说明：portable-backup 的 `existsSync(local_path)` 缺陷会让备份打包为 0，但它在 `create` 路径只复制文件，不删除源文件。测试启动巡检是第二次删除的直接原因；第一次完整缺失仍发生在本次审计之前，原因未知。

## 证据限制

- 274 个文件在第一次扫描时已经全部不可读，现有 JSON 没有保存文件消失前后的事件时间线、访问日志、部署记录或文件系统元数据，不能确定失踪的起点、持续时间和根本原因。
- 5 个文件能在 `pre-activity-render-loras-2026-09-25` 备份中找到，只能证明该备份时点存在可匹配副本，不能据此推断所有缺失都发生在该日期之前或之后。
- ComfyUI 的 `ECONNREFUSED` 是当前探测结果，不能证明它是历史文件缺失的原因；同样，历史作业失败也不能直接解释全部产物缺失。
- 普通数据库备份只覆盖 SQLite 数据库，不包含媒体文件。即使数据库可以恢复，产物字节仍会缺失；媒体目录需要独立、可校验的备份与恢复演练。目录中这次命中的旧备份带有 `artifacts/` 子目录，但这不改变“数据库备份本身不含媒体”的边界。
- 主代理已核实生产容器的数据卷为宿主机 `data` 映射到容器 `/app/data`，因此宿主机媒体根和容器媒体根指向同一批文件；文件被测试删除后两边会同时表现为空。对象存储、远端 CDN 或旧签名 URL 仍未验证。

## 生产部署后复查

2026-11-09 04:06（北京时间）部署当前工作区构建，容器 healthy。基线82dbebe，本轮未创建Git提交；通过项目部署脚本同步Portal、Service与运行时源码，镜像本身未重建。

| 复查项 | 实际结果 |
| --- | --- |
| 28个正式页面/详情 | HTTP全部成功，无页面异常、无本站请求失败 |
| 数据库 quick_check | ok |
| 媒体文件与状态 | ready=5、missing=269；5件SHA-256与原备份一致 |
| 恢复文件读取 | 5件原文件接口全部HTTP200，字节数与原件一致 |
| 缺失引用 | 269记录保留，268有直接引用，未穷举JSON内嵌引用 |
| 日历 | 上海时区无React418；隔离浏览器另测UTC与洛杉矶 |
| ComfyUI及生成 | 引擎连接拒绝，五模式仍无绑定；设置页保留明确错误提示 |
| 当前备份 | pre-workspace-consolidation-final-20261109包含两库与5件媒体；已打包文件/库无校验错误，269历史缺件使完整备份验证为false |
| 测试隔离保护 | 完整182文件回归后5文件hash不变；181初次通过，旧schema兼容修复后剩余项与备份测试复跑通过 |

生产媒体验证使用实际原件；失败预览重试使用隔离浏览器模拟404。没有对269个缺件伪造恢复结果，也没有触发外部付费生成。

## 证据来源

- `artifacts/content-audit-2026-11-09/content-availability.json`
- `artifacts/content-audit-2026-11-09/content-availability-after.json`
- `artifacts/content-audit-2026-11-09/backup-matches.json`
- `artifacts/content-audit-2026-11-09/restored-files.json`
- `artifacts/content-audit-2026-11-09/content-diagnosis.json`
- `artifacts/content-audit-2026-11-09/browser-results.json`
