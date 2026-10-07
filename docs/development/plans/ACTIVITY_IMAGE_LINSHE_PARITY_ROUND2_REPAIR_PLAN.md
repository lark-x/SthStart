# 活动生图对齐邻舍：第二轮修复与最小验收计划

> 编制日期：2026-10-03（Asia/Shanghai）。
> 状态：待执行。本文件只安排下一轮，不表示已经修复、部署或恢复数据库。
> 面向：接手当前工作区的实施模型。
> 本轮原则：修复审查已确认的问题；只做本轮相关测试，不重跑全项目验收。

## 1. 本轮要交付什么

保留已有邻舍对齐工作流、Base/Turbo 预设、镜头/漫画/素材入口和基础细化，不重新建设系统。

本轮必须完成：

1. 对当前数据库异常形成可复核诊断，明确真实数据操作是否安全。
2. 修复 tags 模式默认系统指令与 JSON 解析要求不一致。
3. 修复结构化提示词重复组装、同一人物身份重复输出。
4. 修复素材细化的来源归属查询。
5. 修复细化任务的重启恢复、暂停待确认及迟到结果收集。
6. 补齐细化版本校验、提交前保存、幂等重发与冻结来源图片引用。
7. 在环境允许时，用最少的真实调用补验镜头、漫画、素材及一次细化，并纠正上一轮报告的过度完成声明。

不是本轮任务：全站前端升级、新模型安装、LoRA 训练、增加工作流、自动视觉判图、批量重画、DSH 改造、提交 Git、推送、部署、未经确认的数据库恢复。

本轮不追求补跑原计划的全部阶段。原计划仍然保留，未完成项目须明确登记，不能以本轮完成代替原计划全部完成。

## 2. 已确认的事实与证据边界

审查依据：

- `docs/development/plans/ACTIVITY_IMAGE_LINSHE_PARITY_EXECUTION_SPEC_V2.md`，尤其新增的完成报告部分。
- `docs/development/logs/activity-image-linshe-parity-v2-progress.md`。
- 当前源代码、临时数据库最小复现及 `artifacts/activity-image-parity-v2/` 的报告与截图。

本轮开始前重新核对代码，不把本文件的行号或状态当成永久事实。

| 项目 | 上轮审查时的结论 |
| --- | --- |
| 业务数据库 `data/sthstart.db` | 迁移版本 49；Windows 只读完整性检查出现页面错误，外键检查报 `database disk image is malformed` |
| Docker 对同一挂载库的读取 | 独立只读连接报 `file is not a database`；容器当时仍显示 healthy |
| `data/narrative.db` | 完整性与外键检查通过，迁移版本 2 |
| `data/backups/2026-10-03T07-11-28.124Z/` | 主库版本 48，两库检查通过；这是迁移前备份，不包含之后的全部新增数据 |
| tags 默认策略 | 输出格式为 tags，但实际系统指令仍要求只返回一行英文提示词 |
| 提示词收尾 | 已编译的完整字符串再次与同一批结构化字段拼接，动作/景别重复 |
| 素材细化查询 | 输出表没有 `id`，子查询误引用外层 `a.id`，可解析出错误来源 attempt |
| 细化重启 | studio job 被置为 interrupted，但关联 queued 生成任务未加等待恢复标记；恢复还可能因已有 callId 被拒绝 |
| 细化版本 | 提交明显无效的版本号 9999，仍能创建 queued 任务 |
| 真实样例 | A/B 和漫画样例有关闭优化的记录，只证明部分提交/出图链路，不证明自动优化有效 |

不能从以上事实推导“迁移 49 必然导致损坏”。数据库异常原因尚未确认，报告必须区分异常现象、已证实原因和推测。

## 3. 开始规则与操作权限

### 3.1 先阅读的项目规范

- `.agents/skills/project-verifier/SKILL.md`：只选择本轮定向检查。
- `.agents/skills/db-migration-backup/SKILL.md`：区分只读检查、临时数据库和真实库操作。
- `.agents/skills/contract-first-api/SKILL.md`：原则上不改契约；确需改跨端字段时先改共享 Schema。
- `.agents/skills/frontend-ui-standards/SKILL.md`：只检查受影响的细化弹窗，不扩大页面改造。

### 3.2 工作区保护

1. 记录开始时 `git status --short`；阅读拟修改文件的现有差异。
2. 当前有大量已修改与未跟踪文件；这些都是现有工作成果，不得清理。
3. 不运行 `reset --hard`、`clean`、批量 checkout、自动 stash，不替换邻舍子模块。
4. 不自行更新依赖、统一格式化全仓或顺便重构大模块。
5. 新增报告和截图使用新目录，不覆盖上一轮证据。

### 3.3 数据库异常与开发解耦

阶段 0 可只读诊断。业务代码和自动化测试可以继续使用内存/临时数据库，不必为等待真实库恢复而停掉所有开发。

但在真实业务库未确认健康之前，禁止：

- 启动会自动迁移真实库的本地服务。
- 向真实活动写入测试任务、修改提示词策略、注册工作流或调用真实模型。
- 用部署/重启来“试试看数据库是否恢复”。

恢复、覆盖数据库、删除 WAL/SHM、暂停正在使用的服务等操作，需要用户明确确认本轮具体对象与影响。历史上对其他恢复任务的授权不沿用。

## 4. 阶段 0：最小数据库诊断，不擅自修复真实数据

### 4.1 目标

确认正在使用的数据库位置、宿主机与容器看到的状态，以及可恢复备份情况。交付判断，不在本阶段尝试破坏性修复。

### 4.2 检查步骤

1. 核对配置中的 `STHSTART_DATABASE_PATH`、`STHSTART_NARRATIVE_DATABASE_PATH` 以及 Docker mounts。只打印路径和状态，不打印环境变量全集、Token 或密钥。
2. 分别用宿主机和容器的只读 SQLite 连接检查实际业务库；记录 Node/SQLite 版本、文件大小、修改时间、数据库路径及伴随 WAL/SHM 是否存在。
3. 对每项查询分别捕获错误，避免一项失败遮住后续结果：

```sql
SELECT MAX(version) FROM schema_migrations;
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

4. 核对上表备份是否存在，读取备份版本及完整性；如已有较新备份，先读清单再挑一个候选，不遍历并检查所有历史备份。
5. 输出最多一页诊断：真实路径、宿主/容器结果、备份日期和版本、是否允许进入真实联调、需要用户确认的事项。

禁止用 `new ServiceDatabase(realPath)` 做只读检查，因为构造过程会迁移。使用 `DatabaseSync(realPath, { readOnly: true })` 或既有明确只读脚本。

### 4.3 若异常仍在

- 将阶段标为“真实联调受阻”，继续后续隔离代码修复。
- 不在原文件上执行 `VACUUM`、`REINDEX`、恢复或 `.recover`。
- 既有 `db:backup` 使用 `VACUUM INTO`，不要默认它能备份异常库或在异常库上反复尝试。
- 如需保留现场，先说明暂停写入的对象与影响并取得确认；停止所有写入者后，将 `.db` 及现有 `-wal/-shm` 一起保存到新的取证目录并记录哈希。取证副本不是已经验证可恢复的业务备份。
- 如需分析/恢复，在副本中进行；验证完恢复结果和新增数据损失范围后，再请求用户批准切换。不能仅因为版本 48 备份健康，就覆盖当前版本 49 的数据。
- 不把宿主与容器差异直接归因为 SQLite 版本或 Docker 锁；没有证据就保留为未确定。

阶段产物：`docs/development/logs/activity-image-parity-round2-db-diagnosis.md`。

## 5. 阶段 1：修复 tags 指令和唯一组装来源

### 5.1 主要文件

```text
packages/contracts/src/activity-image-prompts.ts
apps/service/src/activities/parity-config.ts
apps/service/src/activities/image-prompt-structured.ts
apps/service/src/activities/image-prompt-optimizer.ts
apps/service/src/activities/image-render-common.ts
apps/service/src/activities/image-prompt-v2.ts
app/features/generation/components/activity-image-prompt-policy-panel.tsx
```

### 5.2 tags 输出协议必须由服务保证

当前错误是 `outputFormat='tags'` 时，将原 prose 指令直接交给 `buildStructuredSystemPrompt()`。本轮不要只修一个注册脚本后就结束。

实现要求：

1. 新建的邻舍对齐 tags 策略使用现有 `DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS`，不沿用 prose 默认指令。
2. 运行时 tags 请求始终包含固定 JSON 输出协议、完整合法示例、字段约束及 actorScope。用户配置只补充改写规则，不能让固定协议消失。
3. 如果历史 instructions 与现有 prose 默认文本完全一致，运行时将其视为旧默认，不再作为 tags 的补充指令。不要通过模糊关键词判断并删除用户自定义规则。
4. 固定协议明确：只返回 JSON；字段必须符合已有 `StructuredVisualPromptSchema`；角色 ID 只来自 actorScope。没有角色时 `actors=[]`，不得补人物。
5. 前端从 prose 切到 tags：只有当当前指令仍是已知默认值时，才替换为 tags 默认；自定义文本保留，并说明 JSON 格式由系统强制。不要静默覆盖自定义内容。
6. prose 请求继续使用原 prose 语义，历史已保存优化结果不重新调用模型。
7. 不自动回写真实数据库里的旧策略，不覆盖旧策略版本。真实配置更新只在数据库健康、用户允许真实联调时通过既有版本化保存流程执行。

建议结构（按现有函数签名实现，不强制照抄新类型）：

```ts
const protocol = DEFAULT_ACTIVITY_IMAGE_STRUCTURED_INSTRUCTIONS;
const rules = instructions.trim() === DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS.trim()
  ? ''
  : instructions.trim();
// JSON 协议、补充规则、合法角色范围均明确分区；最后重申 JSON 协议不可被补充规则覆盖。
return buildTagsSystemPrompt(protocol, rules, actorScope);
```

如果 `instructions` 本身已等于 tags 默认协议，避免把同一段协议再重复加入。

### 5.3 结构化块只编译一次

保留 `optimizedPrompt` 作为展示/兼容字段，不必为了修复改变接口。但最终组装必须区分结构化和 prose：

```ts
// 伪代码：字段映射按现有 V2FinalizeInput 实现。
if (hasStructuredBlocks) {
  return compileVisualPrompt({
    ...blocks,
    naturalLanguage: blocks.naturalLanguage,
    stylePrompt: style,
    loraTriggers: enabledTriggers,
    directorConstraints,
  }).positive;
}
return compileVisualPrompt({
  naturalLanguage: optimizedProse,
  stylePrompt: style,
  loraTriggers: enabledTriggers,
  directorConstraints,
}).positive;
```

具体要求：

- 核对 `v2FinalizeInputFrom()` 是否把 `visualBlocks.naturalLanguage` 带到最终收尾；如缺失，在服务私有类型中补齐。
- 不把已经编译的 `optimizedPrompt` 当作结构化模式的 naturalLanguage。
- `compileVisualPrompt()` 的 actorLabel 与 identity 槽位只输出一次同一人物身份。可让 label 承载身份并从本人物 body 排除该身份；不要全局删除其他人物的相同标签。
- 去重作用域保持人物内和公共块内，不能把两个人共有的衣服/动作合并后失去人物归属。
- 画风质量词和启用 LoRA 触发词保持既有唯一组装规则。
- 历史重绘/细化继续使用原始最终执行快照，不经过新优化器，不改历史图片的提示词记录。
- 镜头、漫画、素材均通过相同收尾逻辑。只核对这三个调用点，不复制三个实现。

### 5.4 本阶段最小验收

使用模拟 LLM，检查实际发送 payload，而不只检查策略表字段：

1. 新注册 tags 默认策略要求 JSON，模拟合法 JSON 可通过解析。
2. 无人物输入只允许空 actors；prose 模式不被误改成 JSON 协议。
3. 单人物 parser → finalizer 完整路径中，身份、动作、景别各一份，画风/触发词不重复。
4. 双人物保持分别归属；合法的相同衣服标签可在两个人物块中各出现一次。

不要以“某个字段单元测试通过”替代完整组装路径测试。

## 6. 阶段 2：修复素材细化归属与提交保护

### 6.1 素材来源查询

文件：`apps/service/src/activities/studio-hires.ts`。

删除使用 `SELECT id FROM activity_image_attempt_outputs` 的错误关联。按真实表字段显式关联：

```sql
SELECT a.id, a.task_id /* 其余实际冻结所需字段 */
FROM activity_media_job_links l
JOIN activity_image_attempts a ON a.id = l.attempt_id
JOIN activity_image_attempt_outputs o ON o.attempt_id = a.id
WHERE l.activity_id = ?
  AND l.slot_id = ?
  AND o.artifact_id = ?;
```

实施前核对当前真实列名；如查询涉及活动归属的其他表，再补相应约束。不要仅把 `id` 改为 `attempt_id` 而保留不明确的外层关联。

要求：

- 图片必须属于当前活动、当前槽位的原生历史；同活动其他槽位也拒绝。
- 多张产物按请求的 artifactId 找到对应 attempt，不默认第一张。
- 归属校验失败时不创建 studio job、生成任务或图片引用。
- 不接受“只要 appId=activities 就允许”的替代判断。

### 6.2 细化版本校验与幂等顺序

复用现有 `assertStudioVersions()`，它目前在 `studio-storyboard.ts`。如直接导入造成循环依赖，可将版本验证函数小范围提取到公共内部模块，更新原调用方；不要复制第二套规则。

预览和新提交都验证请求版本；漫画目标还核对 comicDraftVersion 与画格归属。继承原图参数不意味着可以忽略当前操作对象版本。

提交事务建议顺序：

```ts
const requestHash = studioHash(request);
const old = store.findIdempotent(activityId, request.idempotencyKey, requestHash);
if (old) return old; // 响应丢失后的原请求重发，不被新的草稿版本或配置阻挡
assertStudioVersions(database, activityId, request.versions);
const current = previewStudioHires(...);
if (current.plan.planHash !== request.planHash) throw existingPlanChangedError();
// 校验阻塞条件，冻结，插入任务/条目/来源引用；均在同一事务。
```

- 同键同请求：先返回原任务，不重新预览、优化或生成。
- 同键不同请求：409，不允许改变 seed/参数后复用原键。
- 新任务旧版本：409，零任务插入。
- 已有错误码能够表达版本冲突时直接沿用，不为本轮增加一套错误体系。
- 不盲目把 `canSubmit=false` 全部忽略或全部视为版本冲突。缺快照、文件、来源归属、非法参数属于阻塞；原图描述已变化的提示应按原计划的历史来源规则处理，不偷偷改用当前描述重画。

### 6.3 冻结时保护来源图片

在已完成目标归属验证后，创建任务的同一事务中调用 `createArtifactReference()`：

```ts
createArtifactReference(database, {
  artifactId: plan.sourceArtifactId,
  appId: 'activities',
  refType: 'activity_studio_job',
  refId: `studio-job:${job.id}`,
});
```

`StudioStore.create({ artifactIds })` 当前要求 `activity_assets` 行，而漫画/镜头历史不一定有这种行。本轮可在细化创建函数中，验证原生历史归属后直接建引用；不要为通过验证伪造 activity_assets，也不要放宽所有任务的归属规则。

重复请求不能反复创建任务或重复引用。引用失败要回滚任务插入。既有完成结果的历史引用继续保留。

### 6.4 前端提交前保存

文件：`app/features/activities/components/studio-hires-dialog.tsx`。

- 预览前已有 `beforePreview()` 保存队列；提交前同样 flush 当前编辑器队列。
- 保存失败/冲突时留在弹窗，不发送细化请求。
- flush 后读取最新版本，与本次预览版本比较；已变化则清除预览、提示重新预览，不把新版本塞进旧 planHash 偷渡提交。
- 网络超时重发使用已经冻结的原提交 payload 和同一个幂等键。用户真正修改细化参数/重新预览时清除该 payload，并生成新键；不要让两种情况混在一起。
- 后台任务创建成功、但浏览器响应丢失的场景，不应因重新读版本而强制新建第二个任务。
- 保留最长边、denoise、原图及错误原因；不顺带改弹窗布局。

## 7. 阶段 3：细化重启恢复，按关联任务事实判断

主要文件：

```text
apps/service/src/activities/studio-recovery.ts
apps/service/src/activities/studio-hires-runner.ts
apps/service/src/activities/studio-render-results.ts
apps/service/src/activities/studio-routes.ts
apps/service/src/generation/execution.ts 仅核对既有暂停标记消费者，非默认修改目标
```

### 7.1 不再用 callId 判断“已发给模型”

callId 可能在统一生成任务落库时就存在。不能因为有 callId，就把尚未发给 ComfyUI 的 queued 任务认定为已调用模型。

移除“hires 跳入文本任务分支并 continue”的恢复方式。建议新增小型内部函数 `recoverStudioHiresJob()`，显式处理单条细化 item，不把细化伪装成普通文生图批次。

判断依据：generationTaskId、任务 status、providerTaskId、upstreamMayContinue、产物可读性和已冻结计划。

### 7.2 状态处理表

| 恢复时事实 | 必须处理 |
| --- | --- |
| 原 job 已 queued，但尚无关联生成任务，且 item 尚未执行 | 等待明确恢复；保留冻结 plan/seed，不自动提交 |
| 已关联生成任务，status=queued，providerTaskId 为空，upstreamMayContinue=false | 添加既有 `studio_resume_required` 暂停标记；studio job interrupted；允许用户确认后释放同一任务 |
| submitting/accepted/running，或 upstreamMayContinue=true | 只核对/等待原任务；无法确定则 unknown；禁止创建新任务或自动重投 |
| succeeded/completed 且有可读图片 | 收集所有图片、同步对应原生历史和 studio 结果；history_only，不自动选图 |
| completed 但没有可读图片 | 明确产物不可用；保留日志和引用，不宣称成功 |
| failed/abandoned/cancelled 且上游不会继续 | 按真实终态记录；用户要重试须明确新建，不在恢复过程中偷偷重画 |
| 已停止 job 的迟到图片 | 保留取消意图，但仍可进入历史；不写当前画面，不自动续跑 |

### 7.3 安全恢复的实现要求

- 恢复 queued 任务只清除暂停标记，继续使用原 taskId、seed、冻结 workflow 和 submission key。
- `resumeStudioJob()` 必须基于上述关联任务事实验证安全性，不能一律 `job.callId != null` 就拒绝。
- 请求仍使用 expectedJobRevision/planHash/itemIds，重复恢复不二次释放或新建任务。
- 对关联任务状态使用带条件的 UPDATE；在检查和变更间任务状态改变时拒绝恢复，不无条件改回 queued。
- 复用 `collectStudioRenderResult()` 和对应原生同步器，不重写三套产物落库。
- 细化的候选自动入镜状态仍保持禁止；所有重启/迟到结果不得修改 `SceneBeat.mediaUrl`、漫画 selectedImage 或素材绑定。
- 恢复与结果收集可以重复执行，不重复插入历史。没有新增网络请求，不补调用提示词模型。
- 不修改全站 generation 状态机，不新增数据库迁移；如实际发现不可避免的结构变更，先报告原因与最小方案。

## 8. 最小自动化范围：约 12–15 个关键行为

不要重复跑上一轮 595 项服务测试。新增用例统一在名称中加入 `parity-round2:`，放入最接近业务的现有文件，允许参数化，不为凑数量拆成几十条。

| 文件 | 本轮要覆盖的行为 |
| --- | --- |
| `apps/service/src/activity-parity-config.test.ts` | 默认 tags 策略的实际系统指令含固定 JSON 协议；不误改 prose/用户自定义规则 |
| `apps/service/src/activity-prompt-v2.test.ts` | parser→finalizer 单人物无重复；双人物归属与各自合法重复保留；无人物输入保持空 actors |
| `apps/service/src/activity-image-hires.test.ts` | 当前槽位有效来源成功；其他槽位/其他活动拒绝；旧版本拒绝；同键重发返回同任务、同键不同参数拒绝；冻结立即保护源图片 |
| `apps/service/src/activity-studio-recovery.test.ts` | 带 callId 的 queued 关联任务被暂停且可显式恢复；运行/未知任务不重投；迟到结果进入历史不选图；重复恢复/收集不重复记录 |
| `app/features/activities/lib/hires-request.test.ts` 或已有适合的前端测试文件 | 预览后版本变化/保存失败不提交；响应丢失重发保留 payload 和幂等键 |

测试夹具必须模拟真实 `onInsertTask` 后的状态：studio job 已有 callId，item 已关联 generationTaskId，但生成任务仍 queued。不要在测试开始前手工加好暂停标记，然后把结果当成恢复逻辑已完成。

基础执行命令（先核对文件存在）：

```powershell
node --import tsx/esm --test --test-name-pattern="parity-round2:" apps/service/src/activity-parity-config.test.ts apps/service/src/activity-prompt-v2.test.ts apps/service/src/activity-image-hires.test.ts apps/service/src/activity-studio-recovery.test.ts app/features/activities/lib/hires-request.test.ts
npm run typecheck
```

要求：检查匹配测试实际执行数，不允许全部 skip 后报告通过。修改一个测试文件后只重跑该文件的本轮用例；最后合跑一次并运行一次类型检查即可。

仅按需增加：

- 改了共享 TypeBox/API 字段：`npm run test:contracts` 一次；原则上本轮不需要改 Schema。
- 抽取版本验证函数影响旧调用：补跑原文件中 1–2 个相关旧用例，不扩大全部 Story/活动测试。
- 不默认运行 `npm run test`、`ci:core`、`verify`、全部 Playwright、全量构建、全量截图。

不要为本轮重测主题、角色发布、DSH、离线包、全站路由等无关功能。

## 9. 最小页面检查与真实联调

### 9.1 页面检查：只查改动页面

使用隔离数据库/夹具，不允许浏览器脚本默认指向真实业务库。

只检查一次桌面 1440×900 和一次窄屏 390×844 的细化弹窗：

1. 预览正常；预览后修改并保存目标内容，提交时提示重新预览。
2. 保存冲突保留输入与参数，不创建任务。
3. 模拟响应丢失，同键重发只有一条任务；修改参数后是明确的新请求。
4. tags/prose 切换的默认指令及自定义规则不被静默覆盖。

沿用项目组件和错误提示。仅保存必要截图，实际查看；不批量更新旧视觉基线。

目录：`artifacts/activity-image-parity-round2/<本轮时间目录>/`。

### 9.2 真实调用门槛

只有同时满足下列条件，才执行真实联调：

- 实际数据库健康，或另有明确配置的隔离测试数据库。
- 测试服务的数据库、产物目录、端口均显式隔离，不与生产容器共用；启动前确认路径。
- 有可用的已配置活动文本模型。不要擅自填密钥、切换全局默认、复制其他项目凭据或关闭优化。
- 已有 ComfyUI 工作流/模型可用。

环境不满足就登记“外部阻塞”，不通过手工英文或禁用优化绕过去宣称完成。

### 9.3 真实预算：最多四个生图任务

在明确的新验收活动中准备一个镜头、一个漫画画格、一个 image 素材槽位，复用已发布工作流/预设，不碰用户原活动。

| 调用 | 内容 | 必须记录 |
| --- | --- | --- |
| 1 镜头 | 中文人物动作描述 → tags/keyword 优化 → 生图 | 优化 callId、生成 taskId、最终编码文本、角色动作无重复 |
| 2 漫画 | 中文画格描述 → 同一优化链 → 生图 | 不要求用户手工写英文，结果只进入漫画历史 |
| 3 素材 | 无人物道具/空场景素材槽位 → 优化 → 生图 | actors=[]；沿用 recipe/compilation/attempt，不新造入口 |
| 4 细化 | 对上面一张图执行一次基础细化 | 原图哈希不变、来源/参数对应、只进入历史、没有额外优化调用 |

四个任务是总预算，不是每次运行脚本的预算；发送到 ComfyUI 的失败任务也计入。不做 A/B 多 seed，不补 Turbo 和 LoRA 的全套真机验证。LoRA 文件仍缺失时直接保留未验证，不下载或装模型。

一次失败先看日志，能用模拟定位就不再真实调用。需要超出四次时给出原因并让用户决定，不循环运行旧 stage7 脚本。

真实观察只需确认明显的主体、动作、空场景是否合理；不宣称仅凭一张图已保证人物一致性或全面画质提升。

## 10. 交付报告与完成条件

新增报告：`docs/development/logs/activity-image-parity-round2-result.md`。不要把原计划全文重写为“全部完成”。

报告必须包含：

```text
1. 本轮改动文件与职责，既有改动如何保留。
2. 数据库：实际路径、只读检查结果、备份状态；是否有真实写入及其授权。
3. 任务逐项：tags 指令、唯一组装、素材归属、版本/幂等/引用、细化恢复。
4. 本轮测试：实际执行命令、通过/失败/skip 数；类型检查结果。
5. 页面：桌面/窄屏证据及检查结果。
6. 真实联调：实际次数、优化 callId、生成 taskId、artifactId；未执行的具体原因。
7. 尚未完成事项与外部阻塞；不能把关闭优化的样例算成自动优化成功。
8. 是否部署/提交/推送：本轮默认均为否。
```

对上一轮报告追加短更正说明：

- 原“4C 恢复通过”需以本轮真实状态夹具结果重新判定。
- 素材是原计划明确要求的第三入口，不以“独立子系统”排除其验收。
- A/B 与漫画关闭优化的样例只能证明对应出图/组装路径。
- 数据库旧检查通过是当时结果，不能代替当前健康状态。
- 原计划真实预算不能只按最后一次脚本的成功样例计数；本轮独立记录实际提交总数。

完成等级必须分开：

- **本轮代码修复完成**：上述缺陷修复，定向测试及类型检查通过。
- **本轮真实联调完成**：数据库/隔离环境安全，四个关键任务及对应日志验证通过。
- **原 V2 计划全部完成**：本轮不默认宣称；真实 LoRA、其他原计划未验收项仍按原门槛登记。

## 11. 明确保留到后续、不要顺便展开的事项

- 提示词 request hash V1/V2 兼容、知识版本完整纳入缓存键的全面审查。
- 结构化输出总长度/总标签数、导演约束优先级的完整升级。
- 多实例 loader/engine 冻结解析的广泛兼容扩展。
- 全量 UI 诊断展示、全部日志字段可视化、峰值显存测量。
- 原计划剩余对照实验、真实 LoRA、完整发布与部署。

如果本轮核心修复必须触及其中某项，只实现解除当前缺陷所需的最小部分并注明；不能将其自动扩展为另一轮大开发。

## 12. 给接手模型的执行摘要

先核对工作区并做只读数据库诊断；真实库异常不阻断内存测试，但阻断真实库操作。随后修 tags 输出协议和一次组装，再修细化来源、版本/幂等/引用及重启恢复。只跑名称带 `parity-round2:` 的针对性用例和一次类型检查；只检查相关弹窗。环境安全时最多做四个真实生成任务，否则如实交付代码结果及阻塞说明。全过程不部署、不提交、不覆盖数据，不把局部成功写成原计划全部完成。
