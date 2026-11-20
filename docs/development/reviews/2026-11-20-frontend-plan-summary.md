# SthStart 前端视觉计划总结（P0–P4）

日期：2026-11-20。计划见 [前端视觉计划](2026-11-20-frontend-visual-plan.md)，各阶段细节见 [P0](2026-11-20-p0-delivery.md)、[P1](2026-11-20-p1-delivery.md)、[P2](2026-11-20-p2-delivery.md)、[P3](2026-11-20-p3-delivery.md)、[P4](2026-11-20-p4-delivery.md) 交付记录。

全部改动留在工作区：**没有提交，没有部署到 `9320`，正式库没有迁移**。浏览器验收只用测试端口（4273/4200、4973/4974、4983/4984）与临时数据目录。

截图总览：[`artifacts/visual-verification/2026-11-20-summary/index.html`](../../../artifacts/visual-verification/2026-11-20-summary/index.html)，12 组页面的最初与最终并排对比，可直接用浏览器打开。

## 1. 各阶段做了什么

| 阶段 | 内容 |
| --- | --- |
| Skill 与规则 | 新增 `sthstart-design-language`、`sthstart-ui-system`、`frontend-visual-qa`；修订 `frontend-workspace-interaction`、`project-verifier`、`app/AGENTS.md`；旧的 `frontend-design-aesthetics`、`frontend-visual-verification` 归档到 `docs/archive/`。 |
| P0 守门与修缺陷 | 截图疑似缺陷 4 个修复（14 处搜索图标被遮挡、时间轴首刻度、画布署名角标、资料库窄屏页签）；`check:ui` 棘轮检查并接入 `ci:core`；axe 无障碍扫描（首轮 11 处 serious/critical 全部修好）；视觉基线 7 → 22 张。 |
| P1 外框与页面原型 | `OverviewLayout` / `CollectionLayout` / `DetailLayout` / `ReaderLayout`；角色库、制作项目、媒体库迁到 `CollectionLayout`，角色库页头控件 15 → 7；首页「继续创作」主卡与少数据建议；侧栏重复图标拆开；修好 29 项过期 e2e；axe 加 390 宽。 |
| P2 内容视觉 | 作品、创作项目、制作项目三类封面上传（契约先行 → 服务端校验 → 迁移 68 → 前端）；`EntityArt` 生成式占位替换单字方块；角色档案、项目详情迁 `DetailLayout`，故事阅读、叙事档案迁 `ReaderLayout`；画布颜色全部改 token，修好暗色日志面板。 |
| P3 皮肤与动效 | 皮肤 CSS 拆为 `skins/_base.css`、`genshin.css`、`sticker.css`（拆分前后 34 张基线零差异）；L2 氛围层与可关闭的 L3 主题化层；四种动效并遵守「减少动态效果」；手机页头合并成一行；修好 35 项过期 e2e 与 5 处真缺陷；封面接入作品设定页与新建流程。 |
| P4 存量收敛与总验收 | 5 项 fixme 收尾（其中「来源更新预览」是真缺陷，已修）；色板类、hex、小字号、粗字重、字符图标全部清零；深色孤岛面板改为跟随主题；axe 扩到四套主题；全量回归。 |

## 2. `check:ui` 数量变化

| 类别 | 初始基线（P0） | P1 后 | P2 后 | P3 后 | **最终（P4）** |
| --- | --- | --- | --- | --- | --- |
| Tailwind 原生色板类 | 563 | 563 | 554 | 554 | **0** |
| 6 位 hex 颜色（业务层） | 156 | 156 | 24 | 24 | **0** |
| 小于 12px 的字号 | 205 | 196 | 93 | 93 | **0** |
| 超过 600 的字重 | 67 | 67 | 58 | 58 | **0** |
| 任意像素值 | 86 | 80 | 79 | 79 | **4** |
| 字符图标 / 表情符号 | 7 | 7 | 3 | 3 | **0** |
| 有存量的文件 | 116 | — | — | — | **2** |

剩余 4 处任意像素值是有意保留的几何值（手机外框圆角 36/24px、日志时间线圆点 `-left-[21px]`），理由见 P4 记录 §2.1。hex 现在只出现在 `app/styles/theme.css`、皮肤文件和 `app/lib/theme-preference.ts` 的强调色预设（用户可选的数据值）中。

## 3. 视觉评分（最初 → 最终）

1–5 分，按 `frontend-visual-qa` §2。「最初」是该页面第一次被计划评分时的分数，「最终」是最后一次改动后的分数。**第一印象、层级、密度与留白三列是主观项，需要你看截图总览确认。**

| 页面 | 第一印象* | 层级* | 密度与留白* | 控件预算 | 可读性 | 一致性 | 主题与皮肤 | 状态完整 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 首页 | 3 → 5 | 3 → 4 | 2 → 4 | 4 → 4 | 4 → 4 | 3 → 5 | 4 → 4 | 3 → 4 |
| 首页 · genshin | 4 → 5 | 4 → 4 | 4 → 4 | 4 → 4 | 5 → 5 | 4 → 5 | 3 → 5 | 4 → 4 |
| 首页 · sticker | 4 → 5 | 4 → 4 | 4 → 4 | 4 → 4 | 5 → 5 | 4 → 5 | 3 → 5 | 4 → 4 |
| 角色库 | 3 → 4 | 3 → 4 | 2 → 4 | 2 → 4 | 3 → 4 | 3 → 5 | 4 → 4 | 4 → 4 |
| 制作项目 | 3 → 5 | 3 → 4 | 2 → 4 | 4 → 4 | 4 → 4 | 4 → 5 | 4 → 4 | 4 → 4 |
| 媒体库 | 3 → 3 | 3 → 3 | 3 → 3 | 3 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 |
| 作品目录 | 3 → 5 | 3 → 4 | 3 → 4 | 4 → 4 | 4 → 4 | 3 → 4 | 4 → 4 | 4 → 4 |
| 作品首页 | 3 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 |
| 作品沙盒 | 3 → 3 | 3 → 4 | 3 → 3 | 3 → 3 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 |
| 创作项目详情 | 2 → 4 | 3 → 4 | 2 → 4 | 4 → 4 | 4 → 4 | 3 → 4 | 4 → 4 | 4 → 4 |
| 角色档案 | 3 → 4 | 3 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 3 → 4 | 4 → 4 | 3 → 4 |
| 故事阅读流 | 3 → 4 | 3 → 4 | 3 → 4 | 4 → 4 | 3 → 5 | 3 → 4 | 4 → 4 | 4 → 4 |
| 叙事档案 | 4 → 4 | 4 → 4 | 3 → 4 | 4 → 4 | 4 → 5 | 4 → 4 | 4 → 4 | 4 → 4 |
| 故事流画布 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 3 → 4 | 3 → 4 | 3 → 5 | 4 → 4 |
| 自由生成 / 笔记 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 3 → 5 | 4 → 4 | 4 → 4 | 4 → 4 |
| 任务抽屉（P4 首次评分） | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 3 → 5 | 3 → 4 | 4 → 4 |
| 制作工作台 · 素材制作（P4） | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 4 → 4 | 3 → 4 | 3 → 4 | 4 → 4 |

没有任何一项低于最初；可读性、一致性全部 ≥ 4。仍是 3 分的：媒体库与作品沙盒的第一印象（测试数据里没有真实图像，沙盒是调试视图），媒体库层级与密度、作品沙盒的密度与控件预算。

## 4. 改动文件总清单

本计划的改动和工作区里原有的 264 个他人未提交改动混在同一分支上，下面只列本计划新增或改动的文件。每个阶段的逐文件说明见对应交付记录。

- **契约**：`packages/contracts/src/covers.ts`（新增），项目 / 活动 / 作品契约加可选 `coverArtifactId`，`STORY_WORLD_METADATA_KEYS`。
- **服务**：`apps/service/src/covers.ts`、`covers.test.ts`（新增）；作品设定保存剔除封面字段；首页最近工作带出封面；3 个升级测试显式期望新列为 null。
- **迁移**：迁移 68 `entity-covers`（三张表加可空 `cover_artifact_id` 与删除触发器）。
- **前端**：
  - 共享原语与布局：`app/components/ui/input.tsx`（`leftIcon`）、`pagination.tsx`、`entity-art.tsx`、`entity-art-model.ts`；`app/components/shared/page-archetypes.tsx`、`page-archetypes-model.ts`；
  - 外框：`app/shell/navigation.tsx`、`task-drawer.tsx`、`accent-color-dialog.tsx`、手机页头；
  - 业务模块：`app/features/covers/`（`CoverField`、`PendingCoverField`、`applyPendingCover`、API）；角色库、制作项目、媒体库、首页、作品目录、作品首页、作品设定、角色档案、创作项目详情、故事阅读、叙事档案、故事流画布、创作编排画布、日历、资料库；
  - P4 存量收敛涉及约 100 个业务文件，集中在 `app/features/activities`、`story-worlds`、`characters`、`story`、`media-library`、`public-services`、`linshe-bridge`，以及 `app/shell`、`app/workspaces`、`app/apps/linshe`、`app/settings/ai-logs`；
  - `app/lib/theme-preference.ts`（L3 主题化开关、`ACCENT_PRESETS`）、外观设置页。
- **样式**：`app/styles/theme.css`（`--console-*`、`--media-backdrop`、`--on-media`、`--publication-*`）、`app/styles/skins/_base.css`、`genshin.css`、`sticker.css`（由 `warm-white-skin.css` 拆出）、`motion.css`、`entity-art.css`、`shell/page-archetypes.css`、`shell/home-overview.css`、`resources.css`、`story-worlds/flow/flow.css`、`creative-workbench.css`。
- **测试与检查**：
  - `scripts/ui/check-tokens.mjs`、`check-tokens.test.mjs`、`baseline.json`，`package.json` 新增 `check:ui`、`test:ui-check` 并接入 `ci:core`，`@axe-core/playwright`；
  - 新增 `tests/e2e/a11y-routes.spec.ts`、`entity-covers.spec.ts`、`motion.spec.ts`、`tests/e2e/visual-fixtures/`；
  - `visual.spec.ts` 与 34 张 win32 基线；
  - 按新界面更新的过期 e2e 约 25 个文件（P1 29 项、P3 35 项、P4 4 项）。
- **文档与 Skill**：三个新 Skill 和两个修订的 Skill、`app/AGENTS.md`、`docs/archive/` 两份归档与 README 入口、计划文档、本总结与 P0–P4 五份交付记录。

## 5. 正式库迁移 68：执行前的备份步骤

正式库会在**下次部署或重启服务时**自动执行迁移 68。执行前按 `db-migration-backup`：

```bash
npm run db:check          # 只读：确认当前版本为 67
npm run db:backup         # 一致快照 + media-manifest.json
npm run db:integrity      # 只读：PRAGMA integrity_check
# 部署 / 重启服务，迁移 68 自动执行
npm run db:check          # 确认版本为 68
npm run db:integrity
```

需要连媒体一起保底时，改用 `node --import tsx scripts/portable-backup.ts backup`，再 `verify`。迁移只加可空列和触发器，回退时用备份恢复即可，不需要反向迁移。迁移已在临时旧版数据库上验证过：旧数据逐列保留，`integrity_check` 正常，外键检查为空。

## 6. 全量回归

依次运行，细节见 [P4 记录](2026-11-20-p4-delivery.md) §3。

| 检查 | 结果 |
| --- | --- |
| `check:architecture` / `check:ui` / `typecheck` | 通过（架构 0 违规） |
| 回归（`test:regression`，含全量服务测试） | 317 个文件 316 通过；唯一失败是已知的上游适配器测试（4/18 子项，他人未提交改动，只记录） |
| `skills:sync -- --check`、`npm run build` | 通过 |
| 主配置 e2e | 修复后整轮 309 项：257 通过、13 失败、22 跳过；13 项里 11 项单独重跑通过（共享测试库 / 负载波动），1 项已标 fixme，1 项间歇性（见 §7） |
| world-authoring / story-worlds / learning / rework / comfy 配置 | 31/31、9/9、3/3、4/4、14/14 |
| axe 四套基础主题 × 1440/390 | 8/8 组，serious / critical 为 0 |
| `visual.spec` | 34 通过、1 跳过 |

失败归类：**本计划引入**的只有首页模块卡与字阶相关的 e2e 断言（P0/P1 有意改动），已全部修好；其余是**分支既有改动**让断言过期（已改或标 fixme）和**环境限制**（专用配置、负载、`vinext dev` 冷启动）。

## 7. 遗留与下一步建议

**需要你确认或决定的**

1. 评分表里第一印象、层级、密度三列（主观项），请看截图总览确认。
2. 正式库迁移 68：下次部署或重启服务前按 §5 备份。
3. 本计划的改动和工作区里原有的未提交改动混在同一分支，提交前需要拆分。

**遗留**

- `workspace-edges` 矮视口 1440 用例间歇性失败（3 次 1 次通过），探针 6 次没能复现，原因未定，不能排除与本计划有关。
- 两项新 fixme：资料库 `returnTo` 往返（快捷入口默认关闭后没有入口）、自由生成分栏滚动边界（参数栏改版）。
- 主配置整轮共用一个测试库，`visual-optimization`、`model-services` 等会被其他用例的数据挤到第一屏之外，单独运行都通过。
- darwin 视觉基线待补：在 Mac 上运行 `npx playwright test tests/e2e/visual.spec.ts --update-snapshots`。
- 物理手机、系统软键盘、真实中文输入法与读屏器没有覆盖（浏览器模拟）。
- 次级弹窗（提示词来源面板、镜头影响复核等）只有 axe 与类型检查覆盖。
- ESLint 既有 27 个 `react-hooks/*` 错误、4 项上游适配器服务测试失败，都不是本计划引入。

**下一步建议**

1. 给共享测试库敏感的几份 e2e 各自建独立数据，消除整轮运行里的波动。
2. 媒体库与作品沙盒的第一印象仍是 3：媒体库可以加按类型分组的封面墙，沙盒视图可以考虑并入作品首页或明确标为调试入口。
3. 把 `check:ui` 的剩余 4 处几何值收进共享原语（手机外框、时间线圆点），基线清零后可把 `arbitraryPx` 也改为新文件零容忍以外的全局零容忍。
4. 补 darwin 基线后，把 `visual.spec` 加进 CI 的常规浏览器任务。
