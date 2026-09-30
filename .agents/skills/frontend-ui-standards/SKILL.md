---
name: frontend-ui-standards
description: >-
  Use when developing or reviewing SthStart frontend pages, components, styles, or layouts.
  Choose document-flow pages or isolated workspace scrolling, reuse shared UI and semantic
  tokens, and verify affected views without making deployment a default check.
---

# SthStart 前端 UI 准则

## 先选择页面布局

- 列表、详情、表单和资料库默认采用自然文档流，复用 `PageContainer`、页面标题和 `PageTabs`。不因存在左右区域就改成全屏 IDE。
- 活动工作室等需要持续操作的工作台复用 `WorkspaceHeader`、`SplitPanes`。需要隐藏全局导航时沿用 `AppShell` 的 embed 模式，并保留返回导航和必要全局操作。
- 工作台高度由现有外框和可用视口决定，避免嵌套 `h-screen` 重复计入顶栏。主内容链设置 `min-h-0`，承载自适应内容的 Flex/Grid 子项设置 `min-w-0`。
- 多栏工作台各溢出区域独立滚动；长正文不能撑高左右栏。固定头部或底部操作置于滚动区之外，滚动内容本身保留 `min-h-0`。

## 响应式与阅读

- Grid、Flex 和固定宽度侧栏均可使用；根据实际挂载的栏位和可用宽度调整布局。隐藏侧栏时不能留下空网格轨道或把主体困在侧栏宽度中，不强制使用 `:has()`。
- 窄屏采用单栏、标签切换或抽屉，确保正文和主要操作可达。打开、关闭辅助面板不能丢失未保存的正文或表单状态。
- 长篇正文在桌面可将阅读宽度控制在约 720–800px；移动端使用可用宽度。对话气泡按内容和容器排版，不要求所有屏幕达到固定汉字数。
- 检查中文自然换行以及长 URL、代码等内容的溢出；正文避免机械 `break-all`。辅助信息保持紧凑，较长内容允许展开，不用统一固定高度截断必要信息。

## 组件、样式与操作

- 优先复用共享布局和 UI 组件，先查 `app/components/shared/`、`app/components/ui/` 以及现有主题样式，避免新增一套重复外框。
- 应用界面背景、文字、状态、边框等优先使用项目语义 token，例如 `bg-paper`、`bg-surface`、`text-ink`、`text-muted`、`bg-accent` 与 `var(--radius-panel)`。侧栏尺寸沿用当前外框配置，不写死文档里的旧宽度。
- 媒体画面、角色配色、图表和设备模拟界面按其用途处理；通用圆角类并非一律禁止，应与相邻组件保持一致。
- 每个视图有清晰的主要操作，去除无意义的重复按钮和标题。允许与当前位置有关的快捷按钮、菜单和快捷键，不强制所有 AI 操作都放进右侧面板。
- 表单有可见标签，图标按钮有可访问名称；加载、失败与空状态不能遮断恢复操作。

## 按改动验证

- 布局和交互改动在受影响的真实路由检查桌面与窄屏；工作台额外检查长短内容切换、独立滚动、面板折叠和草稿保留。
- 全局样式或共享外框改动，抽查普通页面与复杂工作台。纯文案小改动不要求完整截图回归。
- 需要截图时使用当前环境可用的浏览器工具或匹配目标页面的脚本，并用可用图像查看工具实际查看截图，不能仅凭脚本成功判定视觉正确。
- `scripts/take_screenshot.mjs` 覆盖活动和日志等特定场景，不是所有页面的通用验收。类型检查和测试范围按改动决定。
- 不把 `npm run deploy:docker` 当成默认验证步骤；它会部署并重启容器，仅在已授权的部署任务中执行。环境不可用时说明未验证的部分，不扩大任务范围。
