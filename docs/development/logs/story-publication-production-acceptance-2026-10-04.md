# 剧情到发布：DSH 与生产 Docker 真实验收

日期：2026-10-04。承接隔离验收，不复跑全站 CI；简单测试、提示文案和只读证据采集交给 `ds-wb/cn:deepseek-v4.1-flash`，主进程负责集成、真实调用与画面审查。

## 结论

**技术链路已实际跑通且部署，成片的画面质量仍未通过。**

这次不是模拟 ComfyUI、提示音或单纯 MCP 协议测试：原生 DSH Web 中的 `step-5-preview` 读取新验收项目并提交六镜头方案；9320 的生产 Docker Service 完成六张图片、六句在线配音、约61.34秒视频和发布包。每次 ComfyUI 请求与任务快照、AI 日志一致。不能因此宣称图片准确表现所有动作、人物声音完成设计或可直接发布。

没有改动用户已有正式剧情，未自动上传平台，未自动重试或重绘，未提交 Git。验收数据只在标题带「发布全链路验收」的新项目中创建。保留大量已有未提交改动。

## 本轮实际修复

| 文件 | 职责与修复 |
| --- | --- |
| `scripts/story-dsh/generate-web-patch.mjs` | 原生 Web 的两个 persona 插件重复注册 `deployment:persona-prefix`，导致不能新建会话；制作说明合并到原 Story persona，保留 Story/Publication 两个 MCP 与原生页面功能。 |
| `scripts/story-dsh/generate-web-patch.test.mjs` | 三个回归用例：实际 `--dump-config`、有制作凭据时单 persona/双 MCP、无制作凭据时仅原 Story MCP；只用假凭据。 |
| `scripts/publication-dsh-live-acceptance.mjs` | 验收允许隔离端口3082，不占用或终止用户3081实例；3082不发送冒充3081的运行心跳。仅测试项目临时配对。 |
| `apps/service/src/publication/images.ts` | 新制作模式未明确选配置时优先已启用的邻舍对齐 Base；拒绝正向提示词绑定固定拼词节点的旧工作流，避免预览所谓最终词与实际二次拼词不同。不修改不可变工作流，不改旧活动默认绑定。 |
| `apps/service/src/publication/images.test.ts` | 九个提示词/配置回归：人物原词、纯场景/物体、满幅要求、禁止画内文字、缺英文/人物/场景拦截、后缀去重、默认Base、固定拼词拒绝且模板不变。 |
| `apps/service/src/publication/worker.ts` 与测试 | 同键重复请求已完成导出直接返回原任务，不再把已完成整轮改回 running；未创建额外任务。 |
| `app/features/activities/publication/publication-workspace.tsx` | 更正默认预设说明；配音配置加载失败提供重试，空清单显示下一步入口。未猜测兼容标记、隐藏配置或改造聊天页。 |
| `scripts/publication-production-acceptance.mjs` | 测试项目和来源双校验；运行幂等键在请求前落盘，导出按作品/草稿版本稳定幂等；精确检查宽高；预算来自审批。导出为CPU转码，不会再次生图/配音。 |
| `scripts/publication-production-evidence.mjs` | 只读实际库及 ComfyUI 历史，输出安全ID、计数、比较结果；无法取上游时明确未验证并非零退出。 |

固定生图后缀已要求画面填满画幅，字幕另由项目绘制；这项要求没有保证模型遵从。本轮没有训练/安装 LoRA，没有启用自动视觉判图。

## 数据、环境与部署

- 当前实际库：`F:/Project/SthStart/data/sthstart.db`，迁移50；叙事库版本2。本轮没有新增迁移或恢复数据库。
- 制作前一致快照：`F:/Project/SthStart/data/backups/2026-10-04T07-37-46.103Z/`。
- 最终部署前快照：`F:/Project/SthStart/data/backups/2026-10-04T08-01-06.323Z/`。`db:backup` 是数据库与媒体清单，不含媒体二进制；本轮没有删除或移动媒体。
- `db:check`：50/50、2/2；`db:integrity`：两库ok。
- ComfyUI 本机8188；容器内引擎地址 `http://host.docker.internal:8188`。历史查证从本机 `127.0.0.1:8188` 读取，六个实际prompt ID均能找到。
- 工作流 `anima-activity-linshe-parity` v1；Base预设 `b2c56a87-f801-43eb-b158-b524295a5d8a` 修订1。
- 模型 `anima_baseV10.safetensors`，编码器 `anima_baseV10_txt.safetensors`，VAE `qwen_image_vae.safetensors`。768×1024；串行、没有Hires、没有参考图、没有LoRA。
- `stepaudio-2.5-tts`、`cixingnansheng`、speed1；直接复用连接 `conn-mut24bmg` 的加密凭据，通过真实生产服务调用。连接显示名包含3，不表示实际使用3。
- 最终 `npm run build` 通过；现有部署脚本同步并重启容器，结果healthy。重启后同一运行仍succeeded、使用量6图/265字、12个所选图片/音频均可用，没有重新提交模型任务。
- 已停止本轮3082测试实例并撤销该测试项目的 Story 与 Publication 两个临时凭据。状态均未配对；用户3081原实例未停止。保留测试作品、媒体、DSH原生会话证据，不把临时凭据并入文件。

## 完整链路及实际ID

1. 新验收项目 `24c6e240-cc19-4b19-a37c-c311a58a27af` 创建正式章节；章节ID `c74ce217-1632-4cb4-91ca-f36eedfe4eaa`，冻结修订 `d07063d0-a1c2-47d0-a933-b0bdb1168df6`。
2. 原生 DSH Web 的 Step 模型使用制作工具读取和改写制作方案；生成阶段没有管理员批准工具，也不反写正式章节。第一次输出达长度上限，续轮完成提交；不是宣称任意长章节一轮即可成功。
3. 制作草稿从v2到v3；保留来源/角色/镜头ID，复杂双人镜头改为阿贝多单人反应镜头，英文提示词分为人物/景别/场景/细节；六句265字符。最后自动媒体回写形成草稿v15。
4. 管理员审批 `5f8b31ba-aca2-4fb1-801c-7c7eaf315c03` 冻结配置，图片额度8（六张首轮＋两张可人工重绘），配音额度265；MCP不能自行批准。
5. 运行 `c1d3b5bb-8480-4fb5-b5f5-701a6c86eeb6`：六图、六音频、自动导出成功；实际用量6图/265字，不使用剩余重绘额度。
6. 单独下载验收触发一次CPU导出，故共有两个成功导出任务，不是两轮模型制作。脚本后续相同版本使用稳定键；没有新增图片/语音请求。
7. 最新导出任务 `d1c2e73b-feb0-4549-98e5-a9d5435c52c5`：ZIP `2dcfe232-19aa-44cd-bb0f-077428e491ee`、封面 `4c0dae75-09f8-4ae9-b556-6787f24ae214`、视频 `487cec8e-2f4f-480a-adeb-6d97b441eccd`。

图片调用ID、生成任务ID和上游prompt ID全部列在输出目录 `evidence.json`，可在9320全站AI日志查到。各调用用运行ID关联，不伪造提示词优化父调用；新制作模式没有内部LLM优化步骤。

## 靶向验收

| 检查 | 实际结果 |
| --- | --- |
| `images.test.ts` | 9/9通过。 |
| `worker.test.ts` | 8/8通过，含重复导出状态回归。新增测试起初误用了历史图片契约字段，修正为 `renderTaskId` 后通过；没有放宽契约。 |
| DSH patch测试 | 3/3通过，真实安装包 `--dump-config` 加载Web配置；另有真实Web模型工具调用。 |
| 脚本语法检查 | 通过。 |
| `npm run typecheck` | 根项目与所有workspace通过。 |
| `npm run build` | Portal、Service、回放及comic-reader构建通过；原有大chunk/plugin耗时/inlineDynamicImports警告保留。 |
| 请求三方核对 | 六图任务快照/AI请求/ComfyUI history的正负词、模型、seed、steps、CFG、采样器、尺寸一致，6/6。 |
| 来源不变 | 来源章节仍revision1，制作来源仍冻结相同修订。 |
| 音频/视频 | 六句音频总计57,432ms；FFprobe视频61.339648秒、1080×1920、30fps、H264＋AAC。浏览器真实播放时间推进；没有人工听审全部读音。 |
| 发布包 | 11条目：六图卡、封面、视频、SRT、文案、manifest；结构检查通过，文本扫描未见疑似凭据。 |
| 浏览器 | 桌面1440×900和390×844检查制作方案、导出页；真实视频可播放，所查看页面无JS错误、无根横向溢出。截图调整视口后须等待真实布局绘制，未使用刚缩放但尚未重排的旧画面作为窄屏证据。 |
| 部署后 | 容器healthy、运行/媒体/预算保持，临时凭据撤销。 |

没有新增共享契约或数据库结构，因此本轮未重复契约全套、全站Portal/Service测试或完整CI；此前通过结果仅作历史基线，不冒充本轮结果。

## 逐镜画面验收：未通过

| 镜头 | 实际观察 | 判定 |
| --- | --- | --- |
| 1 雪山营地 | 帐篷、灯、木桌与玻璃器皿出现，不再全白；但上下大幅蓝色空边。 | 内容改善，构图待修。 |
| 2 阿贝多举试管 | 可辨认角色和发光试管；手部、动作并非精准眼前举管，上下白边。 | 需要人工选择/重绘。 |
| 3 砂糖记录 | 人物、笔记与书写基本出现，背景雪山帐篷；仍需审核人体比例和细节。 | 可作为候选，不等于最终通过。 |
| 4 晶体特写 | 小试管架远离镜头，大片单色空背景，不是目标晶体大特写。 | 不可作为目标镜头发布。 |
| 5 阿贝多反应 | 单人物可辨认，避免了双人同脸，但仍有白边。 | 构图待修。 |
| 6 砂糖写结论 | 实际为闭眼趴桌休息，未在书写；上下白边。 | 动作不合格。 |

六图整体比之前的全白场景/双人身份混淆有所改善，但**不是同seed控制实验**，不能将变化归因于某个代码修改。满幅提示词并未消除模型生成的空边；当前没有角色LoRA或参考图。视频与图卡会忠实保留源图这些问题。

## 下一步的明确边界

1. 保留当前技术样品，不将其标记为正式发布成片。先把第4/6镜的画面描述与英文提示词重新聚焦单个动作：物体占画幅主体、明确书写手/笔/打开的笔记，去除会诱导趴桌和极简空背景的描述。
2. 调整提示词/画风/尺寸就是新配置，必须重新核对并批准；不能用旧批准悄悄换词、模型或采样参数。相同冻结配置的人工重绘仍是随机尝试，不承诺解决空边。
3. 若需要进一步功能，应优先提供可控裁切/构图而非自动裁掉内容；当前制作台没有通用裁切编辑，本轮未擅自增加平行画布。字幕仍由项目绘制，不交给生图模型。
4. 安装并选择兼容角色参考或LoRA后再做小规模对照；不承诺多角色LoRA自动绑定左右人物，不下载未知权重或扩大付费预算。
5. 两个角色目前同男声，尚需你决定角色声音ID并逐句听审。情绪指令、克隆、词级对齐和BGM不在当前首版范围。

## 可直接打开的证据

全部文件：`F:/Project/SthStart/artifacts/publication-production/2026-10-04T07-25-32.657Z/`。

- `fixture.json`、`preview.json`、`run-report.json`、`export-report.json`、`evidence.json`。
- `images/001-prod-shot-1.png` 至 `006-prod-shot-6.png`，为实际ComfyUI产物。
- `video.mp4`、`publication.zip`、`cover.png`、`video-frame-18s.png`。
- `dsh-native-plan-final.jpg`、`desktop-export-final.jpg`、`desktop-drawing-deployed.jpg`（部署后默认预设文案）、`mobile-plan-final.jpg`、`mobile-export-after-paint.jpg`。
- 网页：`http://localhost:9320/apps/activities/5df698a8-d7ab-4c91-8f4d-9c47c27c4c88`。
