---
name: frontend-workspace-interaction
description: >-
  Use when implementing or refactoring frontend user interactions, workspace layouts, state ergonomics,
  forms, and keyboard shortcuts in SthStart. Enforces viewport lock, independent scrolling, inline direct
  manipulation, progressive disclosure, floating contextual controls, and keyboard ergonomics.
---

# SthStart 创作工作台与交互工程准则 (Workspace Interaction)

基于现代创作软件（Notion、Linear、Figma）的交互工程标准，规范 SthStart 密集型工作台与常规页面的架构模式与交互流。

---

## 核心反模式（严禁出现）

| 原始反模式 | 问题表现 | 正确设计范式 |
| :--- | :--- | :--- |
| **无脑按键网格** | 在顶栏或卡片边缘平铺 5~15 个按钮，缺乏主次 | **主次分明**：保留 1 个主 CTA，次要操作收拢至 `<MoreHorizontal />` 下拉菜单 |
| **过度弹窗（Modal Fatigue）** | 仅修改名称或简单属性就弹出模态遮罩层 | **原生行内直接操纵**：透明无框输入框，点击即编辑，失焦自动持久化 |
| **全页无序纵向滚动** | 正文过长导致左右侧栏被推高、顶栏滚出屏幕 | **视口锁高与独立滚动**：外框锁定视口，主画布与侧栏分别设立内部滚动条 |
| **平铺式繁杂筛选** | 列表上方常驻平铺 4~6 个原生 Select 下拉框 | **渐进暴露**：默认单行搜索框，高级筛选通过折叠抽屉或徽标触发 |
| **批量操作常驻侵占** | 表格或卡片列表上方常驻“批量删除”、“批量移动”等按钮 | **动态悬浮操作条**：选中项目后通过 `FloatingActionBar` 优雅浮现 |

---

## 一、 页面架构模式（严格二选一）

1. **自然文档流页面 (Natural Document Flow)**：
   - **适用场景**：项目列表、设置中心、通用表单、历史归档；
   - **组件复用**：统一使用 `PageContainer`、页面标题与 `PageTabs`；
   - **滚动规约**：页面整体随视口自然纵向滚动，不强加全屏 IDE 布局。

2. **持续创作工作台 (Creative Workbench)**：
   - **适用场景**：活动工作室、漫画制作工坊、角色属性工坊、分镜编辑器；
   - **组件复用**：统一使用 `WorkspaceHeader` 与 `SplitPanes`；全屏沉浸时沿用 `AppShell` 的 embed 模式，并保留返回导航与全局关键操作；
   - **视口锁高规约**：
     - 根容器配置 `h-full min-h-0 min-w-0 overflow-hidden`，严禁在内部嵌套 `h-screen` 重复计入顶栏；
     - 主内容链关键节点必须设置 `min-h-0`，承载自适应内容的 Flex/Grid 子项必须设置 `min-w-0`；
     - 左右分栏各自独立滚动（`min-h-0 flex-1 overflow-y-auto`），长正文严禁撑高左侧导航或右侧属性面板。固定头部或底部操作置于滚动区之外。

---

## 二、 原生行内即时交互 (Inline Direct Manipulation)

1. **标题与单行属性编辑**：
   - 实体标题采用透明背景无边框输入框：
     ```tsx
     <input
       value={title}
       onChange={...}
       className="w-full bg-transparent border-0 border-b border-transparent hover:border-border-default/50 focus:border-accent p-0 pb-1 text-2xl font-bold tracking-tight outline-none transition-colors"
     />
     ```
   - 失去焦点 (`onBlur`) 或防抖自动持久化，不强迫创作者停下心流点击“确认保存”。
2. **标签与元数据交互**：
   - 标签组采用紧凑胶囊组件，支持原地输入回车添加、点击删除，不依赖模态框。

---

## 三、 渐进暴露与情境唤起 (Contextual Actions)

1. **微操作胶囊 (Floating Capsule Overlay)**：
   - 针对卡片、画面、素材项，在悬停时展示半透明工具胶囊：
     ```tsx
     <div className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-full bg-black/60 backdrop-blur-md px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
       {/* 矢量图标按钮 */}
     </div>
     ```
2. **聚合顶栏与溢出菜单 (More Actions Overflow)**：
   - 顶栏高度控制在 48~52px 之间，保留 1~2 个关键状态按钮，次要功能归类收入 `<MoreHorizontal />` 下拉菜单。
3. **动态悬浮操作条 (FloatingActionBar)**：
   - 在卡片或列表批量勾选时，动态唤起底部居中的 `FloatingActionBar`，提供批量操作（如批量匹配、归档、导出），不常驻占用头部空间。

---

## 四、 键盘人体工学 (Keyboard Ergonomics)

- `Ctrl/Cmd + S`：显式触发全量草稿保存；
- `Ctrl/Cmd + B`：切换/折叠大纲导航侧栏；
- `Escape`：关闭所有正在打开的浮层、下拉菜单或筛选抽屉；
- 列表与自动补全：完整支持 `ArrowUp` / `ArrowDown` 焦点轮巡与 `Enter` 确认；
- 焦点管理：所有可交互元素必须具备清晰但克制的聚焦环（`focus-visible:ring-1 focus-visible:ring-accent`）。

---

## 五、 响应式与草稿状态保护

1. **移动端窄屏自适应**：
   - 移动端自动将辅助侧栏转为浮动抽屉（Drawer）或标签切换，确保正文和主要操作可达；
   - 打开或关闭抽屉不得清空或丢失未保存的正文与表单草稿。
2. **长文本排版安全**：
   - 窄屏下对话气泡与段落自适应父容器宽度，严禁水平溢出。
