# Harness MCP 使用指南

日期：2026-10-06。当前源码提供 Story 9工具、Publication 22工具；生产实例只有部署相应版本后才会出现新增工具。请以客户端 tools/list 为准。

## 接入与权限

使用标准stdio。Story凭据从剧情工作台配对入口获取；Publication凭据从制作台“AI协作”入口获取，两者不能互换。项目固定在进程环境中，模型不用也不能填写其他项目ID。

以下为通用客户端配置模板，只包含占位值；正式凭据通过客户端安全配置注入，不能提交仓库或发给模型。

```json
{
  "mcpServers": {
    "story": {
      "command": "node",
      "args": ["--import", "tsx/esm", "<ABSOLUTE_PROJECT_PATH>/apps/service/src/story/native-mcp-server.ts"],
      "cwd": "<ABSOLUTE_PROJECT_PATH>",
      "env": {
        "STHSTART_STORY_PROJECT_ID": "<PROJECT_ID>",
        "STHSTART_STORY_PORTAL_URL": "http://127.0.0.1:9320",
        "STHSTART_STORY_BRIDGE_TOKEN": "<STORY_BRIDGE_TOKEN>"
      }
    },
    "publication": {
      "command": "node",
      "args": ["--import", "tsx/esm", "<ABSOLUTE_PROJECT_PATH>/apps/service/src/publication/mcp-server.ts"],
      "cwd": "<ABSOLUTE_PROJECT_PATH>",
      "env": {
        "STHSTART_STORY_PROJECT_ID": "<PROJECT_ID>",
        "STHSTART_STORY_PORTAL_URL": "http://127.0.0.1:9320",
        "STHSTART_PUBLICATION_BRIDGE_TOKEN": "<PUBLICATION_BRIDGE_TOKEN>"
      }
    }
  }
}
```

Node和tsx须在该运行环境可用。制作MCP只连接本机Portal。stdio仍需可达的Portal/Service，不能离线读项目库。DSH使用现有Windows启动器，独立制作配对参见 [制作指南](STORY_PUBLICATION.md)。重新生成凭据会使旧凭据失效；撤销后后续工具请求立即失去权限。

## Story工具

| 工具 | 请求要点 | 返回/限制 |
| --- | --- | --- |
| get_project | 无 | 当前项目摘要 |
| list_entries | kind、cursor、limit可选 | 当前条目与修订；旧偏移分页 |
| read_entry | kind、id、offset可选 | 最多20,000字符及truncated |
| search_entries | query、kind/cursor可选 | 最多20条短摘录 |
| submit_proposal | operation、kind、targetId、baseRevision、标题/正文/reason | 仅待审；update须使用当前revision，create不能新建outline |
| get_proposal_status | proposalId | 本项目提案详情 |
| list_proposals | status、targetId、cursor、limit可选 | 提案摘要及stale，不返回整份正文 |
| list_entry_revisions | kind、id、cursor/limit可选 | 不可变修订摘要，source保留baseline标识 |
| read_entry_revision | kind、id、revisionId、offset可选 | 最多20,000字符；必须属于指定项目/条目 |

## Publication工具

所有作品操作均需activityId，发现作品时无需提供它。

| 工具 | 用途 |
| --- | --- |
| list_publications | 发现作品，query标题过滤、cursor/limit分页；给出最近运行及下一步 |
| list_runs | 运行摘要，cursor/limit/status可选；任务详情用get_run_status |
| get_source_bundle | 冻结章节，entryRevisionId/offset/limit可选；用nextOffset续读 |
| get_publication | 当前草稿和最近批准快照；不能仅据此判定可启动 |
| propose_publication_plan | 整份方案提交，expectedDraftVersion检查版本 |
| get_publication_options | category=images/speech/assets/loras/all；参考资产可按cursor/limit续读 |
| validate_publication_plan | 候选document校验，不保存；valid与executable分别表示草稿格式/可执行完整性 |
| preview_publication_run | saved version、speechProfileId、makeVideo；返回最终词/配置、数量、依赖与approvalValid |
| patch_publication_plan | expectedDraftVersion及最多40条类型化operations，整批原子保存 |
| start_approved_run | approvalId、idempotencyKey；执行人工批准的方案 |
| get_run_status | runId；查询任务、用量和产物ID |
| stop_run | runId；停止后续调用，上游可能继续 |
| list_shot_images | shotId；分页候选、availability/current/staleSource |
| retry_shot | shotId/runId/idempotencyKey；复用批准提示词随机重绘 |
| select_shot_image | shotId/artifactId/expectedDraftVersion/allowStaleSource |
| list_utterance_audio | utteranceId；分页候选、实际时长、过期状态 |
| select_utterance_audio | utteranceId/artifactId/expectedDraftVersion/allowStaleSource |
| retry_utterance_audio | utteranceId/runId/idempotencyKey；未改动的批准配音，剩余额度内重试；相同成功音频复用 |
| get_publication_media | 分页本作品历史、所选及导出产物摘要 |
| read_publication_artifact | artifactId、mode=metadata/preview；作品范围媒体读取 |
| export_publication | expectedDraftVersion/makeVideo/idempotencyKey；所选媒体导出，不调用生图/配音 |
| get_publication_task | taskId；查询作品范围子任务或独立导出 |

新增列表的limit范围1–50，默认20。cursor为不透明的创建顺序游标，必须原样传回；创建新记录不会挤偏下一页。参考图分页返回referenceAssetsNextCursor，即使当前页只有音频也须继续翻页。

预检默认只检查本地记录与运行依赖。传checkUpstream=true会只读检查ComfyUI模型/LoRA及已配置语音凭据，不生成图片或语音；imagesVerified表示上游图像配置查证，providerVerified仍为false，不宣称语音服务实际调用成功。运行开始时会再次检查。

LoRA选项目前是作品已配置的候选，availability=requires_preflight，不是全局可安装权重目录。参考资产只来自作品合法引用；尚不能用本工具导入任意文件或跨项目资产。

## 局部编辑

支持publication、actor、shot、utterance四种operation，目标使用稳定ID。source、selectedImage、selectedAudioArtifactId、批准和任务字段均不可修改。媒体选择使用独立工具；新增/删除/重排镜头继续提交完整document。

```json
{
  "activityId": "<ACTIVITY_ID>",
  "expectedDraftVersion": 7,
  "operations": [
    { "kind": "utterance", "id": "<UTTERANCE_ID>", "changes": { "text": "这一句新的对白。", "voiceBindingId": null } },
    { "kind": "shot", "id": "<SHOT_ID>", "changes": { "visualDescription": "笔尖落在展开的实验记录本上。" } }
  ]
}
```

缺失字段保留原值，null用于允许清空的字段。任何非法目标整批不保存。返回新draftVersion、changedTargets、invalidatedImages/Audio及approvalRequiresReview。仅改对白使相应音频失效；画面词变化使相应图片失效。

## 媒体与客户端能力

metadata返回类型、原图尺寸/时长/字节数和作品页链接，不含本机路径。preview返回图片或短音频MCP内容：

- 图片原文件最多16MiB、最多4000万像素；预览最长边1024，JPEG不超过2MiB，transformed=true。原始尺寸与预览不要混淆。
- 音频预览最多30秒且2MiB；其他音频、视频和ZIP通过作品页查看。
- 原始预览数据只出现在MCP媒体块，structuredContent不重复携带base64。
- DSH须配置可用附件存储，并且当前模型声明支持image输入，才会把图片传给模型；只注册工具不足以证明图片已进入模型上下文。
- 仅支持文本的模型/客户端应使用元数据并安排网页审阅，不能声称已看图或听过音频。DSH的音频能力以实际客户端支持为准，图片测试不代表音频已经听审。

## 三条完整工作流

### 新会话恢复作品

1. list_publications，按标题与时间定位作品；多页时传回nextCursor。
2. get_publication读取草稿与版本，get_source_bundle逐段读冻结来源。
3. list_runs找回正在运行/未知的任务，get_run_status核对事实。unknown不得重新启动或自动重试。
4. list_shot_images/list_utterance_audio核对现有候选；read_publication_artifact按能力读取预览。

### 检查与提交方案

1. get_publication_options查询可用工作流、预设和声音，编写真实来源/角色/镜头ID及完整英文词。
2. validate_publication_plan检查候选，按issues.path/targetId修复；不完整草稿可保存，可执行方案须6–12镜头。
3. propose_publication_plan提交完整方案，或patch_publication_plan局部修改。
4. preview_publication_run核对当前版本、最终配置与额度数量；需要查上游时传checkUpstream=true。
5. 用户在网页确认方案和预算后，再核对approvalValid并start_approved_run。审批按钮未被开放为MCP工具。

### 审阅候选并导出

1. get_run_status核对任务成功与产物存在，list_shot_images/list_utterance_audio查看历史。
2. read_publication_artifact读取实际预览，记录角色、动作、构图/声音问题。
3. 同配置的重绘/单句配音重试使用原运行与稳定idempotencyKey；改变文本、声音或配置后重新提交并回到人工核对。
4. 选图/选音频时用最新expectedDraftVersion；来源过期须明确allowStaleSource。
5. export_publication锁定所选版本，get_publication_task追踪导出，get_publication_media找回封面、视频与发布包。

## 故障恢复与验证

工具错误包含error/message/retryable，草稿冲突附currentVersion。409冲突先重读并重做局部修改，不能猜新版本。批准过期/配置改变回网页重新核对。未知提交结果仍占已有额度，核对上游前不重投。同一提交的重试沿用原idempotencyKey；不同请求不要复用同键。

```powershell
npm run test:contracts
npm run test:mcp
npm run test:mcp:dsh
npm run typecheck
```

DSH测试使用安装的真实客户端/插件和本地脚本化模型、内存库及实际图片文件；不会消耗外部模型额度。这证明协议、工具执行与图片传输，不证明真实创作模型推理或成品视觉/读音质量。后者仍需指定测试作品、人工批准额度并逐镜/逐句验收。
