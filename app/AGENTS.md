# SthStart 前端核心规则

适用于 `app/` 的页面、组件与样式开发。视觉方向、页面原型与皮肤表达参照项目的 `sthstart-design-language` skill；token、UI 原语与主题皮肤契约参照 `sthstart-ui-system` skill；工作台架构与交互工程参照 `frontend-workspace-interaction` skill；浏览器验收与视觉评分参照 `frontend-visual-qa` skill；检查范围参照 `project-verifier` skill。前端视觉推进计划见 [2026-11-20 前端视觉计划](../docs/development/reviews/2026-11-20-frontend-visual-plan.md)。以下保留各类页面共同需要的约束。

## 架构与代码归属

开始新增功能、调整模块边界或重构前，阅读 [前端架构规范](../docs/FRONTEND_ARCHITECTURE.md)。该文档是架构标准；[实施计划](../docs/development/FRONTEND_ARCHITECTURE_PLAN.md) 保留阶段范围、历史估算和验收定义。S0–S6 已完成本轮代码与集成验收；结果与实机验收边界见 2026-11-11 架构交付记录。正式架构规范和验收记录放在可纳入 Git 的路径，阶段记录使用 `docs/development/reviews/`。

- 新代码按明确职责组织；旧代码在相关模块改动时逐步收敛，不为局部修复搬迁无关文件。
- 当前目录职责：`app/shell` 负责全站外框，`app/workspaces` 负责跨模块组合，`app/features` 负责业务规则与请求，`app/components` 负责基础控件和通用布局，`app/server` 只放服务端实现，`app/api` 只做门户接口与代理。
- 页面入口负责路由和装配；跨模块组合归工作台；业务规则、请求、查询和草稿归所属业务模块。
- 基础 UI 与通用布局不新增业务请求依赖。全局任务、命令和导航由应用外框接入，通过属性或插槽组合。
- 业务模块不得反向依赖页面、外框或跨模块工作台；跨模块使用明确的公开能力，避免新增运行时循环和双向模块依赖。纯工具不从页面或组件导出。
- 服务器实体由 Query 管理，筛选分页由 URL 适配层管理，未保存内容由编辑会话管理，局部交互状态留在最近组件。不要另建全局 Store 重复保存服务器数据。
- 保留接口、查询键、路由、本机草稿键和修订兼容；自动保存、离线同步和中文输入行为有独立验收，不因拆分文件改变语义。
- 会话、管理凭据和代理实现留在服务端边界；客户端依赖树不能包含服务专用实现。客户端通过 API 或 `app/lib/admin-fetch.ts` 访问，不导入 `app/server`。
- EX-01 至 EX-08 已关闭；保留的单向兼容入口见架构规范 §9，新代码不得把兼容入口当作新的依赖方向。新增例外只在 `scripts/architecture/exceptions.json` 登记，写明具体边、原因和收敛任务，不使用整目录豁免。
- 跨模块依赖或公共入口改动后运行 `npm run check:architecture`；修改检查规则后运行 `npm run test:architecture`。静态依赖检查不等于浏览器、保存或性能验收。阶段完成后同步规范与验收记录；执行状态和最终验收由主代理更新。

## 页面与交互

- 优先复用现有共享布局、UI 组件和语义化设计 token，避免为单个页面增加重复的外框或主题系统。
- 普通列表、详情和表单默认自然滚动；需要持续操作的多栏工作台使用可用视口内的独立滚动。工作台内容链保留 `min-h-0`，自适应 Flex/Grid 子项保留 `min-w-0`，长内容不能撑高相邻栏。
- 窄屏主要内容和操作必须可达，正文按可用宽度自然换行。打开或关闭辅助面板不能丢失未保存的草稿。
- 每个视图有清晰的主要操作，去掉无意义的重复按钮和标题；允许上下文快捷入口，不强制所有 AI 操作集中在同一位置。
- 外框顶栏只提供全局工具，不重复页面名称或模块图标。页面保留一个明确的主标题；侧栏负责模块导航，页内标签负责视图切换，局部工具栏负责当前内容操作。通过表面色与必要的分隔线表达区域归属，避免给同一层重复加标题。
- 布局或交互变更验证受影响路由；共享外框或全局样式变更抽查代表性普通页面和工作台。使用实际可用的浏览器及图像查看工具，不强制对所有页面运行同一个截图脚本。
- UI 文档、规则或纯文案调整不要求完整浏览器回归。部署、容器重启和真实数据操作不属于默认前端验收，只有任务已授权时才执行。

## UI 原语、样式边界与主题不变量

- **严禁业务层硬编码颜色与野生容器**：`app/shell/`、`app/workspaces/`、`app/features/` 中的组件与页面禁止直接手写 Tailwind 色板类（如 `bg-sky-50`、`text-amber-700`、`border-emerald-300`），也禁止用散装 `div` 拼接自定义弹窗或带描边卡片；统一复用 `app/components/ui/` 原语（`<Card>`、`<Badge variant="...">`、`<Dialog>`、`<Drawer>`、`<CommandPalette>` 等）与语义化 Token。
- **用语义 `data-*` 钩子代替跨层样式耦合**：新增或改造共享 UI 原语时，优先暴露语义属性钩子（如 `data-ui-variant`、`data-ui-badge`、`data-dialog-lining`、`data-command-lining`）和语义化 Props，确保基础画布与风格化套件（`data-ui-skin`）无需修改业务 JSX 即可联动换肤。
- **主题与皮肤基础不变量**：
  - `THEMES` 固定保持 4 套基础画布（`light-paper`、`light-zinc`、`dark-espresso`、`dark-obsidian`），新增视觉风格走 `UiSkinId` / `data-ui-skin` 正交叠加层，不破坏现有主题矩阵；
  - `THEME_BOOTSTRAP_SCRIPT` 中对 `data-mantine-color-scheme` 的写入次数严格保持 2 处；
  - `app/styles/mantine-bridge.css` 不得引入除 `#000000` / `#ffffff` 外的硬编码十六进制颜色。
- **主题或共享原语改动后的定向测试**：修改 `app/lib/theme-preference.ts`、`app/providers/`、`app/styles/` 或 `app/components/ui/` 后，除浏览器抽查外，运行 `node --import tsx/esm --test app/lib/theme-preference.test.ts app/providers/mantine-theme.test.tsx app/providers/providers.test.tsx app/components/ui/primitives.test.tsx app/components/ui/pagination.test.tsx` 与 `npm run typecheck`。
