# Mantine 全站验收矩阵

29 项来自 `app/**/page.tsx`，并与隔离环境 Vinext 生产构建路由输出核对。已部署产品修订 `6415d44ffd73206ef9fee1285a70c740426b98e8` 在 Chromium 和 WebKit 分别通过桌面／手机 29 个入口，共 116 次检查，另有四主题和代表布局共 8 组检查。两浏览器均已验证笔记在实际断开测试源站后从缓存打开。扩大回归和修正测试夹具后的复验记录在本地 `artifacts/mantine-upgrade-20261113/final-browser-evidence.json`；本地 9320 已通过部署后抽查。详见[组件归属与迁移验收记录](2026-11-14-mantine-ui-maintenance.md)。

测试使用仓库 Playwright 配置创建的临时数据库、媒体目录和管理员会话；为缺数据使用空库或固定 ID，为错误使用单次网络拦截或模拟服务，验证真实可见状态。通用规则：1440×900、390×844 检查每行；外壳及代表性工作台增加 1024×768、1920×1080、短视口和四主题。下列测试文件均相对 `tests/e2e/`；“补”标的是规划时相对旧用例的检查重点，实测结果以上述归档为准。

| # | 路由／归属 | 隔离数据与可操作验收 | 规划时的测试入口与补测重点 |
| --- | --- | --- | --- |
| 1 | `/` C4 | 空库及有最近项目、笔记、活动；打开最近项及导航 | `portal.spec.ts` 首页、模块入口；补继续创作和请求失败 |
| 2 | `/apps/projects` B2 | 有／无项目，列表进入现有项目；模拟列表失败 | `portal.spec.ts` 主标题与导航；补列表状态与继续 |
| 3 | `/apps/projects/[id]` B2 | 真实项目 fixture，打开关联章节、制作，退回项目；无效 ID | `architecture-publication.spec.ts` 下游；补项目详情返回、错误 |
| 4 | `/apps/story` B2 | 已有项目及空列表、创建入口 | `portal.spec.ts` 导航；补 Story 列表、空态 |
| 5 | `/apps/story/[id]` B2 | 两章；慢保存、切章、组合输入、离线恢复和发布快照 | `architecture-editors.spec.ts`、`architecture-publication.spec.ts`；补离线、跨主题和窄屏 |
| 6 | `/apps/activities` B3 | 活动 fixture、空态、列表筛选和断网 | `activities.spec.ts` 首个流程；补空／错及继续编辑 |
| 7 | `/apps/activities/new` B3 | 固定模板和角色，走默认创建和输入错误 | `activities.spec.ts`、`activity-rework.spec.ts` |
| 8 | `/apps/activities/[id]` B3 | 分镜、设备预览、回放、草稿冲突；假任务验证导出 | `activities.spec.ts`、`architecture-studio-draft.spec.ts`、`frontend-experience.spec.ts`；补短屏工具与模拟导出失败 |
| 9 | `/apps/characters` B1 | 角色、作品、标签、分组、收藏；筛选同步 URL、空结果、分页 | `pagination.spec.ts`、`theme-polish.spec.ts`；补手机筛选、嵌套焦点及最后页签 |
| 10 | `/apps/characters/new` B1 | 新建、校验、中文输入保存 | `portal.spec.ts` 角色创建；补窄屏键盘 |
| 11 | `/apps/characters/[id]` B1 | 有角色；草稿、头像区及无效 ID | `portal.spec.ts` 角色编辑、手机页签；`architecture-editors.spec.ts` 头像来源 |
| 12 | `/apps/story-worlds` C1 | 世界和两个分支；空、运行、暂停、阅读、比较、事件详情 | 独立 story-worlds 配置下 `story-worlds*.spec.ts`；补候选截图与浮层栈 |
| 13 | `/apps/narrative` C1 | 固定章节和条目；筛选、阅读、导入入口和空结果 | `portal.spec.ts` 叙事；补导入失败与窄屏筛选 |
| 14 | `/apps/calendar` C1 | 两个同日生日、活动和无事件月份；选择、切换和创建入口 | `calendar.spec.ts`；补四主题实际绘制颜色、手机事件详情 |
| 15 | `/apps/notebook` C2 | 固定笔记及无结果；验证与资料工作台之间的导航 | `portal.spec.ts` 手机回访、`pagination.spec.ts` |
| 16 | `/apps/notebook/new` C2 | 新建多块笔记，校验、保留未提交输入 | `portal.spec.ts` 笔记创建、`notebook-longform.spec.ts` |
| 17 | `/apps/notebook/[id]` C2 | 已有笔记；慢保存、切视图、恢复、无效 ID | `architecture-editors.spec.ts`、`notebook-longform.spec.ts`；补冲突、错误 |
| 18 | `/apps/notebook/offline` C2 | 测试浏览器关闭网络，已有可用本机草稿／空缓存 | `offline-and-mobile.spec.ts`；确认直接入口、恢复与重连 |
| 19 | `/apps/resources` C2 | 多页资料与个人笔记；搜选、采用、空结果、窄屏末页签 | `knowledge-library.spec.ts`、`workspace-edges.spec.ts`、`architecture-editors.spec.ts`；补末页签和错误 |
| 20 | `/apps/media` C3 | 临时目录放小图；分别建有效、缺文件、返回错误的 fixture | 补预览、筛选、缺失和真实请求失败的差异 |
| 21 | `/apps/inspiration` C3 | 固定记录、空及请求失败 | 补搜索、采用、错误及窄屏 |
| 22 | `/apps/creative` C3 | 模拟服务连接与可用来源；不提交真实生成 | `portal.spec.ts`、`architecture-editors.spec.ts`、`comfy-configuration.spec.ts`；补假任务状态和末页签 |
| 23 | `/settings` C4 | 直接访问，确认重定向和回退行为 | 补显式重定向及窄屏焦点 |
| 24 | `/settings/public-services` C4 | 连接与模型发现固定响应，模拟 500；保存、过滤及末页签 | `portal.spec.ts` 公共服务；补窄屏末页签 |
| 25 | `/settings/generation` C4 | 假引擎和工作流；表单、离开前保存、连接失败 | `comfy-configuration.spec.ts`、`portal.spec.ts` |
| 26 | `/settings/control-center` C4 | 模拟在线／不在线服务和诊断响应；用本机假凭据 | `portal.spec.ts` 管理会话和控制中心；补诊断失败与聚焦 |
| 27 | `/settings/ai-logs` C4 | 临时日志、空日志及事件流；连接中断 | `portal.spec.ts` SSE；补筛选和重连提示 |
| 28 | `/settings/backups` C4 | 在临时目录用假清单；模拟成功、失败和危险确认 | 补空、错、确认焦点；不恢复真实数据 |
| 29 | `/apps/linshe` C4 | 本机 iframe stub、加载失败、打开桥接、返回 | 补 iframe 之外的工具可达、失效提示与窄屏返回 |

跨页单独设门槛：A1 四主题／自定义色首屏、切换、刷新及弹层变量；A2 按钮／表单／页签语义及移动滚动线索；A3 原生与 Mantine 过渡、阻塞模态下不打开命令、Esc 单层、焦点回归、滚动锁定及触控底部安全区。合成输入事件覆盖键盘守卫；真实设备与输入法未跑时如实列为限制。性能重用 `architecture-performance.spec.ts` 同一脚本和夹具；四条代表路由每条五次，分别比较 CSS、JS、长任务和可交互耗时。主代理汇总实测通过、失败、复测和未验收项，部署后仅做健康与真实页面只读抽查。
