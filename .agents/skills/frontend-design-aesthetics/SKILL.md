---
name: frontend-design-aesthetics
description: >-
  Use when styling, designing visual hierarchy, selecting typography scales, configuring spacing rhythm,
  or reviewing visual presentation in SthStart. Enforces Notion/Craft warm-paper light aesthetics combined with
  Linear/Raycast precision, semantic design tokens, 8px spatial grid, high-contrast readability, modern sans-serif
  UI headings (serif reserved only for immersive reading), and strict zero-emoji standards.
---

# SthStart 视觉美学与设计系统准则 (Design Aesthetics)

融合 **Notion / Craft 的轻盈人文温暖纸感** 与 **Linear / Raycast 的现代精密工具质感**，定义 SthStart 统一的视觉语言与排版律动，杜绝传统管理后台的生硬割裂感。

---

## 核心设计哲学

1. **轻盈纸感与同色系通透层次 (Warm Paper & Cohesive Light Sidebar)**：
   - 默认日间主题（`light-paper`）采用温润象牙纸底（`#faf8f4`）搭配同色系亚麻暖灰侧栏（`#f3efe6`），告别深黑侧栏与浅色画布的生硬割裂；选中项以洁白悬浮纸片（`#ffffff` + 柔和微阴影）呈现。
   - 界面是创作者内容的承载容器，不应喧宾夺主；杜绝花哨的重投影、高饱和度大色块与任何非正式的表情符号（Zero-Emoji 准则）。
   - 图标统一使用 Lucide SVG 矢量图标，尺寸严格控制在 14~18px 之间，保持视觉重心的统一。

2. **空间律动与 8px 网格 (Spatial Rhythm)**：
   - 间距严格基于 4px / 8px 步进倍数（`gap-1` [4px], `gap-2` [8px], `gap-3` [12px], `gap-4` [16px], `gap-6` [24px]）。
   - 容器内边距层次分明：卡片内部统一 `p-4` 或 `p-5`，工作台侧栏 `p-3` 或 `p-4`，页面外框 `p-6`。
   - 严禁出现无规律的任意像素微调（如 `mt-[13px]`, `p-[7px]`）。

3. **字体阶度与文本层级 (Typography Scale)**：
   - **全局无衬线 UI 主导（`--font-sans`）**：所有页面大标题（`.tpl-title`、`.desk-header-title`）、工作台标题、导航、卡片标题与按钮统一使用现代无衬线字体，通过字重（`600`/`700`）与紧凑字距（`-0.025em`）拉开层级。
   - **沉浸式阅读衬线体（`--font-serif`）**：仅在「叙事档案阅读器」「小说/长文正文阅读视图」等沉浸式长文阅读区域启用衬线体。
   - **字号底线规约**：辅助标注（Caption / Meta）不低于 `12px`（`text-xs`）；所有可交互控件与标签（`button`, `input`, `select`, `[role="tab"]`）字号不低于 `14px`（`text-sm`）；长文阅读与编辑表面不低于 `16px`。

4. **语义设计 Token 与着色规约 (Color Tokens)**：
   - **背景层级 (Surface Layers)**：
     - `bg-paper` (`--bg-app`)：全屏底层温暖纸张；
     - `bg-nav` (`--nav-surface`)：同色系轻盈侧边导航表面；
     - `bg-surface` (`--surface`)：纯净悬浮纸片卡片与工具面板；
     - `bg-surface-sunken` (`--surface-sunken`)：沉降容器、分段控制器槽位与次要信息底座。
   - **边框与分隔 (Borders & Dividers)**：
     - 卡片与面板采用清晰温润的 1px 细边框（`border-border-subtle`），表单输入控件采用满足 3:1 对比度的 `border-border-control`。
   - **圆角标度 (Corner Radius)**：
     - 面板与大卡片使用 `rounded-[var(--radius-panel)]`（`16px`），按钮与输入控件使用 `rounded-[var(--radius-control)]`（`10px`），弹窗使用 `rounded-[var(--radius-dialog)]`（`20px`）。
