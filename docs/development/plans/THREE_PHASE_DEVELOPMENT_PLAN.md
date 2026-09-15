# SthStart 三阶段详细开发计划

更新日期：2026-09-15  
基线版本：`main@84a9764`（已完成素材库、企划向导、MCP 研究流及 ComfyUI 配置工作区）

---

## 阶段总览与演进路线

```text
+-----------------------------------------------------------------------------------+
| 阶段一：近期（Next Sprint）- 业务闭环与异步感知                                      |
| 1. 全局后台任务中心 (Global Task Center / Drawer)                                  |
|    - 统一调度：Topics 采集、Activity 策划、MCP 调研、ComfyUI 生图/视频任务           |
|    - AppShell 状态浮标、实时进度流、Toast 通知与快速回跳                              |
| 2. 活动分镜/场景一键生图 (Scene Storyboard Generation)                              |
|    - 贯通：活动阶段 (Stage) -> 角色外观/环境 -> ComfyUI 预设 -> 中央 Artifact 2.0   |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 阶段二：中期（Mid Term）- 架构解耦与媒体收敛                                       |
| 1. Generation Core 重构与 Engine Adapter 抽象 (DEV-001/002/003)                   |
|    - 解耦执行大文件，统一 ComfyUI / Windows Worker / Cloud 适配器边界              |
| 2. Worker / ComfyUI 深度就绪检查与诊断强化 (FIX-001 / DEV-005)                    |
|    - 探测 GPU 显存、模型文件完整性、缺少自定义节点诊断与 UI 修复建议                  |
| 3. 媒体全面收拢至 Artifact 2.0 (DEV-007)                                           |
|    - Notebook 附件与 Character 资产统一入库 Artifact，实现配额与去重管理            |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
| 阶段三：远期（Long Term）- 智能联动与离线便携                                      |
| 1. 本地第一方知识库 (Narrative & Notebook RAG) 接入企划                             |
|    - 将历史剧情树、设定笔记作为企划的第一方参考，保证世界观和人物性格一致性           |
| 2. 移动端 PWA 与离线触控体验打磨                                                  |
|    - 支持安装至桌面、卡片滑动手势、移动端快捷灵感速记                                |
| 3. 便携式备份与跨设备快速迁移                                                      |
|    - 数据库与中央媒体一键打包、脱敏与加密同步，打通主力台式机与笔记本                  |
+-----------------------------------------------------------------------------------+
```

---

## 阶段一：近期计划（Next Sprint）- 业务闭环与异步感知

### 1.1 模块一：全局后台任务中心（Global Task Center / Drawer）

#### 1. 背景与痛点
- 系统当前包含多种后台异步耗时任务：
  1. **话题素材库采集任务**（Topics Collector）
  2. **活动企划向导任务**（MCP 调研任务、三方案批量生成任务）
  3. **ComfyUI / Windows Worker 生图与视频任务**
  4. **活动剧本与阶段文本生成任务**（Text Jobs）
- 各模块各自实现轮询接口，离开当前页面后无法全局感知进度，生图完成后缺乏全局通知，长耗时任务容易给用户造成“系统挂起”的错觉。

#### 2. 架构设计与数据流

```text
[Topics Collector] \
[Planning Wizard]   \      统一写入
[Generation Engine]  ----> TaskRegistry (内存 + SQLite 持久化)
[Activity Text Jobs]/             |
                                  | 统一聚合暴露
                                  v
                    GET /api/v1/tasks/live & SSE
                                  |
                                  v
            AppShell: <GlobalTaskTrigger /> (Badge + 进度灯)
                                  | 点击展开
                                  v
            <TaskDrawer />: 进度列表 / 取消 / 重试 / 业务页面直跳
```

#### 3. 详细设计与实现规范

##### (1) 后端 Task Registry 与聚合契约
- 在 `packages/contracts/src/index.ts` 增加统一任务契约：
  ```typescript
  export interface UnifiedTaskSummary {
    taskId: string;
    domain: 'topics' | 'planning' | 'generation' | 'text_job';
    title: string;                 // 任务描述，如 "生成活动分镜: 序幕对话"
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress?: number;             // 0 - 100 百分比
    phase?: string;                // 当前阶段，如 "正在使用 ComfyUI 采样 15/30"
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    targetUrl?: string;            // 完成后可点击跳转的 URL，如 "/apps/activities/act_123"
    canCancel: boolean;
    canRetry: boolean;
  }
  ```
- 在 `apps/service/src/tasks/` 创建全局轻量任务总线：
  - `registry.ts`：注册各模块的任务查询 Adapter。各模块只需提供 `getRunningTasks()` 与 `cancelTask(id)` 回调，避免侵入各业务子系统存储。
  - `routes.ts`：
    - `GET /api/v1/tasks/live`：获取当前活跃及最近 24 小时完成的任务列表。
    - `GET /api/v1/tasks/events`：SSE 长连接，任务状态变更或进度更新时推送增量事件。
    - `POST /api/v1/tasks/:id/cancel`：统一取消指定任务。

##### (2) 前端 AppShell 浮标与任务抽屉
- 修改 `app/components/layout/app-shell.tsx`：
  - 顶栏右侧新增 `<TaskCenterTrigger />`：
    - 当有 `running` 任务时，显示脉冲呼吸灯及运行中数量 Badge；
    - 当任务成功完成时，弹出全站 Toast 提示并携带直达链接；
    - 当任务失败时，给出错误徽标。
- 新增 `app/components/shared/task-drawer.tsx`：
  - 侧边滑出抽屉，分类展示：“进行中”、“已完成”、“已失败”；
  - 进度条（Progress bar）实时更新；
  - 提供“一键取消全部正在执行的任务”与“清除已完成历史”；
  - 点击任务卡片，跳转至对应的业务编辑界面并自动定位。

#### 4. 交付与验证标准
- [ ] 启动话题采集任务后切换至“创作笔记”，顶栏能看到进度更新，完成后收到 Toast。
- [ ] 在生图过程中能通过任务抽屉安全取消。
- [ ] 服务端重启后，未完成任务标记为中断，抽屉不出现僵尸轮询。

---

### 1.2 模块二：活动分镜/场景一键生图（Activity Scene Storyboard Generation）

#### 1. 背景与痛点
- 企划向导完成后，活动已经拥有结构化的阶段（Stages）、剧情对话、环境地点与参与角色的 V2 人设（外观特征、穿着）。
- 现存的 `ImageWorkbench` 和 `MediaWorkstation` 与活动阶段是分离的，用户需要人工复制人物外貌特征与场景环境到生图表单中，缺乏一键为特定阶段生成“分镜配图”的直观动作。

#### 2. 用户交互流程
```text
活动详情 / 编辑页
  ├── 阶段列表 (Stages List)
  │    └── 每个阶段卡片右侧增加 [生图分镜] 按钮
  │         └── 点击打开 <StageStoryboardDialog stage={stage} />
  │              ├── 自动提取：阶段标题、剧情概要、主要角色外观、环境地点
  │              ├── 智能组装：生成优化后的提示词（正向/负向）与画面比例 (16:9 / 4:3)
  │              ├── 选择预设：选择已配置的 ComfyUI Preset（动漫插画 / 场景概念图）
  │              └── 点击 [开始生成分镜] -> 触发 Generation Core -> 入库中央 Artifact 2.0
  └── 生成完成后，直接关联到阶段的 `stage.media`，并在回放视图 (Playback) 实时呈现
```

#### 3. 核心改造点与文件清单
1. **提示词组装增强**：
   - 复用并扩展 `apps/service/src/activities/image-prompt-compiler.ts`：
   - 增加 `compileStageStoryboardPrompt(activity, stageIndex, stylePreset)`：
     - 提取 `stage.title`、`stage.summary`；
     - 读取该阶段涉及的 `actorId` 对应的角色 V2 `appearance` 与覆盖穿着；
     - 读取活动全局的 `location` 视觉标签；
     - 输出适合 Stable Diffusion / SDXL / Flux 结构的规范英文 Prompt。
2. **后端阶段媒体绑定接口**：
   - 在 `apps/service/src/activities/routes.ts` 补充：
     - `POST /api/v1/activities/:id/stages/:stageId/generate-image`：创建分镜生图任务。
     - `POST /api/v1/activities/:id/stages/:stageId/attach-media`：将生成的 `artifactId` 设为该阶段的分镜封面或背景插画。
3. **前端分镜工作台联动**：
   - 在 `app/features/activities/components/stages-editor.tsx` 接入分镜配图入口。
   - 新增 `app/features/activities/components/stage-storyboard-dialog.tsx`：提供参数微调、种子设置与模型预设切换。
   - 在 `playback-workstation.tsx` 中，分镜插画与旁白对话同步渐入播放。

#### 4. 交付与验证标准
- [ ] 为活动某一幕阶段点击生成分镜，自动带入该幕登场角色的发色、瞳色、服装与场景描述。
- [ ] 生成产物自动落库 Artifact 2.0 并关联到活动阶段元数据。
- [ ] 回放工作室能正确展示生成的分镜原画。

---

## 阶段二：中期计划（Mid Term）- 架构解耦与媒体收敛

### 2.1 模块一：Generation Core 重构与 Engine Adapter 抽象

#### 1. 现状与技术债（对应 BACKLOG `DEV-001` / `DEV-002` / `DEV-003`）
- 当前 `apps/service/src/generation/` 包含了将近 2000 行的密集业务代码，包含了任务调度、ComfyUI WebSocket 解析、Windows Worker 轮询、租约管理与重试逻辑，耦合严重。
- 新增新的引擎（如云端 API、本地 Ollama 绘图等）需要到处修改 `if (type === 'comfyui') ... else if (type === 'windows_worker')`。

#### 2. 重构设计方案
- 抽象统一适配器接口 `apps/service/src/generation/adapters/engine-adapter.ts`：
  ```typescript
  export interface EngineAdapter {
    readonly engineType: 'comfyui_local' | 'windows_worker' | 'cloud_api' | 'mock';
    probeReadiness(): Promise<EngineReadinessResult>;
    submitWorkflow(job: GenerationJobContext): Promise<EngineExecutionReceipt>;
    pollProgress(lease: JobLease): Promise<EngineProgressUpdate>;
    cancel(lease: JobLease): Promise<void>;
    fetchOutputs(receipt: EngineExecutionReceipt): Promise<DiscoveredArtifact[]>;
  }
  ```
- 拆分模块目录结构：
  ```text
  apps/service/src/generation/
  ├── adapters/
  │   ├── engine-adapter.ts          # 统一契约接口
  │   ├── comfyui-adapter.ts         # 本地 ComfyUI (HTTP + WebSocket)
  │   ├── windows-worker-adapter.ts  # Windows Worker 远程桥接
  │   └── mock-adapter.ts            # 单元测试与轻量降级桩
  ├── core/
  │   ├── scheduler.ts               # 纯调度器：优先级队列、并发配额与抢占
  │   ├── lease-manager.ts           # 租约心跳与死锁超时清理
  │   ├── recovery-runner.ts         # 重启恢复与断点接管
  │   └── output-collector.ts        # 媒体流式收集与转存 Artifact 2.0
  ├── routes.ts                      # 纯 HTTP 路由分发
  └── store.ts                       # SQLite 数据库持久化
  ```
- **渐进式重构策略**：保留现有全量集成测试（`generation.test.ts`、`generation-configuration.test.ts`），利用现有测试网确保重构过程中外部接口行为 100% 不破坏。

---

### 2.2 模块二：Worker / ComfyUI 真实就绪与健康诊断强化

#### 1. 目标（对应 BACKLOG `FIX-001` / `DEV-005`）
- 解决 ComfyUI / Worker 常常因为缺少某个特定自定义节点（如 ControlNet、FaceID、Animatediff）或缺少大模型 Checkpoint 而在生图进行到一半时崩溃的问题。

#### 2. 详细改造点
1. **动态工作流依赖探测 (Workflow Dependency Inspector)**：
   - 在导入或编辑工作流 JSON 时，自动扫描所有节点的 `class_type` 与 `inputs` 中的模型名称（`.safetensors`, `.ckpt`）。
   - 提取出两个清单：`requiredCustomNodes` 与 `requiredModels`。
2. **Worker / 本地就绪探测探针增强**：
   - 增强 `GET /object_info` 与 Worker 心跳上报：
     - 上报 GPU 型号、显存总量及可用显存（VRAM Free / Total）。
     - 上报已安装节点库及当前已加载的模型文件。
   - 严格比对：如果工作流需要 `CheckpointLoaderSimple` 里的 `animagine-xl-3.1.safetensors`，但 ComfyUI 目录下未检测到，立即标记该工作流为 `MissingModel`，禁止提交并明确提示用户去对应目录放置模型。
3. **前端控制中心与生图面板可操作提示**：
   - 错误状态不只显示“执行失败”，而是给出具体提示：
     > “缺少自定义节点：`ComfyUI-Impact-Pack`，请在 ComfyUI Manager 中安装并重启。”

---

### 2.3 模块三：媒体资产全面收拢至 Artifact 2.0

#### 1. 目标（对应 BACKLOG `DEV-007`）
- 目前 Notebook 附件与 Character 资产仍保留部分旧媒体表和独立路径，未能利用 Artifact 2.0 的统一配额、流式分块读取、Range 播放与签名机制。

#### 2. 实施方案
1. **数据表与契约统一**：
   - 标记废弃 `characters.media` 与 `notebook_attachments` 旧表，在新上传时一律使用 `Artifact 2.0` 的 `artifact_files` 表。
   - 保留原资源的 `legacyId` 作为索引，确保旧数据只读投影正常工作。
2. **平滑数据迁移 CLI (`scripts/migrate-legacy-media.ts`)**：
   - 扫描现有 `data/` 下的角色头像与笔记附件；
   - 计算 SHA-256 哈希，如果已存在相同文件则复用 `artifactId`，不存在则流式写入中央存储；
   - 更新角色表中的 `avatarArtifactId` 与笔记块的 `mediaArtifactId`；
   - 自动生成迁移备份，支持回滚。
3. **全站媒体配额保护 (Pinning Policy)**：
   - 角色正式头像与活动分镜自动标记为 `isPinned: true`，不参与配额淘汰；
   - 实验性质的临时生图草稿根据设定的配额自动按 LRU 清理。

---

## 阶段三：远期计划（Long Term）- 智能联动与离线便携

### 3.1 模块一：本地第一方知识库（Narrative & Notebook RAG）接入企划

#### 1. 业务价值
- 目前活动向导在构思剧情和收集角色设定时，主要向外部 MCP 提问或依赖大模型已有知识。
- 实际上，用户在 **“叙事档案（Narrative Archive）”** 中已导入了详尽的任务树、剧情台词，在 **“创作笔记（Notebook）”** 中记录了大量的自创设定。将这些本地第一方数据作为企划背景参考，能够打造独一无二的“连续创作宇宙”。

#### 2. 架构设计
```text
[活动企划向导: 启动研究]
           |
   +-------+-------+
   |               |
   v               v
[外部 MCP 调研]   [本地知识库检索 (Local Knowledge RAG)]
(网页/近期讨论)   (叙事档案任务树 + 创作笔记世界观)
   |               |
   +-------+-------+
           |
           v
   [统一候选生成与设定注入]
   - 结合本地角色历史关系，避免设定吃书
   - 提取本地人物高光台词风格作为 Prompt 示例
```

#### 3. 详细设计
- **本地检索管道**：
  - 利用已部署的 Chroma 向量数据库与 SQLite FTS5 全文搜索；
  - 提供检索接口 `POST /api/v1/knowledge/search`，同时支持语义检索与精确人物名检索。
- **企划向导适配**：
  - 在企划向导第一步增加开关：“同时检索本地档案与笔记”；
  - 检索结果在第三步“研究依据”中与外部 MCP 证据并列展示，标记为 `[本地档案: 作品名 - 任务树章节]`。

---

### 3.2 模块二：移动端 PWA 与离线触控体验打磨

#### 1. 目标
- SthStart 具备良好的局域网模式（`npm run start:lan`），很多用户会在同一局域网下用平板或手机访问。需要进一步优化移动端的“类原生 App”体验。

#### 2. 实施清单
1. **PWA 支持**：
   - 配置 `manifest.json`、启动屏图标、主题色（与 Eye-care / Default tokens 联动）；
   - 注册基础 Service Worker，缓存字体、核心 CSS 与 SVG 图标，网络中断时展示友好的离线提示。
2. **触控手势优化**：
   - **灵感素材库卡片**：支持移动端触摸滑动交互（右滑收藏、左滑忽略）；
   - **移动端抽屉手势**：全局任务中心与导航抽屉支持手指下滑或边缘滑动关闭。
3. **创作笔记“灵感速记”模式 (Quick Jot)**：
   - 在手机端首屏提供类似备忘录的一键速记卡片，3 秒内完成输入并保存至本地 IndexedDB，后台静默同步。

---

### 3.3 模块三：便携式备份与跨设备快速迁移

#### 1. 目标
- 满足用户在“主力台式机（负责 ComfyUI 运算与主力运行）”与“便携轻薄本（出差/移动办公）”之间同步数据库与创作成果的诉求。

#### 2. 实施方案
- 研发增强的备份迁移工具 `scripts/portable-sync.ts`：
  - **导出 (`npm run export:portable`)**：
    - SQLite 数据库生成 WAL Checkpoint 并导出一致性快照；
    - 打包已 Pin 的中央 Artifact 媒体文件；
    - 敏感密钥（API Keys、Tokens）支持选择“保留/脱敏/加密打包”；
    - 输出单个压缩归档文件 `sthstart-backup-2026xxxx.tar.gz`。
  - **导入恢复 (`npm run import:portable --file=xxx`)**：
    - 预检查目标系统的 Node/Python 环境与 SQLite 驱动；
    - 支持增量合并或覆盖模式；
    - 执行数据库版本完整性校验（`npm run db:integrity`）确保数据无损。

---

## 阶段实施时间表与排期建议

| 阶段 | 预计周期 | 核心交付物 | 关键验收指标 |
| :--- | :--- | :--- | :--- |
| **阶段一 (近期)** | 2 ~ 3 周 | 1. 全局后台任务中心<br>2. 活动分镜一键生图 | - 全站异步任务可视、可取消、可通知<br>- 从活动阶段到分镜原画的完整闭环跑通 |
| **阶段二 (中期)** | 3 ~ 4 周 | 1. Generation Core 解耦<br>2. 深度就绪诊断<br>3. 媒体收敛至 Artifact 2.0 | - 统一 `EngineAdapter` 接口，无多重分支<br>- 严格识别缺失节点/模型<br>- 旧媒体表平滑下线 |
| **阶段三 (远期)** | 3 ~ 4 周 | 1. 叙事/笔记本地 RAG<br>2. 移动端 PWA & 手势<br>3. 便携备份与导入 CLI | - 企划自动关联本地前作剧情<br>- 手机端流畅操作与离线缓存<br>- 跨机器环境一键迁移 |

---

## 风险与应对措施

1. **并发任务负载与锁冲突风险**（阶段一）：
   - *风险*：话题采集与多方案生成并行时，可能竞争 SQLite 写锁或耗尽本地 LLM 速率限制。
   - *应对*：在任务总线中引入领域队列隔离与速率控制器，确保前台交互请求优先于后台定时采集。
2. **生图引擎解耦兼容性风险**（阶段二）：
   - *风险*：重构底层执行链路可能影响现存历史生图任务的状态恢复。
   - *应对*：在原有完整测试套件（`test:contracts`、`test:service`）基础上，严格采用双轨并行测试与逐步替换，确保所有已有测试全部保持通过。
3. **向量数据规模增长风险**（阶段三）：
   - *风险*：引入本地叙事档案检索可能增加本地向量数据库内存占用。
   - *应对*：采用混合检索策略（FTS5 词法检索过滤候选 + 顶层 Embedding 精排），避免对全量文本进行全量向量化。
