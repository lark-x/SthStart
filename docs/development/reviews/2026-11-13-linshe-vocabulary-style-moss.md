# 邻舍词表补全、画风默认值与 MOSS 接入交付记录（2026-11-13）

状态：代码、迁移 58、部署与本地真实出图完成。MOSS 与 Anima 并存，不替换默认路径。

## 范围与决策

| 决策 | 采用值 |
| --- | --- |
| 成人词表 | 保留但默认关闭；只有工作流策略显式开启才参与关键词与向量检索 |
| 开关位置 | 现有「系统设置 → 生成 → 画风与提示词」面板 |
| 画师串／质量词默认值 | 空字符串，表示沿用工作流节点默认；界面用 placeholder 提示邻舍取值 |
| 词表基线与 MOSS | 词表任务与 MOSS 任务并行，互不阻塞 |

## 词表

`scripts/generate-parity-knowledge-data.mjs` 改为从对象库 `git show <ref>:<path>` 取文件，不再要求子模块 HEAD 等于基线。默认固定 `6b4c2e517ef72eb606a6ea3577c11804c3a6c603`；上游 `main`（`b5a0d72`）删掉了「手部动作(拿着某物)」整组，按 main 生成只剩 130 条／1777 标签，因此**不能跟 main**。来源、许可与再生成命令见 [邻舍借用台账](LINSHE_BORROW_LEDGER.md)。

拆分结果：通用集 141 条／1962 标签（内容哈希 `7baabdab…` 未变，证明通用集未被改动），成人集 81 条／824 标签（版本 `linshe-parity-adult-1+71a334d1`）。

`image-prompt-knowledge.ts` 新增 `includeAdult` 与 `knowledgeItemsForPolicy()`；`image-knowledge-index.ts` 新增独立语料 `image_prompt_knowledge_adult`，只在存在开启策略时同步，检索时按成人版本元数据过滤，避免旧向量混入。

## 策略字段与迁移

迁移 58 `image-prompt-style-defaults-and-adult-vocabulary` 为 `activity_image_prompt_policy_versions` 增加三列：

```sql
ALTER TABLE activity_image_prompt_policy_versions ADD COLUMN artist_string TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_image_prompt_policy_versions ADD COLUMN quality_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_image_prompt_policy_versions ADD COLUMN adult_knowledge_enabled INTEGER NOT NULL DEFAULT 0;
```

契约里这三项在**响应**中必填，在**保存请求**中可选，旧客户端继续可用。组装顺序对齐邻舍：质量词 → 画师串 → 画面描述 → 策略画风后缀；`manualFinal` 仍然完全绕过组装。结构化分支此前会吞掉画风前缀，本轮已修正并加断言。

## 画风默认值

故事世界新世界默认 `visualStyle` 改为日式动画赛璐璐描述（`DEFAULT_VISUAL_STYLE`），避免默认落成写实照片。`image-prompt-language.ts` 的系统提示加入 `anime screencap, cel shading, flat colors, clean lineart` 锚点，并把工作流策略里的画师串与质量词作为既定风格传给改写模型；缓存键升级为 `story-image-en-v2:`，旧缓存不再复用。

## MOSS 接入

`moss-image-story` 由官方 `image_moss_image_t2i` 模板转成 API 图，**去掉 9B 文本扩展子图**（TextGenerate / ComfySwitchNode / PreviewAny），改为直接编码服务端写好的英文描述；`CLIPLoader` 使用 `moss_image` 类型，潜空间用 `EmptyFlux2LatentImage`，`editorConfig` 声明 `promptLanguage:'en'` 与尺寸／步数绑定。注册脚本 `scripts/moss-workflow-register.ts` 默认只读，写入需 `--apply --confirm --engine-id`，按内容哈希幂等，不创建预设、不改任何用途绑定。

## 验证

| 项目 | 结果 |
| --- | --- |
| 契约测试 | 53 项通过 |
| 词表／迁移／策略／MOSS／英文改写／配图定向 | 56 项通过 |
| `npm run typecheck` | 通过 |
| 服务构建 | 通过 |
| 真实 MOSS 出图 | 1024×1024、25 步、CFG 2.5、32 秒；赛璐璐平涂，两人与未点燃黄铜灯正确 |
| 部署 | 9320 容器健康，schema 58，完整性 ok，外键 0，`/apps/activities`、`/apps/story-worlds`、`/settings/generation`、`/apps/story` 均 200 |
| 回归 | `npm run test:regression` 235 个测试文件全部通过（report: `artifacts/testing/1794552218390-27896/report.md`） |
| 部署后复查 | `moss-workflow-register --check` 显示 existingVersion=1；重复 apply 返回 published=false |
| 成人语料隔离 | 无开启策略时不发起任何成人语料请求；开启后才同步并只返回成人条目 |

真实出图脚本：`node --import tsx scripts/moss-workflow-live-check.ts`；图片 `artifacts/story-worlds-implementation/moss-output/moss_story_00001_.png`，提交图 `submitted-graph.json`。

三阶段对比（`scripts/moss-workflow-phase-compare.ts`，固定种子 20261113）共 75 秒完成三张：建立／行动／结果画风一致，但道具连续性不达标——行动图把立式灯画成横向扭曲结构，结果图灯变深色且两人已离开桌旁。细节与未证明项见 `artifacts/story-worlds-implementation/moss-phase-compare.json`；这与 Anima 的同类问题一并归入 VAL-018 持续改善。

## 部署过程要点

容器里的 `scripts/database.ts` 读的是 `apps/service/src`，所以**必须先部署新源码再执行迁移**，否则容器内仍只有 57 版迁移。本次顺序：备份 → 构建 → `deploy-docker.mjs --skip-build` → 容器内 `db:migrate` → `db:check`/`integrity` → 注册 MOSS → 页面检查。备份目录 `/app/data/backups/2026-11-13T06-26-17.530Z`。

## 已知限制

- 成人词表的向量语料只在开启后首次调度时同步；未开启的库不会有该语料，也不会被检索。
 - 混合检索会丢弃元数据版本不匹配的旧向量；重建索引期间返回关键词降级，不会混用新旧语料。
- 画师串／质量词留空即不注入，实际效果取决于工作流节点默认值；要复现邻舍观感需在活动画风里显式填写 `@ebora` 与质量词。
- MOSS 与 Anima 的画风差异属模型能力差异，本轮只验证单张真实出图与人物／道具事实，未做多阶段连续一致性对比。
