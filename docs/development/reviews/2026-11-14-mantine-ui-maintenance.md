# Mantine 组件归属与迁移验收记录

适用于 [SthStart 全站 Mantine 升级计划](../2026-11-13-MANTINE_FRONTEND_UPGRADE_PLAN.md)。本地 9320 已完成切换并通过上线后检查。下文记录组件维护约定、各候选验证及最终交付证据。

| 需要修改的内容 | 修改位置与规则 |
| --- | --- |
| 颜色、字号、间距、模块识别色 | `app/styles/theme.css` 保留四套主题和已有偏好键。 `app/styles/mantine-bridge.css` 只把这些变量映射给 Mantine，不能独立定义第二套产品配色。 |
| 通用交互与布局 | 业务页面复用 `app/components/ui` 与 `app/components/shared`。控件层只处理语义、样式、焦点和状态展示；请求、筛选、保存及草稿留在各业务模块。 |
| 新的 Mantine 样式 | 优先复用现有适配器；如新引入组件，核对它使用的 CSS 入口和项目变量。需要官方样式时从 `app/globals.css` 按组件引入对应的 layer 样式。检查生产构建中是否增加全局 CSS 或首屏 JS。 |
| 弹窗、抽屉和子浮层 | 共享适配器协调原生对话框及 Mantine 浮层。子弹层必须在有效的对话框面板内；验证 Esc 只关一层、关闭回焦、滚动隔离。保留输入法组合事件守卫。 |
| 原生元素 | 保留语义化布局、简单原生选择器、文件上传、范围／色彩输入，以及平台或编辑器专用交互。按钮和输入有重复的通用呈现时优先迁移；单独核对拖拽、时间轴、画布和阅读器，避免损坏键盘、手势和媒体行为。 |
| 专用模块 | 节点图、Markdown、视频播放和邻舍 iframe 保持原有业务实现；工具栏、反馈和外围操作遵循共享组件规则。 |

第九次固定版本 `5bdb60cc1ea54515b32fb976d4ba439a82f19972` 的源码检查按文件记录了入口、功能、工作台、外壳和共享组件的原生 JSX。相同口径下，基线 799 个，第四版 593 个，第九版 513 个。第九版实际导入的通用 UI 库为 `@mantine/core` 和 `@mantine/hooks`，未发现旧 Radix 导入。

数字包含原生对话框、语义折叠面板、文件输入、取色和播放器滑块，不能直接作为迁移率。复查区分专用交互与可迁入共用控件的操作。活动分镜检查器、生成结果和记录编辑、角色公共资产仍有可统一的普通操作。第九版逐行清单在本地 `artifacts/mantine-upgrade-20261113/frozen-9-native-controls.json`。最终版本需重新清点，并记录页面与键盘实测结果。

第九版已通过 Chromium 桌面和手机的 29 入口检查，以及四种视口和主题的代表页检查。对 WebKit 改用同一浏览器上下文中的独立页面后，29 个手机入口也全部通过；媒体页须等列表请求真正成功，角色筛选抽屉底边距视口底边不超过 2 CSS px。WebKit 全站导航的关闭回焦仍有偶发失败，未达交付门槛。截图与浏览器报告在本地 `artifacts/mantine-upgrade-20261113`。

同一脚本在 Chromium 上顺序测原版与第九版，每页各五次。故事、角色、活动的脚本解码量分别增加约 144、161、161 KB，三个页面的 CSS 传输各增加约 57 KB。资料页基线在观测窗口内有两种预取状态，不能据中位字节直接判定改善。四个页面的就绪中位数增加约 102–234 ms；同一机器仍有后台服务回归运行，最终版须在条件一致时复测。数据：`baseline-recheck.json`、`frozen-9-perf.json` 和 `frozen-9-perf-delta.json`。

第十二次固定版本 `3b7e95d9a5a85bfe1bfa93f401136eea27c32226` 同口径为 424 个原生标签，通用 UI 导入只有 Mantine core/hooks。实际测量确认媒体预览面板在两浏览器桌面视口居中、窄屏操作可达；长笔记正文由编辑区整体滚动。真实轮滚和鼠标触发补出了 WebKit 背景滚动与媒体预览回焦问题；独立 IndexedDB 探针复现了本机临时 WebKit 浏览器会话不能存放 Blob/File，笔记插图需在能持久写入的 WebKit 会话复验。报告 `frozen-12-focus.log`，当前为 Chromium 7/7、WebKit 4/7。Windows 的七张截图已逐张检查，控制中心总览使用固定数据直接显示完整面板；macOS 截图基线仍待在目标系统生成并复核。

第十二版和原版使用同一脚本、同一 Chromium、同一夹具，分别连续采样 20 次。故事、资料、角色、活动页面的就绪中位数差分别为 −38、+21、−2、−105 ms；操作差为 −31、+5、−11、−4 ms。样本量不足以证明加速，本轮没有出现一致的操作回退。故事／角色／活动 JS 解码量约 +146／163／163 KB、CSS 传输约 +59 KB；资料页 JS 仍受预取影响，CSS 传输约 +33 KB。两侧无页面脚本错误，各路由长任务次数中位数为 0。记录 `baseline-final-recheck-b.json`、`frozen-12-perf.json`、`frozen-12-perf-delta.json`。原版第一次采样出现浏览器 `ERR_NO_BUFFER_SPACE`，无完整输出，未计入结果。

第十三次固定版本 `11d80780bc70d15402416a2d68b77ef655891834`：Chromium 与 WebKit 各完成桌面和手机 29 入口，共 116 次页面检查。故事世界 9/9、模拟生图 14/14、活动返工 4/4、学习与异常保存 3/3。弹层专项 18/20：WebKit 背景滚动和媒体回焦已通过；条件卸载的备份恢复预览在两浏览器中关闭后未回到触发按钮，仍在补修。第十二版 Chromium 扩大回归 165/169（2 失败、2 跳过），七张 Windows 截图均通过；角色页签追加客户端就绪门槛后独立重复 4/4，笔记入口重新纳入上述双浏览器独立矩阵并通过。尚未进行正式切换。

第十四次固定版本 `d989a7c17fd2e7962ae5f3f8c2ce20b82e0cfdd0`：弹层专项 20/20，备份恢复和删除取消均回到原按钮；角色／活动／邻舍流程和 Windows 截图共 22/22。架构 627 文件、2486 本地依赖、0 违规，门户类型检查通过。原生标签降至 360，导入仍只有 Mantine core/hooks。定向 lint 中活动生成对话框两项 React 规则错误在原始基线同样存在，未计为本次新增。持久 WebKit 会话能写入图片；主代理重复长笔记时复现一次真实版本冲突：同一笔记第一次 PUT 带 rev1 成功成为 rev2，紧接第二次仍带 rev1。该问题独立处理，验收须验证后写的本机编辑及真正的服务端冲突。当前没有发布到 9320。

第十六次固定版本 `e620221d17fca083819c464046bf15bb82d26ecc`：生产门户和同修订 Docker 镜像已构建，29 路由 × 2 尺寸 × 2 浏览器及 8 组代表布局全部通过；WebKit 专项 40/40，真实断网重开笔记、插图与修订冲突通过。断网用例先等待 Service Worker 接管和缓存就绪，再让隔离源站拒绝新连接，验证实际缓存响应。Chromium 扩大回归 160 通过、3 失败、1 跳过（活动返工走独立配置）。首个主题点击在客户端接管前，强调色关闭回焦及叙事导入切页仍需复验。第十五版完整 `ci:core` 241 文件通过；第十六版笔记修订专项单测 11/11。上线尚未执行。

候选残留仍有原生语义、专业编辑控件与少量普通表单。活动企划、分镜、绘图设置和角色邻舍资产的普通控件继续收口；读者视图、时间轴、画布、文件选择、范围输入及原生折叠保留。原生标签数量仅用于定位，不作为迁移率。每次复核以最终源码清单和代表页实际操作为准。

第十七次固定版本 `c13adce8b4dc925b766cc7454ac329804c6b1ef1`：补齐活动制作、角色资产、生成设置、笔记和资料等普通表单入口。旧的未载入样式已移除；确认有缺失的提示框和开关样式进入全局组件层，调用方仍可按场景调整尺寸。最终源码初审 628 个生产文件，只有 Mantine core/hooks 作为通用组件依赖；原生 JSX 标签 284 个，其中三个下拉框是生日组合选择器。其他原生项按用途保留，包括原生折叠、文件选择、范围和部分数值输入、JSON 与正文编辑、卡片选择、外壳焦点触发点。逐行清单在本地 `artifacts/mantine-upgrade-20261113/frozen-17-native-controls.json`。

第十七版定向：主题切换和强调色回焦两引擎分别重复两次，共 8/8；叙事视觉 Chromium 2/2，实际前进后退、角色筛选、活动预览及日历等双浏览器 20/20；笔记及叙事单测 15/15。全量、镜像和最终性能仍在验收。

第十六版静置前后顺序复测（同脚本、同数据、每页五次）：故事／资料／角色／活动就绪差 +133／+11／+141／+28 ms，操作差 −13／+26／+4／−4 ms，脚本解码增加 149–169 KB、CSS 传输增加约 63 KB，四页均无脚本错误，长任务次数中位差为零。第十二版时间结果的方向不完全一致，字节开销稳定可见。按组件引入样式与静态主题桥接已减少重复开销；延迟加载命令面板的独立试验只减约 1.5 KB gzip，延迟抽屉却推迟了实际可聚焦时间，均未合入。不能将本次迁移表述成性能提速。

已发布产品修订 `6415d44ffd73206ef9fee1285a70c740426b98e8`，Mantine core/hooks 9.8.0。最终验收用例修订 `84f0ca082dbca3423840109bb880dc2c3c3fa7bc` 只调整两个 E2E 文件；应用、服务、静态资源、依赖锁和部署配置等 13 项 Git 对象与镜像源完全一致。相同产品 29 路由 × 2 尺寸 × 2 引擎和 8 组代表布局全过。Chromium 扩大回归 163 通过、1 项浏览器创建页面前退出、1 项转独立返工配置；WebKit 51 通过，另有 4 项主题用例和 1 项邻舍用例的旧测试夹具需要修正。邻舍触控以相同产品、隔离夹具复跑，两引擎各两次均通过。四主题在两引擎以每路由一个页面重跑 8/8，保留实际对比度、切换、加载与页面脚本异常断言。Windows 七张视觉基线全过，控制中心警告框的新外观在两次独立截图逐像素相同，核实后更新该基线。原跑和复跑均存档于 `final-browser-evidence.json`。

Linux 发布镜像 `sthstart:mantine-6415d44ffd73` / `sha256:2d0d900806dbb09698f58ecaeddcfbd3820f2dd9c30089fc5c23e9a0dc2bf808` 先在隔离环境通过健康及九条实际页面检查，再切换本地 9320。上线后门户和 API 都返回 HTTP 200，首页、角色、活动、日历、笔记、资料、媒体、控制中心和备份均通过 Chromium 只读验证，未发现脚本异常或横向溢出；配置与两个数据挂载保持一致。旧运行版本保存为 `sthstart:mantine-rollback-20261114-043743`。本地工作区保留原暂存状态，没有推送远端。详见 `artifacts/mantine-upgrade-20261113/frozen-19-local-deploy.log`。

最终 `npm run ci:core` 通过：架构、类型、242 个回归测试文件和生产构建。独立业务验收 30 项通过，覆盖故事世界、模拟生成、活动返工和学习流程。最终源码清点在 628 个生产文件中确认通用组件仅导入 Mantine core/hooks，原生控件相关 JSX 从 799 个降到 284 个；保留的典型用途包括文件选择、阅读器、画布、时间轴和具备原生语义的交互。清单在 `artifacts/mantine-upgrade-20261113/frozen-19-native-controls.json`。

最终产品性能报告（本机 Chromium 151、相同脚本和测试数据、原版与候选各 20 个样本，每页五次；两段采样顺序执行，同机有独立核心回归进程）：

| 页面 | 就绪中位差 | 操作中位差 | JS 解码增加 | CSS 传输增加 |
| --- | ---: | ---: | ---: | ---: |
| 故事工作台 | +96 ms | −8 ms | 148 KB | 69 KB |
| 资料库 | +26 ms | −6 ms | 169 KB | 68 KB |
| 角色编辑 | +52 ms | +5 ms | 164 KB | 69 KB |
| 活动工作台 | +7 ms | +1 ms | 163 KB | 69 KB |

长任务次数中位差为零，没有页面脚本异常。启动耗时和资源开销有上升；就绪后的操作耗时没有一致退化。原始范围、传输量和样本：`artifacts/mantine-upgrade-20261113/frozen-19-perf-delta.json` 及两份对应原始 JSON。

本轮实际使用 Windows Chromium 与 Windows WebKit。macOS 视觉基线和真实移动设备／输入法没有运行：已核对短视口及模拟组合事件，但不能替代 Safari/macOS 渲染或实体键盘、触屏验证。既有 macOS 视觉工作流保留，可在获得目标系统时补测；没有覆盖这两类基线。

## 后续全站收敛与去自研升级（2026-11-14 Wave 1 & Wave 2）

在 `6415d44ffd73` 基线之后，工作区继续完成了两轮收口改造（尚未执行 Git 提交或重新部署至本地 9320 容器）：

### 1. 工程卫生、文档与全站普通原生控件收敛（Wave 1）

- **文档与 Lint 卫生**：`docs/FRONTEND_ARCHITECTURE.md` 同步 Mantine 9.8.0 架构决策、公共适配器边界、浮层规则与升级门禁；`eslint.config.mjs` 的 `globalIgnores` 补充 `artifacts/**`、`data/**`、`workers/**/data/**`、`.vinext/**`、`scratch/**`、`test-results/**`、`playwright-report/**`、`coverage/**`、`dist/**`、`**/dist/**`、`.wrangler/**`、`.dsh-tmp/**`、`.pai/**`、`.zcode/**`、`**/.venv/**`、`**/*.min.js`、`temp_harness_output/**`、`experiments/**`、`upstream/**`、`dsh-mcp-servers/**`，消除扫描生成物与压缩脚本导致的 `npm run lint` 卡顿；同步清零 `mantine-theme.test.tsx`、`command-registry.tsx`、`ai-logs-client.tsx` 定向 lint 警告，并从 `mantine-controls.ts`、`button.tsx`、`page-tabs.tsx` 清理无引用冗余类名 `buttonRoot`、`buttonSection`、`tabsList`、`tab`。
- **普通原生控件收敛统计（非 `app/components/ui/` 且非测试文件）**：
  - Wave 1 前基线：`<button>` 140、`<input>` 50、`<select>` 3、`<textarea>` 5、`<details>` 84。
  - Wave 1 后收敛至：`<button>` 39、`<input>` 34、`<select>` 0、`<textarea>` 1、`<details>` 82。
  - Wave 2 补齐 `CalendarView` 图例复选框、`RowActionsMenu` 触发器（迁至 `IconButton`）与 `ToastProvider` 关闭按钮后最终收敛至：`<button>` **38**、`<input>` **33**（全部为专用原生输入：`file` 14、`radio` 12、`range` 6、`color` 1）、`<select>` **0**、`<textarea>` **1**（`story-entry-text-canvas.tsx` 正文核心画布）、`<details>` **82**（剩余均为原生语义折叠）。

### 2. Mantine 原生浮层、通知与命令面板去自研升级（Wave 2）

- **依赖与样式桥接**：安装 `@mantine/notifications@9.8.0`（保留自研语义化 `CalendarView` 网格与 `Modal + Combobox` 命令面板，未引入 `@mantine/dates` 与 `@mantine/spotlight`）；`app/globals.css` 显式补入 `Overlay`、`Paper`、`CloseButton`、`ScrollArea`、`Combobox`、`Loader`、`Notification` 与 `@mantine/notifications/styles.layer.css`；`app/styles/mantine-bridge.css` 补齐 `--mantine-line-height-sm`、`--mantine-color-dark-0` 及 Modal/Drawer 遮罩、Notification 语义状态色、Combobox 表面样式；`app/providers/mantine-theme.test.tsx` 变量门禁同步扩展覆盖 `@mantine/notifications/styles.layer.css`。
- **浮层与焦点去自研**：`Dialog`（`app/components/ui/dialog.tsx`）与 `Drawer`（`app/components/ui/drawer.tsx`）从原生 `<dialog>.showModal()` 全面迁至 Mantine `Modal` / `Drawer`；抽取共享 `useWebKitReturnFocus`（`app/components/ui/use-webkit-return-focus.ts`，替代 Mantine `returnFocus` 以兼容 WebKit 指针点击与条件挂载弹窗）、`useOverlayEscapeLayer`（LIFO Esc 逐层关闭与 IME 保护）、`useModalFocusContainment`（背景 `inert` 与焦点边界）及 `OverlayFlexScrollArea`（透传内容，避免 `DrawerContent` 内置 `100vh` 滚动容器破坏手机贴底抽屉与短视口滚动）；全仓清理残留的 `dialog[open]`、`.showModal(`、`.ui-dialog`、`.ui-drawer`、`ui-command-` 选择器（**0 命中**）。
- **命令面板与通知重构**：`CommandPalette`（`app/components/ui/command.tsx`）重写为 Mantine `Modal` + `Combobox`（保留 `hasBlockingModal()`、`Ctrl/Cmd+K` 开关、CJK IME 守卫与既有 ARIA 标签）；`ToastProvider`（`app/providers/toast-provider.tsx`）基于 `@mantine/notifications`（`createNotificationsStore()` + `Notifications` + `Notification`）重构，维持 Context 订阅隔离、`MAX_VISIBLE_TOASTS = 3` 淘汰与既有 `useToast` / `useUI` 接口。

### 3. Wave 2 最终验证结果与当前状态

- **静态与单元测试门禁**：
  - `npm run check:architecture`：exit 0（`629 files, 2585 local edges, 0 violations, 0 stale exceptions`）。
  - `npm run typecheck`：exit 0（主工程与 `@sthstart/service`、`@sthstart/activity-playback`、`@sthstart/contracts` 全通过）。
  - `npm run skills:sync -- --check`：exit 0。
  - UI/Provider 单元测试（`app/components/ui/primitives.test.tsx`、`app/components/ui/pagination.test.tsx`、`app/providers/mantine-theme.test.tsx`、`app/providers/providers.test.tsx`）：`53/53 passed`（10 suites, 0 fail, 0 skipped）。
  - `npm run test:portal`：exit 0（60 个测试文件全过）。
  - `npm run build`：exit 0（`vinext build` + `build:service`，仅存既有 `build:comic-reader` `inlineDynamicImports` warning）。
- **Playwright E2E 验收（最终构建后全过）**：
  - `tests/e2e/mantine-overlays.spec.ts`（Chromium + WebKit）：`8/8 passed`。
  - Chromium 专题与回归（`mantine-activity-studio.spec.ts`、`mantine-world-calendar.spec.ts`、`workspace-review.spec.ts`、`theme-polish.spec.ts`、`contrast.spec.ts`）：首次 4-worker 并发全过；`mantine-character-filters.spec.ts`（6/6）与 `portal.spec.ts`（17/17）在 `--workers=2` 复跑下 `23/23 passed`（消除 4-worker 并发下的瞬时 `net::ERR_NO_BUFFER_SPACE` 与水合时机波动）。
- **当前客观状态**：上述 Wave 1 & Wave 2 改动均留在本地 Git 工作区，**尚未执行 `git commit`/`push`**，本地 9320 容器仍运行此前部署的 `sthstart:mantine-6415d44ffd73` 镜像，尚未按新工作区重新构建镜像或切换上线。

## 控制中心细节精修（2026-11-14）

按全站视觉精修计划完成控制中心门面，未改变运行时接口、配置保存或日志订阅逻辑：

- **页头收纳操作**：`刷新` 与 `导入旧配置` 从内容面板顶部移入 `PageHeader` 的 `actions`，与标题、分区页签同排；内容面板直接以告警或分区内容开始，不再留空操作条。
- **页签完整可见**：控制中心有六个分区，1280px 基线宽度下与标题、操作同排会裁掉「实时日志」。在 640–1439px 让页签独占一行；1023px 以下允许页签换行，手机 390px 两行显示全部六个分区，不产生页面横向滚动。
- **运行栈健康度卡**：原右侧竖线分栏改为独立软底卡片，显示运行比例与百分比、`role="progressbar"` 进度条（`aria-valuetext` 为「N / M 项服务运行中」），底部为「最近异常 / 丢弃日志」双列指标；服务数为 0 时 `aria-valuemax` 取 1，避免无效范围。
- **停止状态语义**：共享 `StatusIndicator` 已将 `stopped` / `stopping` 从红色错误灯拆为中性灰环，仅 `offline` / `error` 保留红色告警。该共享文件由并行任务先行修改，控制中心未重复覆盖。

验证（隔离端口，固定接口夹具）：

- `npx tsc --noEmit`、`npm run check:architecture`（631 files，0 violations）、`npm run build:portal` 均通过。
- 实景截图 light-paper / dark-espresso × 1440 / 1280 / 390：操作按钮位于 `.tpl-header .page-header-actions`，页签无裁切，页面横向溢出为 0；停止状态点计算色为中性（浅色 `#ebe7df` 底 + `#a9a39a` 边，深色 `#23211e` 底 + `#8b8275` 边）。证据在 `artifacts/control-center-polish-20261114/`。
- `visual.spec.ts` 控制中心两条基线已更新并通过；`portal.spec.ts` 控制中心页签切换 Chromium 与 WebKit 各 1/1 通过；`contrast.spec.ts` + `viewport-matrix.spec.ts` 共 8/8 通过（四主题对比度、控件边界、焦点环、七视口无横向溢出）。

## 全站现代视觉与交互精修（2026-11-14）

按用户提供的全站视觉精修计划完成壳层、角色库、制作项目、首页、日历与控制中心。此次只调整展示、布局和交互反馈，没有改变角色、项目、活动、日历事件、运行配置或日志的数据协议。

- **壳层与动效**：路由布局判定集中到 `app/shell/shell-layout.ts`，自带 `WorkspaceHeader` 的故事世界、叙事、笔记和活动工作台不再叠加全局工具条。`StatusIndicator` 将 `stopped` / `stopping` 改为中性灰环，只有 `offline` / `error` 显示危险色。页签增加凹槽轨道、指示条入场、按压反馈与面板淡入；动效均受 `prefers-reduced-motion` 控制。
- **角色资料库**：缺图头像按名称稳定映射六种语义色；搜索、作品、标签、分组、仅收藏、筛选与计数收进同一工作流；卡片有轻抬升、边框提亮和标签单行 `+N` 截断；更多操作由原生 `<details>` 换成 Mantine `Menu`，保留标签、菜单项语义和 Esc 回焦。
- **制作项目与首页**：制作列表按类型显示模块色块，版本号改为等宽胶囊，更新时间改为相对时间并保留精确日期提示，入口按钮与整行悬停联动。首页最近工作显示带识别色的类型胶囊，并在悬停／键盘聚焦时显现跳转箭头。
- **角色日历**：月份导航、搜索、事件类型和筛选整理为统一工具栏，月份只保留一个标题；跨月格不再使用深灰遮罩，事件改为带左侧识别色条的胶囊；手机端使用紧凑日期格与类型圆点；右侧显示当天安排和本月后续日程。
- **控制中心**：刷新和导入旧配置移入页头操作区；健康度改为带 `role="progressbar"` 的独立软底指标卡；已停止服务保持中性状态。页头导航在 1024px 及以下独占一行，避免把全局工具挤成空白行。

验证证据：

- `node --import tsx/esm --test`：公共控件、主题桥接、外框、状态灯、头像映射和日历状态共 `65/65` 通过。
- `npm run check:architecture`：`631 files, 2591 local edges, 0 violations, 0 stale exceptions`。
- `npm run typecheck`、`npm run build`：通过。
- Chromium 页面回归：`theme-polish`、`contrast`、`mantine-character-filters`、`mantine-world-calendar`、`portal`、`workspace-review`、`shell-layout`、`activities-list-polish` 共 `55/55` 通过。
- Chromium + WebKit 弹层专项：`8/8` 通过；设计令牌：`3/3` 通过；`visual.spec.ts` 七张视觉基线：`7/7` 通过。
- 本地 `9320` 已同步新构建并通过健康检查。暖白／暖夜桌面六页和五页手机截图均无页面脚本异常、无横向溢出；故事世界只有一个工作台顶栏。前后对照在 `artifacts/visual-polish-20261114/compare/`，最终截图与 `report.json` 在 `artifacts/visual-polish-20261114/after/`。
- 限制：未做 macOS 渲染、实体触屏与真实输入法测试；Windows WebKit 通过的是自动化测试，不等同于 Safari 实机验收。改动未提交、未推送。
