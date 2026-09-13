# 前端统一方案 · 阶段 B 交付记录

> 日期：2026-09-12  
> 依据：[FRONTEND_DESIGN_UNIFICATION_AND_UX_PLAN.md](../plans/FRONTEND_DESIGN_UNIFICATION_AND_UX_PLAN.md) §14 第一优先级（控件与主题统一、导航完整性、弹层稳定性、可信状态反馈）  
> 本轮范围：阶段 B「基础组件和真实缺陷」。阶段 C 逐页迁移与阶段 D 样式清理未在本轮展开。

## 1. 改动清单（对照计划编号）

### 主题与 token（F01、§3.1）

- `app/styles/theme.css`：新增语义状态 token `--{success,warning,danger,info}` 各五件（`fg/bg/border/solid/on-solid`），基础色与护眼覆盖成套；`@theme` 映射为 `text-{x}-fg`、`bg-{x}`、`border-{x}-border`、`bg-{x}-solid` 等工具类。旧 `--color-*` 变量保留，globals.css `.status-*` 等既有引用不受影响。
- `@theme` 补齐 `--shadow-panel/floating/dialog` 映射（原先只有 `:root` 变量，工具类不生成）。

### 控件统一（F02、F03，§3.3/§3.4）

- Button：全部尺寸统一 8px 圆角（`rounded-lg`），不再随 size 变形；高度 sm 32 / md 40 / lg 48 / icon 36 / icon-lg 44；`loading` 设置 `aria-busy`；danger 系改用语义 token（白字对比度 3.3:1 → 5.9:1）。
- Input/Select/Textarea：统一 40px 高（原 42px）、8px 圆角、`border-border-default`；Select 补充自绘下拉箭头（`appearance-none`）；错误态走 `border-danger` token。
- Card：12px 圆角（原不对称 `4px_20px_4px_4px`）、`shadow-xs`、`border-border-default`；CardTitle 按规范改无衬线 18px/600（面板标题不用衬线，页面 H1 保留衬线）。
- Dialog：16px 圆角（原不对称）；标题改无衬线 18px/600；新增显式 `size` variant（sm/md/lg，默认 md 与旧版一致）。
- AppSwitcher/弹层关闭按钮等杂项圆角同步收敛。

### 弹层稳定性（F07、F08，§7.3）

- 新增 `app/components/ui/overlay.ts`（`useOverlayAccessibility`）：
  - 回调经 ref 稳定化，父级重渲染不再重建焦点/滚动锁（修复 Drawer 依赖 `onOpenChange` 的缺陷）；
  - body 滚动锁引用计数，嵌套弹层只还原最后一层；
  - Escape 只关闭栈顶弹层；
  - 焦点陷阱过滤 `disabled/hidden/inert/aria-hidden` 与不可见元素；
  - 首焦点顺序：显式 `initialFocusRef` → `[data-autofocus]` → 首个文本输入 → 容器（不再默认落在右上角关闭按钮）；
  - 关闭后恢复触发器焦点，触发器已卸载时交给浏览器回退。
- Dialog/Drawer 全部接入该 hook，共 15 个消费文件 API 保持兼容。

### 导航注册表（F06，§4.1）

- 新增 `app/components/shared/navigation.tsx`：单一注册表（`id/title/href/group/icon/description/keywords`），分组 创作/应用/管理，含邻舍、角色日历、生成配置等全部 11 个入口。
- AppSwitcher 改为消费注册表，按组渲染 `optgroup`——修复切换器缺邻舍入口的问题。
- 命令面板应用条目由注册表生成——修复命令表缺活动、日历、生成配置的问题；两个导航名称保证一致。
- 覆盖检查：注册表 11 项 vs AppSwitcher 11 项 vs 命令面板应用条目 11 项 + 偏好 1 + 快捷操作 3（`action-new-character`、`action-new-note`、`action-logs` 保留）。

### SidebarColumns 修复（F05，§7.1）

- `sidebarFirst` 不再用 CSS order：小屏 DOM 直接先渲染侧栏（视觉与键盘顺序一致），桌面用显式 `xl:col-start/row-start` 恢复 main 左、sidebar 右（旧实现会把 main 挤进 360px 列）。该组件当前无业务调用方，按计划要求先修复再推广。

### Toast（F09，§7.4）

- 相同 `key`（缺省 variant+title）的通知合并更新而非堆叠；同时最多 3 条，超出丢弃最旧。
- 默认时长：成功/默认/信息 4 秒，警告/错误 8 秒（原全部 4 秒）；`duration: 0` 常驻语义保留。
- 悬停/聚焦暂停计时，离开后按剩余时间恢复。
- 容器宽度 `w-[min(384px,calc(100vw-32px))]`，去掉 `left+right+w-full` 的手机溢出组合；考虑 `safe-area-inset-bottom`；层级提升到 `z-[60]`，不再与弹窗（z-50）相互遮挡。
- 颜色全部走语义 token，护眼主题下不再发白。

### 状态组件 token 化

- Badge/Alert/StatusIndicator/EmptyState：硬编码十六进制色迁移到语义 token；Badge `error` 文字色由 accent-dark 修正为 danger-fg；Alert 标题由 `h5` 改为段落（避免为视觉尺寸用标题标签）；StatusIndicator 为 `loading` 补充兜底色。

### 新增共享组件（§7.2）

| 组件 | 路径 | 说明 |
| --- | --- | --- |
| FormField | `app/components/ui/form-field.tsx` | label/必填/提示/错误 + aria 关联，自动注入控件 id |
| ConfirmDialog | `app/components/ui/confirm-dialog.tsx` | 危险操作默认聚焦取消，提交中防重复关闭 |
| AsyncState | `app/components/ui/async-state.tsx` | loading/error/empty/no-results/offline 共享呈现，动作由调用方提供 |
| SaveStatus | `app/components/ui/save-status.tsx` | 未修改/未保存/保存中/已保存/失败/冲突 |
| PageTabs | `app/components/ui/page-tabs.tsx` | tablist/tab 语义、方向键漫游；页面跳转场景仍用链接 |

均无业务调用方接入，供阶段 C 逐页迁移使用。

## 2. 验证结果

- `tsc --noEmit` 通过；`eslint`（改动目录）0 错误 0 警告。
- `npm run build:portal` 生产构建通过；构建产物 CSS 中确认新工具类（`text-success-fg`、`bg-danger-solid`、`shadow-floating`、`rounded-2xl` 等）已生成。
- 实际浏览器核对（生产构建 + 内置浏览器截图，1440×900 与移动端）：
  - 门户、角色库页头/工具栏/按钮/输入样式正常；
  - 批量导入弹窗：首焦点落在首个输入框（原为关闭按钮）、滚动锁生效、Escape 关闭后 `body.overflow` 还原为空；
  - 护眼模式下弹窗表面保持暖色（`bg-surface` token），不发白；
  - AppSwitcher 含全部 11 个入口并按组分栏。
- Playwright e2e（自动拉起 portal+service，独立 e2e 库）：
  - 功能套件 25 项：**21 通过，4 失败**，其中仅 1 项由本轮引起并已修复（命令面板条目改名“邻舍”→ 恢复“邻舍.EXE”，重跑通过）；
  - visual 基线 7 项：因本轮有意样式变更，用 `--update-snapshots` 重建基线，全部通过。

### 既有失败（非本轮引入，证据如下）

1. `portal.spec.ts:120` 公共服务测试：断言标题「公共 LLM 模板库」在当前源码中已不存在（WIP 已重做该页，测试未同步）。
2. `portal.spec.ts:377` 叙事测试：`handleImportComplete` 从不把 `inspectorOpen` 置真（默认 false），搜索框在导入后不可能出现；叙事源码与该测试相对 HEAD 均无改动，逻辑上无法通过。
3. `portal.spec.ts:465` 移动端导航：断言门户首屏可见「进入邻舍」；门户页面与全局 CSS 本轮未改动（布局逐位等价），属于 WIP 门户布局与该 HEAD 测试的既有冲突。
4. `calendar.spec.ts:6`（WIP 新增、未跟踪文件）：`getByText('寿星甲…')` 同时命中日历格与详情行，严格模式歧义；首轮通过、单跑失败，为时序相关的不稳定测试。

## 3. 遗留风险与下一阶段

- 弹层背景未做 `inert`/aria-hidden 隔离（需要门户级根节点配合，焦点陷阱目前只保证键盘不逃逸）；建议在阶段 C 门户改造时一并处理。
- `globals.css` 的 `.primary-action`/`!important`/末尾补丁未清理（计划阶段 D）；门户卡片仍是消费方，待门户页迁移时一并替换为 Button。
- 阶段 C 逐页迁移未开始，建议顺序照计划执行：公共服务 → 活动 → 角色库/编辑 → 日历 → 创作中心 → 笔记 → 叙事 → 控制中心/生成配置 → 门户首页；新增的 FormField/AsyncState/SaveStatus/PageTabs/ConfirmDialog 在各页落地。
- 上述 4 个既有 e2e 失败建议由对应 WIP（公共服务页、叙事工作台、门户移动端、日历测试）的负责人修复或更新断言。
