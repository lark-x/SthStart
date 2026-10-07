# 轻量制作台实施记录

开始：2026-10-03。已有大量未提交改动，未清理、重置或更改邻舍指针。

- 基线：契约 36/36；Story store 8/8。
- 真实主库：前轮诊断已记录损坏，本轮不向它执行迁移、不写测试项目、不部署。
- 复用：StoryStore 冻结条目版本；ActivityStore 建立活动外壳；统一生成执行器、工作流解析与 LoRA；产物上传/引用/路径解析；本地 Noto 字体；响应式编辑浮层。
- 新模块职责：publication 负责独立的制作文档、批准、预算、任务恢复、配音与发布；不改旧镜头和旧聊天。

## 本轮交付结论

验收日期：2026-10-04（Asia/Shanghai）。阶段 0–5 的实现与隔离验收通过；阶段 6 已补做六张真实 ComfyUI 图片、六句真实 StepAudio 配音及63.77秒视频的功能验收，**画面质量未通过，DSH 实际创作模型自主完成方案的链路未验证**，不能判定正式成片验收通过。后续证据见 [真实 ComfyUI 验收](story-publication-real-acceptance-2026-10-04.md)。本轮没有部署、提交或推送，没有写入真实业务库，没有修改既有剧情或活动数据。

已实现的链路：保存剧情章节 → 创建独立制作作品 → MCP 读取冻结章节并提交制作方案 → 网页人工确认实际配置和额度 → 串行生图、逐句配音 → 图片/配音历史选择 → 漫画预览 → PNG、MP4、SRT、发布 ZIP。旧活动、旧漫画和旧剧情桥接保持原入口。

## 逐阶段结果

| 阶段 | 结果 | 证据及边界 |
| --- | --- | --- |
| 0 基线与保护 | 通过 | 初始契约 36/36、Story store 8/8；保留已有未提交文件和邻舍子模块状态；沿用此前真实库只读诊断，不强行迁移异常库。 |
| 1 契约、独立存储与迁移 | 通过（隔离库） | TypeBox 契约、CAS、不可变版本、批准配置、预算、任务和项目凭据；迁移 50 在已存在章节的 49 版内存库上升级，章节完整保留，integrity_check=ok，foreign_key_check 无结果。 |
| 2 轻量制作台 | 通过（浏览器） | 剧情“制作作品”入口；三步制作台；自动保存及冲突保护；绘制、角色、LoRA、配音、协作设置使用弹窗/窄屏抽屉。宽度 832 保存后刷新保持；390×844 根视口无横向或纵向溢出。 |
| 3 制作 MCP 与统一任务 | 通过（隔离上游） | 标准 stdio MCP 经精确 Portal 代理访问 Service；八工具可列举，读取可分段、方案可提交；未批准不能启动，桥接不能调用批准接口。生成请求、日志、seed 一致；没有第二次 chat/completions 提示词改写。 |
| 4 配音与局部失效 | 通过（模拟提供商＋真实音频探测） | 独立 /audio/speech 配置、上传音频、实际时长、音频历史、凭据脱敏、未知提交不重投；相同成功配音复用不再次请求或计字数。修改一句只使该句音频失效，修改演出推近不使图片失效。 |
| 5 漫画与视频导出 | 通过（真实本机编码） | 共用 Canvas、当地字体、不可变版本导出，溢出/缺图拒绝；FFmpeg 实际生成 H264/AAC、1080×1920、30fps 视频，首秒有音频。浏览器 MP4 实际解码播放；发布 ZIP 无密钥、生成提示词或调用日志。 |
| 6 真实创作小样与部署 | 部分通过 | 已完成六张真实ComfyUI图片、六句StepAudio配音、63.77秒视频与发布ZIP。画面质量未通过，完整读音人工审查与DSH创作模型自主分镜未验证；真实库异常，未恢复或部署。详细证据见后续真实验收报告。 |

“通过”不等于已上线。模拟图片为程序生成的色块，模拟配音为提示音，不代表角色一致性、生图质量或中文 TTS 效果。

## 主要文件及职责

- `packages/contracts/src/activity-publication.ts`：唯一的制作文档、任务、配音、批准、历史及 MCP 请求响应契约；在 `index.ts` 导出。
- `apps/service/src/database.ts`：追加迁移 **50 / story-publication-workstation**。差异里的 47–49 及其他模块修改是既有工作区内容，不能归为本轮新增。
- `apps/service/src/publication/store.ts`：章节冻结、版本、CAS、产物引用、图片和音频历史、预算、凭据。制作选图不修改 SceneBeat.mediaUrl 或正式 Story 资料。
- `images.ts / worker.ts`：确定性提示词编译、工作流/模型/LoRA 条件校验、冻结实际配置、统一生成任务、串行调度、停止和重启恢复。
- `speech.ts`：独立语音密钥和兼容提供商调用、日志脱敏、音频持久化及 FFprobe 时长；未知结果保留已用额度。
- `exports.ts`：本地 Noto、Canvas 漫画、CPU FFmpeg、字幕和固定 ZIP 路径；本地导出不占新的模型额度。
- `routes.ts / mcp-server.ts`：管理员制作 API、项目范围八工具桥接和 stdio MCP；`server.ts` 仅增加注册。
- `packages/activity-playback/src/publication/`：纯卡片渲染和时间线；编辑器、图片导出及视频共用，字幕按实际时长比例分段，不宣称字级强制对齐。
- `app/features/activities/publication/`：集中 API、草稿保存队列、三步工作台、漫画预览及历史；活动页面按新作品类型分流，旧类型不变。
- `app/features/story/components/create-publication-dialog.tsx`、`story-workspace.tsx`：保存章节后选择真实章节修订，创建独立制作作品。
- `app/api/publication-bridge/`、`app/lib/publication-bridge-policy.ts`：独立白名单代理，不转发管理员 Cookie 或任意上游 URL。
- `scripts/story-dsh/`：可选第二个制作 MCP 和独立 DPAPI 凭据；保留旧 Story 六工具，不自动扩大控制中心已有配对权限。
- `apps/service/package.json / package-lock.json`：新增 `@napi-rs/canvas` 原生渲染依赖。
- `packages/contracts/src/activity-image-prompts.js`：按对应 TypeScript 源机械同步旧生成文件，修正 Vite 读取旧 JS 时缺少结构化提示词 Schema 导出的构建问题；不是另造提示词契约。
- `scripts/publication-{fixture.ts,portal.mjs,browser.mjs}`：显式隔离验收入口，只使用内存库、临时媒体和模拟上游。
- `docs/STORY_PUBLICATION.md`：使用、配对、配音密钥、运行依赖及恢复说明。

## 验收中修复的问题

1. 完整 Service 启动时重复注册旧音频解析器：仅在制作插件内替换为缓冲上传，旧路由流式上传仍保留。
2. 字幕拆段导致音频晚开始、逐段时间量化累积漂移：音频从该句首段开始，按全局 30fps 边界量化。
3. 窄屏隐藏文件控件撑出页面空白：给上传标签提供定位容器，根视口固定，内容独立滚动。
4. 已有画面但旧绘制失败时无法本地导出：显式导出任务优先处理已选媒体，不再次花费生图或配音额度。
5. 非音频上传污染历史：失败文件隔离并移除上传引用，不选入草稿、不显示为可用音频。
6. 历史文件不可用/被隔离时不能选择，也不能被路径解析悄悄改回可用状态；相同成功配音缓存不重复计费。
7. 冻结来源可被换成同项目其他章节：保存时固定整份来源；更换章节需创建新作品。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm run test:contracts` | 37/37 通过 |
| `npm run test:portal` | 18/18 通过 |
| 下列新模块靶向测试 | 17/17 通过，0 跳过 |
| 旧 Story store/native MCP/schema 与 beat-renders 回归 | 17/17 通过 |
| `node --test scripts/story-dsh/generate-web-patch.test.mjs` | 1/1 通过；使用已安装 DSH 的原生 Web --dump-config 验证新旧 MCP 可同时加载，patch 不含真实 Token。非实际模型调用。 |
| `npm run typecheck` | 通过 |
| `npm run build:portal` / `npm run build:service` | 均通过 |
| 相关已跟踪文件 `git diff --check` | 通过，仅存在 LF/CRLF 提示 |

新模块靶向命令：

```powershell
node --import tsx/esm --test apps/service/src/publication/store.test.ts apps/service/src/publication/worker.test.ts apps/service/src/publication/routes.test.ts apps/service/src/publication/speech.test.ts apps/service/src/publication/exports.test.ts packages/activity-playback/src/publication/timeline.test.ts
```

未运行完整 CI 或无关全站测试。构建仍有既有 chunk 大小、Vite 插件耗时和 comic-reader inlineDynamicImports 提示，不属于本轮功能失败，未以放宽断言掩盖问题。

## 浏览器、媒体及调用证据

最终隔离浏览器证据目录：`F:/Project/SthStart/artifacts/story-publication/2026-10-03T17-13-01.333Z/`。更早失败或尚有布局问题的截图保留，但不作为最终通过证据。

- 1440×900：`desktop-story-entry.png`、`desktop-plan.png`、`desktop-drawing.png`、`desktop-approval.png`、`desktop-media.png`、`desktop-export.png`、`desktop-video-playback.png`。
- 390×844：`mobile-media.png`、`mobile-drawing.png`、`mobile-audio-history.png`。
- 1920×1080：`large-export.png`。
- 下载产物：`publication.zip`（内含六张图卡、封面、字幕、文案、manifest 和视频）、`cover.png`、`video.mp4`。
- `report.json`：临时项目、运行、统一生成任务和调用日志 ID、视口、前端错误与请求错误列表。二者均为空。

隔离运行 ID：`c4742de3-ebd1-4e5c-b1bc-6e04bbe501fe`。作品 ID：`f8a936ea-dcb8-4237-9b07-5e8a9f777c95`。项目 ID：`387b3650-02d4-4686-89d6-4a93c0b70e4a`。

实际统计六次模拟 ComfyUI 提交、六次模拟配音、零次文本提示词优化；全链路导出成功。独立十秒视频测试验证编码和首秒音轨；浏览器小样为 9.9 秒、1080×1920，实际播放时间推进。**这是带提示音的技术样品，不是目标 60–90 秒剧情成片。**

本轮临时预览服务已停止。上述 ID 只属于内存测试，不能在真实服务里打开日志；报告、截图和下载文件继续保留。

测试媒体目录 `C:/Users/12938/AppData/Local/Temp/sthstart-publication-browser-38N1Yf` 的清理被运行环境拒绝，未绕过限制；它不包含真实模型凭据，若仍存在可由用户手动清理。

## 真实数据库与下一步

- 本轮新增迁移号：50；真实库仍未应用本轮迁移。
- 真实库路径：`F:/Project/SthStart/data/sthstart.db`。损坏事实来自 `activity-image-parity-round2-db-diagnosis.md`，本轮未执行恢复、修复或重建，不推断损坏原因。
- 真实迁移前备份位置：**无，本轮没有真实迁移或真实库写入；不能伪造备份记录**。隔离库完整性通过不能证明真实库健康。
- 上线前需另行确认并处理真实库异常；核对实际 Docker 挂载，按项目数据库技能执行健康检查、可恢复备份、迁移和完整性校验。
- 新原生 Canvas 依赖需安装到实际运行环境；Docker 需包含 FFmpeg/FFprobe（现有镜像构建参数 `INSTALL_FFMPEG=true`）。只同步 dist 文件不足以交付这两个运行依赖。
- 配置独立语音提供商及密钥，再在明确的新验收项目中运行真实 DSH/MCP、真实 ComfyUI 和 TTS。执行六画面、60–90 秒、最多两张重绘的小样，人工审核人物、构图、声音与字幕后再判定阶段 6 通过。
- 没有平台自动上传、连续人物动画、背景音乐、语音克隆或本地 TTS；这些不属于本轮交付。
