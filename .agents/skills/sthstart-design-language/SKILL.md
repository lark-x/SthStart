---
name: sthstart-design-language
description: >-
  Use when designing or redesigning a SthStart page, module home, list, detail view, reader, or empty
  state, or when the goal is to make the UI look better rather than only follow rules. Defines the
  visual direction ("the creator's desk"), five page archetypes, header control budget, density,
  imagery, empty and low-data states, reading typography, motion, and how much expression a ui skin
  may add. Token names, primitives and theme invariants live in sthstart-ui-system; interaction
  mechanics live in frontend-workspace-interaction; acceptance lives in frontend-visual-qa.
---

# SthStart 设计语言

方向：**创作者的书桌**。界面是一张整洁的暖纸桌面，用户的作品——章节、角色、世界、图像——是桌上最显眼的东西。外框和控件退到后面，但不能退到"什么都没有"。

本 Skill 回答"做成什么样"。token 名称与取值以 `app/styles/theme.css` 为准，用法见 `sthstart-ui-system`。整体推进计划见 `docs/development/reviews/2026-11-20-frontend-visual-plan.md`；标注「计划」的条目在对应阶段落地前，按"现在"一栏执行。

## 1. 三条判断标准

做任何页面前先问：

1. **第一眼看到的是作品还是控件？** 首屏最大的元素是筛选栏、按钮组或空白时，需要重排。
2. **只有 1 条数据时还好看吗？** 少数据是新用户的常态，必须专门设计，不能只是"列表变短"。
3. **去掉一半按钮还能完成主任务吗？** 能的话，那一半应该进溢出菜单。

## 2. 五种页面原型

每个路由归入其中一种。滚动和分栏的工程要求见 `frontend-workspace-interaction`。

| 原型 | 用途 | 滚动 | 首屏主角 | 使用 | 已迁移页面 |
| --- | --- | --- | --- | --- | --- |
| Overview | 工作台首页、模块首页 | 自然滚动 | "继续创作"主卡 + 最近作品缩略图 | `OverviewLayout` | 工作台首页 |
| Collection | 角色库、制作项目、媒体库、资料列表 | 自然滚动 | 作品卡片或行 | `CollectionLayout`（内置控件预算）+ `CollectionFilterButton` / `CollectionFilterChips` / `CollectionViewToggle` / `useCollectionView` | 角色库、制作项目、媒体库 |
| Detail | 角色档案、项目详情、设置分区 | 自然滚动 | 实体的图像与名称 | `DetailLayout` | 已使用：角色档案、创作项目详情（封面在 `media` 槽） |
| Workbench | 剧情工作室、制作工作台、世界编辑、笔记编辑 | 视口锁高、分栏独立滚动 | 正在编辑的内容 | `WorkspaceShell` / `WorkspaceHeader` + `SplitPanes` / `WorkbenchColumns` | 沿用现有组件 |
| Reader / Canvas | 叙事档案、长文阅读、故事流画布 | 阅读单栏自然滚动；画布视口锁高 | 正文或画布本身 | `ReaderLayout`；画布用各自外壳 | 已使用：叙事档案阅读器、故事阅读流（`embedded`）；正文统一 `.reader-prose` |

原型组件在 `app/components/shared/page-archetypes.tsx`，纯逻辑（控件预算、视图选择、少数据判定）在 `page-archetypes-model.ts`。不要为单个页面另做外框。新列表页优先用 `CollectionLayout`；页面结构特殊时（如角色库的三个页签面板）至少复用其中的动作区、筛选按钮、胶囊和视图切换。

## 3. 页头与控件预算

- 一个页头最多：**1 个主操作 + 2 个次操作 + 1 个溢出菜单**。全局搜索和任务入口由外框提供，不计入。`CollectionActions` 会把超出预算的次操作自动并入溢出菜单。
- 筛选默认只显示：**1 个搜索框 + 1 个"筛选"按钮**。已生效的条件以可删除的胶囊显示在搜索框下方；没有条件时不占行。
- 视图切换（`PageTabs`）不计入控件预算，但一个页头只放一组。
- 统计数字（"共 N 条"）只出现一次：有分页时由分页显示，不再在胶囊旁重复；没有分页时才放进 `summary`。
- 同一状态（如"未运行"）在一个视图里只出现一次。
- 手机（640px 以下）页头是应用栏：标题与全局工具同一行，子导航、页面操作各占一行，不留只放全局工具的空行；DOM 顺序不变，页面操作先于全局工具获得焦点。实现见 `app/styles/workspace-unified.css`。

## 4. 密度

| 档位 | 行高 | 用于 |
| --- | --- | --- |
| 舒适 | 56–64px | Overview、Collection 卡片视图 |
| 标准 | 44–48px | Collection 行视图、Detail 属性 |
| 紧凑 | 32–36px | Workbench 侧栏、大纲树、日志 |

一个页面只用一个主密度；Workbench 的侧栏可以比主区紧凑一档。字号下限不随密度降低（见 `sthstart-ui-system` §1）。

## 5. 图像与作品呈现

- 角色、项目、世界、活动都应有**视觉代表**：立绘 / 封面 / 首图。
- 没有图像时统一使用 `EntityArt`（`app/components/ui/entity-art.tsx`）：按实体 ID 生成稳定纹样，色相取自模块 tone，叠加纸纹与首字；改名不改变纹样。不要再写纯色方块加单字的占位。
- 有真实图像时用 `EntityImage`：`src` 缺失或加载失败自动回落到 `EntityArt`，不会出现破图。
- 作品（故事世界）、创作项目、制作项目支持封面：`CoverField`（`app/features/covers/components/cover-field.tsx`）提供设置、更换、移除，可从媒体库选或本地上传；封面只保存媒体 ID，地址用 `coverImageUrl()` 生成。
- 图像统一：固定 `aspect-ratio`（头像 1:1、立绘 3:4、封面 16:10）、`--radius-panel`、1px 发丝边、懒加载、加载时显示同尺寸 `Skeleton`。
- 图像上的悬停工具或说明，用语义遮罩（`bg-overlay-backdrop` 或 `bg-surface/…`），不写 `from-black/60` 这类原生色板。
- 卡片里图像占卡片面积 40% 以上时，标题放图像下方，不做文字压图。
- 首页"最近工作"必须带缩略图。

## 6. 空态与少数据态

| 数量 | 处理 |
| --- | --- |
| 0 | `EmptyState`：一句话说明做了会得到什么 + 1 个主操作 + 最多 1 个次要入口（如"导入"）；风格化皮肤会在图标块上加插图（L2） |
| 1–2 | 卡片视图（`useCollectionView` 自动切换），列表（`[data-collection-items]`）改用更宽的卡片并限制总宽；Overview 显示"下一步可以做什么"的 1–3 个建议（`pickNextSteps`） |
| ≥3 | 正常列表 |

空态文案说明结果，不只写"暂无数据"。筛选导致的空结果与真正的空库分开处理：前者给出"清除筛选"或"扩大范围"，且只在该操作有效时出现。

## 7. 阅读排版

- Reader 原型的正文行宽约 36–40 个汉字（约 `40em`），行高 1.8，段距 0.6em，字号不低于 16px。
- 衬线体（`--font-serif`）只在 Reader 原型和正文阅读视图使用；其余全部 `--font-sans`。
- 元信息（时间、人物、章节）放在正文上方一行，使用 meta 字阶，不在正文中穿插徽章。

## 8. 动效

使用已有的 `--motion-fast/base/slow`、`--motion-ease`、`--motion-spring`。共享实现在 `app/styles/motion.css`，业务层不另写动画：

| 场景 | 动效 | 时长 |
| --- | --- | --- |
| 列表首次出现 | 淡入 + 上移 4px，逐项错开 30ms，最多 8 项 | base |
| 面板 / 标签切换 | 淡入 + 横移 4px | fast |
| 浮层打开 | 透明度 + 缩放 0.98→1 | base |
| 保存状态变化 | `SaveStatus` 状态点颜色过渡，不弹 toast | fast |

禁止：弹跳的主按钮、循环动画（加载指示除外）、超过 slow 的过渡。全部遵守 `prefers-reduced-motion: reduce`（改为直接显示）。

接入方式：
- 列表：页面原型的列表容器加 `data-collection-items`，其他需要进入动效的列表加 `data-motion-list`，子项自动逐项错开（第 9 项起不再错开）；
- 标签面板：`[role='tabpanel']` 自动生效；
- 浮层：共享 `Dialog` 已使用透明度 + 缩放 0.98→1，减少动态效果时时长为 0；
- 保存状态：`SaveStatus` 自带；
- 自定义按压位移（`:active` 的 `translate`）必须同时写 `scale: 1`，避免与 Tailwind 的 `active:scale-*` 叠加抖动；
- `tests/e2e/motion.spec.ts` 覆盖错开时序与减少动态效果。

## 9. 皮肤的表达等级

皮肤（`data-ui-skin`）可以有个性，但只能在下列区域、按等级表达：

| 等级 | 状态 | 可以改变 |
| --- | --- | --- |
| L1 点缀 | 已实现，默认开 | 主按钮底唇、激活指示条、标签下划线、聚焦色 |
| L2 氛围 | 已实现，默认开 | 画布极淡纹理（阅读视图除外）、空态插图、头像框、页头饰线起点纹章、`EntityArt` 纹样变体 |
| L3 主题化 | 已实现，外观设置「皮肤主题装饰」可关 | Overview「继续创作」主卡图样、骨架加载高光、首页问候区插画 |

任何等级都**不能改变**：正文区背景与字色、表单控件可读性、数据表格、错误与警告的颜色语义。

一直有效的禁区：整块高饱和实底、科幻 HUD 切角、`skewX` 斜向变形、斑马斜纹动画、大面积高饱和阴影、只改按钮导致控件与容器割裂。

合格标准：1440 首页截图缩略到 25% 时，仍能一眼看出和默认皮肤不同；正文区放大看时，和默认皮肤一样易读。

## 10. 图标

- Lucide SVG，行内 14–18px，模块底块 24–36px。不用表情符号，也不用 `✓`、`○` 等字符代替图标。
- 每个模块一个唯一图标，在 `app/shell/navigation.tsx` 集中定义，其他位置引用该映射。新增模块不得复用已有模块图标。
- 侧栏 rail 收起时每个图标在 hover / focus 显示文字提示（`shell-nav-tooltip`）；展开模式显示文字，偏好存于 `sthstart_nav_collapsed`。
