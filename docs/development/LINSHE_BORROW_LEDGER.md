# 邻舍借用台账

本文件记录 SthStart 从邻舍（`upstream/linshe` 只读子模块）借用内容的**来源、固定版本、许可与再生成方式**。新增借用必须先补一行，再改代码。

## 固定版本

| 项目 | 值 |
| --- | --- |
| 借用基线提交 | `6b4c2e517ef72eb606a6ea3577c11804c3a6c603` |
| 词表文件 | `agent-core/src/db/data/imagePromptTags.yaml` |
| 词表 SHA256 | `0b70265df5321caf5f9d638e958729ce4d4ef067e3d149d0c601701155213729` |
| 上游版本标识 | `2026-09-02.1+0b70265d` |
| 子模块当前 HEAD | `e4d524e`（**不用于生成**） |
| 上游 `main` 当时 HEAD | `b5a0d72`（**不用于生成**） |

`upstream/linshe` 是只读参考，不提交、不修改、不推进指针。生成脚本用 `git show <ref>:<path>` 从对象库取文件，不依赖子模块工作区内容，因此子模块 HEAD 与基线不同也能复现。

## 为什么不跟 `main`

上游 `main`（`b5a0d72`）删除了整个「手部动作(拿着某物)」分组（拿包、拿书、拿杯等）。按 `--ref b5a0d72` 重新生成只剩 130 条 / 1777 个标签，缺少常用持物动作。因此词表固定到 `6b4c2e5`，并在脚本默认值里写死，避免有人顺手改成 `main`。

## 借了什么

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 通用词表 141 条 / 1962 标签 | `apps/service/src/activities/image-prompt-knowledge-data.ts` 的 `PARITY_KNOWLEDGE_ITEMS` | 只保留人物、服装、动作表情、环境、场景、物件、相机、画面风格、结构规则 |
| 成人词表 81 条 / 824 标签 | 同文件的 `PARITY_KNOWLEDGE_ADULT_ITEMS` | 上游 `adult_` 前缀的 7 类；**默认不参与检索**，只有策略显式开启才并入 |
| 分类配额与关键词打分口径 | `apps/service/src/activities/image-prompt-knowledge.ts` | 按作用域选标签，不重写自然语言 |
| 画师串与质量词语义 | 策略字段 `artistString` / `qualityPrompt` | 对应邻舍 `config.comfyui.artist` 与 `qualityPrompt`；空值表示沿用工作流默认 |
| Anima 工作流参数 | `apps/service/src/activities/parity-workflows.ts` | Base 31 步 / CFG 5、Turbo 12 步 / CFG 1，er_sde / beta |

标签文本、搜索词、规则正文一律原样复制，不改写、不重新排序、不补写内容。

## 许可

上游 README 声明 MIT，仓库内没有单独的 `LICENSE` 文件；`imagePromptTags.yaml` 在提交 `932b76b` 引入，没有附加外部署名。SthStart 保留来源提交与文件哈希以便追溯；若上游后续补充许可条款，以补充条款为准。

## 再生成与校验

```powershell
node scripts/generate-parity-knowledge-data.mjs            # 按默认固定提交重新生成
node scripts/generate-parity-knowledge-data.mjs --check    # 只校验，不写文件
node scripts/generate-parity-knowledge-data.mjs --ref <sha> # 换基线（需同时更新本文件）
```

安全集内容哈希必须保持 `7baabdab2f7bcaeda3a3852281fa4215d9e6171fa8f74a5dcf4bb436ee2826d0`；变化即代表通用词表被改动，需要重新评审。

## 未借用的部分

- 邻舍的 ComfyUI 公共控制与聊天生图网关不并入 SthStart；SthStart 用自己的工作流注册与生成队列。
- 邻舍的向量库实现不直接复制；SthStart 只借语料，索引与降级逻辑在本仓库实现。
