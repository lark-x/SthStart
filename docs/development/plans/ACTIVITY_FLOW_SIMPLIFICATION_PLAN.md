# 活动链路精简方案

日期：2026-09-19
基线：`main@5635328`
状态：已实施（§3.1–§3.4）；实施结果与验证见文末「8. 实施结果」。
关联：本方案处理「链路收敛」，与 `THREE_PHASE_DEVELOPMENT_PLAN.md` 的功能扩展（任务中心、分镜生图、架构解耦）不冲突，可并行；但阶段一的「全局任务中心」会再次增加活动入口，建议先做本方案再做任务中心。

## 1. 现状

### 1.1 入口层

活动列表页 4 个动作 + 侧栏 1 个：

| 入口 | 去向 |
| --- | --- |
| 新建活动 | `/apps/activities/new` → 规划向导（4 步） |
| 从话题找灵感 | `/apps/inspiration` → 话题素材库 → 建立企划会话 → 回 `/new?session=…` |
| 导入活动 | 导入弹窗 |
| 角色日历 | `/apps/calendar` → 选寿星 → 回 `/new?date=…` |
| 侧栏「话题素材」 | 同第 2 条 |

### 1.2 创建层：两条完整流程并存

`app/apps/activities/new/new-activity-entry.tsx` 按 `?mode=` 二选一：

| | 规划向导（默认，102KB） | 手动表单（`?mode=manual`，42KB） |
| --- | --- | --- |
| 步骤 | 活动意图 → 人物与地点 → 方案对比 → 确认创建 | 单页：模板 + 参与者 + 企划助手 + 阶段 |
| 模型调用 | 检索 + 方案生成，两次 | 企划助手内一次 |
| 模板 | 支持（内置 + 我的模板） | 支持 |
| 日期 | 支持 | 支持 |
| 寿星 | 支持 | 支持 |
| 自定义参与者 | **不支持** | 支持 |
| 角色职责映射 | 支持 | 支持 |
| 创作配置 | 支持 | 支持 |
| 直接创建空活动 | 不支持 | 支持 |

两者之间还有一个「改用手动创建」按钮互相跳转（`planning-wizard.tsx:737`）。**同一条业务、两套实现、能力大量重叠，差异只有 3 处**：自定义参与者、直接创建空活动（手动表单独有），以及检索与方案对比（向导独有）。

### 1.3 生产层：4 模式 + 子标签 + 7 动作 + 6 弹层

```text
活动工作室
├── 页头动作 7 个：AI 生成 / 内容变化与处理历史 / 版本回溯 / 导出工程 /
│                  保存新版本 / 预设模板 / 返回列表
├── 「下一步」提示条（ProductionOverview）
├── 模式 tab 4 个
│   ├── 记录：子标签 3 个（群聊 / 朋友圈 / 本阶段发生的事）
│   ├── 设定：基本信息 + 参与角色 + 阶段编辑（左右两栏）
│   ├── 素材：单张图工作台 + 批量生图面板
│   └── 回放：设备预览 + 动作序列
└── 弹层 6 个：AI 生成(36KB) / 图片工作台(50KB) / 批量素材(38KB) /
               活动预设(18KB) / 导出 / 历史抽屉
```

后端 28 个接口，其中 11 个是企划会话专用。

### 1.4 三个具体的错位

1. **提示与 tab 是两套坐标系。** `activity-guidance.ts` 输出的进度是「1 确认设定 / 2 写活动内容 / 3 配图（可选）/ 4 预览与导出」，而 tab 顺序是「记录 / 设定 / 素材 / 回放」。默认落在「记录」，提示却说「先确认参与者与活动安排」——用户看到的第一屏就自相矛盾。
2. **配图有两个入口。** 素材模式里「新增镜头 / 批量生图与挑选」并列，两者都通向生成图片，区别（单张 vs 批量）对用户不是自明的。
3. **弹层内还有两层折叠。** AI 生成弹窗里「生成 4 个阶段 · 按需调整范围」和「更多写作方式：邀请、祝福、重写、阶段规划」都是折叠区，而后者在默认态下按钮不可见（`activity-simplification.spec.ts:25` 明确断言了这一点）。

### 1.5 已经做过的一轮精简

`tests/e2e/activity-simplification.spec.ts` 显示已经收过一轮：

- 「保存新版本」从页头移入「更多操作」折叠（默认不可见）
- 「创作配置」收进「高级选项：创作偏好与模板（可选）」折叠
- 阶段编辑一次只展开一个
- 提示条与主行动按钮已存在（`ProductionOverview`）

所以本方案**不重复这些**，只处理仍然存在的结构性问题。

## 2. 目标链路

```text
入口（不变，4 个）
  └── 新建活动 → 规划向导（唯一主路径）
        └── 「从空白开始」→ 直接建活动 → 进工作室

工作室（tab 与提示统一为一条线）
  └── 内容 → 素材 → 回放 → 导出
        ├── 内容：设定 / 群聊 / 朋友圈 / 事件（同层切换，不再有二级标签）
        ├── 素材：默认批量面板；单张编辑按需打开
        ├── 回放：不变
        └── 导出：从弹层升为 tab
```

对比现状：创建流程 2 → 1；模式 tab 4 → 4（但语义与提示统一，且去掉二级标签）；页头动作 7 → 3 + 更多；导出弹层 → tab。

## 3. 改造步骤

### 3.1 创建流程合并

**目标**：向导是唯一主路径；手动表单降级为「从空白开始」。

1. `new-activity-entry.tsx` 移除 `?mode=manual` 分支，直接渲染 `PlanningWizard`；删除 `new-activity-form.tsx`（42KB）。
2. 向导页头（`planning-wizard.tsx:737`）把「改用手动创建」改为「从空白开始」。行为：以当前 intake（模板 / 日期 / 已选角色）为初值，跳过检索与方案生成，直接调用既有的 `create-activity` 建立活动并跳转。**不是**跳到另一个页面。
3. 把手动表单独有的两项能力补进向导：
   - **自定义参与者**：在 step 1「人物与地点」的角色选择旁加「添加自定义参与者」（无 `sourceCharacterId` 的角色）。注意现有约束：企划生成要求全部角色来自角色库（`new-activity-form.tsx:346`），所以自定义参与者只在「从空白开始」路径可用，进入检索/生成前需提示移除。
   - **直接创建空活动**：即上面的「从空白开始」。
4. 「从空白开始」建立的活动，阶段来自所选模板（沿用 `stageDraftsFromTemplate` 的等价逻辑，现在在 `new-activity-form.tsx:42`），建好后进工作室的「内容」tab 继续编辑。

**验收**：`/apps/activities/new` 只有一条流程；`?mode=manual` 不再存在；从空白开始能在 3 步内建出可编辑活动。

### 3.2 工作室 tab 重排

**目标**：tab 顺序、提示文案、进度编号三者一致。

1. `activity-studio-workspace.tsx` 的 tab 定义（第 324-338 行）改为：

   | id | 标签 | 图标 | 合并自 |
   | --- | --- | --- | --- |
   | `content` | 内容 | MessageSquare | 原 `settings` + `records` |
   | `media` | 素材 | Camera | 原 `media` |
   | `playback` | 回放 | PlaySquare | 原 `playback` |
   | `export` | 导出 | Download | 原导出弹层 |

2. **`settings` 与 `records` 合并为 `content`**：设定（基本信息 / 参与角色 / 阶段）与记录（群聊 / 朋友圈 / 事件）合成同一 tab，用**同层**切换器分「设定 / 群聊 / 朋友圈 / 事件」，不再嵌套二级标签。合并后单页结构：左栏设定与角色、右栏阶段编辑；下方切换内容视图。

   这一步同时消除 §1.4 第 1 条的错位：不再有「提示说设定、界面在记录」。

3. **URL 参数兼容**：`?tab=settings` 与 `?tab=records` 都映射到 `content`（并在映射时决定内容视图的初始选中项）。`navigateTab`（第 127 行）与 `onNavigateTab`（第 315 行）的取值同步更新。

4. **导出升为 tab**：`ExportModal` 的两种导出方式（离线包 / 渲染工程）移入 `export` tab 作为两个动作卡片，不再用弹层。`prepareContent()` 的调用时机从「打开弹层前」改为「进入 export tab 时」。

5. **素材默认批量**：`media-workstation.tsx` 里「批量生图与挑选」从并列按钮改为默认视图，单张编辑（`ImageWorkbench`）在点击某个镜头时按需打开。

6. `activity-guidance.ts` 的进度文案改为与 tab 同名：「1 内容 / 2 素材 / 3 回放 / 4 导出」，`ProductionOverview` 里那行硬编码（第 48 行）改为从 tab 定义生成，避免再次漂移。

**验收**：tab 名称、进度编号、`ProductionOverview` 的按钮去向三者一致；`?tab=settings` 与 `?tab=records` 旧链接仍可用。

### 3.3 页头动作收敛

1. 常驻 3 个：**AI 生成**、**保存新版本**（沿用现有折叠内位置）、**返回列表**。
2. 「更多操作」保留：内容变化与处理历史、版本回溯、预设/模板。
3. 「导出工程」从页头移除——已升为 tab（§3.2 第 4 条）。

### 3.4 不做的事

- 不改后端接口。28 个接口与 11 个企划会话接口保持不变；本方案只动前端结构与少量 URL 参数映射。
- 不合并 `GenerationModal` 与 `ImageWorkbench` 的代码。它们体量大（36KB / 50KB）且职责不同，合并风险高于收益；只调整入口。
- 不改 `ReworkPanel`、`HistoryDrawer`、`ActivityPresetsModal` 的内部实现。
- 不引入新的前端框架或状态库。

## 4. 需要同步修改的测试

| 文件 | 依赖点 | 改法 |
| --- | --- | --- |
| `tests/e2e/activity-simplification.spec.ts` | `getByRole('tab', {name:'设定'})`、`'记录'` | 改为 `'内容'`，并按新的同层切换器调整 |
| `tests/e2e/activities.spec.ts` | `'设定'`、`'素材'`、`'回放'` | `'设定'` → `'内容'` |
| `tests/e2e/frontend-experience.spec.ts` | `'设定'`（2 处） | 同上 |
| `tests/e2e/activity-rework.spec.ts` | `/new?mode=manual`、`添加自定义参与者`、`选择活动模板` | 改为向导路径；确认自定义参与者已补进向导 |
| `tests/e2e/quantitative-targets.spec.ts`、`typography.spec.ts`、`contrast.spec.ts`、`viewport-matrix.spec.ts` | 访问 `/apps/activities/new` | 默认路径从向导变为向导（不变），但向导页内容变化会影响排版/对比度取样 |

## 5. 验收

1. `npx tsc --noEmit`、`npm run build:portal` 通过。
2. `npm run test:portal`、`contracts`、`service` 全通过（预期 10 / 16 / 169）。
3. Playwright 全量通过；活动相关 4 个 spec（activities / activity-simplification / activity-rework / workspace-review）全部更新并绿。
4. 人工核对三件事：
   - `/apps/activities/new` 只有一条流程，无 `?mode=manual`。
   - 工作室首屏的 tab、进度编号、提示按钮三者指向一致。
   - 素材默认进批量面板，点单个镜头才开单张工作台。
5. 视觉基线：活动页不在现有基线集合内，预计无需重生成；若角色编辑器等受影响需按既有两步确认流程处理。

## 6. 风险与回退

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 删除 `new-activity-form.tsx` 丢失能力 | 自定义参与者、从空白开始 | §3.1 第 3 条先补齐再删 |
| `?tab=` 旧链接失效 | 用户书签、话题素材跳转 | §3.2 第 3 条做参数映射 |
| `activity-simplification.spec.ts` 是精简验收的守门测试 | 它断言了「更多写作方式」默认折叠等既有简化 | 只改 tab 名称相关断言，不放宽其他断言 |
| 与三阶段计划的任务中心冲突 | 任务中心会再加活动入口 | 本方案先做；任务中心接入时按新结构挂 |

回退：本方案为纯前端结构改动，按文件回退即可；`new-activity-form.tsx` 删除后可从 git 历史恢复。不涉及数据库与业务契约。

## 7. 工作量估计

| 步骤 | 规模 | 说明 |
| --- | --- | --- |
| §3.1 创建流程合并 | 中 | 向导加两个能力 + 删一个 42KB 文件 |
| §3.2 tab 重排 | 中大 | settings/records 合并是主要工作量；导出升 tab 次之 |
| §3.3 页头收敛 | 小 | 移除一个按钮 |
| §4 测试同步 | 中 | 4 个 spec 需改，2 个可能受影响 |

建议顺序：§3.1 → §3.2 → §3.3 → §4，每步独立可验证。

## 8. 实施结果

按 §3.1 → §3.4 → §4 的顺序完成，全部为前端结构改动，未新增数据库结构、前端框架或后端接口。

### 8.1 创建流程合并（§3.1）

- `new-activity-entry.tsx` 移除 `?mode=manual` 分支，只渲染 `PlanningWizard`；删除 `new-activity-form.tsx`（41.9KB）。
- 页头「改用手动创建」改为「从空白开始」：以当前 intake 为初值直接建活动，不再跳页。
- 手动表单独有能力已补进向导：
  - **自定义参与者**：`CustomCastMember` + `CustomCastEditor`，第一步与第二步都可编辑；只在本场活动出现，不进角色库，也不能用于检索/方案生成。
  - **直接建活动**：`buildBlankActors()` 合成「角色库快照 + 自定义参与者」，经 `useCreateActivity` + `buildActivityDocument` 落库。
- 实施中发现并修复两个会静默丢数据的缺陷：
  - 向导只把角色 id 存进 `birthdayIds`，而 `buildActivityDocument` 的 `birthdayActorIds` 要 actor id（服务端快照生成的是 `actor_xxxxxxxx`）。补 `actorIdByCharacterId` 映射后，寿星名单才真正写入。
  - 从日历带入角色时，标题与寿星原本由手动表单负责，向导未接手；补齐后「选好寿星 → 建生日活动」不再断链。

### 8.2 工作室 tab 重排（§3.2）

- tab 改为 `内容 / 素材 / 回放 / 导出`；`settings` 与 `records` 合并为 `content`，内容内部用同层切换器分「设定 / 群聊 / 朋友圈 / 事件」。
- `LEGACY_TAB_MAP` 保留 `?tab=settings`、`?tab=records` 旧链接可用。
- 导出由弹层升为 tab（新增 `export-panel.tsx`，删除 `export-modal.tsx`）；进入素材/回放/导出前统一先 `prepareContent()`。
- `ProductionOverview` 的进度文案改为与 tab 同源（`WORKFLOW_STEPS`），消除「提示说设定、界面在记录」的错位。
- **§3.2 第 5 条（素材默认批量）未按原样实施**：`MediaBatchPanel` 是模态 `Dialog`，默认打开会盖住整页、连模式 tab 都点不到（实测会让 `activities.spec.ts` 超时）。改为保留其意图——把「批量生图与挑选」提为素材页主按钮、「新增镜头」降为次要按钮，并改写说明文案，让两个入口的主次与区别自明。

### 8.3 页头收敛（§3.3）

- 「导出工程」移出页头（已升为 tab）；常驻动作收敛为「下一步」区域主动作 + 「更多操作」（内容变化与处理历史 / 版本回溯 / 预设模板 / 保存新版本）。

### 8.4 测试同步（§4）与发现

| 文件 | 改法 |
| --- | --- |
| `activities.spec.ts` | 改用「自定义参与者 + 从空白开始」建活动；子标签改「群聊/朋友圈/事件」 |
| `activity-simplification.spec.ts` | 先「内容」再「设定」；「记录」改「群聊」 |
| `frontend-experience.spec.ts` | 同上；并补上「更多操作」展开（09-19 那波把「保存新版本」收进折叠，测试未同步） |
| `activity-rework.spec.ts` | `?mode=manual` 改走向导；「选择活动模板」改「活动模板」 |
| `calendar.spec.ts` | 改「从空白开始」，并用接口断言四阶段与两位寿星 |
| `quantitative-targets.spec.ts` | 生成入口断言改为「接下来做什么」区域的主动作；模板下拉改向导的「活动模板」，并去掉已不存在的确认框 |

顺带修复的三处遗留不一致（都在本次改动之前就存在）：

1. 生日活动预填标题：契约模板 `type` 与 E2E 断言都是「生日聚会」，而 `8678cdd` 之后的手动表单写成「生日会」。向导沿用正确措辞。
2. `quantitative-targets.spec.ts` 仍断言页头「AI 生成内容」按钮；该重复入口已被 09-19 的精简收进「接下来做什么」，断言随之更新。
3. 同一 spec 仍在向导 URL 上查找已删除手动表单的「选择活动模板」标签与确认框。

### 8.5 验证

- `npx tsc --noEmit`：通过。
- `npm run build:portal`：通过。
- `npm run test:portal`：13/13 通过。
- `apps/service` 单测：245 项中 241 通过、4 失败，失败集中在 `topics` / `ideas` / 便携备份（M6-B），与本次前端改动无关（在干净 `HEAD` 上同样失败，见 8.6）。
- Playwright 全量：53 通过 / 1 跳过 / 12 失败；12 项失败在干净 `HEAD` 上逐条复现，全部属于既有的对比度、视觉基线与门户/公共服务用例，本次改动新增失败数为 0。
- 活动相关 6 个 spec（activities / activity-simplification / frontend-experience / activity-rework / calendar / quantitative-targets）：17 通过 / 1 跳过。
- 说明：首轮跑这批 spec 时曾一次性出现 16 项失败，单独复跑与第二轮同批全绿；原因是 Playwright 服务与另一个 worktree 的进程争用端口，不是代码缺陷。

### 8.6 既有失败（不属于本次改动）

为区分「本次引入」与「既有」，另建 `HEAD` 的独立 worktree 复跑同一批用例，结果一致：

| 用例 | 干净 HEAD | 本工作区 |
| --- | --- | --- |
| `contrast.spec.ts` 3 项 | 失败 | 失败 |
| `visual.spec.ts` 7 项 | 失败 | 失败 |
| `portal.spec.ts` 2 项 | 失败 | 失败 |
| `quantitative-targets.spec.ts` 2 项 | 失败（旧标签/旧按钮断言） | 已修复，通过 |

其中 `portal.spec.ts` 的失败包含一个 React 水合错误（`Minified React error #418`），`contrast.spec.ts` 的失败来自 `/apps/activities/new` 向导步骤徽标的文字对比度（4.28:1）与一处 `select` 边框（1.46:1）。这两类都需要单独处理，本方案未涉及。
