# AI 创作编排真实系统评估

日期：2026-11-17
状态：已用真实模型执行三次首场尝试。第三次生成可校验的场景候选，但供应商拒绝两路审核请求，未进入采用。20 场故事与 2 张图片验收均未完成。

## 目标和边界

本评估验证 AI 创作编排从真实故事上下文、双 StoryLine、分叉历史、独立审核、人工批准到正式采用的完整链路，不使用 mock 审核结果，也不把脚本生成的数据写入生产作品。

- 生产数据库只以 `DatabaseSync(readOnly: true)` 打开。
- `--execute` 在新目录创建独立 eval 数据库，仅复制指定模型、连接和必要生成工作流引用。
- 模型密钥只通过现有 `SecretStore` 在内存解析，不复制到 eval DB、报告、命令行输出或日志。
- 不复制生产项目、世界、branch、故事正文、run、approval、artifact 或会话。
- 脚本不修改生产数据库、不发布内容、不部署服务。
- 未执行前默认只运行 read-only inventory，不发起收费调用。

工具入口：[creative-live-eval.ts](F:/Project/SthStart/scripts/testing/creative-live-eval.ts)。

## 场景结构

20 个“场景”全部是真实故事场景，不把额外图片算入 20：

| 场景 | Branch | StoryLine | 验收重点 |
|---|---|---|---|
| `main_01` | main | 林澄线 | 建立人物目标与港口异常 |
| `main_02` | main | 沈砚线 | 第二人物自主推进并交换同一事实 |
| `main_03` | main | 林澄线 | 两线共享时间和已确认事实 |
| `main_04` | main | 双线 | 同一地点汇合，不替角色做决定 |
| `main_05` | main | 林澄线 | 新增可追踪悬念 |
| `main_06` | main | 沈砚线 | 私密知识边界 |
| `main_07` | main | 林澄线 | 时间压力与资源状态变化 |
| `main_08` | main | 沈砚线 | 分叉前共同事实 |
| `main_09` | main | 林澄线 | 分叉后主线升级 |
| `main_10` | main | 沈砚线 | 主线第二线继续推进 |
| `main_11` | main | 双线 | 两种角色视角产生可验证矛盾 |
| `main_12` | main | 林澄线 | 可信输入强制关键方向确认 |
| `main_13` | main | 沈砚线 | 信息缺口与未知结果 |
| `main_14` | main | 林澄线 | 人物自主冲突 |
| `main_15` | main | 双线 | 主线收束并保留事实 |
| `main_16` | main | 林澄线 | 完整阶段交付 |
| `fork_01` | fork after `main_08` | 林澄线 | 平行历史改变后续路径 |
| `fork_02` | fork | 沈砚线 | 分支内人物自主行动 |
| `fork_03` | fork | 双线 | 分支内部共享事实 |
| `fork_04` | fork | 沈砚线 | 平行历史阶段交付 |

主 branch 共 16 场。第 8 场正式采用后，从当时的 `currentTick` 创建平行历史 fork，再完成 4 场。fork 继承第 1–8 场的定义、状态、事件、知识与 StoryLine；主 branch 第 9 场以后的事件不得进入 fork。

同一 branch 内的林澄线和沈砚线交替推进，`main_04/main_11/main_15/fork_03` 使用双线。每次 context 通过 `contextSelection.storyLineIds` 选择当前人物线，但模型仍读取同 branch 的完整已发生历史。共享事实、知识边界和分叉隔离由真实 StoryWorld 数据验证。

### 阶段边界

`--story-only` 不会缩减完整的 20 场景目标，只暂不要求 vision 模型和图片工作流，并把两个图片验收项明确记为 `pending`。`--max-scenes N` 表示本 eval 累计最多启动前 N 个故事场景，而不是把总目标改成 N。

root 可以先运行 `--story-only --max-scenes 1`，让第一场正常推进到人工审批门。批准并完成后，脚本因阶段边界退出，`report.json` 为 `partial`，不会显示 20 场景通过。后续如需继续，root 必须显式用更大的 `--max-scenes` 恢复；脚本不会自动扩大场景边界，也不会自动扩大统一 budget。

### 思考等级隔离

`--thinking-level low|medium|high|off|auto` 只用于新建 eval。脚本先按白名单复制指定 `model_profiles` 到临时 eval DB，再只更新临时副本的 `thinking_level`；生产数据库中的模型配置不变。

选定的 level 写入 `manifest.json` 的 `thinkingLevel` 和报告计划。`--resume` 默认沿用 manifest 值；显式传入相同值可以确认，传入不同值会直接拒绝。`profileFingerprint()` 已包含解析后的 `thinkingLevel`，因此 run freeze 后再解析同一个临时模型会得到一致指纹；如临时配置在 freeze 后变化，执行器继续按原有指纹校验失败关闭。

## 额外图片验收

以下两场不计入 20：

- `extra_image_main`：使用主 branch `main_08` 正式 adopted scene，生成 1 张图片。
- `extra_image_fork`：使用 fork branch `fork_03` 正式 adopted scene，生成 1 张图片。

两场都使用真实图片工作流和具有 `multimodal` 能力的 vision 模型。实际总图片数必须为 2；如果拒绝走 revision，图片调用数可能增加，但始终受统一 image budget 约束。

story-only 阶段会把上述两项保留在报告与 `pending-approvals` 证据中，状态为 pending。即使 20 场故事全部通过，story-only 报告仍为 `partial`，完整图片验收尚未完成。

## 统一预算

预算属于整个 eval，而不是每场乘 20 的隐式预算：

- `--execute` 必须给出一个 CreativeBudget 总上限；`textCalls/images/tokens` 汇总扣减，`maxRevisions` 仍按单 run 契约限制为 0–2。
- 每次启动 run 前，脚本从 eval DB 汇总所有 run 的实际 usage，只把剩余额度分配给当前 run。
- 当前 run 获得的是统一 cap 的完整剩余包络，例如 root 指定的 `{"maxTextCalls":8,"maxImages":0,"maxTokens":150000,"maxRevisions":1}`；不会再把预算缩成不透明的每场估值。
- 当前 run 的 `maxTextCalls/maxImages/maxTokens` 不高于全局剩余额度，因此任何单 run 都不能让总量越界。
- `report.json` 的 `budgetLedger` 保存全局 `cap/used/remaining`。
- 脚本从实际固定版本的流程图计算首轮模型和生图调用数，并保留 token 预检。默认故事首轮为导演、主笔和两路审核，共四次调用。返修继续占用同一总预算。
- 输出目录使用单写锁，防止两个进程并行恢复同一 eval。
- `resume` 继续使用 manifest 中固定的 budget cap；显式传入不同 cap 会被拒绝。`--max-scenes` 只能显式扩大原边界，不能缩小。

建议启动参数由 root 根据模型和图片供应商实际价格填写；脚本不提供默认金额或自动扩容。

## 人工审批门

脚本从不自动批准，也不直接修改 `co_approvals`：

1. run 推进到 `waiting_approval` 后立即停止。
2. 保存 pending approval ID、revision、bundleHash、artifact IDs 和 scene/review 证据。
3. root 阅读 scene、review、review target/hash、context、usage 和 AI 调用摘要。
4. root 只有在用户已经授权本轮真实评估后，才用实际看到的 ID/hash 执行：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts `
  --resume artifacts/creative-evals/<runId> `
  --reviewer root `
  --approve <approvalId> <bundleHash>
```

脚本校验 pending 状态、revision 和 bundleHash，然后调用正式 `CreativeService.decision`。若同一 run 后续出现方向审批或最终审批，脚本会再次停在新的 pending，要求新的显式参数。

缺少 approve flags 时退出码为 `3`，eval DB 和全部证据保留，可继续 `--resume`。不提供 `--approve-all`、自动 hash、默认审批评论或直接 SQL 更新入口。

## 临时数据库复制

新 eval DB 使用当前 ServiceDatabase migrations。只复制：

- `managed_apps` 中的 `story-worlds`；
- 显式选择的 `model_profiles` 及其 `service_connections`；
- 显式选择的 `generation_engines/generation_workflows/generation_workflow_versions`；
- 对应版本的 engine options、worker 元数据和 media 元数据。

连接只复制 `credential_account` 指针。实际密钥通过 SecretStore 在调用时读取。`headers_json` 会扫描内嵌的 Authorization、API key、cookie 或 token；发现真实凭据字符串时拒绝执行并提示迁移到 SecretStore。普通用户名、显示名、用户自定义非敏感 header 和内容字段不会被当作 secret 拒绝。

脚本不复制 `provider_profiles` 业务投影、purpose routing、项目、世界、artifact 或历史。合成世界由脚本在 eval DB 内创建。

## CLI

默认只读 dry-run：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --list
node --import tsx scripts/testing/creative-live-eval.ts --self-check
node --import tsx scripts/testing/creative-live-eval.ts --self-check --story-only --max-scenes 1
node --import tsx scripts/testing/creative-live-eval.ts --self-check --story-only --max-scenes 1 --thinking-level low
node --import tsx scripts/testing/creative-live-eval.ts --dry-run
node --import tsx scripts/testing/creative-live-eval.ts --dry-run --story-only --max-scenes 1
node --import tsx scripts/testing/creative-live-eval.ts --dry-run --story-only --max-scenes 1 --thinking-level low
```

可选免费健康探测：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --dry-run --probe-health
```

`--probe-health` 仅执行：

- OpenAI-compatible：`GET /models`
- ComfyUI：`GET /system_stats`
- Worker：`GET /health`

输出只保存可达性、HTTP 状态和延迟，不保存响应正文、endpoint 或凭据。该检查不能证明具体 vision 能力或生成质量。

未来获授权后的第一阶段真实执行形式如下。示例不代表已授权或已执行：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --execute `
  --story-only --max-scenes 1 `
  --thinking-level low `
  --model text=<textProfileId> `
  --budget '{"maxTextCalls":8,"maxImages":0,"maxTokens":150000,"maxRevisions":1}' `
  --output artifacts/creative-evals/<runId>
```

完整 20 场故事加 2 张图片的获授权形式：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --execute `
  --model text=<textProfileId> `
  --model vision=<multimodalProfileId> `
  --image-workflow <workflowId>@<publishedVersion> `
  --budget '{"maxTextCalls":120,"maxImages":4,"maxTokens":2000000,"maxRevisions":2}' `
  --output artifacts/creative-evals/<runId>
```

预算示例只说明格式，不代表当前批准额度。实际执行前必须按供应商成本重新确定。

## 证据与报告

每次 run 保存：

```text
scenarios/<sceneId>/
  start.json
  run.json
  nodes.json
  context.json
  scene.json
  review.json
  image.json
  approval.json
  approvals.json
  usage.json
  ai-calls.safe.json
  result.json
```

全局保存：

```text
inventory.json
manifest.json
pending-approvals.json
eval.db
report.json
report.md
```

`report.json` 分开记录：

- 技术状态：预算、review 与实际 artifact hash 绑定、pending/approved 状态、adopt 记录和调用摘要；
- 环境状态：模型、vision、生成引擎和工作流是否可用；
- 人工状态：初始为 `pending`，不得由自动评分冒充通过；
- 统一预算 ledger：cap、used、remaining；
- 对 failed/uncertain/cancelled 保留明确错误并停止，不自动重投。
- `coverage.plannedStoryScenarios` 始终为 20；`maxStoryScenes` 记录当前累计边界。story-only 或未到边界时，两个图片要求逐项保存为 pending。
- 只有 20 个完整故事 run 与 2 个图片 run 都完成，`fullEvaluationComplete` 才为 `true`。阶段完成退出码为 `4`，人工审批门为 `3`；两者都不是全面通过。

## 2026-11-17 read-only inventory 结果

执行命令：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --dry-run
```

结果：

- SecretStore：可用，backend 为 `native-windows`。
- 文本/多模态模型：配置了 1 个 `magpie · auto/deepseek-v4.1-flash`，capabilities 同时声明 `text` 和 `multimodal`，但所需凭据未就绪，因此当前不可用。
- 可用文本模型：0。
- 可用 vision 模型：0。
- 已发布图片工作流：共盘点 19 个版本。
- 可用图片工作流：13 个，主要是 enabled 的本地 ComfyUI 工作流。
- 不可用图片工作流：云端 GPT Image 相关已发布版本共 6 个，其 engine 处于 enabled，但凭据未就绪。

显式免费健康探测：

```powershell
node --import tsx scripts/testing/creative-live-eval.ts --dry-run --probe-health
```

本轮结果：

- `comfyui-local` 的 `GET /system_stats` 返回网络失败，不能仅凭 engine 和 workflow 已启用就认定当前可以生图。
- 文本连接的免费 `GET /models` 分别出现网络失败、HTTP 401 或 10 秒超时；没有任何文本连接通过本轮只读探测。
- `magpie-gpt-image` 的免费端点探测超时；其云端生图仍受缺少 SecretStore 凭据阻塞。
- 探测没有发送聊天、图片生成或审核请求，没有产生已知的推断调用费用。

当前阻塞：

1. 真实故事、审核和 vision 验收需要先补齐可用文本模型凭据。
2. 独立图片审核必须选择支持真实图像输入的 multimodal 模型；仅声明 capability 不足以通过，SecretStore 凭据和实际调用仍需验证。
3. 图片生成可选用当前本地 ComfyUI 工作流；但本轮免费健康探测显示 ComfyUI 当前不可达。若选择云端 GPT Image，必须先完成其 SecretStore 凭据配置和网络探测。
4. 以上结论来自数据库配置、SecretStore 可用性以及显式免费 GET 探测；没有证明模型 vision 能力或画质，也没有发起任何收费生成。

### 部署容器复核

宿主机的 9320 由 `sthstart` Docker 容器提供。容器内只读复核使用已部署的 schema 64，没有导入工作区新 source、没有实例化 `ServiceDatabase`、没有执行 migration，也没有发送聊天或生图请求。

宿主/容器差异：

- 宿主机脚本使用 native Windows keyring 时，模型凭据可用布尔值为 false。
- 部署容器没有系统 keyring，但配置了挂载到数据目录的 file keyring；`SecretStore.status()` 返回 `available=true, backend=file`。
- 容器内使用已部署 `providers.js` 对模型配置执行只读解析，结果 `profileResolved=true, keyringSecretAvailable=true`。
- 该模型 `auto/deepseek-v4.1-flash` 声明 `["text","multimodal"]`，模型和连接均 enabled。
- 容器内免费 `GET /models` 返回 HTTP 200，并包含上述模型 ID。
- 部署中的应用模型状态接口同样报告 story-worlds 与 creative-center 的 text/multimodal 绑定结构 ready、credential source 为 keyring。

因此，“容器也没有可用文本/vision 模型”并不成立。当前更准确的结论是：模型配置、凭据解析和免费模型清单位于同一容器环境时均可用；真实聊天、vision 读取和内容质量仍未经付费调用验证。

图片引擎复核：

- 容器配置中有 `comfyui-local`，声明 enabled，并关联 13 个已发布工作流版本。
- 容器内 `GET /system_stats` 网络失败，所以当前图片生成仍被实际运行环境阻塞。
- `magpie-gpt-image` 声明 enabled，并关联 6 个已发布工作流版本；其免费 `/models` 可访问，但 SecretStore 未解析到该图片连接凭据，不能据此认定云端生图可用。

本轮只做了免费 GET 与凭据布尔判定，没有确认 vision 的真实图像理解能力。若后续获得明确付费评测授权，应先选择一个场景和最小统一预算，通过正常 runtime 推进到人工审批门，不能用探测结果替代真实执行。

## 验收判定

自动技术检查必须全部满足：

- 20 个故事场景顺序完成，主 branch 16 场、fork branch 4 场；
- fork 固定发生在 `main_08` 后，fork 不出现主线第 9 场以后的事实；
- 同一 branch 的两条 StoryLine 都能读取此前共享事实；
- 每份 review 的 target ID/hash 指向实际产物；
- 所有正式采用均来自 approved 且未 stale 的完整 bundle；
- 全程 usage 不超过统一 budget ledger；
- 图片生成总数为 2，vision 确实读取实际图片；
- secret 未出现在 eval DB、报告、错误或审计摘要。

人工验收重点：

- 人物是否有自主目标、行动和受限知识；
- 对话是否推进关系或冲突，而不是复述设定；
- 两条故事线是否真正交织，fork 后是否出现因果污染；
- 新增设定、伏笔和 simulation 是否可在后续延续；
- 图片是否保持人物、服装、地点和剧情事实。

自动检查通过不等于内容质量通过。最终 `manualReview` 只可由 root 根据本轮场景证据填写。

## 真实首场结果与后续验收

三次都使用隔离数据库及同一模型配置，累计 **8 次文本调用、74,967 token、0 次生图**。没有任何内容进入正式历史。预算按前一轮的剩余值递减；第三次仅调整了评测库模型副本的推理档位。

| 尝试 | 调用 / token | 结果 |
|---|---:|---|
| 首轮 | 2 / 17,973 | 主笔未返回可解析 JSON |
| 第二轮 | 2 / 29,174 | 主笔返回可读正文，但 JSON 被输出额度截断 |
| 第三轮，`low` | 4 / 27,820 | 导演、主笔完成，五个事件通过校验；两路独立审核均收到 HTTP 200 包装的供应商客户端拒绝，没有审批包 |

第三轮[场景候选与结算报告](F:/Project/SthStart/artifacts/creative-audit/live-first-scene-low)。稿件给两名角色安排了会面前各自查证的动作，留下日志去向和潮位偏差两个可接续钩子；两处时间证据如何关联仍需审核，不能因结构通过而采用。该供应商的模型列表可读、导演和主笔成功，均不能证明其支持 SthStart 的审核请求。应用现会把这类已收到的拒绝显示为供应商限制，不自动重投。

容器已可连接本地 ComfyUI，`/system_stats` 返回 HTTP 200。图片任务、实际看图审核及基于两条历史的配图质量仍未验证。

后续先使用允许 SthStart 直接调用的模型为连贯编辑与总编完成最小双审核，再由人工阅读候选并确认采用。首场通过后继续验证两条人物线、历史分叉及附加图片。现有文本调用额度已经用完；新执行需要新的明确额度。

故障注入（timeout、invalid JSON、changed model、budget rollback、lease 丢失和 provider uncertain）继续使用注入 fetcher 的离线测试，不消耗真实模型费用。
