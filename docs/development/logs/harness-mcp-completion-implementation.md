# Harness MCP补全实施记录

日期：2026-10-06（Asia/Shanghai）。对应 [实施计划](../plans/HARNESS_MCP_COMPLETION_PLAN.md)。

## 当前结果

P0–P6已实现，P7文档、标准客户端及真实DSH插件的隔离验收已完成。两套MCP从14工具扩展到31工具：Story9、Publication22。P7真实外部创作模型、付费生图/配音及逐镜/逐句质量验收仍待具体测试作品和明确额度，不能将本轮脚本化模型夹具称为真实创作模型验收。

本轮未新增数据库迁移、未部署、未提交Git，未修改用户正式剧情或运行真实付费制作。已有大量工作区改动与邻舍子模块状态保持原样。本轮测试使用内存数据库和临时媒体；全部临时DSH/媒体目录由测试清理。

## 阶段交付

| 阶段 | 结果 | 实现与证据 |
| --- | --- | --- |
| P0契约/协议 | 完成 | harness-mcp.ts请求/响应契约；stdio真实子进程测试；传输5MiB响应上限、20秒超时、不跟重定向、结构化错误及CAS currentVersion；原八工具JSON Schema兼容修复 |
| P1发现/恢复 | 完成 | 项目作品、运行摘要；rowid创建顺序游标，新增记录不会挤偏后续页；最近运行与nextAction；明确历史批准须预检有效性 |
| P2历史/媒体 | 完成 | 镜头/对白历史和过期状态，作品全部媒体/导出引用；图片JPEG预览与短音频MCP块；大媒体回作品页；真实DSH图片进入视觉模型夹具上下文 |
| P3选项/校验/预检 | 完成 | 工作流/预设、语音模型与声音、合法参考图、已配置LoRA候选；candidate校验不保存；预检数量/实际词/配置与依赖；可选只读上游模型/LoRA检查，无生成请求 |
| P4局部编辑 | 完成 | 稳定ID、最多40条、字段白名单、null/省略语义、原子保存及CAS；返回失效媒体与批准影响；非法字段明确拒绝，避免Fastify默认移除字段后静默接受 |
| P5音频/导出 | 完成 | 本句历史选音频、过期来源确认；未改动批准配音的幂等重试；原子准入计入待执行字数并保留执行时额度预留；独立不可变版本导出/任务查询 |
| P6剧情续接 | 完成 | 提案摘要/状态/过期筛选；修订摘要与分段正文；项目、条目、种类归属检查，baseline标识保留 |
| P7接入/验收 | 部分完成 | 更新三个指南、DSH persona，新增完整使用指南；真实DSH插件+标准SDK协议/工具/图片验收通过；真实外部模型、付费小样和质量审查待完成 |

## 工具、路由和契约对照

所有路径均在项目桥接范围内。以下制作路径相对于 `/api/v1/publication-bridge/projects/:projectId`，`:work`代表activityId。项目Token在既有hook校验，作品/目标/产物二次校验，Portal逐路径/方法白名单，不转发管理员Cookie。

| 工具 | HTTP路径 | 契约/测试 |
| --- | --- | --- |
| list_publications | GET /publications | PublicationDiscovery*，harness.test/stdio |
| list_runs | GET /publications/:work/runs | PublicationRunDiscovery*，发现及客户端恢复 |
| list_shot_images | GET /publications/:work/shots/:shotId/history | PublicationImageDiscoverySchema，双候选分页/过期 |
| list_utterance_audio | GET /publications/:work/utterances/:utteranceId/history | PublicationAudioDiscoverySchema，音频归属/时长 |
| get_publication_media | GET /publications/:work/media | PublicationMediaDiscoverySchema，引用及文件可用性 |
| read_publication_artifact | GET /publications/:work/artifacts/:artifactId | PublicationArtifactSchema，真实媒体/stdio/DSH |
| get_publication_options | GET /publications/:work/options | PublicationOptions*，凭据细节不返回 |
| validate_publication_plan | POST /publications/:work/validate | PublicationValidation*，无版本或任务写入 |
| preview_publication_run | POST /publications/:work/preview | PublicationPreflight*，批准有效/配置变化/上游只读 |
| patch_publication_plan | POST /publications/:work/patch | PublicationPatch*，非法目标整批不保存及局部失效 |
| select_utterance_audio | POST /publications/:work/utterances/:utteranceId/select-audio | 复用PublicationAudioRequest/Draft，过期确认 |
| retry_utterance_audio | POST /publications/:work/utterances/:utteranceId/retries | 复用Retry/Task，幂等、未知、预算、批准变更 |
| export_publication | POST /publications/:work/exports | 复用ExportRequest/Task，已有真实FFmpeg与幂等回归 |
| get_publication_task | GET /publications/:work/tasks/:taskId | 复用Task，任务运行归属验证 |

Story新增路径相对于 `/api/v1/story-bridge/projects/:projectId`：

| 工具 | HTTP路径 | 契约/测试 |
| --- | --- | --- |
| list_proposals | GET /proposals | StoryProposalDiscovery*，摘要/过期/分页 |
| list_entry_revisions | GET /entries/:kind/:id/revisions | StoryRevisionDiscovery*，修订摘要 |
| read_entry_revision | GET /entries/:kind/:id/revisions/:revisionId | StoryRevisionChunkSchema，20,000字符分段/跨目标拒绝 |

原六Story和八Publication工具保留名称/核心语义；stdio测试逐一验证原八制作工具及十四个新增制作工具的映射。Story新增三工具亦有stdio调用和真实存储/路由验证。两套桥接仍无批准或正式内容直接写入工具。

## 客户端验收的实际含义

`dsh-harness.test.ts`启动安装的DeepSeekHarness和原生MCP插件，经真实stdio子进程连接临时HTTP网关及Fastify业务服务。测试中本地OpenAI-compatible模型夹具按脚本请求发现作品、读来源、查配置、校验、提交完整方案、找回运行、读运行及图片。临时作品标题确实变化，图片进入声明支持image的模型上下文。随后独立SDK客户端重新发现作品、读取图片，并验证撤销后调用失败。

这不是仅测试tools/list，也不是外部模型自主推理。图片是本机Canvas生成的测试文件，不是新增ComfyUI作品。原生Web patch的三项测试验证双MCP/单persona配置，未将SDK测试冒充Web页面交互验收。

音频传输实现有真实时长/字节上限与网页降级；没有用图片测试冒充音频听审。视频/ZIP通过作品页面访问，不提供任意URL、任意文件系统或Token URL。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| npm run test:contracts | 38/38通过，包含补丁边界及媒体参数契约 |
| npm run test:mcp | 16/16通过（含最终新增只读预检用例） |
| npm run test:mcp:dsh | 4/4通过：真实DSH插件与独立SDK；原生Web配置3项 |
| npm run test:portal | 19/19通过；新增Publication代理和Story历史路径 |
| Publication全模块＋Story routes/store＋两桥接策略/代理的阶段回归 | 52/52通过；之后新增预检用例单独5/5通过，未混作同一轮数量 |
| npm run typecheck | 根项目与所有workspace通过 |
| npm run build | Portal、Service、回放、漫画阅读器构建通过；保留现有大chunk/inlineDynamicImports警告 |

最终收尾验证若发现变化，在本表更新；不同命令有重叠，不相加为唯一测试总数。

## 保留的边界与下一步

1. 部署是独立动作，本轮源码工具不代表9320现有实例已更新。使用前部署对应版本并重新启动MCP客户端以刷新工具发现。
2. 需要用户指定测试作品、允许图片数和配音字符数，才执行真实外部模型与付费小样，并逐镜/逐句记录质量。此前10月4日的生产验收仍是历史证据。
3. LoRA列表是作品已配置候选，上游只读预检查证可用性；本轮没有全局权重安装/导入工具。
4. 仅文本模型/无附件存储的DSH仍可用工具，但图片降级为说明；用户须配置真实支持视觉的模型后才可让其看图。
5. MCP创建作品、持久化审阅记录、状态订阅、通用裁切/资产导入仍属于原计划可选范围，未并入本轮。

使用文档：[Harness MCP指南](../../HARNESS_MCP.md)。
