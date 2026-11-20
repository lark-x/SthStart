# SthStart 前端视觉与规则重整计划

日期：2026-11-20。依据：`app/AGENTS.md`、`.agents/skills/` 下原有 4 个前端 Skill、`app/styles/`、`app/components/ui/`、`app/features/` 源码扫描、`tests/e2e/`，以及 `artifacts/visual-verification/` 中 2026-11-15 全站审查和 11-17 资料库复修截图。分析阶段只读，没有启动服务；同日已按 §3 将新 Skill 写入仓库，旧 Skill 已归档。

---

## 1. 总体评价

一句话：**工程基础已经很好，视觉停在"整洁的管理后台"，还不像创作工具。**

| 维度 | 评价 | 依据 |
| --- | --- | --- |
| 架构与状态归属 | 强 | 依赖方向、运行时循环、服务端泄漏都有自动检查；Query / URL / 编辑会话分工清楚 |
| 设计系统基础 | 强 | `theme.css` 279 个 token，4 套基础主题 + 2 个皮肤正交叠加；43 个 `components/ui` 原语，业务层 `<Button>` 1361 处、裸 `<button>` 85 处 |
| 交互工程 | 较强 | CJK 输入守卫、浮层焦点、Esc 层级、滚动图钉都有实现和用例 |
| 视觉表现力 | 中偏弱 | 克制有余、记忆点不足；内容（角色、封面、图像）没有成为画面主角 |
| 规则执行 | 弱 | 规则写在文字里，没有自动守门，`features/` 已明显漂移（见 §3） |
| 视觉回归 | 中 | 有 186 张路由矩阵截图，但像素基线只有 7 张，核心工作台没有基线；没有 axe 可访问性检查 |

---

## 2. 我看到的前端问题

### 2.1 观感层（截图核对）

1. **内容不是主角。** 首页、角色库、制作项目几乎没有图像：角色头像是单字占位（"全"），项目没有封面，媒体库不在首页出现。暖纸只体现在背景色，没有体现在内容承载上。
2. **少数据状态很空。** 1440 首页下半屏空白约 40%；制作项目只有 1 条时整页是一条细行加大片空地。新创作者最常见的就是少数据状态，这是第一印象。
3. **页头控件预算超标、入口重复。** 角色库标题行：3 个分段标签 + 新建角色 + 搜索/导入 + 更多 + 全局搜索 + 任务；下一行又是搜索框 + 作品/标签/分组 3 个 Select + 仅收藏 + 筛选与排序 + 批量管理。这正是 `frontend-workspace-interaction` 自己列的"平铺式繁杂筛选"反模式。故事世界的"未运行"在顶栏和副栏各出现一次。
4. **侧栏 rail 难认。** 只有图标没有文字，`navigation.tsx` 中 `Compass`、`Sparkles` 各被两个模块使用，识别全靠记忆。
5. **皮肤的感知差异太小。** `genshin` 皮肤下的资料库，与普通暗色相比主要只多了金色主按钮和标签下划线。"90/10"红线把皮肤压到几乎看不出来，投入和回报不成比例。
6. **疑似缺陷（需在实机复核）：**
   - 制作项目、资料库笔记的搜索框左侧预留了图标位，截图里看不到图标；
   - 故事世界画布空态说明首字被裁（"整时间范围…"），时间轴首个刻度标签被裁（"0m (00:00)"），画布右下角有一个残留小矩形；
   - 资料库分类标签末项"世界"被截断，但没有渐隐提示。

### 2.2 代码层（`app/features` 等目录扫描，不含测试文件）

| 违规类型 | features | shell | components | 主要文件 |
| --- | --- | --- | --- | --- |
| 原生 Tailwind 色板类（规则禁止） | **487** | 28 | 20 | `prompt-source-panel.tsx` 63、`media-batch-panel.tsx` 42、`image-impact-review.tsx` 38、`shell/task-drawer.tsx` 27 |
| 硬编码 6 位 hex | 103 | 6 | 0 | `workflow-canvas.tsx` 17、`event-node.tsx` 17、`cluster-node.tsx` 16（xyflow 画布节点） |
| 任意像素值 `p-[7px]` 类 | 319 | 0 | 18 | `character-editor-fields.tsx` 29、`world-image-reader.tsx` 27 |
| 小于 12px 字号 | **203** | 0 | 12 | `world-image-reader.tsx` 25、`world-event-detail.tsx` 18、`world-reader.tsx` 16 |
| `font-bold` 及以上（规则上限 600） | 66 | 0 | 1 | `scene-beat-editor.tsx` 12、`studio-mobile-view.tsx` 8 |
| 按钮使用 `text-xs`（规则要求可交互 ≥14px） | 77 | — | — | — |
| `style={{}}` 内联样式 | 80 | 6 | 5 | — |

说明：
- `--font-weight-bold` 和 `--font-weight-black` 在 `theme.css` 中都已映射为 600，所以 `font-bold` 实际不会变粗，但会误导后续开发，也会让皮肤无法区分层级。
- `shell/task-drawer.tsx` 属于全站外框，却使用 `bg-sky-50 / text-amber-700 / border-emerald-300` 这类色板，而 `--color-success/warning/info-*` token 已经齐全。
- 只找到 4 处符号（`✓`、`○`），不是真正的表情符号；建议换成 Lucide 图标以保持一致。
- `eslint.config.mjs` 和 `scripts/architecture/check.mjs` 里都没有颜色、字号、字重相关的规则。**规则存在，但没有任何检查执行它。**

### 2.3 结构层

- 超大文件阻碍视觉改造：`world-resource-picker.tsx` 3089 行、`world-authoring-page.tsx` 1886 行、`story-worlds/workspace.tsx` 1704 行、`topic-library-view.tsx` 877 行。
- `app/styles/` 有 36 个 CSS 文件，`theme.css` 和 `warm-white-skin.css` 各约 620 行；`responsive.css` 有 8 处 `!important`。皮肤规则分散在多个文件，继续加皮肤会越来越难维护。

---

## 3. 现有前端 Skill 的问题

| Skill | 保留 | 问题 | 处理 |
| --- | --- | --- | --- |
| `frontend-design-aesthetics` | 表面层级、色彩配比、字阶、皮肤 6-Zone 契约、Tailwind v4 优先级坑 | ① 在 Skill 里写死 `#f3f0e9` 等 hex，和 `theme.css` 形成两份事实来源；② 大部分是"禁止什么"和 CSS 细节，缺少"怎样做得好看"：没有页面原型、图像策略、空态、密度、动效；③ "7 档幂律遮罩""双层内衬"这类实现细节应该写在组件文档里；④ 只有红线，没有表达空间，所以皮肤做得平淡 | **拆成两个**：`sthstart-design-language`（正向设计方向，新增）+ `sthstart-ui-system`（token / 皮肤 / 原语 / 避坑，由原 Skill 瘦身改名） |
| `frontend-workspace-interaction` | 反模式表、视口锁高、分栏物理、CJK 守卫、滚动图钉 | **示例代码违反项目自己的规则**：`text-2xl font-bold`（超出 600 上限、未使用字阶 token）、`bg-black/60`（原生色板）、`focus-visible:ring-1`（和 inline 变体 2px 底线、1.5px 聚焦态冲突）；页面"严格二选一"不包括阅读器和 xyflow 画布；`Ctrl+B` 在正文编辑器内和"加粗"冲突 | **修订**：示例改为引用 `Input variant="inline"`、`FloatingActionBar` 等现有原语；页面原型改成 5 类（与 design-language 共用）；快捷键加作用域说明 |
| `frontend-visual-verification` | 视口阶梯、2x 截图、不能只看 exit code、数据安全边界 | 启动端口写的是 4173，Playwright 实际用 4273；`view_file` 是其他 Agent 的工具名；没说明何时更新 `toHaveScreenshot` 基线；只能发现缺陷，**没有评判"好不好看"的标准** | **升级为 `frontend-visual-qa`**：证据采集 + 评审打分表 + 基线维护 |
| `project-verifier` | 全部 | 前端行没有 token 检查入口 | 小改：加入 `npm run check:ui` |

用户级 Skill：
- `impeccable` 和 `ui-ux-pro-max` 能力重叠。建议只留 `impeccable` 做机械检查（资料库复修已在用），`ui-ux-pro-max` 从 SthStart 工作区禁用，避免两套审美意见互相打架。
- `modern-web-guidance` 只在使用新 CSS 或浏览器 API 时查询（如 `@container`、View Transitions、Popover API），日常改 Tailwind 类不必调用。

新的前端 Skill 结构（仍是 4 个，职责不重叠）：

```
.agents/skills/
├── sthstart-design-language/      新增：做成什么样（方向、原型、图像、空态、动效、皮肤表达）
├── sthstart-ui-system/            原 frontend-design-aesthetics 瘦身：用什么做（token、原语、皮肤契约、避坑）
├── frontend-workspace-interaction/ 修订：怎么交互
└── frontend-visual-qa/            原 frontend-visual-verification 升级：怎么验收、怎么打分
```

### 落地状态（2026-11-20）

| 项目 | 位置 | 状态 |
| --- | --- | --- |
| `sthstart-design-language` | `.agents/skills/sthstart-design-language/SKILL.md` | 新增 |
| `sthstart-ui-system` | `.agents/skills/sthstart-ui-system/SKILL.md` | 新增，取代 `frontend-design-aesthetics` |
| `frontend-visual-qa` | `.agents/skills/frontend-visual-qa/SKILL.md` | 新增，取代 `frontend-visual-verification` |
| `frontend-workspace-interaction` | 原位置 | 已修订：示例改用 `Input variant="inline"` 与表面 token，滚动模式按页面原型，`Ctrl+B` 写明作用域，聚焦样式与 `Button` 一致 |
| `project-verifier` | 原位置 | 已补充视觉验收与主题/原语检查入口 |
| `app/AGENTS.md` | 第 3 行 | 已改为引用新 Skill 与本计划 |
| 旧 Skill | `docs/archive/frontend-design-aesthetics.md`、`docs/archive/frontend-visual-verification.md` | 已移出自动发现目录并归档，`docs/archive/README.md` 有入口 |
| 截图疑似缺陷 | 见 §4 P0 第 2 项 | 已复核：4 处修复（含复核新发现的资料库页签溢出），1 处不再出现 |
| `check:ui` 守门 | `scripts/ui/check-tokens.mjs`、`scripts/ui/baseline.json`，接入 `ci:core` | 已落地；基线：色板 563、hex 156、小字号 205、粗字重 67、任意 px 86、字符图标 7 |
| axe 无障碍扫描 | `tests/e2e/a11y-routes.spec.ts` | 已落地；22 个主路由 × 暖白/暖夜，serious/critical 为 0 |
| 视觉基线 | `tests/e2e/visual.spec.ts`、`tests/e2e/visual-fixtures/` | 7 → 22 张 win32 基线，按分支已确认改动重新生成；darwin 待补 |
| P0 交付记录 | [2026-11-20-p0-delivery.md](2026-11-20-p0-delivery.md) | 含验证结果；其中 29 项过期 e2e 已在 P1 修复 |
| 页面原型组件 | `app/components/shared/page-archetypes.tsx`、`page-archetypes-model.ts`、`app/styles/shell/page-archetypes.css` | 已落地：Overview / Collection / Detail / Reader 与动作区、筛选按钮、胶囊、视图切换（URL）；单测 9 项 |
| 列表页迁移 | 角色库、制作项目、媒体库 | 已迁到 `CollectionLayout`；角色库页头加筛选行可见控件 15 → 7 |
| 首页 | `app/page.tsx`、`app/workspaces/home/` | 已改为 Overview：继续创作主卡、少数据建议、紧凑统计卡、带缩略图的最近工作 |
| 侧栏 rail | `app/shell/navigation.tsx` | 提示与展开模式原已存在；图标去重，制作项目归入「作品」 |
| 状态去重 | 作品沙盒视图、列表总数 | 已完成 |
| axe 扩展 | `tests/e2e/a11y-routes.spec.ts` | 1440 / 390 × 两套主题；新发现的 7 类问题已修复，serious / critical 为 0 |
| P1 交付记录 | [2026-11-20-p1-delivery.md](2026-11-20-p1-delivery.md) | 含评分表、截图、检查结果与遗留 |
| 封面上传 | `packages/contracts/src/covers.ts`、`apps/service/src/covers.ts`、迁移 68 `entity-covers`、`app/features/covers/` | 已落地：作品、创作项目、制作项目可设置 / 更换 / 移除封面；正式库在下次部署或重启服务时迁移，备份步骤见 P2 交付记录 §2.4 |
| `EntityArt` / `EntityImage` | `app/components/ui/entity-art.tsx`、`entity-art-model.ts`、`app/styles/entity-art.css` | 已落地；首页、作品目录、作品首页人物、角色库、角色档案、制作项目的单字占位已替换 |
| Detail / Reader 迁移 | 角色档案、创作项目详情；叙事档案阅读器、故事阅读流 | 已迁移；正文统一 `.reader-prose`（16px / 1.8 / 40em） |
| 画布 token 化 | 故事流画布、创作编排画布、运行日志控制台 | 已完成；hex 156 → 24（剩余在 P4 范围） |
| P2 交付记录 | [2026-11-20-p2-delivery.md](2026-11-20-p2-delivery.md) | 含契约与迁移说明、评分表、截图、检查结果与遗留 |
| 皮肤 CSS 拆分 | `app/styles/skins/genshin.css`、`sticker.css`、`_base.css` | 已完成；拆分前后 12 张皮肤基线与 22 张原有基线零差异 |
| 皮肤表达分级 | `app/styles/skins/<id>.css`、外观设置「皮肤主题装饰」、`sthstart_skin_flourish` | L2 氛围默认开（画布纹理、页头纹章、空态插图、头像框、`EntityArt` 纹样）；L3 主题化可关（主卡图样、问候区插画、加载高光）；阅读视图不铺纹理 |
| 动效语言 | `app/styles/motion.css`、`Dialog`、`SaveStatus`、`data-collection-items` / `data-motion-list` | 已落地：列表 30ms 错开、面板横移 4px、浮层 0.98→1、保存状态过渡；减少动态效果全部关闭；`tests/e2e/motion.spec.ts` |
| 手机页头 | `app/styles/workspace-unified.css`（639px 断点） | 标题与全局工具同一行，子导航、页面操作各占一行；DOM 焦点顺序不变 |
| P2 遗留 | 作品设定页、补全作品设定、新建制作项目 | 封面接入（`PendingCoverField` + `applyPendingCover`，创建后写入）；叙事阅读器用真实结构数据补拍；4 项服务测试失败已确认在他人未提交的上游适配器改动内 |
| 过期 e2e | 主配置、作品专用、世界设定三组 | 已按当前界面更新；5 项改动较大的标为 `test.fixme` 并写明原因（见 P3 交付记录 §1.1） |
| P3 交付记录 | [2026-11-20-p3-delivery.md](2026-11-20-p3-delivery.md) | 含评分表、截图、检查结果与遗留 |
| P3 遗留 fixme | `story-worlds-source-updates`、`story-worlds-extended`、`world-authoring` | 5 项全部收尾：「来源更新预览」是真缺陷（窄屏下对话框随筛选抽屉卸载），已修；其余 4 项按现行流程重写并通过 |
| 作品性能用例 | `story-worlds-extended` 5 | 用例上限本就是 90s；单跑 35s，各步均远低于断言上限，不改超时与断言 |
| 存量收敛 | 业务层约 100 个文件 | 色板类 554 → 0、hex 24 → 0、小于 12px 字号 93 → 0、粗字重 58 → 0、字符图标 3 → 0、任意像素值 79 → 4（有意保留的几何值）；深色孤岛面板改为跟随主题 |
| 新增 token | `app/styles/theme.css` | `--media-backdrop`、`--on-media`（图像遮罩与文字）、`--publication-*`（导出图内容色）；强调色预设移到 `app/lib/theme-preference.ts` 的 `ACCENT_PRESETS` |
| axe 四套主题 | `tests/e2e/a11y-routes.spec.ts`（`STHSTART_A11Y_THEMES`） | 四套基础主题 × 1440/390 共 8 组，serious / critical 为 0 |
| P4 交付记录与总结 | [2026-11-20-p4-delivery.md](2026-11-20-p4-delivery.md)、[2026-11-20-frontend-plan-summary.md](2026-11-20-frontend-plan-summary.md)、`artifacts/visual-verification/2026-11-20-summary/index.html` | 含全量回归结果与归类、最初 → 最终评分、改动文件总清单、迁移 68 备份步骤、遗留 |

P0–P4 全部完成。新 Skill 中原标为「计划」的条目都已改为现行说明：`check:ui`、axe 扫描（P0）、页面原型组件（P1）、`EntityArt` / 封面 / Detail 与 Reader 迁移（P2）、皮肤拆分与表达分级、动效接入、手机页头（P3）、存量收敛（P4）。遗留事项见 [总结](2026-11-20-frontend-plan-summary.md) §7。

---

## 4. 前端计划

### P0 守门与修缺陷（约 1 周，先做）

目标：先停止漂移，再谈提升。

1. **新增 `scripts/ui/check-tokens.mjs` 和 `npm run check:ui`**（2026-11-20 已完成，见 [P0 交付记录](2026-11-20-p0-delivery.md) §2），扫描 `app/shell`、`app/workspaces`、`app/features`、`app/apps`、`app/settings`：
   - 原生色板类、6 位 hex、`text-[<12px]`、`font-bold|extrabold|black`、任意 px 值；
   - **棘轮模式**：当前数量写入 `scripts/ui/baseline.json`，CI 只允许数量不变或下降，新文件必须为 0；
   - xyflow 节点等确需 JS 颜色的位置，改为读取 CSS 变量（`getComputedStyle` 或 `var(--tone-*)`），不登记豁免。
   - 接入 `ci:core`，排在 `check:architecture` 之后。
2. **修复 §2.1 第 6 条的疑似缺陷**（2026-11-20 已复核并处理，结果见下表）。

   | 疑似缺陷 | 当前代码复核 | 处理 |
   | --- | --- | --- |
   | 搜索框图标不可见 | **确认**，14 处同类写法。图标是 `Input` 之前的绝对定位兄弟节点，被输入框白底盖住 | `Input` 新增 `leftIcon`（Mantine `leftSection`，`aria-hidden`、不接收指针、默认 `pl-9`），14 处改用该属性；补单测 |
   | 故事流时间轴首刻度被裁 | **确认**。刻度按中心点 ≥150px 过滤，标签左半段落在 146px 角色列下面 | 按整段标签左缘避让角色列；列宽抽为 `ACTOR_LANE_HEADER_WIDTH` 共用 |
   | 画布右下角残留小矩形 | **确认**，是 React Flow 默认署名（半透明白底 + 10px 灰字，暗色下像空白方块） | 保留署名，故事流与创作编排画布改用主题文字色、透明底、12px |
   | 画布空态说明首字被裁 | **不再出现**。11-18 后无事件时不再渲染画布，空态单独显示 | 无需修改 |
   | 资料库分类末项截断 | 分类已改为换行网格，不再截断；但顶部五个视图页签因新增图标在 390px 溢出 93px，末项「数据源」不可见（`mantine-notebook-resources` 用例失败） | 640px 以下页签只显示文字 |

   证据：`artifacts/visual-verification/2026-11-20-p0-defects/`（before / after，1440 与 390，暖白与暖夜）。
3. **Skill 修订**（2026-11-20 已完成）：按 §3 改完 4 个 Skill 和 `app/AGENTS.md`，去掉自相矛盾的示例。
4. **视觉基线补齐**（2026-11-20 已完成：22 张 win32 基线，页面原型用例回放 HAR 固定数据；darwin 基线待补）：`visual.spec.ts` 从 7 张增加到约 20 张，覆盖首页、制作项目、制作工作台、角色库、故事世界、资料库、媒体库、设置；每张包括 `light-paper` 和 `dark-espresso`，皮肤只抽查。
5. **加入 `@axe-core/playwright`**（2026-11-20 已完成：`tests/e2e/a11y-routes.spec.ts` 扫描 22 个主路由，修复 11 处 serious/critical 后为 0），对主路由做无障碍扫描，只报 serious/critical。

验收：`check:ui` 进入 CI 并通过；新增基线通过；5 个缺陷有修复前后截图。

### P1 设计语言落地：外框与页面原型（约 2 周）

> 2026-11-20 已完成，见 [P1 交付记录](2026-11-20-p1-delivery.md)。Detail / Reader 原型组件已就绪，页面迁移随 P2 进行；`WorkbenchLayout` 沿用现有 `WorkspaceHeader` + `SplitPanes`，没有新增组件。

1. **页面原型组件**（`app/components/shared/`），与 `sthstart-design-language` 一一对应：
   - `OverviewLayout`（首页、模块首页）、`CollectionLayout`（列表）、`DetailLayout`（档案详情）、`WorkbenchLayout`（已有 `WorkspaceHeader` + `SplitPanes`，补齐规范）、`ReaderLayout`（沉浸阅读）。
   - `CollectionLayout` 内置"页头控件预算"：1 个主操作 + 最多 2 个次操作 + 溢出菜单；筛选默认只有 1 个搜索框加 1 个"筛选"按钮，已生效条件以可删除的筛选胶囊显示。
2. **侧栏 rail**：hover/focus 显示文字提示，可切换"展开带文字"模式；重新分配图标，消除 `Compass` / `Sparkles` 重复。
3. **首页重做**：
   - 顶部"继续创作"主卡：最近一次编辑的项目，显示封面、章节、上次停在哪里，带一个主按钮；
   - 最近工作改为带缩略图的卡片，加入角色头像和媒体缩略图；
   - 统计卡数字和标签同行，降低高度，把空间留给内容；
   - 少数据状态（0–2 条）显示"第一步做什么"的引导，不留大片空白。
4. **列表页**：角色库、制作项目、媒体库支持"卡片 / 行"两种视图，记在 URL；少于 3 条时自动用卡片视图并居中。
5. **重复信息清理**：故事世界状态只保留一处；页头和副栏不再重复同一状态。

验收：`frontend-visual-qa` 评分表中"层级""密度""第一印象"三项从当前约 3 分提到 4 分以上（主观项由你确认）；控件预算在新原型上由单测检查。

### P2 内容视觉（约 2 周）

> 2026-11-20 已完成，见 [P2 交付记录](2026-11-20-p2-delivery.md)。封面按「完整支持上传」实施（契约 + 迁移 68 + 服务校验 + 前端）。

1. **生成式占位**：没有头像或封面时，根据实体 ID 生成稳定的纹样（色相取自对应 `--tone-*`，叠加纸纹与首字），替换现在的单字方块。实现为纯组件 `EntityArt`，无请求依赖。
2. **封面与立绘**：项目、世界、活动支持封面；角色卡优先显示立绘裁切。图像统一使用 `aspect-ratio` 和 `--radius-panel`，加 1px 发丝边以避免在暖纸上"浮"。
3. **阅读体验**：`ReaderLayout` 规定正文最大行宽约 36–40 个汉字、行高 1.8、段距 0.6em，衬线体只在这里启用。处理 `world-reader` 和 `world-image-reader` 中 <12px 的问题（共 41 处）。
4. **画布节点 token 化**：`workflow-canvas`、`event-node`、`cluster-node`、`actor-lane-header` 的 59 处 hex 改为读取 CSS 变量，四套主题都能正确换色。

### P3 皮肤与动效（约 1–2 周）

1. **皮肤分级**：把"90/10"改为三档表达，在 `sthstart-design-language` 中定义：
   - L1 点缀（现状）：按钮底唇、激活指示条；
   - L2 氛围（新增，默认开）：页面画布的极淡纹理或角落纹样、空态插图、头像框、分隔饰线；
   - L3 主题化（可选开关）：首页主卡背景图、加载动画。
   - 禁区保持不变：正文区、表单、数据表格不受皮肤影响。
2. **动效语言**：已有 `--motion-*` token 但业务层基本没用。定义 4 种场景：列表进入（逐项 30ms 错开）、面板切换（淡入 + 4px 位移）、保存反馈（状态点过渡）、浮层（缩放 0.98→1）。全部遵守 `prefers-reduced-motion`。
3. **皮肤 CSS 拆分**：`warm-white-skin.css` 按皮肤拆成 `skins/genshin.css`、`skins/sticker.css`，公共部分保留在 `skins/_base.css`。

### P4 存量收敛（持续，跟随业务改动）

- 按 `check:ui` 的基线逐模块偿还，优先级：`shell/task-drawer` → `features/activities`（色板占比最高）→ `features/story-worlds`（字号和 hex）→ `features/characters`（任意 px）。
- 碰到超过 1000 行的组件时，先拆出纯展示子组件再改样式；不为改样式单独搬迁无关逻辑。
- 目标：色板类 487 → 50 以下，<12px 字号 203 → 0，`font-bold` 66 → 0，hex 只出现在 `theme.css` 和皮肤文件中。

---

## 5. 衡量指标

| 指标 | 当前 | P0 后 | P4 目标 |
| --- | --- | --- | --- |
| 业务层原生色板类 | 535（features+shell+components） | 不增长 | < 50 |
| 业务层 hex | 109（check:ui 口径 156，P2 后 24） | 不增长 | 0 |
| <12px 字号 | 215（check:ui 口径 205，P1 后 196，P2 后 93） | 不增长 | 0 |
| 像素视觉基线 | 7（P0 后：22） | ~20 | ~30 |
| 无障碍扫描 | 无（P0 后：22 个主路由 serious/critical = 0） | 主路由 serious/critical = 0 | 全路由 |
| 页头与筛选行可见控件（角色库） | 约 15 | — | ≤ 7 |
| 视觉评分（frontend-visual-qa） | 未打分 | 建立基准 | 各项 ≥ 4/5 |

## 6. 不在本计划内

- 不新增第 5 套基础主题，不改 `THEMES` 矩阵和首屏脚本写入次数。
- 不替换 Mantine 或 Tailwind。
- 邻舍子模块 UI 按其自己的规范处理。
- 部署到 9320 仍按现有约定，在验证完成后执行。
