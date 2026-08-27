# SthStart 运维与备份恢复手册

本文档为 SthStart 多应用协同底座（包括公共模型服务、Artifact 2.0 中央媒体库、Generation Core 任务调度、Windows Worker、H3 视频生成以及邻舍托管运行时）的完整部署、运维、安全与备份恢复指南。

---

## 1. 架构总览与网络拓扑

SthStart 采用多应用分层架构，典型生产部署拓扑如下：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           Mac 主机 (SthStart 核心)                       │
│                                                                         │
│  浏览器 ──► Portal (:4173)                                              │
│               │                                                         │
│               ▼ 服务端 BFF (注入 Admin Token)                             │
│         公共服务 (:4100，仅回环 127.0.0.1 监听)                           │
│           ├─ SQLite: data/sthstart.db (配置/任务/元数据, Migration v11)   │
│           ├─ SQLite: data/narrative.db (剧情档案与知识库, Migration v1)   │
│           ├─ 中央 Artifact 存储: data/artifacts/<appId>/                │
│           └─ 运行日志: data/logs/                                       │
│                                                                         │
│  邻舍前端 (:5173) ──► 邻舍后端 (:3099) ──► 可选向量服务 (:8765)         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ 受信任局域网 (IP 白名单 + Token 鉴权)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       Windows / RTX 机器 (算力节点)                      │
│                                                                         │
│  Windows Worker (:9200, 固定单并发, 磁盘水位保护)                        │
│    │                                                                    │
│    └──► 本地 ComfyUI 引擎 (:8188) + 模型权重 (H3 / SDXL / FLUX 等)       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 网络边界与防火墙安全

1. **Mac 本机服务隔离**：
   - 公共服务核心（端口 4100）、邻舍主控（端口 3099）、向量服务（端口 8765）始终强制监听回环地址 127.0.0.1。
   - 禁止将 4100、3099 或 8765 直接通过路由器端口映射暴露到公网。
2. **受信任家庭局域网访问 (start:lan)**：
   - 仅在家庭可信 Wi-Fi 中通过 npm run start:lan 启动；该模式仅暴露 Portal（4173）与邻舍前端（5173），后端核心仍保持回环监听。
3. **Windows Worker 防火墙与访问控制**：
   - 在 Windows 防火墙中仅放行来自 Mac 主机局域网 IP 的入站连接到端口 9200。
   - Worker 配置文件中必须设置 WORKER_ALLOWED_IPS（填入 Mac 主机的 IP/CIDR，例如 192.168.1.100/32）。
   - 禁止在未配置 IP 白名单和高熵 Token 的情况下将 Worker 端口暴露到非受信任网络。

---

## 2. Mac 中央 Artifact 目录与存储管理

SthStart 采用中央 Artifact 2.0 统一管理所有多媒体生成与用户上传产物。

### 目录与分层结构
- **存储路径**：data/artifacts/<appId>/<artifactId>.<ext>（例如 data/artifacts/creative-center/、data/artifacts/characters/）。
- **临时目录**：上传中的流式切片暂存于 data/artifacts/<appId>/.tmp-<uuid>.tmp，写入完成后原子重命名为最终产物，杜绝半成品文件。

### 50 GiB 配额与最旧优先淘汰策略
- **配额上限**：默认全局配额为 50 GiB，可通过环境变量 STHSTART_ARTIFACT_MAX_BYTES 自定义（支持范围 1 GiB ~ 10 TiB）。
- **保护机制**：
  - 标记为置顶（pinned = 1）的产物永不被自动清理。
  - 被其他实体引用（存在 artifact_references 记录，如角色头像、笔记附件、叙事概念图）的产物永不被自动清理。
  - 处于进行中任务关联的产物受保护。
- **淘汰算法**：超限时按 created_at ASC（最旧优先）逐个清理无引用、未置顶的就绪产物，直至降至配额以内。若无法腾出空间则返回 artifact_quota_exceeded。

### 启动巡检 (Reconciliation)
服务每次启动时会在后台自动进行 Artifact 完整性巡检：
- 清理历史意外中断遗留的 .tmp-* 临时文件。
- 比对数据库与文件系统，将磁盘上丢失的文件标记为 file_status = 'missing'。
- 隔离未登记的孤儿文件，确保存储库干净一致。

---

## 3. Windows Worker 部署与运维

Windows Worker 是运行在配备 NVIDIA RTX 显卡的 Windows 电脑上的轻量无状态桥接服务，负责将 SthStart 的标准生成任务对接至底层 ComfyUI。

### 部署步骤
1. **安装依赖**：在 Windows 机器上安装 Node.js 22+ 与 Git。
2. **复制配置**：
   ```powershell
   cd workers/windows-worker
   Copy-Item windows-worker.env.example .env
   ```
3. **配置环境变量**：
   - WORKER_TOKEN：至少 32 字符的高熵随机密钥（与 SthStart 管理端登记的 Token 保持一致）。
   - WORKER_PORT：默认 9200。
   - WORKER_HOST：设为 0.0.0.0 或 Windows 局域网 IP。
   - WORKER_ALLOWED_IPS：填入 Mac 主机 IP（如 192.168.1.100）。
   - WORKER_DATA_DIR：工作目录，存放任务状态与临时输入输出。
   - WORKER_MAX_TEMP_BYTES：临时目录最大空间（默认 100 GiB；不得小于各媒体/输出上限）。
   - WORKER_DISK_WARNING_BYTES：磁盘剩余告警阈值（默认 10 GiB）。
   - WORKER_DISK_STOP_BYTES：磁盘最低停机阈值（默认 2 GiB）。
   - WORKER_CAPABILITIES：声明能力，如 image,video,h3-t2v,h3-i2v,h3-fl2va。
4. **启动 Worker**：
   ```powershell
   npm install
   npm start
   ```

### 核心运维原则
- **固定单并发 (concurrencyLimit = 1)**：Worker 强制一次仅执行一个生成任务，禁止多任务并发抢占显存引发 CUDA OOM。
- **产物生命周期与确认机制 (confirm)**：Mac 调度器从 Worker 流式拉取完成的媒体产物并完成 SHA-256 校验后，向 Worker 发送 POST /v1/worker/tasks/:taskId/confirm，Worker 接收确认后才清理本地中间文件。
- **断电恢复**：Worker 在 WORKER_DATA_DIR/tasks 中持久化任务清单，重启后可自动恢复未确认任务的状态查询。

---

## 4. H3 视频生成与高级媒体能力

### H3 能力配置 (T2V / I2V / FL2VA)
- **就绪探测机制**：SthStart 管理端通过 GET /api/v1/admin/experiments/h3/status 实时向 Worker 发起健康探测。仅当 Worker 报告 ready: true 且显式包含相应能力标签（如 h3-t2v）时，界面才展示为可用。禁止无 Worker 时的伪造就绪。
- **参数安全边界**：
  - 分辨率、时长和并发数由已绑定 Workflow 的能力声明与服务配置共同决定；管理端状态页显示当前探测到的值，业务代码不会假设所有 H3 都是同一规格。
  - 服务端会按当前 Workflow 能力在任务创建时硬校验，前端只做同一份状态的预提示，不能绕过服务端限制。
  - 默认实验配置为 854×480、最长 4 秒、固定单任务排队；如要调整，必须同步验证目标 Worker、模型和显存。
- **合规声明**：使用 H3 相关工作流前，必须确保符合 H3 许可规范。

### ffmpeg / ffprobe 工具链
Mac 端用于视频时长、分辨率、帧率、编码解析与代表帧缩略图抽取：
- **安装方法**：
   ```bash
   brew install ffmpeg
   ```
- **健康检测**：运行 node scripts/linshe-doctor.mjs，确认 ffmpeg 与 ffprobe 均显示 ✓。
- **降级表现**：若系统未安装 ffmpeg，视频生成后处理（自动缩略图生成、视频流元数据读取）将降级，但不影响图片生成与文本对话。

### 高级工作流能力
高级能力不通过业务代码拼接 ComfyUI 画布，而是作为版本化工作流的一部分登记，再由 `inputSchema`、`inputCapabilities` 和 `nodeBindings` 声明可变输入：

- **LoRA / ControlNet / Inpaint / Upscale**：在 API JSON 工作流中固定对应节点和模型，只有需要业务传入的权重、遮罩或放大参数才加入节点绑定；模型文件必须预先放在 Windows/RTX 的受控模型目录中，Worker 不会自动下载。
- **参考视频 / 音频**：先通过中央 Artifact 接口上传，再在 Generation 任务的 `inputArtifacts` 中用 `inputKey` 引用。工作流版本须为每个输入声明 `mediaTypes`、`maxBytes`、`required` 和节点绑定；Worker 会流式接收并校验 SHA-256，禁止使用客户端路径或原始文件名。
- **H3 T2V / I2V / FL2VA**：分别绑定 `h3-t2v`、`h3-i2v`、`h3-fl2va` 用途，并要求 Worker 健康检查报告对应能力。未就绪、能力缺失或上游失败都必须显示明确错误。

一个参考视频输入能力声明如下：

```json
{
  "inputCapabilities": {
    "referenceVideo": {
      "mediaTypes": ["video/mp4", "video/webm"],
      "maxBytes": 536870912,
      "required": true,
      "maxCount": 1
    }
  },
  "nodeBindings": {
    "referenceVideo": ["12", "inputs", "video"]
  }
}
```

输入媒体必须属于当前应用，且工作流引擎类型与能力匹配；ComfyUI 直连目前只接受图片输入，视频和音频输入统一走 Windows Worker。这样可为后续能力扩展保留统一协议，同时不把尚未验证的模型或自定义节点宣称为已就绪。

---

## 5. 工作流导入与生命周期 (Workflow API JSON Import)

### 格式严格限制
SthStart **仅接受 ComfyUI API 格式 JSON**（节点 ID 为键，包含 class_type 与 inputs 对象）。
- **严格拒绝 GUI 格式**：任何包含 nodes 数组、links 数组或 last_node_id 的前端画布导出 JSON 将被直接拒绝（返回 400 invalid_workflow_format_gui_rejected）。
- **严格拒绝明文凭据**：导入内容中不得包含任何 token、secret、apiKey、password 等明文密钥字段（返回 400 secrets_not_permitted）。

### API 导入接口
管理员可通过 HTTP 接口直接导入工作流：
```http
POST /api/v1/admin/generation/workflows/import
X-SthStart-Admin-Token: <管理令牌>
Content-Type: application/json

{
  "id": "anime-turbo-v1",
  "name": "二次元极速生图工作流",
  "description": "基于 Anima Turbo 模型的标准生图管线",
  "category": "image",
  "engineKind": "comfyui",
  "inputSchema": {
    "prompt": { "type": "string" },
    "width": { "type": "number", "default": 768 },
    "height": { "type": "number", "default": 1024 }
  },
  "nodeBindings": {
    "prompt": ["106", "inputs", "text"],
    "width": ["122", "inputs", "value"],
    "height": ["124", "inputs", "value"]
  },
  "outputDeclarations": ["8"],
  "outputMediaTypes": ["image/png"],
  "definition": {
    "106": { "class_type": "CLIPTextEncode", "inputs": { "text": "" } },
    "122": { "class_type": "PrimitiveInt", "inputs": { "value": 768 } },
    "124": { "class_type": "PrimitiveInt", "inputs": { "value": 1024 } },
    "8": { "class_type": "VAEDecode", "inputs": {} }
  }
}
```

### 管理控制台导入
在 SthStart 管理页面（http://127.0.0.1:4173/settings/generation）的“版本化工作流”卡片右上角，点击 **「导入工作流 JSON」** 按钮，选择符合规范的 JSON 文件即可一键完成校验、注册与版本发布。

---

## 6. 无静默 Fallback (No Silent Fallback) 故障处置

SthStart 遵循“调用链确定性”原则，在托管模式下：
1. **禁止隐式本地降级**：当公共服务或 Worker 不可用、上游报错（401/429/502/503）时，系统必须直接将错误向上返回，严禁静默回退到本地旧模型或未经验证的 Provider。
2. **提交不确定性防护**：若向上游提交任务时发生网络超时，任务状态转为 abandoned，错误码标记为 submission_outcome_unknown，严禁自动重复发起提交以避免重复开销。

### 常见错误码与排查指南

| 错误码 | 产生原因 | 排查步骤 |
| --- | --- | --- |
| `generation_engine_unavailable` | 生成引擎未配置、被禁用或无法连通 | 检查引擎 Base URL 是否正常；检查 ComfyUI / Worker 进程是否存活 |
| `worker_token_missing` | Windows Worker 缺少鉴权 Token | 在 SthStart 引擎管理中重新录入 Worker Token，或执行 Token 轮换 |
| `worker_unavailable` | Windows Worker 网络不可达或返回异常 | 检查 Windows 局域网连通性、防火墙规则及 `WORKER_ALLOWED_IPS` |
| `invalid_workflow_format_gui_rejected` | 上传了含 `nodes` 数组的 ComfyUI 画布导出 | 在 ComfyUI 启用 Dev 模式，点击「Save (API Format)」导出 API JSON |
| `secrets_not_permitted` | 工作流 JSON 中包含了明文密码/Token | 移除工作流中的敏感密钥字段，通过管理端凭据库配置 |
| `artifact_quota_exceeded` | 中央存储空间超出配额且无可淘汰旧文件 | 清理不必要的产物或调大 `STHSTART_ARTIFACT_MAX_BYTES` |
| `submission_outcome_unknown` | 提交任务时遭遇网络超时 | 确认上游服务负载，手动在管理界面确认任务状态后再选择重试 |

---

## 7. 数据备份与灾难恢复流程

### 备份策略
必须备份以下关键数据项：
1. **SQLite 数据库**：`data/sthstart.db` 与 `data/narrative.db`（以及关联的 WAL/SHM 文件）。
2. **中央媒体库制品**：`data/artifacts/` 目录。
3. **环境密钥配置**：根目录 `.env`。
4. **邻舍本地数据**：`upstream/linshe/agent-core/data/` 目录。

### 备份执行
在主项目根目录下运行：
```bash
npm run db:backup
```
此命令会在线生成一致性 SQLite 快照，并在备份目录中生成 `media-manifest.json` 清单文件，记录全部 Artifact 的相对路径与 SHA-256 校验和。

如需指定备份路径：
```bash
npm run db:backup -- /path/to/my-backups/2026-08-27
```

### 灾难恢复步骤
1. **停止正在运行的服务**：
   ```bash
   npm stop
   ```
2. **恢复 SQLite 数据库**：
   ```bash
   npm run db:restore -- /path/to/my-backups/2026-08-27 --confirm
   ```
3. **恢复媒体制品文件**：
   将备份的 `artifacts/` 文件夹复制回 `data/artifacts/`。
4. **运行数据与迁移校验**：
   ```bash
   npm run db:check
   npm run db:integrity
   node scripts/linshe-doctor.mjs
   ```
5. **重启服务**：
   ```bash
   npm start
   ```

---

## 8. 巡检与健康诊断命令速查

| 操作 | 命令 | 说明 |
| --- | --- | --- |
| **系统全量环境巡检** | `node scripts/linshe-doctor.mjs` | 检查依赖、数据库结构、ffmpeg、存储可写性与引擎配置 |
| **数据库版本校验** | `npm run db:check` | 检查数据库是否匹配最新 Migration 版本 |
| **数据库完整性检查** | `npm run db:integrity` | 运行 SQLite `PRAGMA integrity_check` 深度检查 |
| **执行数据库迁移** | `npm run db:migrate` | 运行未执行的结构版本迁移脚本 |
| **在线数据备份** | `npm run db:backup` | 生成数据库快照与媒体清单 `media-manifest.json` |
| **服务停止** | `npm stop` | 校验目录并安全停止 Portal、公共服务及托管的邻舍进程 |
| **本地服务启动** | `npm start` | 启动 Portal 与公共服务 |
| **局域网模式启动** | `npm run start:lan` | 仅在受信任家庭网络中启动局域网访问 |
