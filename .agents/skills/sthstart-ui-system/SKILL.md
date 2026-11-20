---
name: sthstart-ui-system
description: >-
  Use when writing or reviewing SthStart UI code that touches colors, typography, spacing, radius,
  elevation, shared primitives in app/components/ui or app/components/shared, theme files in
  app/styles, or a data-ui-skin. Defines which tokens and primitives to use, the business-layer hard
  rules, theme and skin invariants, the 6-zone skin contract, and Tailwind v4 / Mantine pitfalls.
  Replaces frontend-design-aesthetics; visual direction lives in sthstart-design-language.
---

# SthStart UI 系统

本 Skill 回答"用什么做"。**取值的唯一来源是 `app/styles/theme.css`（含 `@theme` 映射）和 `app/lib/theme-preference.ts`**。这里只写 token 名称和用途，不抄色值；需要确认取值时直接读这两个文件。

## 1. 业务层硬规则

适用于 `app/shell`、`app/workspaces`、`app/features`、`app/apps`、`app/settings`。

| 禁止 | 改用 |
| --- | --- |
| Tailwind 原生色板类（`bg-sky-50`、`text-amber-700`、`from-black/60`） | 语义 token 类，或 `Badge` / `Alert` 的 `variant` |
| 6 位 hex、`rgb()` 字面量，包括 xyflow 节点等 JS 里的颜色 | CSS 变量；JS 中写 `var(--tone-*)` 或读取计算样式 |
| `text-[9px]`–`text-[11px]` | 辅助文字最小 `text-xs`（12px）；按钮、输入、`select`、`[role="tab"]` 最小 `text-sm`（14px）；长文阅读与编辑表面最小 16px |
| `font-bold`、`font-extrabold`、`font-black` | `font-semibold`（600）为上限。主题已把 bold / black 映射成 600，写了也不会变粗，只会误导 |
| 任意像素值 `p-[7px]`、`mt-[13px]` | 4px 步进的间距类；确需特殊尺寸时在原语里定义 |
| `rounded-xl`、`shadow-lg` 等固定圆角阴影 | `--radius-*`、`--elev-*` |
| 散装 `div` 拼弹窗、带描边卡片 | `Dialog`、`Drawer`、`Card`、`CommandPalette` |
| `✓`、`○` 等字符或表情符号 | Lucide 图标 |

执行方式：

- 由 `npm run check:ui`（`scripts/ui/check-tokens.mjs`）执行，已接入 `ci:core`，排在 `check:architecture` 之后。扫描上述目录的 `.ts` / `.tsx`（跳过测试文件和 `//`、`*` 开头的注释行），类别为原生色板、6 位 hex、小于 12px 字号、超过 600 字重、间距尺寸圆角的任意 px、字符图标与表情符号。
- 棘轮：`scripts/ui/baseline.json` 按文件、按类别记录存量，数量只能减少，基线里没有的新文件必须为 0，不使用整目录豁免。超标时列出文件和行号；读不了的文件单独报错（退出码 2），不按 0 处计。
- 清理存量后运行 `npm run check:ui -- --update` 收紧基线；有任何一项超标时 `--update` 会拒绝执行，不能用它放宽基线。规则本身的单测：`npm run test:ui-check`。

## 2. Token 用途

| 类别 | Token / 常用类 | 用途 |
| --- | --- | --- |
| 表面 | `--bg-app` → `--bg-nav` → `--surface` → `--surface-raised`；`--surface-sunken`、`--surface-selected`、`--overlay-backdrop` | L0 画布、L1 侧栏、L2 卡片、L3 浮起与选中；凹槽与次要底座；遮罩 |
| 线 | `--hairline`（`border-hairline`）、`--border-control`（`border-border-control`）、`--border-subtle/default/strong` | 卡片与面板用发丝线；表单控件用满足 3:1 的控件边 |
| 文字 | `text-fg-default`、`text-fg-muted`、`text-fg-subtle` | 正文、次要、元信息 |
| 强调 | `--accent`、`--color-focus-ring` | 只表示"可操作 / 已选中"：每屏最多一个主按钮；焦点环 |
| 识别 | `--tone-{violet,blue,orange,green,pink,slate}` 及 `-soft`、`-fg` | 只表示"属于哪个模块"：24–36px 图标底块、小徽章、2px 标记线 |
| 状态 | `--color-{success,warning,danger,info}-{bg,border,fg,solid,on-solid}`；`--color-status-{online,offline,unknown}` | 状态提示、任务抽屉、连接状态 |
| 媒体 | `bg-media-backdrop/*`、`text-on-media`、`border-on-media/*` | 只用于图片 / 视频之上的遮罩、按钮与文字；四套主题共用，不要用在普通表面上 |
| 字阶 | `--text-display`、`--text-page`、`--text-section`、`--text-card-title`、`--text-body`、`--text-meta`、`--text-reading` | 业务层不写字号数值；需要时用 `text-[length:var(--text-section)]` |
| 字体 | `--font-sans`（UI）、`--font-serif`（只在 Reader）、`--font-reading`、`--font-mono` | — |
| 圆角 | `--radius-panel`（面板卡片）、`--radius-control`（按钮输入）、`--radius-dialog`（弹窗）、`--radius-chip`（胶囊） | — |
| 阴影 | `--elev-xs` … `--elev-xl` | 卡片 xs，浮起 md，弹窗 xl |
| 动效 | `--motion-fast/base/slow`、`--motion-ease`、`--motion-spring` | 场景见 `sthstart-design-language` §8 |

色彩配比约 90% 暖中性、8% 模块识别色、2% 强调色。强调色和识别色不能互相替代；侧栏只有当前激活项显示模块识别色。层级依次靠文字灰阶、留白、表面、细线表达，不在面板内嵌套多层全包边框。

## 3. 原语优先

先在 `app/components/ui/` 找（`EmptyState` 根节点带 `data-ui-empty`、图标块带 `data-ui-empty-icon`，`SaveStatus` 带 `data-save-state`，供皮肤与动效使用）：`EntityArt`、`EntityImage`（实体视觉代表，见 `sthstart-design-language` §5）、`Button`、`IconButton`、`Input`（含 `variant="inline"`、搜索框用 `leftIcon`）、`Textarea`（含 `variant="inline"`）、`CjkInput`、`CjkTextarea`、`Select`、`Checkbox`、`Switch`、`Badge`、`Alert`、`Card` 系列、`Dialog`、`Drawer`、`ConfirmDialog`、`ResponsiveEditOverlay`、`CommandPalette`、`PageTabs`、`Pagination`、`FloatingActionBar`、`RowActionsMenu`、`EmptyState`、`Skeleton`、`Spinner`、`AsyncState`、`SaveStatus`、`ScrollFadeContainer`、`Tooltip`、`AnchoredPopover`、`FormField`、`FormSection`。

布局在 `app/components/shared/`：页面原型 `OverviewLayout`、`CollectionLayout`、`DetailLayout`、`ReaderLayout` 及 `CollectionActions`、`CollectionFilterButton`、`CollectionFilterChips`、`CollectionViewToggle`、`useCollectionView`（`page-archetypes.tsx`）；基础布局 `PageContainer`、`ReadingContainer`、`PageHeader`、`SectionHeader`、`Toolbar`、`CardGrid`、`Panel`、`WorkspaceShell`、`WorkspaceHeader`、`WorkbenchColumns`、`SidebarColumns`、`SplitPanes`、`StatusIndicator`、`TagsInput`、`LazyPanel`。

实体图像统一走 `EntityImage`（`ratio`：`avatar` 1:1、`portrait` 3:4、`cover` 16:10），长文正文统一用 `.reader-prose`（衬线、≥16px、行高 1.8、段距 0.6em）；画布与节点的颜色只写 `var(--token)`，不要带 hex 回退值。

没有合适的原语时，先扩展原语（加 `variant` 或语义 `data-*` 钩子），再在业务层使用；不要在业务层写一次性样式。新增或修改原语时暴露语义钩子（`data-ui-variant`、`data-ui-badge`、`data-dialog-lining`、`data-command-lining` 等），让皮肤不改业务 JSX 就能联动。浮层、焦点与 CJK 规则见 `docs/FRONTEND_ARCHITECTURE.md` §7.2。

## 4. 主题与皮肤不变量

- `THEMES` 固定 4 套：`light-paper`、`light-zinc`、`dark-espresso`、`dark-obsidian`。新风格走 `UiSkinId` / `UI_SKINS` / `data-ui-skin`（现有 `default`、`genshin`、`sticker`），与 `data-color-mode`、`data-custom-accent` 正交。
- `THEME_BOOTSTRAP_SCRIPT` 写 `data-mantine-color-scheme` 保持 2 处；`sthstart_ui_skin` 同步到 `data-ui-skin`。
- `app/styles/mantine-bridge.css` 只允许 `#000000`、`#ffffff` 两个 hex。
- 皮肤样式在 `app/styles/skins/`，`app/globals.css` 按 `genshin.css` → `sticker.css` → `_base.css` 的顺序导入：
  - `<id>.css`：该皮肤的令牌（亮 / 暗两段），以及 L2 / L3 表达层；新规则以 `html[data-theme][data-ui-skin='<id>']` 开头，优先级高于公共层；
  - `_base.css`：暖白纸面按钮收尾、自定义强调色覆盖、6 区联动规则。按皮肤区分但与通用规则同优先级的少量规则留在这里，保持原有先后；
  - 新增皮肤：新建 `<id>.css` 并在 `_base.css` 之前导入，在 `theme-preference.ts` 注册 `UiSkinId`、`UI_SKINS` 与首屏脚本。
- L3 主题化装饰由 `data-skin-flourish='off'` 关闭（外观设置的「皮肤主题装饰」开关，偏好键 `sthstart_skin_flourish`，首屏脚本同步）；L3 规则写成 `html[data-theme][data-ui-skin='<id>']:not([data-skin-flourish='off'])`。
- 皮肤改动必须跑 `visual.spec.ts` 的 `ui skin baselines`（genshin / sticker × 暖白 / 暖夜 × 角色库、资料库、制作项目），有意变化时更新基线并写明原因。
- 表达等级与禁区见 `sthstart-design-language` §9。

### 新皮肤必须覆盖的 6 个区域

1. **侧栏与子导航**：激活项书签卡片质感（克制边框 + 2px 底唇 + 左侧细指示条）。
2. **页面与工作台顶栏**：克制的饰线或渐变墨线分隔，不加厚重边框。
3. **分段标签与工具栏**：`page-tabs[data-variant='local']` 凹陷槽位 + 浮起激活胶囊与底部指示条。
4. **卡片、分栏与列表选中行**：圆角、细边与表面抬升一致，选中行与相邻面板材质一致。
5. **双层内衬浮层**：`Dialog`、`Drawer`、`CommandPalette` 为外壳（`[data-dialog-header]` / `[data-dialog-footer]` / `[data-command-header]`）+ 抬升内衬工作面（`[data-dialog-lining]` / `[data-command-lining]`），避免单调白框或双层粗框。
6. **触感控件与次级表面**：`Button` 底唇与按压下沉、`Switch` / `Checkbox` 轨道、`Badge`、`Alert`（左侧 3px 状态条 + 浅底）、`Pagination`、`.ui-control` 1.5px 扁平聚焦态。

## 5. Tailwind v4 与 Mantine 避坑

- 没有 `@layer` 包裹的皮肤 CSS 优先级高于 Tailwind `@layer utilities`（`border-0`、`bg-transparent`、`shadow-none`、`scale-[0.98]`、`text-paper` 等）。
- 按钮或菜单项加 `:active` 位移时显式写 `scale: 1;`，避免和 `active:scale-[0.98]` 叠加抖动。
- 嵌在头部容器里的无框输入（如 `[data-command-header] .ui-control`）显式重置 `border`、`background`、`box-shadow`。
- 选中项（如 `[data-combobox-selected]`）从深底白字改成浅底时，同时覆盖子元素上的 `text-paper`、`bg-paper/*`。
- 通用 `:focus-visible` 规则排除 `.ui-control`，聚焦样式由原语自己管理。
- 独立滚动区的上下边缘渐隐用 `ScrollFadeContainer`，不自己写线性渐变。
- Mantine 组件接入和升级流程见 `docs/FRONTEND_ARCHITECTURE.md` §7.3。

## 6. 改动后的检查

修改 `app/lib/theme-preference.ts`、`app/providers/`、`app/styles/` 或 `app/components/ui/` 后运行：

```bash
node --import tsx/esm --test app/lib/theme-preference.test.ts app/providers/mantine-theme.test.tsx app/providers/providers.test.tsx app/components/ui/primitives.test.tsx app/components/ui/pagination.test.tsx
npm run typecheck
```

```bash
npm run check:ui
```

浏览器验收按 `frontend-visual-qa`。
