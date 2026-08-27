# SthStart 下一阶段：AI 媒体平台与 H3 完整实施计划

> 适用项目：`lark-x/SthStart`
> 编制日期：2026-08-27
> 用途：可直接交给其他 Agent 分阶段执行

## 一、阶段目标

将目前的“统一图片生成框架”升级为真正支持图片、视频、音频输入输出的媒体生成平台，并完成 MiniMax H3 本地视频生成第一版。

目标架构：

```text
Creative / Linshe / Character / Narrative
                    ↓
             Generation Core
                    ↓
       Workflow + Engine Adapter
                    ↓
             Windows Worker
                    ↓
                 ComfyUI
                    ↓
       Image / Video / Audio Output
                    ↓
          Mac Artifact Store
```

本阶段完成：

- Generation Core 完整模块化。
- Windows Worker 从 Image Worker 升级为 Media Worker。
- 图片、视频、音频流式输入和输出。
- 视频元数据、缩略图、Range 播放。
- Generation Progress 和 SSE 前端接入。
- H3 文生视频、图生视频、首尾帧视频。
- 创作中心视频页面。
- Generation Settings 和 Creative 页面组件化。
- 完整自动化测试和真实 Windows 联调说明。

本阶段不完成：

- MiniMax 云端收费 API。
- 自动付费降级。
- Reference Video/Audio 高级模式。
- Video-to-Video。
- LoRA/ControlNet 管理器。
- ComfyUI 节点编辑器。
- 自动下载模型或 Custom Nodes。
- Character、Narrative 的正式生成入口。
- Notebook/Character 旧媒体存储迁移。
- 多 GPU 自动负载均衡。
- Worker 远程启动/停止 ComfyUI。

## 二、当前基线

下一个 Agent 开始前必须确认：

- 数据库当前最新 Migration 是 v8。
- 新建 `/api/v1/images/tasks` 已进入 Generation Core。
- `image_tasks` 只用于历史任务兼容。
- Artifact 已支持流式上传、SHA-256、Range、配额和引用。
- Windows Worker 已支持图片任务、Token、IP Allowlist、磁盘阈值和重启恢复。
- Generation SSE 后端已经存在。
- 创作中心已经支持文生图、图生图、任务历史和作品库。
- H3 目前只有带鉴权的 readiness probe，没有正式生成入口。
- `generation.ts` 已初步拆分，但仍约 59 KB。
- `generation-client.tsx` 和 `creative-client.tsx` 仍是大型 Client Component。
- 当前完整验证结果：Service 84/84、Worker 4/4、Portal 6/6、Browser 9/9、Visual 7/7。

> 重要：稳定化修复目前可能仍在工作区中尚未提交。下一个 Agent 不得从旧提交 `a83bfca` 重新开始，也不得通过 `git reset`、`git checkout --` 等操作丢弃现有修改。

开始实施前执行：

```bash
git status --short
git diff --check
npm run verify
npm run test:e2e -- --grep-invert "visual baseline"
npm run test:e2e -- --grep "visual baseline"
```

不得通过修改或删除测试来掩盖回归。

## 三、Phase 0：保存稳定化基线

### 任务

- 检查当前未提交修改。
- 不覆盖用户修改。
- 在获得用户授权后，将稳定化内容作为独立提交保存，例如：

```text
fix: stabilize generation compatibility and CI
```

- 新阶段从这个提交之后继续。

### 验收

- 工作区没有未知或丢失的修改。
- 当前测试继续全绿。
- 数据库 v8 可从 v1/v7 正常升级。
- 不修改现有用户数据库内容来“修测试”。

## 四、Phase 1：完成 Generation Core 模块化

### 目标目录

```text
apps/service/src/generation/
├── service.ts
├── scheduler.ts
├── recovery.ts
├── lifecycle.ts
├── task-store.ts
├── events.ts
├── errors.ts
├── types.ts
│
├── workflows/
│   ├── registry.ts
│   ├── validator.ts
│   ├── renderer.ts
│   └── capabilities.ts
│
├── inputs/
│   ├── validator.ts
│   ├── artifact-input.ts
│   └── media-types.ts
│
├── engines/
│   ├── adapter.ts
│   ├── registry.ts
│   ├── comfyui.ts
│   └── worker.ts
│
├── outputs/
│   ├── collector.ts
│   ├── manifest.ts
│   └── post-processing.ts
│
├── compatibility/
│   └── legacy-image.ts
│
└── routes.ts
```

### 要求

- `generation.ts` 最终只作为兼容导出层，或控制在约 5–10 KB。
- Engine 调用只能出现在 Adapter 中。
- Scheduler 不直接理解 ComfyUI `/prompt`、`/history`。
- Legacy Image 只能通过 Compatibility Adapter 调用 GenerationService。
- 不再为旧图片接口新增独立调度、轮询、取消逻辑。
- 保持现有 API、状态和错误码兼容。
- 拆分必须以行为不变为原则，每次移动后运行 Generation 测试。

### Engine Adapter

定义统一接口：

```ts
interface GenerationEngineAdapter {
  health(): Promise<EngineHealth>;
  submit(context: SubmitContext): Promise<SubmitResult>;
  status(context: StatusContext): Promise<EngineTaskStatus>;
  cancel(context: CancelContext): Promise<CancelResult>;
  collectOutputs(context: OutputContext): Promise<EngineOutput[]>;
}
```

业务代码不得使用大量分散的 `if (engine.kind === ...)` 判断。

### 验收

- 现有 Generation 21 项测试全部通过。
- Legacy Image 测试全部通过。
- `public-routes.ts` 不再包含完整 ComfyUI 生命周期。
- `generation.ts` 不再是主要实现文件。
- 没有循环依赖。
- 没有两套任务状态机。

## 五、Phase 2：Generation 媒体数据模型

建议增加两个正式 Migration。

### Migration 9：Generation Media Capabilities

在 `generation_workflows` 增加：

```text
category
```

允许：

```text
image
video
audio
transform
```

在 `generation_workflow_versions` 增加：

```text
input_capabilities_json
output_media_types_json
output_schema_json
```

在 `generation_engine_options` 增加：

```text
capabilities_json
```

在 `generation_tasks` 增加：

```text
priority
progress_json
started_at
```

`priority` 允许：

```text
interactive
normal
background
```

保留现有 `succeeded` 状态，不要在本阶段将其重命名为 `completed`。

### Migration 10：Artifact Video Metadata

在 `artifacts` 增加：

```text
fps
codec
has_audio
thumbnail_artifact_id
metadata_json
```

要求：

- 旧 Artifact 默认值安全。
- 旧图片无需立即扫描。
- 元数据允许后台懒补。
- `thumbnail_artifact_id` 必须引用中央 Artifact。
- 不保存 Windows 或 Mac 绝对路径到业务模块。

### Contracts

在 `@sthstart/contracts` 增加或完善：

```text
MediaCategory
MediaKind
EngineCapabilities
WorkflowInputCapabilities
WorkflowOutputSchema
GenerationPriority
GenerationProgress
EngineOutput
ArtifactVideoMetadata
```

继续使用 TypeBox，不引入 Zod。

### 验收

- 新数据库直接建立 v10。
- v1、v7、v8 数据库可以升级至 v10。
- Migration 失败完整回滚。
- 未知 Migration 继续 fail closed。
- 旧 Generation 和 Artifact 记录可正常读取。

## 六、Phase 3：Windows Worker Media Protocol v2

### 输入媒体

支持：

```text
image/*
video/*
audio/*
```

必须移除当前仅允许图片和 12 MiB 的固定限制。

增加配置：

```dotenv
WORKER_IMAGE_MAX_BYTES=
WORKER_VIDEO_MAX_BYTES=
WORKER_AUDIO_MAX_BYTES=
WORKER_OUTPUT_MAX_BYTES=
WORKER_CAPABILITIES=image,video,audio,h3-t2v,h3-i2v,h3-fl2v
COMFYUI_INPUT_DIR=
```

### 流式上传

当前 Worker 上传会将请求读入 Buffer，本阶段必须改成：

```text
HTTP Request Stream
        ↓
大小限制 Transform
        ↓
SHA-256 Transform
        ↓
受控 .tmp 文件
        ↓
校验
        ↓
Atomic Rename
```

禁止对视频或音频使用：

```text
chunks[]
Buffer.concat()
arrayBuffer()
```

要求：

- Content-Length 超限立即拒绝。
- 无 Content-Length 时按实际流量限制。
- 中断上传删除 `.tmp`。
- SHA-256 不匹配删除文件。
- 相同 uploadId + 相同哈希保持幂等。
- 相同 uploadId + 不同内容返回 409。
- 文件扩展名不能由用户直接控制路径。

### ComfyUI 输入

- 图片可以继续通过 `/upload/image`。
- 视频和音频不得伪装成图片上传。
- Worker 将视频/音频复制到明确配置的 `COMFYUI_INPUT_DIR/sthstart/{taskId}`。
- Workflow 中只注入 Worker 生成的安全相对文件名。
- 不允许 Workflow 或客户端提供任意磁盘路径。
- 路径必须经过 `resolve` 后确认仍位于受控根目录。

### Output Manifest

统一输出：

```ts
interface WorkerOutput {
  outputId: string;
  outputName: string;
  mediaKind: 'image' | 'video' | 'audio' | 'file';
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}
```

兼容解析：

```text
output.images
output.videos
output.audio
output.files
```

对于 Custom Node：

- 优先依据 Workflow `output_schema_json`。
- 不允许仅凭扩展名猜测任意系统文件。
- 文件必须位于受控 ComfyUI output 根目录。
- `outputId` 不能包含路径。

### 下载

- 保持 Streaming。
- 支持 HEAD。
- 支持 Range。
- 支持 206、416、ETag。
- SthStart 确认 SHA 和大小后才调用 Worker confirm。
- 确认前 Worker 不删除输出。
- SthStart 下载中断时 Worker 保留文件用于重试。

### Worker Progress

Worker 连接 ComfyUI WebSocket，至少处理：

```text
execution_start
executing
progress
executed
execution_error
```

统一成：

```json
{
  "value": 0.68,
  "stage": "sampling",
  "message": "正在采样",
  "current": 34,
  "total": 50
}
```

无法得到百分比时：

```json
{
  "value": null,
  "stage": "running"
}
```

### 验收

- 500 MB 测试文件不会产生相近大小的 Node 内存峰值。
- 图片、视频、音频均能流式上传。
- Worker 重启后任务和输入记录仍可恢复。
- 输出 Manifest 可同时包含 MP4、PNG、WAV。
- 路径穿越、错误哈希、超限、断流全部被拒绝或清理。
- Worker Token 和 IP Allowlist 没有回归。

## 七、Phase 4：SthStart 输入、输出与 Artifact 后处理

### Generation Input

当前仅接受图片的限制改为由 Workflow Version 决定。

例如：

```json
{
  "firstFrame": {
    "mediaTypes": ["image/png", "image/jpeg", "image/webp"],
    "maxBytes": 20971520,
    "required": true
  },
  "referenceVideo": {
    "mediaTypes": ["video/mp4"],
    "maxBytes": 536870912,
    "required": false
  }
}
```

服务端必须校验：

- App 是否有 Artifact 访问权。
- MIME 是否允许。
- 文件状态是否 ready。
- 大小是否符合 Workflow 限制。
- 必填输入是否存在。
- 同一输入数量是否超限。

### Artifact Metadata

新增：

```text
apps/service/src/artifacts/metadata.ts
apps/service/src/artifacts/thumbnail.ts
```

使用：

```text
ffprobe
ffmpeg
```

要求：

- 使用 `spawn` 参数数组，不使用 shell 拼接。
- 自动检测工具是否存在。
- 视频读取 duration、width、height、fps、codec、hasAudio。
- 图片读取 width/height。
- 视频缩略图默认取 20% 位置，最长不超过第 1 秒。
- 生成 WebP 缩略图。
- 缩略图也进入 Artifact Store。
- 列表页面不直接预加载视频。

主输出完整保存到 Mac 后任务才可 `succeeded`。

缩略图失败时：

- 不将主视频标记为失败。
- 记录明确事件。
- 加入可恢复的后处理队列。
- 后续巡检可重新生成。

### 磁盘与大小

增加独立配置：

```text
artifactImageMaxBytes
artifactVideoMaxBytes
artifactAudioMaxBytes
```

不得继续用一个 12 MiB 限制覆盖所有媒体。

### 验收

- MP4 可通过中央 Artifact API 播放和拖动。
- Safari/Chrome Range 正确。
- 视频元数据落库。
- 缩略图落库并可显示。
- 下载失败不会产生 ready Artifact。
- 磁盘不足不会留下假完成任务。
- Windows 关闭后已完成作品仍可播放。

## 八、Phase 5：H3 Workflow 与执行能力

### 前置条件

Agent 不得凭空编造可执行的 H3 Workflow。

需要用户提供或在 Windows ComfyUI 导出：

```text
H3 T2V API Workflow JSON
H3 I2V API Workflow JSON
H3 First/Last Frame API Workflow JSON
```

必须是 ComfyUI API 格式，不是浏览器 GUI Workflow。

还需要明确：

- 使用的 H3 Custom Node 名称和版本。
- 模型文件名。
- 输入节点。
- 输出节点。
- 可用分辨率。
- 可用时长。
- 是否原生生成音频。

如果这些资料暂时缺失：

- 可以完成平台、导入、验证和测试 Fixture。
- 不得将 H3 状态伪装成 Ready。
- 实际 Windows H3 联调必须标为待外部环境验证。

### 工作流

建议建立：

```text
creative-h3-t2v
creative-h3-i2v
creative-h3-fl2v
```

每个 Workflow 有独立版本与能力：

```json
{
  "category": "video",
  "inputs": {
    "prompt": {},
    "firstFrame": {},
    "lastFrame": {},
    "duration": {},
    "aspectRatio": {},
    "seed": {}
  },
  "outputs": {
    "video": {
      "mediaTypes": ["video/mp4"]
    }
  }
}
```

### 第一版功能

文生视频：

```text
prompt
duration
aspectRatio
seed
```

图生视频：

```text
prompt
firstFrameArtifactId
duration
aspectRatio
seed
```

首尾帧：

```text
prompt
firstFrameArtifactId
lastFrameArtifactId
duration
aspectRatio
seed
```

限制由 Workflow Capability 决定，删除当前代码中写死的：

```text
854 × 480
4 seconds
```

### Readiness

Ready 必须同时满足：

- Worker 在线。
- Worker Token 有效。
- `h3-*` capability 存在。
- ComfyUI 在线。
- Workflow 已发布。
- 必要输入 Binding 有效。
- 必要输出声明有效。
- Worker 确认所需节点和模型存在。

否则显示明确原因：

```text
worker_unreachable
comfyui_unreachable
workflow_missing
custom_node_missing
model_missing
binding_invalid
capability_missing
```

### 验收

- T2V、I2V、FL2V 都通过统一 Generation Task。
- 任务异步执行。
- 不在 HTTP 请求中等待整段视频完成。
- 有真实进度事件。
- 视频和音频信息正确。
- 输出完整回传 Mac。
- 错误不会暴露 Token、绝对路径或完整 Prompt。
- 取消不会调用 ComfyUI 全局 interrupt。

## 九、Phase 6：Generation SSE 与前端组件化

### SSE

后端已有 Generation SSE，需要在 Portal 正式消费。

浏览器不得持有应用 Token。

推荐：

- 使用现有 Admin Session Proxy。
- 通过 `fetch()` 读取 SSE Stream。
- 不使用需要自定义 Authorization Header 的原生 `EventSource`。
- 收到事件后更新 TanStack Query Cache。
- 断线通过 Last-Event-ID 重连。
- 页面隐藏后可以降低更新频率。
- SSE 不可用时保留低频 Polling 兜底。

### Generation Settings 拆分

```text
app/features/generation/
├── api.ts
├── queries.ts
├── mutations.ts
├── events.ts
├── schemas.ts
│
├── components/
│   ├── engine-list.tsx
│   ├── engine-form.tsx
│   ├── worker-list.tsx
│   ├── worker-form.tsx
│   ├── workflow-list.tsx
│   ├── workflow-editor.tsx
│   ├── workflow-capabilities.tsx
│   ├── assignment-panel.tsx
│   └── diagnostics-panel.tsx
│
└── generation-settings.tsx
```

`generation-client.tsx` 只负责页面组合。

### Creative 拆分

```text
app/features/creative/
├── components/
│   ├── image-generator.tsx
│   ├── video-generator.tsx
│   ├── task-list.tsx
│   ├── task-card.tsx
│   ├── media-gallery.tsx
│   ├── video-player.tsx
│   ├── workflow-picker.tsx
│   └── artifact-picker.tsx
├── queries.ts
├── mutations.ts
├── events.ts
└── types.ts
```

`creative-client.tsx` 只负责布局、Tab 和组合。

### 创作中心视频页面

增加：

```text
视频
├── 文生视频
├── 图生视频
└── 首尾帧
```

移动端要求：

- 单列布局。
- 上传区支持 iPhone 照片选择。
- 播放器不溢出。
- 任务卡片不依赖 Hover。
- 不自动播放 Gallery 视频。
- 只加载 Thumbnail。
- 点击后才加载 MP4。
- 使用 `playsInline`。
- 适配 `100dvh`。

### Cloud Engine

- UI 暂时不允许创建或选择 `cloud`。
- 后端继续返回 `unsupported_engine`。
- 不显示尚不可用的 Cloud 功能。

### 验收

- Generation Settings 不再是 27 KB 单组件。
- Creative Client 不再是 28 KB 单组件。
- 活跃任务主要由 SSE 更新。
- Polling 只作为兜底。
- 视频任务实时显示阶段和进度。
- 手机可以上传首帧、尾帧并提交。
- 视频作品可播放、收藏、删除和复用参数。

## 十、Phase 7：管理、诊断与恢复

### 控制中心

增加：

```text
GPU Node
Generation Queue
Media Diagnostics
```

展示：

- Worker Online/Offline。
- ComfyUI Online/Offline。
- Worker capabilities。
- GPU 名称。
- VRAM 总量和剩余量。
- Windows 磁盘状态。
- Running/Queued 数量。
- 当前任务阶段。
- Workflow Ready 状态。

### 日志

默认只记录：

```text
taskId
appId
workflowId/version
engineId
status
duration
artifact size
error code
```

默认不记录：

- 完整 Prompt。
- API Token。
- Worker Token。
- Windows/Mac 绝对路径。
- Workflow 完整 JSON。
- 图片或视频内容。

只有现有临时敏感日志开关开启时，才允许额外诊断数据。

### Recovery

启动巡检必须处理：

- queued：重新进入调度。
- submitting 无 provider ID：标记 outcome unknown。
- accepted/running：只查询，不重新 submit。
- Worker succeeded 但未 confirm：重新下载或核对 Artifact。
- Artifact 已保存但任务未完成：补齐关联并完成。
- 缩略图缺失：重新后处理。
- Worker 临时文件已消失：返回明确 `worker_output_expired`。

### 验收

- 服务重启不会重复提交 H3。
- Worker 重启不会丢失已接受任务。
- 任务恢复不会误标完成。
- 诊断导出不泄露敏感信息。
- H3 不可用不会影响邻舍对话或普通图片功能。

## 十一、测试计划

### Unit

必须覆盖：

- 媒体 MIME 与大小验证。
- Workflow Capability。
- Workflow Binding。
- Output Manifest。
- Progress 映射。
- Priority。
- 状态恢复。
- 路径安全。
- SHA 校验。
- 视频元数据解析。
- Thumbnail 重试。
- H3 readiness 错误分类。

### Worker

必须覆盖：

- 大文件流式上传。
- 上传中断清理。
- Content-Length 欺骗。
- 图片、视频、音频。
- 非法扩展名。
- Path Traversal。
- Output Range。
- Worker 重启恢复。
- Token 和 IP Allowlist。
- ComfyUI execution_error。
- 多媒体 Output Manifest。

### Service Integration

使用 Mock Worker/ComfyUI 覆盖：

- T2V 成功。
- I2V 成功。
- FL2V 成功。
- 视频带音频。
- 进度更新。
- Worker 401。
- Worker Offline。
- ComfyUI Offline。
- Workflow Missing。
- Model Missing。
- GPU OOM。
- 下载中断。
- SHA 不匹配。
- Mac 磁盘不足。
- Worker 磁盘不足。
- Cancel queued。
- Abandon running。
- 服务重启恢复。
- Legacy Image 无回归。

### Browser

新增：

```text
创作中心视频普通模式
图片上传
首尾帧选择
提交任务
进度显示
视频详情
移动端布局
Generation Settings Workflow Capability
```

视觉基线要求：

- macOS 更新 Darwin snapshot。
- Ubuntu 只跑功能测试。
- 不提交本机随意生成的 Linux 假基线。

### 内存验证

必须增加或记录：

- 上传 500 MB 文件时 Node RSS 峰值。
- 下载 500 MB 文件时 Node RSS 峰值。
- 不得出现接近文件大小的额外 Buffer。
- `.tmp` 在失败后被删除。

## 十二、提交顺序

建议拆成独立提交或 PR：

```text
1. refactor: split generation core into adapters and lifecycle modules

2. feat: add generation media capabilities and video artifact metadata

3. feat: upgrade windows worker to streaming media protocol

4. feat: add media output collection and artifact post-processing

5. feat: add H3 workflows and readiness validation

6. feat: add generation SSE client and video creative workspace

7. feat: add GPU queue diagnostics and recovery

8. test: cover H3 media lifecycle and browser flows

9. docs: add Windows H3 deployment and troubleshooting guide
```

每个提交都必须独立通过相关测试。不要累计大量修改后一次性修复。

## 十三、最终验收命令

```bash
git diff --check

npm run typecheck

npm run test

npm run build

npm run lint

npm run test:e2e -- --grep-invert "visual baseline"

npm run test:e2e -- --grep "visual baseline"

npm run db:check

npm run db:integrity
```

真实 Windows 联调额外执行：

```text
Mac → Worker /health
Mac → Worker /system
图片上传
视频上传
音频上传
T2V
I2V
FL2V
进度
取消
MP4 回传
Thumbnail
Range 播放
Worker 重启恢复
Windows 关闭后 Mac 历史播放
```

## 十四、需要用户提供或确认的资料

下一个 Agent 可以先完成基础设施，但真实 H3 联调前需要：

1. 三份 ComfyUI API Workflow JSON：
   - T2V
   - I2V
   - First/Last Frame

2. Windows 环境信息：
   - ComfyUI 根目录
   - Input/Output 目录
   - Worker 地址
   - H3 Custom Node 名称及版本
   - 模型文件名

3. H3 实际限制：
   - 支持时长
   - 分辨率/比例
   - 首尾帧尺寸要求
   - 是否原生音频

建议默认：

- Worker 继续使用当前 JavaScript 实现，不在本阶段重写 TypeScript。
- 视频并发固定为 1。
- 不启用付费 Cloud fallback。
- ffmpeg/ffprobe 自动探测；缺失时显示诊断，不自动安装。
- T2V、I2V、FL2V 都建立能力，但只有导入真实 Workflow 后才显示 Ready。
- H3 真实环境缺失时，允许 Mock 测试完成，但不得声称真实生成已验收。
