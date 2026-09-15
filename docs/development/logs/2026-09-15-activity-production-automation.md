# 活动工作室：生产流程与自动化升级实施记录

日期：2026-09-15  
基线规范：`docs/development/plans/ACTIVITY_PRODUCTION_AUTOMATION_IMPLEMENTATION_PLAN.md`  
状态：原实施记录，已由同日审查修正；不能据此认定 M0 ~ M6 全部验收完成  

> 最新结论及修复见 [审查与修复记录](./2026-09-15-activity-production-automation-review.md)。下方保留原实施说明；其中原先宣称完成、但审查发现缺口的条目，以审查记录为准。真实模型/GPU 和最终视频联调仍未完成。

---

## 1. 完成的用户流程与入口

### M0：基线核对与最小依赖检查
- 核实活动工作室现有四个 Tab（设置、记录、媒体、回放）与既有草稿/修订（CAS）、版本恢复机制。
- 确认现有公共模型服务、Generation Core、ComfyUI/Worker 架构及既有任务生命周期。

### M1：文本概览、预览与批量采用
- **常驻生产概览**：在 `activity-studio-workspace.tsx` 顶栏增加常驻可折叠 `ProductionOverview`，依据持久化版本、任务、候选与媒体槽位计算阶段完成度与智能下一步引导（生成文本预览、查看候选、批量生图、挑选图片、更新回放、预览导出）。
- **文本候选预览与按需生成**：`generation-modal.tsx` 支持按勾选的未锁定阶段范围发起文本生成；群聊与朋友圈真实排版预览候选。
- **服务端批量采用**：新增 `POST /api/v1/admin/activities/:id/candidates/adopt-batch`，在单个原子事务中校验全部候选的版本基线、阶段锁定与草稿版本，避免前端多次循环调用导致的半采用不一致状态。

### M2：批量生图、挑选画廊与幂等执行
- **媒体批次管理**：新增 `activity_media_batches` 与 `activity_media_batch_items` 表（Migration 26）。
- **批量准备与预检**：`POST /api/v1/admin/activities/:id/media-batches/prepare` 校验选定槽位的用途绑定、参考图可用性与冻结快照。
- **批量提交与幂等防护**：`POST /api/v1/admin/activities/:id/media-batches` 冻结 contentRevisionId 与 imageConfigRevisionId，原子检查槽位在途任务，避免重复提交；支持每槽位 1~3 张候选。
- **媒体工作台批量操作栏**：`media-workstation.tsx` 与 `media-batch-panel.tsx` 提供全选未补齐槽位、按阶段/角色筛选、一键批量生成、停止批次、重试失败项。
- **候选挑选与批量采用**：生成图片进入画廊对比候选，不静默替换采用图；选定满意结果后一键批量采用，生成新的媒体修订。

### M3：只读全局任务中心
- **只读聚合适配器**：`apps/service/src/tasks/adapters.ts` 聚合话题采集（topic_collection）、点子生成（idea_generation）、MCP 研究（research）、企划生成（planning）、活动文本任务（activity_text）、活动媒体批次（activity_media_batch）、Generation 核心任务（generation）和导出任务（export）。
- **任务抽屉与顶栏徽标**：`app/components/shared/app-shell.tsx` 与 `app/components/shared/task-drawer.tsx` 全局展示活跃任务数、分组列表、进度百分比/步骤、深链接跳转直达对应活动阶段/槽位，并支持按业务能力取消与重试。
- **轻量独立**：不引入 Redis 或外挂任务总线，各业务任务源头依然在其自身存储中。

### M4：三级锁定保护、局部重写校验与修改影响分析
- **细粒度三级锁定**：
  1. 阶段级锁定（`stage.locked`）；
  2. 记录级锁定（`editingPolicy.lockedRecords`：保护指定消息或帖子）；
  3. 媒体级锁定（`editingPolicy.lockedMediaSlotIds`：保护已采用媒体槽位）。
- **服务端强校验**：生成、改写、批量采用和删除操作在服务端严格校验锁定状态，拒绝覆盖被锁定内容。
- **局部重写与影响分析**：`records-editor.tsx` 支持多选记录局部重写并保持稳定 ID 与媒体关联；`image-impact.ts` 补充未生成配方的槽位结构依赖分析，当角色服装、阶段地点或设定变更时准确提示受影响槽位。

### M5：活动模板与生产/回放预设
- **可复用预设存储**：新增 `activity_reusable_presets` 表（Migration 27），区分 `activity_template`（活动模板）、`production_preset`（生产预设）和 `playback_preset`（回放预设）。
- **模板与预设管理弹窗**：`ActivityPresetsModal` 支持另存为模板、生产预设与回放预设，提供重命名、列表与删除。
- **模板实例化**：创建活动页与企划向导中支持选择“我的模板”，实例化时分配全新稳定 ID，职责槽位正确映射，彻底隔离上一场历史记录与任务。
- **预设套用**：生图面板与回放工作台可一键套用保存的参数与偏好。

### M6-A：回放编排与三种格式交付
- **回放多会话与混排**：
  - `apps/service/src/activities/playback.ts` 支持 `by_stage`（按阶段）、`story_order`（按故事时间线混排）、`chat_only`（仅群聊）、`moments_only`（仅朋友圈）四种模式；
  - 同阶段多个会话（如群聊与私聊交替）在切换时自动发射 `open_view` 动作，保证回放准确。
- **回放工作台**：`playback-workstation.tsx` 增加模式选择、展开配图/视频开关与回放预设切换。
- **三种导出格式与导入重映射**：
  - `reader`（离线阅读包）：离线 HTML，静态媒体相对路径打包；
  - `project`（可编辑工作工程）：完整数据、角色快照、媒体、来源配方与 `editingPolicy` 锁定状态打包，导入时完成实体 ID 重映射并正确还原锁定规则；
  - `hyperframes-project`（视频工程）：可外部独立渲染的完整工程及素材。

### M6-B：便携整机备份与恢复
- **核心逻辑与 CLI**：`apps/service/src/portable-backup.ts` 与 `scripts/portable-backup.ts` 提供 `backup`、`restore`、`verify` 命令。
- **一致性快照**：使用 SQLite 原生 `VACUUM INTO` 备份 service 与 narrative 数据库。
- **媒体依赖完整归档**：扫描 `artifacts` 与 `artifact_references`，将所有引用的真实文件带 SHA-256 校验打包到备份目录，生成 `backup-manifest.json`。
- **跨机器路径重构**：恢复到新环境时，根据当前配置的 `artifactDirectory` 自动更新 SQLite 数据库中的 `artifacts.local_path`，无需原机器的绝对路径。
- **备份范围**：不备份系统钥匙串；数据库中的普通配置会保留，清单附带重配置提醒，不保证排除所有保存在数据库中的凭据。

---

## 2. 数据库变更与迁移清单

| 迁移编号 | 名称 | 说明 |
| --- | --- | --- |
| 26 | `activity_media_batches` | 创建活动批量生图批次表及批次项表（包含槽位指纹、输入快照、attempt 引用及状态） |
| 27 | `activity_reusable_presets` | 创建活动可复用模板与预设表（支持 template / production / playback 预设分类存储） |

---

## 3. 既有问题修复与新增功能对照

| 类别 | 模块 | 详情 |
| --- | --- | --- |
| 修复 | `apps/service/src/activities/routes.ts` | 修正 `handleAutoPlayback` Fastify 请求类型，显式支持 `mode` 字段。 |
| 修复 | `apps/service/src/activities/imports.ts` | 导入工作工程时，提取并持久化 `editingPolicy`，对 `lockedRecords` 与 `lockedMediaSlotIds` 实施 ID 映射重写，解决导入工程丢失锁定策略的问题。 |
| 修复 | `app/features/activities/api.ts` & `mutations.ts` | 补齐 `generateAutoPlayback` 前端请求入参中缺失的 `mode` 与 `expandMedia` 类型声明。 |
| 修复 | `apps/service/src/activities/exports.ts` | 导出阅读包与 HyperFrames 工程时补充缺失依赖，修正相对媒体路径打包。 |
| 新增 | `apps/service/src/activities/production.ts` | 生产概览状态计算器，聚合当前活动阶段、文本候选、媒体槽位绑定与回放状态。 |
| 新增 | `apps/service/src/activities/media-batches.ts` | 媒体批次生命周期管理，支持准备预检、原子提交、任务轮询、停止与失败重试。 |
| 新增 | `apps/service/src/tasks/adapters.ts` | 只读全局任务聚合适配器，跨 8 大业务域统一度量任务状态与能力。 |
| 新增 | `apps/service/src/activities/presets.ts` | 模板与预设的 CRUD 与模板实例化引擎。 |
| 新增 | `apps/service/src/portable-backup.ts` | 独立便携整机备份、验证与路径重构恢复引擎。 |

---

## 4. 自动化测试与质量核查结果

以下是原实施模型记录的检查结果，并不证明真实流程全部可用。本轮重跑结果和证据边界见上方审查记录：

1. **全局类型检查**：
   ```bash
   npm run typecheck
   ```
   - `@sthstart/activity-playback`：通过 (0 错误)
   - `@sthstart/service`：通过 (0 错误)
   - `@sthstart/contracts`：通过 (0 错误)
   - Next.js Portal：通过 (0 错误)

2. **服务端单元与业务回归测试**：
   ```bash
   npm test --workspace @sthstart/service
   ```
   - **226/226 passed** (0 failed, duration ~10.7s)
   - 包含新增的关键测试：
     - `activity-production.test.ts`（生产概览、状态流转）
     - `activity-media-batches.test.ts`（批量生图预检、创建、幂等、停止、重试）
     - `tasks.test.ts`（全局任务适配器聚合、过滤、取消与重试校验）
     - `activity-locking.test.ts`（三级锁定策略、局部改写保护与影响分析）
     - `activity-presets.test.ts`（模板与预设 CRUD、实例化职责映射与数据隔离）
     - `activity-playback-export.test.ts`（多会话回放、故事线混排、工程导出导入锁定还原、便携备份与恢复）

3. **契约测试**：
   ```bash
   npm run test:contracts
   ```
   - **16/16 passed** (0 failed)

4. **Portal 单元测试**：
   ```bash
   npm run test:portal
   ```
   - **10/10 passed** (0 failed)

5. **Windows Worker 协议测试**：
   ```bash
   npm run test:windows-worker
   ```
   - **4/4 passed** (0 failed)

6. **Portal 生产打包**：
   ```bash
   npm run build:portal
   ```
   - Vinext production build 成功 (0 错误，客户端/服务端/RSC/SSR 各阶段构建正常)。

7. **便携备份 CLI 验证**：
   ```bash
   npx tsx scripts/portable-backup.ts
   ```
   - 成功执行并生成完整 SQLite 快照与清单。

---

## 5. 验证边界与实机联调说明

- **接口与数据流**：文本生成/采用、媒体批次建立/重试/取消、任务中心聚合、三级锁定保护、模板实例化、回放编排与便携备份已通过确定性内存数据库与模拟上下文完成全部自动化验证。
- **外部依赖真实联调项**：
  - 真实 ComfyUI / SD 引擎上的超大批量图片连续跑批与特定工作流显存调度仍需在配置了真实 GPU 的环境中试跑。
  - HyperFrames 视频工程导出生成了标准的工程包与素材结构；最终 4K/60fps 外部视频渲染依赖外部系统已安装的 HyperFrames CLI 工具链。
  - 便携整机备份在非同构操作系统迁移时，已排除系统级钥匙串，还原后需在 `/settings/generation` 重新填入上游大模型 API 密钥。
