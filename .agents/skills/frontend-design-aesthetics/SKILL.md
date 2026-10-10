---
name: frontend-design-aesthetics
description: >-
  Use when styling, designing visual hierarchy, selecting typography scales, configuring spacing rhythm,
  or reviewing visual presentation in SthStart. Enforces Vercel-grade minimalist aesthetics, semantic design
  tokens, 8px spatial grid, high-contrast readability, calm professional micro-copy, and strict zero-emoji standards.
---

# SthStart 视觉美学与设计系统准则 (Design Aesthetics)

基于现代高水准创作与开发工具（Vercel、Linear、Raycast）的设计美学标准，定义 SthStart 统一的视觉语言与排版律动，杜绝任何传统管理后台的粗糙与原始感。

---

## 核心设计哲学

1. **克制与宁静 (Restraint & Calmness)**：
   - 界面是创作者内容的承载容器，不应喧宾夺主。
   - 杜绝花哨的重投影、高饱和度大色块与任何非正式的表情符号（Zero-Emoji 准则）。
   - 图标统一使用 Lucide SVG 矢量图标，尺寸严格控制在 14~18px 之间，保持视觉重心的统一。

2. **空间律动与 8px 网格 (Spatial Rhythm)**：
   - 间距严格基于 4px / 8px 步进倍数（`gap-1` [4px], `gap-2` [8px], `gap-3` [12px], `gap-4` [16px], `gap-6` [24px]）。
   - 容器内边距层次分明：卡片内部统一 `p-3` 或 `p-4`，工作台侧栏 `p-3` 或 `p-4`，页面外框 `p-6`。
   - 严禁出现无规律的任意像素微调（如 `mt-[13px]`, `p-[7px]`）。

3. **字体阶度与文本层级 (Typography Scale)**：
   - **大标题 (H1)**：`text-2xl font-bold tracking-tight text-ink`（工作台核心实体标题、页面主标题）。
   - **分节标题 (H2)**：`text-base font-semibold text-ink`（卡片组标题、面板小标题）。
   - **正文字体**：`text-sm font-normal text-ink leading-relaxed`（普通信息、表单标签、列表项）。
   - **辅助标注 (Caption / Meta)**：`text-xs text-muted`（时间戳、版本号、字数统计、快捷键提示）。
   - **中文排版**：长篇正文行高设置 `leading-relaxed` 或 `leading-loose`；桌面阅读视口限制在 720~800px 最佳行长，严禁机械 `break-all` 破坏中文词组完整性。

4. **语义设计 Token 与着色规约 (Color Tokens)**：
   - **背景层级 (Surface Layers)**：
     - `bg-paper`：全屏底层纸张，提供沉静温暖的基底；
     - `bg-surface`：悬浮卡片、侧栏和工具面板；
     - `bg-surface-muted`：沉降容器、输入框内部、次要代码块或空状态背景。
   - **边框与分隔 (Borders & Dividers)**：
     - 采用极轻微弱边框：`border border-border-default/80`，辅以半透明分割线；
     - 避免大面积粗黑线框，依赖留白与微妙背景明度差区分区域。
   - **交互强调 (Accent)**：
     - 强调色（`text-accent` / `bg-accent`）仅用于当前激活项、主 CTA 按钮与重要状态标签，一页内高亮色面积不超过 5%。
   - **圆角标度 (Corner Radius)**：
     - 全局遵从 CSS 变量：面板与大卡片使用 `rounded-[var(--radius-panel)]`，按钮与输入控件使用 `rounded-[var(--radius-control)]`。

5. **微交互触感与材质 (Micro-Texture & Motion)**：
   - 悬停过渡统一采用 150ms 线性缓动：`transition-all duration-150 ease-out`；
   - 悬浮面板与下拉菜单采用半透明背景与高斯模糊（`backdrop-blur-md bg-surface/90 border border-border-default shadow-lg`），传达现代工芸的通透质感。

6. **文案风格与语态 (Micro-Copy & Tone)**：
   - 沉稳、精准、可预期，传达高品质生产力工具的专业质感；
   - 严禁轻浮语气词（如“喵”、“啦”、“呀”），严禁感叹号轰炸；
   - 状态提示直接陈述事实与明确下一步，不提供模糊描述。
