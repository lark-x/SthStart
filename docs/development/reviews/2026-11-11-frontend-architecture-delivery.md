# 2026-11-11：前端架构整理交付

状态：S0–S6 本轮代码与集成验收完成；保留 React，未提交。架构阶段单独交付时未部署；随后已随故事世界集成部署至9320，见[当前交付记录](2026-11-11-story-worlds-delivery.md)。
关联：DEV-014 至 DEV-020；[架构标准](../../FRONTEND_ARCHITECTURE.md)、[实施计划](../FRONTEND_ARCHITECTURE_PLAN.md)。

## 基线与保护

- 分支 `feat/warm-paper-ui`，起点 `68090f7afdf87092c2d30ce73dfd92b2fc99ff9b`。起点包含用户已有未提交 UI、测试和文档改动。
- 建立 1,215 文件的独立源码副本和逐文件 SHA256 清单，未 reset、stash 或覆盖已有工作。证据根为工作区同级 `SthStart-architecture-20261110/`，清单位于 `baseline/baseline-manifest.json`。交付前复核仅两份基线测试（activities/portal）的选择器因基线复跑而变化，产品源码仍与原SHA清单一致；恢复测试时按下条记录反向核对，不能把调整后测试冒充原快照。
- 基线 typecheck、构建、门户测试通过。代表性浏览器首轮 42/45 通过；旧导入菜单、导航按钮选择器修正后与角色用例单独复跑 3/3 通过。
- 所有写入测试使用临时数据库、媒体目录及测试会话；真实服务、用户库、邻舍子模块未修改。

## 实际架构

| 单元 | 当前职责与入口 | 兼容约束 |
| --- | --- | --- |
| S1 基础 | Backups 纯工具进 model；Characters 浏览、筛选 UI 与分页分开；Theme/Toast Context 分开；各域 query-keys | 查询键元组值保持；旧 ui-provider 与 query-keys 纯重导出 |
| S2 编辑器 | Story 工作台/正文、角色表单与素材动作、Notebook 内容/焦点/本机保存分别拆分 | Story 修订与 flush、RHF 单表单、Notebook IndexedDB/local-store/sync 保留 |
| S3 组合 | shell 负责导航/命令/任务；workspaces 负责首页、资料库、项目、Story 制作动作、生成来源及媒体采用 | features 不反向依赖 workspaces；旧笔记 URL 由 notebook-entry 适配 |
| 服务边界 | app/server 管理会话与桥接策略；app/api 保留原 URL | 客户端不可达服务专用实现，代理语义未改 |
| S4 制作 | planning、studio、images、comic、publication、playback；api/queries/mutations 按子域拆分 | 原 199 个运行时导出均有对应声明；旧入口单向转发 |
| S5 加载/样式 | 按活动类型加载工作台，Studio 的素材/漫画/播放/导出按需加载；CSS 保持原序拆片 | 编辑会话在面板外；拒绝缓存以同源资源重试；样式不重新设计 |
| S6 持续检查 | scripts/architecture/check.mjs 纳入 ci:core | 文件与模块循环、基础层反向依赖、纯模型、客户端服务边界、过期例外检查 |

保存差异保留如下，不强制所有编辑器使用同一存储：

| 编辑器 | 存储与版本 | 公共部分 / 独有行为 |
| --- | --- | --- |
| Studio | sessionStorage，activity-draft，draftVersion | DraftSaveController/Queue；目标分镜图片合并不覆盖正文 |
| Comic | sessionStorage，activity-comic-draft，contentRevisionId + draftVersion | 公共计时/等待；漫画页/画格与来源版本校验保留 |
| Publication | localStorage，publication-draft，draftVersion | 公共计时/等待；TypeBox 校验、手动恢复、后台媒体采用守卫保留 |
| Story | 原草稿 Hook 与修订机制 | 保留原实现；上层制作动作先 flush 再冻结最新章节修订 |
| Notebook | 原 IndexedDB、本机优先与 sync | 只拆接入，不改变库名/版本/键/附件及冲突副本 |

整合时修复：卸载取消保存计时、干净 flush 不进入保存中、等待进行中的漫画/出版保存、Story 制作弹窗接收实时章节上下文、图片历史为空时的空值访问、策划提交在事件中读取 ref。加载失败的真实浏览器测试发现原 React.lazy 重建不能解除浏览器 URL 拒绝缓存，已补同源 chunk 的显式重试。嵌套 Suspense 曾造成约 0.6 秒启动等待，改为模块就绪后立即展示后消除。

## 验收证据

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 架构 | 574 文件 / 2,035 条本地依赖；文件循环、模块循环、违规、过期例外全部为 0 | 无 exceptions.json 豁免；检查器 4 个行为用例通过 |
| 类型 | workspace typecheck + 最终 tsc --noEmit 通过 | 新增浏览器用例也被类型检查 |
| 核心回归 | 209 文件首次 208 通过，1 个子进程退出；该文件单独复跑通过 | evaluator.test.ts 退出码 3221226505；完整首轮 1,016 tests，1,013 pass/1 fail/2 skip。不是一次全绿的 ci:core |
| 构建/规则同步 | 门户、服务构建通过；skills:sync --check 通过 | 后续面板修正重建门户通过 |
| 门户逻辑补验 | LazyPanel、路由、保存控制器、策划模型定向测试通过 | 最终加载实现重新执行两组单测 |
| 浏览器集成 | 初轮 65 项：60 pass/4 fail/1 skip；修复后相关 17/17 通过 | 初轮四项分别为空历史回归、基线顶栏56px断言仍写52、搜索框hydration前输入、缓存拒绝重试；均已解决 |
| 候选采用 | 原跳过的隔离库用例单独 1/1 通过 | 采用两项后恢复剩余项 |
| Story 学习链 | 3/3 通过 | 编辑→MCP→提案接受/拒绝，503/409 保留本机输入 |
| 生成流程 | 模拟服务生产浏览器 14/14 通过 | 简单/专业、手动提示词、配置隔离、头像/场景/漫画、移动端 |
| 出版链路 | 新增 2/2 通过 | flush→冻结最新章节修订→创建制作→对白保存/刷新；409 本机恢复且服务端不变 |
| 加载恢复 | 生产浏览器通过，最终加载实现复跑通过 | 故意中断素材工作台 chunk，恢复网络重试，编辑保留与再次打开 |
| CSS | 四个入口展开后的 AST 顺序完全相同 | globals 177、shell 223、workspace-b 47、unified 36 顶层节点；包含嵌套规则与声明顺序 |
| ESLint | app/ 基线 70 errors，最终 59 errors / 136 warnings；新增错误 0 | 59 项是原有或同逻辑搬迁问题；全目录 lint 尚非全绿，不扩大本轮重构去批量改变既有逻辑 |

去重后的相关浏览器业务用例共 86 项通过（65 个原集成项含补跑跳过项、Studio 新增 2、Story 专项 3、生图 14、出版 2）；性能测量另列。截图实际查看了浅色角色列表、深色笔记/长文插入、Story 正文、桌面及390px Studio、移动绘制弹层。1440/1920/1024/390 多视口及四主题自动断言通过。生产预览日志偶见 Vinext `ERR_STREAM_UNABLE_TO_PIPE`（页面切换取消响应），保留原日志；不等同于页面功能失败。

可复跑入口：`npm run check:architecture`、`npm run test:architecture`、`npm run typecheck`、`npm run test:regression`、`npm run skills:sync -- --check`、`npm run build`，浏览器配置与文件见实施计划及 `architecture-*.spec.ts`。CSS 对照：`node scripts/architecture/compare-styles.mjs <baseline-root>`。

## 性能对照

生产构建，Chromium 151.0.7922.34，1440×900，reduced motion，本机网络，每次新 context，每路由5次；固定25笔记、1章节、1角色与活动fixture，800ms稳定等待。首次测量发现启动等待并修正；随后遇到各页共同变慢，依次重新测基线与最终版本以检查环境波动。下面是相邻复测的中位数。原始值和所有范围保存于[机器可读证据](2026-11-11-frontend-architecture-evidence.json)。

| 页面 | 解码后 JS：前→后 | JS 请求数 | API 数 | 页面可操作+800ms：前→后 | 输入/翻页：前→后（ms） |
| --- | --- | --- | --- | --- | --- |
| Story | 1,880,594→1,881,873 B（+0.1%） | 192→194 | 9→9 | 1196→1239 ms | 63.6→61.4 |
| 资料库 | 1,253,910→1,241,831 B（-1.0%） | 138→141 | 5→5 | 1073→1064 ms | 70.5→77.4 |
| 角色 | 1,667,276→1,662,854 B（-0.3%） | 183→184 | 5→5 | 1098→1153 ms | 64.8→59.5 |
| 制作 | 1,966,579→1,739,243 B（-11.6%） | 194→193 | 7→7 | 1239→1251 ms | 51.9→63.5 |

制作传输量 2,024,779→1,797,143 B（-11.2%），减小约228KB解码后JS。最后一轮制作输入中位数+11.6ms/+22%，范围50.7–72.2ms与基线50.1–66.0ms重叠；前一轮最终实现67.9ms与最初基线69.1ms接近，因此未证实持续输入退化。资料库预取会使个别样本请求数/字节增多；同样记录范围。不得据此宣传各页固定提速，readyMs也不是LCP。未测堆内存或公网真实设备。

## 兼容、候选与恢复

- 保留 Activities 的 api/queries/mutations 与 studio-*、beat-renders-api 兼容导出，内部新代码直引子域；保留旧图片/播放入口单向转发。集中 query-keys 与 ui-provider 仅作兼容。
- 删除已全仓库核对无调用方的旧 shared 外框、首页组件、server旧位置、resources组合和project-workspace旧入口。原始静态不可达的旧 records/scene 工具未批量删除，仍可能服务旧链接/制作迁移，不能仅凭静态计数认定废弃。
- 恢复单位依次为基础/每个编辑器/每个跨域组合/每个制作子域/加载与CSS；从基线清单校验对应文件的原文，按单元恢复调用方和兼容入口。禁止整体覆盖工作区；新增文件仅在确认属于该单元且无新调用方时移除。
- 未改数据库结构、接口字段、Query键、IndexedDB版本与草稿键，代码回退不要求删除用户数据。样式回退同时还原入口顺序，不能只拷贝某个片段。

## 限制与后续标准

- 真实GPU/ComfyUI付费生成、长期多设备同步、真实物理中文输入法和手机软键盘未做实机验收；当前覆盖模拟网络、合成组合事件和缩小视口。这些边界沿用已有延后验收，并新增记录。
- 本轮没有声称遍历所有可能的附件故障、导出格式或设备组合；服务回归覆盖相关媒体/导出逻辑，浏览器重点覆盖本次变动的保存与组合链路。
- 既有 lint 债务单列 DEV-021，不将其算作本轮新增。新功能必须使用本次规范；局部修复不要求搬迁无关模块。加载故障重试实测覆盖当前 Chromium/Vinext 同源入口 chunk；不同浏览器错误格式及依赖 chunk 多点故障不在这项证据内。
- 架构阶段无 Git commit/push、无部署/容器重启；后续获准的故事世界集成已将这些改动一并部署，当前部署与真实数据保护以其交付记录为准。
