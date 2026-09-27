---
name: frontend-ui-standards
description: >-
  Use this skill when developing, refactoring, styling, or verifying frontend UI components,
  pages, and layouts in SthStart. Enforces multi-column height isolation, responsive layout,
  natural typography, design tokens, and browser-driven verification.
---

# SthStart 前端开发与 UI 架构准则

本准则定义了 SthStart 前端界面开发、布局编排、排版交互与验收的标准工作流。
所有涉及 `app/` 目录的界面改动与新增组件均须遵循本准则。

---

## 核心准则一：多列工作区高度与滚动完全隔离 (Height & Scroll Isolation)

在复杂多列工作台（如活动工作室、角色编辑器、IDE 型页面）中，必须遵循**列高度独立计算与滚动隔离**原则：

### 1. 视口高度锁定 (Viewport Lock)
- **根容器强制锁高**：工作台根节点必须使用 `h-screen max-h-screen overflow-hidden`（或 `h-[100dvh]`），禁止使用 `min-h-screen`。
- `min-h-screen` 会导致中间长内容无限制撑高页面，从而触发 Flex 默认的 `align-items: stretch`，导致左右两栏被动拉伸并产生大片空白。

### 2. 三栏独立高度与滚动上下文
```tsx
<div className="w-full h-screen max-h-screen flex flex-col overflow-hidden">
  {/* 固定高度顶栏 */}
  <header className="h-12 shrink-0 border-b ...">...</header>

  {/* 工作区三栏主体：min-h-0 是防止 Flex 子项溢出的关键 */}
  <div className="flex-1 flex overflow-hidden min-h-0">
    {/* 左侧栏：高度占满父级，独立纵向滚动，底部固定操作不偏移 */}
    <aside className="w-60 h-full shrink-0 flex flex-col justify-between overflow-y-auto border-r ...">
      <div className="space-y-2">...</div>
      <div className="p-3 border-t ...">底部固定卡片</div>
    </aside>

    {/* 中间核心画布：高度占满父级，仅自身产生滚动条，绝不撑大外层或拉伸左右栏 */}
    <main className="flex-1 h-full flex flex-col min-w-0 overflow-y-auto">
      ...无论内部有 100px 还是 10000px 内容，仅在此处滚动...
    </main>

    {/* 右侧 Copilot / 检查器：高度占满父级，独立滚动 */}
    <aside className="w-72 h-full shrink-0 flex flex-col justify-between overflow-y-auto border-l ...">
      ...
    </aside>
  </div>
</div>
```

### 3. 隔离自查 Checklist
- [ ] 切换到长内容视图时，左侧栏底部按钮/卡片是否依然稳固在屏幕可见区域？
- [ ] 切换到长内容视图时，右侧 Copilot 是否保持原有高度，未被拉伸留白？
- [ ] 浏览器主窗口是否**无全局滚动条**？滚动条是否仅出现在发生内容溢出的中间列？

---

## 核心准则二：全站外框与嵌入模式隔离 (Shell Embed Mode)

SthStart 区分**文档流常规页面**与**全屏工作台页面**：

1. **常规页面（列表、仪表盘、资料库）**：
   - 依赖全局 `AppShell` 的 220px 侧栏导航。
2. **工作台页面（Studio / IDE，如 `/apps/activities/:id`、`/apps/linshe`）**：
   - 必须通过 `data-embed="true"` 隐藏全局侧栏，释放 100% 屏幕宽度给三栏工作台。
   - 页面自身顶栏必须提供返回列表的导航（如 `<Link href="/apps/activities"><ArrowLeft /> 活动列表</Link>`）。

---

## 核心准则三：容器自适应与反死宽度 (Fluidity & Anti-Constrained)

1. **严禁在响应式容器上硬编码固定网格**：
   - 历史负面案例：`.studio-records { grid-template-columns: 200px minmax(0, 1fr); }`，在子节点隐藏时导致内容锁死在 200px 宽度。
   - 规则：容器默认 `display: block; width: 100%;`，仅在特定复合子组件同时挂载时使用 `:has()` 或内联类名启用多列。
2. **Flex 子项必须设置 `min-w-0`**：
   - 所有承载文字或自适应卡片的 `flex-1` 容器，必须同时添加 `min-w-0`，否则 Flexbox 会依据内部文本最小内容宽度撑破容器。

---

## 核心准则四：排版与阅读体验 (Typography & Readability)

1. **自然中文文本断行**：
   - 对话气泡与正文卡片单行宽度必须保证 **25 ~ 45 个汉字**（约 500px ~ 800px），严禁由于容器过窄出现 5 ~ 6 字的畸形断行。
   - 气泡样式规范：`px-4 py-3 rounded-2xl text-sm leading-relaxed break-words shadow-2xs`。
2. **轻量化信息条**：
   - 分幕目标、Beats 事件、状态提示等辅助信息条高度应控制在 **≤ 40px**（单行展示并支持省略/展开），严禁长期占据 30% 以上的垂直屏幕高度。

---

## 核心准则五：交互收敛与零重复 (Consolidation & Zero Duplication)

1. **同屏同功能入口唯一**：
   - 严禁在同一视口内提供多个相同动作的按钮（例如：聊天框上方的「AI 生成一轮对话」与右侧 Copilot 的「续写群聊对话」）。
   - 工作台模式下，AI 操作一律收纳于右侧 Copilot 面板。
2. **文案去重**：
   - 严禁机械拼接标题导致重复。例如：当数据标题为「阶段一：秘密筹备」且前缀带有「第 1 幕」徽章时，标题必须清洗去除前导冗余，展示为 `[第 1 幕] 秘密筹备`，严禁出现 `第 1 幕 阶段一`。

---

## 核心准则六：设计系统 Token 强制使用 (Design Tokens)

所有颜色、边框、圆角均使用项目预设的设计系统变量：

| 类别 | 推荐 Token / Class | 禁止使用 |
| :--- | :--- | :--- |
| **背景色** | `bg-paper`（页面底色）、`bg-surface`（卡片底色）、`bg-surface-raised`、`bg-surface-muted` | `#ffffff`、`#f5f5f5`、`#1a1a1a` |
| **文字色** | `text-ink`（主文字）、`text-muted`（次要文字）、`text-fg-subtle` | `#000000`、`#666666`、`#999999` |
| **主色调** | `bg-accent`、`text-accent`、`hover:bg-accent-dark` | `#ff6600`、`#3b82f6`（直接写死色值） |
| **边框与圆角** | `border-border-default`、`border-border-subtle`、`rounded-[var(--radius-panel)]` | `border-gray-200`、`rounded-lg`（脱离设计系统） |

---

## 核心准则七：强制性浏览器验收 SOP (Browser-Driven Verification)

代码编写与类型检查通过后，必须执行以下验收流程：

1. **构建与热同步**：
   ```bash
   npm run deploy:docker
   ```
2. **执行无头浏览器截图**：
   ```bash
   node scripts/take_screenshot.mjs
   ```
3. **严格人工视觉审查**：
   使用 `view_file` 检查生成的截图：
   - [ ] 切换长短内容时，左右两栏是否保持视口高度，未被拉伸？
   - [ ] 对话与长文本是否保持 25 字以上舒适断行？
   - [ ] 页面是否有且仅有预期的局部滚动条？
   - [ ] 界面各元素是否有遮挡、重叠或错位？
