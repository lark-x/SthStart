---
name: frontend-design-aesthetics
description: >-
  Use when styling, designing visual hierarchy, selecting typography scales, configuring spacing rhythm,
  implementing/extending stylized UI skins (`data-ui-skin`), or reviewing visual presentation in SthStart.
  Enforces Notion/Craft warm-paper light aesthetics combined with Linear/Raycast precision, restrained 90%/10%
  stylized skin architecture, semantic design tokens, 8px spatial grid, high-contrast readability, modern
  sans-serif UI headings (serif reserved only for immersive reading), and strict zero-emoji standards.
---

# SthStart 视觉美学与设计系统准则 (Design Aesthetics)

融合 **Notion / Craft 的轻盈人文温暖纸感** 与 **Linear / Raycast 的现代精密工具质感**，定义 SthStart 统一的视觉语言与排版律动，杜绝传统管理后台的生硬割裂感。

---

## 核心设计哲学

1. **轻盈纸感与同色系通透层次 (Warm Paper & Cohesive Light Sidebar)**：
   - 默认日间主题（`light-paper`）采用温润象牙纸底（画布 `--bg-app: #f3f0e9`）搭配同色系亚麻暖灰侧栏（`--bg-nav: #ebe7de`），侧栏比画布深一档，告别深黑侧栏与浅色画布的生硬割裂；卡片表面采用温和白面（`--surface: #fcfbf8`），选中项以洁白悬浮纸片（`--surface-raised: #ffffff` + 柔和微阴影 + 发丝边）呈现。
   - 界面是创作者内容的承载容器，不应喧宾夺主；杜绝花哨的重投影、高饱和度大色块与任何非正式的表情符号（Zero-Emoji 准则）。
   - 图标统一使用 Lucide SVG 矢量图标，尺寸严格控制在 14~18px 之间（模块底块 24~36px），保持视觉重心的统一。

2. **五级表面层级 (5-Level Surface Hierarchy)**：
   - **L0 画布 (`--bg-app`)**：全屏底层暖纸色（`#f3f0e9`），承载所有面板与工作区；
   - **L1 侧栏 (`--nav-surface`, `--bg-nav`)**：比画布深一档（~3% L，`#ebe7de`），自然划分导航区与工作区；
   - **L2 卡片/面板 (`--surface`)**：接近纯白（`#fcfbf8`）+ 发丝细边（`0 0 0 1px var(--hairline)`）+ 极轻阴影（`--elev-xs`），消除双层容器；
   - **L3 浮起表面 (`--surface-raised`)**：洁白（`#ffffff`）+ `--elev-md`，用于选中项（`--surface-selected`）、详情栏、次级按钮与浮层；
   - **L4 遮罩与对话框**：`--overlay-backdrop` + `--elev-xl`；
   - **凹陷底座 (`--surface-sunken`)**：比画布深一档（`#ebe7df`），用于分段控制器槽位、沉降容器与次要信息底座。

3. **90 / 8 / 2 色彩配比与「强调色 ≠ 识别色」准则**：
   - **~90% 暖中性色**：暖纸、灰阶文字、发丝线，覆盖所有基础表面与长文正文；
   - **~8% 模块识别色 (`--tone-*`)**：降饱和以和暖纸协调（紫/蓝/橙/绿/粉/灰），只出现在 24~36px 图标底块、小徽章与 2px 标记线；
   - **~2% 强调色 (`--accent`)**：低饱和紫（`#665995`），每屏最多一个主要动作按钮，加上交互焦点环；
   - **核心规约**：**强调色表示“能操作/已选中”，识别色表示“属于哪个模块”**，两者严禁混用。侧栏仅当前激活项显示所属模块的底色与图标色，未激活项保持中性灰阶。

4. **空间律动与 8px 网格 (Spatial Rhythm)**：
   - 间距严格基于 4px / 8px 步进倍数（`gap-1` [4px], `gap-2` [8px], `gap-3` [12px], `gap-4` [16px], `gap-6` [24px]）。
   - 容器内边距层次分明：卡片内部统一 `p-4` 或 `p-5`，工作台侧栏 `p-3` 或 `p-4`，页面外框 `p-6`。
   - 严禁出现无规律的任意像素微调（如 `mt-[13px]`, `p-[7px]`）。

5. **字体阶度与文本层级 (Typography Scale)**：
   - **全局无衬线 UI 主导（`--font-sans`）**：所有页面大标题（`.tpl-title`、`.desk-header-title`）、工作台标题、导航、卡片标题与按钮统一使用现代无衬线字体，UI 字重最高 600（杜绝 700/800）。
   - **语义字阶 Token**：
     - `--text-page`（`22px / 600 / -0.02em`）：页面大标题、首屏问候语；
     - `--text-section`（`16px / 600`）：卡片标题、分区标题；
     - `--text-body`（`14px / 400`）：正文、主要控件；
     - `--text-meta`（`12px / 500`，`fg-subtle`）：时间戳、计数、辅助说明。
   - **沉浸式阅读衬线体（`--font-serif`）**：仅在「叙事档案阅读器」「小说/长文正文阅读视图」等沉浸式长文阅读区域启用衬线体。
   - **字号底线规约**：辅助标注（Caption / Meta）不低于 `12px`（`text-xs`）；所有可交互控件与标签（`button`, `input`, `select`, `[role="tab"]`）字号不低于 `14px`（`text-sm`）；长文阅读与编辑表面不低于 `16px`。

6. **语义设计 Token 与边框/圆角标度**：
   - **边框与分隔 (Borders & Dividers)**：
     - 卡片与面板采用发丝线（`--hairline`：`rgb(31 30 28 / 8%)`），输入表单控件采用满足 3:1 WCAG 对比度的 `border-control`（`#837c70`）。
     - 提示框（Alert）统一采用“左侧 3px 状态色条 + 很浅的底色”，取代大面积生硬厚重色块。
   - **圆角标度 (Corner Radius)**：
     - 面板与大卡片使用 `rounded-[var(--radius-panel)]`（`12px`）；
     - 按钮与输入控件使用 `rounded-[var(--radius-control)]`（`8px`，对应 `--radius-sm`）；
     - 弹窗与对话框使用 `rounded-[var(--radius-dialog)]`（`16px`）。尺寸由 Token 统一决定，不在业务组件硬编码。

7. **单闭合边框原则与边缘消隐物理学 (Single-Stroke Discipline & Non-Linear Masks)**：
   - **边框表达用途**：层级依次依靠文字灰阶、留白、表面、细线；避免在画布面板内部嵌套多层全包边框容器。
   - **7 档非线性 Alpha 渐变遮罩 (7-Stop Non-Linear Mask)**：独立滚动容器（大纲树、长文档、日志流）的上下边缘消隐，必须采用基于 $y \approx x^{1.5}$ 幂律曲线的 7 档渐变（`ScrollFadeContainer`），并在触顶或触底时动态将对应边缘羽化值归零，杜绝生硬切断的色阶横线。
   - **高分屏发丝细边微质感 (Hairline Ring)**：边框微光投影采用单像素微透明层（如 `0 0 0 1px var(--hairline)`），在高 DPI 屏幕下呈现温润发丝线，严禁使用浓黑重描边。

8. **风格化套件扩展契约 (`data-ui-skin` 正交叠加架构)**：
   - **审美底线——「90% 洁净纸感 + 10% 克制锚点」**：
     - 风格化主题（如 `genshin`、`sticker`，以及后续 `hsr`、`zzz` 等）必须以基础画布的可读性与纸感呼吸感为主体，仅在边界、底唇、角标与激活锚点中体现主题气质；
     - **明确禁止（反“杀马特 / 过花”红线）**：禁止整块高饱和纯金/亮色实底、重型科幻 HUD 切角、斜向变形（如 `skewX(-10deg)`）、斑马斜纹动画或大面积高饱和阴影；禁止只改按钮导致控件与容器视觉割裂。
   - **正交分层机制**：
     - 底层 4 套基础画布（`light-paper` / `light-zinc` / `dark-espresso` / `dark-obsidian`）与 `data-color-mode`（`light` / `dark`）及 `data-custom-accent` 保持正交；
     - 风格化皮肤通过 `html[data-theme][data-ui-skin='<id>']`（配合 `[data-color-mode='light'|'dark']` 与 `[data-custom-accent]` 优先级规则）在 `app/styles/warm-white-skin.css` 中叠加 Token 与组件表现，并在 `app/lib/theme-preference.ts` 注册 `UiSkinId` / `UI_SKINS` 及首屏防闪烁脚本同步（`sthstart_ui_skin` -> `data-ui-skin`）。
   - **6-Zone 全域联动规范（新增或调整任何皮肤必须完整覆盖以下 6 区）**：
     1. **Zone 1 侧栏与子导航**：激活项书签卡片质感（克制边框 + 2px 实体底唇 + 左侧细窄装饰指示条）；
     2. **Zone 2 页面与工作台顶栏**：克制主题饰线/渐变墨线分隔，不引入额外厚重边框；
     3. **Zone 3 分段标签与工具栏**：`page-tabs[data-variant='local']` 凹陷槽位 + 浮起激活胶囊与底部指示条；
     4. **Zone 4 卡片、分栏与列表选中行**：统一圆角、细边与表面抬升层级，保持选中行与相邻面板材质一致；
     5. **Zone 5 双层内衬浮层（Linshe Dual-Layer Lining）**：`Dialog`、`Drawer`、`CommandPalette` 采用“温润外壳（承载标题与操作栏 `[data-dialog-header]` / `[data-dialog-footer]` / `[data-command-header]`）+ 独立抬升内衬工作面（`[data-dialog-lining]` / `[data-command-lining]`）”结构，避免单调白框或双层粗框；
     6. **Zone 6 触感控件与次级表面**：`Button` 实体底唇与按压下沉、`Switch`/`Checkbox` 轨道、`Badge`、`Alert`、`Pagination` 及 1.5px 扁平聚焦态 `.ui-control` 输入控件。
   - **Tailwind v4 Unlayered CSS 工程避坑指南**：
     - 无 `@layer` 包裹的皮肤 CSS（如 `warm-white-skin.css`）优先级**高于** Tailwind v4 的 `@layer utilities`（`border-0`、`bg-transparent`、`shadow-none`、`scale-[0.98]`、`text-paper` 等）：
     - 为按钮/菜单项添加 `translateY(2px)` 或 `translate(2px, 2px)` `:active` 按压位移时，**必须显式声明 `scale: 1;`**，防止与 Tailwind `active:scale-[0.98]` 叠加产生缩放抖动；
     - 嵌入头部容器内的无框输入控件（如 `[data-command-header] .ui-control`）**必须显式重置 `border` / `background` / `box-shadow`**，消除双层描边；
     - 将列表或下拉选中项（如 `[data-combobox-selected]`）从深底白字改为浅底风格时，**必须同步覆盖子元素上的 `text-paper` 与 `bg-paper/*` 工具类**，防止浅色文字撞在浅色选中底面上。
