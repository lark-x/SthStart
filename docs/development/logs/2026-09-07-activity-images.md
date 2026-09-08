# 2026-09-07：活动工作室 ComfyUI 生图、图生图与提示词溯源实施（I1 闭环）

状态：已完成

关联事项：IMG-T01-01 ～ IMG-T04-03（阶段 I1）

关联规范：`docs/development/plans/ACTIVITY_STUDIO_IMAGE_PROVENANCE_SPEC.md` 与 `docs/development/plans/ACTIVITY_STUDIO_IMPLEMENTATION_SPEC.md`


---

## 本轮目标

按照详细设计规范严格实现活动工作室（Activity Studio）图像生成与溯源完整 I1 闭环：
1. 文生图（Text-to-Image）与单参考图生图（Image-to-Image）生成能力。
2. 提示词块分解与来源白名单溯源（Prompt Provenance）。
3. 点击直达来源字段编辑（Source Navigation）。
4. 三级覆盖作用域（本次尝试 override / 槽位默认 slot / 本场活动 global）。
5. 候选图横向对比与基于 CAS headVersion 的媒体采用。
6. 不可变生成历史（Immutable Attempts）与谱系有向无环图（Lineage DAG）。
7. 具备完整溯源闭环的项目导出与导入（Project Export & Import Remapping）。

严格复用 SthStart 中央 Generation、Artifacts 与模型管理架构，前端不直连 ComfyUI，不侵入修改 `upstream/linshe`。

---

## 完成的核心工作

### 1. 契约层与数据库架构 (P0 / IMG-T01-01 ~ IMG-T01-03)
- **数据库 Migration 14 (`activity-image-provenance`)**：
  - 新增 `activity_image_config_drafts` 与 `activity_image_config_revisions`（画风预设、默认参数、槽位级配置、CAS 草稿）。
  - 新增 `activity_prompt_recipes` 与 `activity_prompt_compilations`（配方哈希、字段白名单快照、分通道编译与执行计划哈希）。
  - 新增 `activity_image_attempts` 与 `activity_image_execution_snapshots`（解耦任务关联，确保历史不可变，防级联删除）。
  - 新增 `activity_image_attempt_outputs`、`activity_image_lineage`（有向边与环路拦截）与 `activity_image_source_dependencies`（依赖反查与变更影响索引）。
- **契约定义 (`packages/contracts/src/index.ts`)**：
  - 定义并导出 `ImageConfigDocument`、`PromptRecipe`、`PromptBlock`、`SourceRef`、`ImageAttempt`、`LineageEdge`、`ImpactPreview` 等完整 TypeBox 契约。

### 2. 后端服务与路由 (P1, P2 / IMG-T02-01 ~ IMG-T02-06)
- **画风与配置 (`image-configs.ts`)**：提供草稿读写、版本 CAS 校验与历史版本不可变提交。
- **配方编译与提示词解构 (`image-prompt-compiler.ts`)**：
  - 将提示词分块解构为本场画风、活动主题、阶段地点、角色外貌与服装、镜头构图、补充词、负向约束与单次生成覆盖等。
  - 生成 `PromptBlock` 及 `SourceRef` 快照，严格限制白名单字段。
- **来源解析与波及影响 (`image-provenance.ts`, `image-impact.ts`)**：
  - `resolveSourceRef`：返回历史快照、当前值与面板导航目标（`navigationTarget`）。
  - `previewSourceImpact`：支持点、斜杠和括号多格式路径，准确识别变更波及槽位并标记 `needsReview`。
- **谱系追溯与拓扑防环 (`image-lineage.ts`)**：记录资产父子引用边，在写入前遍历 ancestor 路径检测环路，保障有向无环图一致性。
- **生成任务调度与安全采用 (`image-attempts.ts`, `media.ts`, `routes.ts`)**：
  - 任务分配区分 `activity_image_text` 与 `activity_image_edit`。
  - 媒体采用 `selectMediaForSlots` 严格校验 CAS `expectedHeadVersion`，防止并发覆盖。

### 3. 工程导出与导入闭环 (P4 / IMG-T04-01 ~ IMG-T04-03)
- **导出打包 (`exports.ts`)**：
  - 当 `format === 'project'` 时，在 ZIP 中打包 `data/provenance/`（包含 configs, recipes, compilations, attempts, execution-snapshots, lineage, index）。
  - `manifest.json` 记录 `imageConfigRevisionId`。
- **暂存与提交导入 (`imports.ts`)**：
  - 暂存阶段提取完整溯源统计（configs, recipes, attempts, lineage）。
  - 提交阶段完成 `activityId`、`contentRevisionId`、`configRevId`、`slotId`、`recipeId`、`compilationId`、`attemptId` 及 `assetKey` 的级联重映射，新活动恢复可读历史与新草稿。

### 4. 前端工作台与操作界面 (P3 / IMG-T03-01 ~ IMG-T03-06)
- **API 与 React Query 钩子 (`app/features/activities/api.ts`, `queries.ts`, `mutations.ts`)**：完整对接图像配置、配方编译、生成任务、谱系追溯、来源解析与受控修改。
- **组件落地**：
  - `PromptSourcePanel`：展示提示词分块、来源实体 Badge、历史与当前值对比，支持一键触发定位导航。
  - `ImageImpactReview`：展示受控修改波及槽位列表与审核确认状态。
  - `ImageWorkbench`：三栏布局（左侧槽位配置与作用域切换、中间提示词分块预览与参考图控制、右侧候选结果流、放大对比与 CAS 采用）。
  - `MediaWorkstation` 与 `RecordsEditor`：槽位与消息/动态徽章无缝联动唤起图像工作台。

---

## 验证结论

- **专项自动化测试 (`apps/service/src/activities-images.test.ts`)**：
  - 7/7 测试套件全部通过：
    1. Capabilities Descriptor & Default Image Config ✔
    2. Recipe preparation with whitelisted sources & override isolation ✔
    3. Source resolution & impact preview on editing ✔
    4. Scoped Idempotency and Attempt conflict (409) ✔
    5. Lineage DAG Cycle Detection ✔
    6. Media Selection CAS HeadVersion Check ✔
    7. Full Project Export with Provenance & Import Remapping ✔
- **全量服务测试 (`apps/service`)**：106/106 测试全部通过，零失败、零回归。
- **全工作区类型检查 (`npm run typecheck`)**：全工作区（contracts, service, activity-playback）0 错误。
- **系统环境健康检查 (`node scripts/linshe-doctor.mjs`)**：v14/14 迁移全部就绪，验证通过。
