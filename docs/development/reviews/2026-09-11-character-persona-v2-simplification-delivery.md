# 人设与外观 V2 精简交付说明

日期：2026-09-11。状态：核心实施完成，剩余项见文末。
实施依据：[人设与外观精简、编译统一及角色数据库清理实施规划](../plans/CHARACTER_MODEL_SIMPLIFICATION_V2_IMPLEMENTATION_PLAN.md)。
范围：SthStart 公共角色库、活动消费者与角色数据库；未修改邻舍（upstream/linshe）内部代码。

## 1. 交付结果

日常只维护四块内容：**人设正文、说话方式、基础外貌、默认穿着**。人设不再要求用户把身份、经历、性格、动机、好恶拆进十几个字段。

| 能力 | 结果 |
| --- | --- |
| V2 内容模型 | 新增 `CharacterDraftV2`（personaText / speechText / dialogueExamples / behaviorRules / appearance.baseText + defaultOutfitText），与 V1 并存于同一联合类型 |
| 统一运行时 | `toCharacterRuntime()` 把 V1、V2、活动快照投影都归一成同一份只读视图，消费方不再各自拼字段 |
| 统一视觉编译 | `buildCharacterVisualContext()` 负责基础外貌 + 有效穿着；头像、活动生图共用，不再各写一套外观文本 |
| 邻舍导出修正 | `compileLinshePrompt()` 现在把唯一的 `## 你的外观` 放在正文末尾，并中和用户正文里的同名标题；修复了邻舍把后续行为段落当成外观的接口约定问题 |
| 活动上下文预算 | `buildCharacterContextSections()` 给行为约束与说话方式独立预算，正文按段落边界裁剪并返回缩减记录，替换原来的整体末尾硬截断 |
| 外观不再混装 | 迁移把外观细项重组为「基础外貌」，服装类内容进「默认穿着」；识图候选改为按细项重建而非整段替换 |
| 候选差异可预览 | 采用识图候选前，界面按当前勾选直接给出「基础外貌 / 默认穿着」的当前值与采用后文本；预览与实际写入共用同一份纯函数，避免两套逻辑漂移 |
| 试演建议可对照采用 | 试演建议不再只显示路径名：逐条给出「当前 / 建议」文本，「采用到草稿」只写入当前草稿并提示仍需保存；建议的允许字段与提示词共用一份定义，V2 里没有的路径不提供采用入口 |
| 迁移复核有界面入口 | 「关系与来源」新增结构迁移复核面板：列出每位角色升级时无法自动归类的项、说明需要确认什么，并给出旧数据里未生效的服装；复核内容由归档原文 + 迁移纯函数现场推导，不另存可能漂移的状态 |
| 导入合并 | `applyV1PatchToV2()` 按人设小节合并卡片字段，只覆盖卡片提供的部分，未提供的段落原样保留 |
| 数据库收敛 | 迁移 20、21 删除重复列、空壳服装表与资产表文件镜像列；迁移 22 记录发布版本的编译器版本（见第 3 节） |

## 2. 数据迁移结果（真实库）

数据库：`data/sthstart.db`，已升级到迁移 22（迁移 20 收敛重复列与空壳服装表，迁移 21 清理资产表的文件镜像列，22 给发布版本加编译器版本列）。

- 角色 120 个，全部从 V1 细分化结构转为 V2：`schemaVersion=2` 120/120。
- 归档：为每个被改写的草稿写入一份不可变原文快照（`character_source_snapshots`，provider `sthstart-draft-migration`），并建立 `character_sources` 的 `migration_archive` 来源行，可在角色「来源」中查看原文 JSON。
- 重复执行安全：再次执行 `apply` 不会重复拼接正文或新增快照（已实测）。
- 未迁移任何已发布版本、活动内容或历史执行记录；发布行为不变，修复通过新发布版本生效。

### 需人工复核的语义冲突（迁移只记录，不擅自判断）

| 类型 | 数量 | 含义 |
| --- | --- | --- |
| `ambiguous_appearance` | 69 | 整体外观描述与单独的发型/眼睛/体态字段并存，且描述疑似含服装；原文全部保留，需要确认外貌与穿着的分界 |
| `accessory_placement` | 103 | 旧配饰无法区分稳定特征与随服装变化的饰品，已留在基础外貌并标注待确认 |

原文均可恢复：`node scripts/character-model-audit.mjs --show-text` 可查看复核项，`character_sources` 的 `migration_archive` 行链接到完整原文快照。

复核项现在也有界面入口：角色「关系与来源」里的「结构迁移复核」面板，以及 `GET /api/v1/admin/character-migration-reviews`（仍有复核项的角色清单）、`GET /api/v1/admin/characters/:id/migration-review`（单角色明细）。真实库上清单返回 120 条，冲突计数与迁移报告一致（`ambiguous_appearance` 69、`accessory_placement` 103）。

## 3. 数据库清理

| 位置 | 动作 | 依据 |
| --- | --- | --- |
| `character_outfits` | **删除表与索引** | 本项目源码中无任何业务读写；迁移前实测 0 行。邻舍自身的同名表有真实换装业务，不在这个数据库，未受影响 |
| `character_visual_references` | 删除 `artifact_id`、`sha256`、`source_page`、`original_url`、`author_note`、`user_note`、`outfit_id` | 这些是 `character_assets` 的副本；读取改为 JOIN 资产表 |
| `character_assets` | 删除 `purposes_json`、`enabled`、`crop_json`、`outfit_id`、`sha256`、`width`、`height` | 参考配置归参考表，文件元数据归 `artifacts`；读取改为 JOIN `artifacts` |
| `character_assets` | 删除 `local_path`、`content_type`、`byte_size`、`original_name` | 文件本身只登记在 `artifacts`；资产表只保留「谁用了哪个 artifact」。孤儿文件扫描改为只以 `artifacts`（加未迁移的笔记资产）为依据 |
| `character_profiles` | 删除 `default_outfit_id` | 默认穿着由 `appearance.defaultOutfitText` 表达；该伪 ID 列数据全为 NULL |

清理前的数据归属先做回填：参考图侧的来源、备注、artifact 归属会在删除前补齐到资产侧，避免信息丢失。迁移在关闭外键约束下重建参考表，结束后执行 `PRAGMA foreign_key_check`，有违规直接报错中止。

## 4. 兼容策略

- `draft_json` 以 V2 为权威。V1 载荷在写入时经迁移组合为 V2，文字不丢，只重新分配结构。
- 已升级角色拒绝旧格式覆盖（`409 draft_schema_upgrade_required`），避免反复套叠小标题把正文写坏。
- 历史 `character_versions`、`compiled_linshe_prompt`、外观快照与活动内容原样保留；读取时归一化，不回填覆盖。
- 未纳入本轮：活动记录里指向旧人物的 `identity` 字段仍属历史快照，继续可读，但不再由新投影写入。

## 5. 实测验证

已执行并通过：

```text
npm run typecheck                                        # portal + service + contracts 通过
npm run build                                            # portal 与 service 构建通过
npm run test:portal                                      # 10/10 通过
npm run test:contracts                                   # 16/16 通过（本轮新增）
npm run test:linshe-contract                             # 2/2 通过
node --test apps/service/dist/*.test.js                  # 152/152 通过（连跑 4 次稳定）
npx playwright test tests/e2e/portal.spec.ts -g "character library"   # 角色主流程通过
```

新增的两组回归测试对应规划第 10.1 节的行为矩阵：

- `packages/contracts/src/character-model.test.ts`（16 例）：迁移不丢字、重复迁移幂等、冲突不擅自归类、未知版本拒绝、预算不切关键约束、多消费方共享语义、邻舍导出外观唯一且在末尾、穿着覆盖三态、V1 只读视图、导入补丁按小节合并、识图候选按勾选细项重建。
- `apps/service/src/linshe-contract.test.ts`、`characters.test.ts`、`database.test.ts`：从邻舍源码读取真实外观锚点验证提取结果、原文归档可下载、服装表 guard 与归档、迁移 20 的重复列合并规则；其中 `database.test.ts` 另有一例专门锁定「同一资产挂多条参考时按参考自身 ID 重建、不合并」「无参考的头像不丢且不编造参考行」。

迁移已在数据库副本上完整演练，再对日常库执行；日常库升级前后各留一份备份：

- `data/sthstart.db.before-persona-v2-20260911.bak`（草稿迁移前）
- `data/sthstart.db.before-v20-20260911.bak`（迁移 20 前）
- `data/sthstart.db.before-v21-20260911.bak`（迁移 21 前）
- `data/sthstart.db.before-v22-20260911.bak`（迁移 22 前）
- 副本演练产物保留在 `.codex/migration-rehearsal/`（可删除）

恢复方式：停止服务后把 `.bak` 文件改名回 `data/sthstart.db` 并同时恢复对应的 `.db-wal`；备份是数据库文件级快照，媒体文件不在其中。
迁移 22 只新增一列；历史发布版本的 `compiler_version` 保持为空，不回填（旧提示词由旧编译器生成，不能冒充新产物）

当前日常库：迁移 22，120 个角色全部 `schemaVersion=2`，`quick_check` 通过，无外键违规。

### 迁移后真实数据的端到端冒烟（对副本执行）

把升级后的真实库复制一份，用新代码启动服务并请求：

- `GET /api/v1/admin/characters` → 200，120 条，通过 `CharacterListResponseSchema` 校验
- `GET /api/v1/admin/characters/:id` → 200，通过 `CharacterDetailSchema` 校验
- `POST /api/v1/admin/characters/:id/publish` → 201，且编译出的提示词中 `## 你的外观` 之后没有任何顶层小节（`appearanceIsLastSection = true`）
- `GET /api/v1/admin/characters/:id/export-tavern` → 200，卡片字段完整

另外直接对真实库校验：120 份草稿全部通过 `CharacterDraftAnySchema`，359 条来源全部通过 `CharacterSourceSchema`。

### 迁移副本演练

迁移 20、21 都先在数据库副本上完整演练，再对日常库执行；迁移 22 只新增可空列。副本产物保留在 `.codex/migration-rehearsal/`、`.codex/v21-rehearsal/`、`.codex/smoke/`（可删除）。

### 二次复核中修掉的九个真实缺陷

上一轮把两个运行时测试失败记成了「环境限制」。复核后确认它们其实是代码缺陷，已修复并有回归测试：

| 缺陷 | 根因 | 修复 |
| --- | --- | --- |
| 端口空闲时仍报 `port_owned_by_other_process` | Windows 上 `Get-NetTCPConnection` 无结果时输出为空，`Number('')` 得到 `0`，通过了 `Number.isInteger` 检查，于是被当成「别的进程占着端口」 | `apps/service/src/runtime.ts` 的端口探测加上 `pid > 0` 判定（Windows 与 POSIX 两处） |
| 启动邻舍 Web 时抛 `spawn EINVAL` | Windows 上 Node 不允许 `spawn('npm.cmd', …)`，必须经 shell；这条路径在 Windows 上从来没有真正跑起来过 | 改为用当前 Node 执行 npm 的 `npm-cli.js` 入口（`npmLaunch()`） |
| 结构迁移的原文归档无法下载 | 迁移归档只写库内 JSON（`raw_file_path` 为空），原始快照接口却要求磁盘文件，一律返回 404 | 无磁盘文件时直接返回库内原始载荷；同时把 `v2-json` / `sthstart-draft-json-v1` 等格式名按 JSON 返回 |
| 迁移把已是 V2 的草稿当 V1 再解析 | `migrateCharacterDraftToV2` 没有识别已升级输入，V2 字段在 V1 里没有对应项，正文会被清空 | 已升级输入直接归一化返回；幂等测试连跑三次校验 |
| 非空 `character_outfits` 会被静默删除 | 迁移 20 直接 `DROP TABLE`，本项目为空表所以没暴露，别人升级过来的库会丢数据 | 迁移加 `guard` 前置检查，命中即中止并指向归档入口；归档脚本先归档旧服装行再清空，归档可在角色来源中下载 |
| 发布版本与试演不记录编译器版本 | `CHARACTER_PERSONA_COMPILER_VERSION` 定义后从未被使用，试演还把版本号硬编码成 `character-persona-v1` | 发布写入 `character-persona-v2`（迁移 22 新增列，历史版本留空不回填）；试演改用常量并写入新版本号 |
| 试演建议给出 V2 里不存在的字段路径 | `buildAuditionPrompt` 输入的是 V2 投影，却示例 `/speech/tone` 这类 V1 路径；用户拿到的建议在 V2 编辑器里没有对应控件 | 试演改用统一的上下文构建器，并限定 fieldPath 只取 V2 草稿真实字段 |
| 媒体巡检会删掉来源快照与导入暂存文件 | 迁移 20 给 `character_assets` 去掉镜像列时，误删了巡检里 `character_assets.local_path` 的保护项。但角色来源快照记在 `character_source_snapshots.raw_file_path`、导入暂存文件根本还没登记——每次服务启动的巡检都会把它们当孤儿删掉，导致「下载原始快照」404、导入会话提交时 ENOENT（此前表现为服务端测试约 5 次 1 次的间歇失败，根因就是它） | 巡检把来源快照纳入已知路径、整块跳过导入暂存目录，并在删除前重新核对全部三类来源；新增 `artifact-reconcile.test.ts` 锁定 |
| 角色编辑器在 390px 下横向溢出 | 头部操作行是 `shrink-0`，内容宽 458px 时无法收缩，把文档宽度撑到 474px | 改为窄屏整行换行（`w-full sm:w-auto`），窄屏不再溢出 |

### 浏览器验收（Windows chromium）

- 角色编辑器视觉基线重新生成，界面确认只保留四块内容：人设正文、说话方式、基础外貌、默认穿着（`tests/e2e/visual.spec.ts-snapshots/character-editor-chromium-win32.png`）。
- 角色创建 → 编辑 → 保存 → 刷新回读 → 发布 → 导出 的完整流程已在 `tests/e2e/portal.spec.ts` 用 V2 界面重跑通过；原来的用例还在按已废弃的 V1 字段（`性格特点 1`、`导入 JSON`、`发布版本`）断言，已一并更新。
- 迁移复核面板对真实迁移库副本做了端到端核对：以 `芙宁娜`（真实库里的 120 个已迁移角色之一）为例，面板列出「外貌与穿着的分界需要确认」「配饰归属需要确认」两项，归档时间 2026-09-11；同一角色的「来源」里能看到 `迁移前原文（V1 草稿）` 并可下载原始快照。接口侧清单返回 120 条，冲突计数与迁移报告一致（69 / 103）。
- 窄屏：四个分区与迁移复核面板在 390px 下均无横向溢出（`scrollWidth === clientWidth`），分区按钮高度不低于 42px。
- 新增自动用例 `character editor tabs stay inside a 390px viewport`：覆盖新建角色各分区与「关系与来源」在 390px 下不溢出、控件不被裁切、分区按钮高度不低于 40px。
- 真实模型与真实生图仍未执行：本机没有可用的模型与生图配置，本条不据此声称通过。
## 6. 新增维护入口

```text
node scripts/character-model-audit.mjs [--db <path>] [--json] [--show-text]   # 只读基线审计
node scripts/character-model-migration.mjs preview [--db <path>]              # 迁移预演，不写入
node scripts/character-model-migration.mjs apply   [--db <path>]              # 归档旧服装行并迁移草稿
```

审计与迁移都使用原始只读/直连 SQLite，不经过会自动迁移的 `ServiceDatabase`，因此不会在查看时改变库结构。

## 7. 剩余项

1. **旧 persona 三表**：`personas` / `persona_versions` / `app_personas` 作为公共服务兼容层保留，尚未淘汰；已确认新编辑只以 `character_profiles` 为权威，发布时生成兼容记录。
2. **旧服装表在别人库里的升级路径**：迁移 20 的 guard 已能拦住非空 `character_outfits`，归档脚本也会先归档再清空；但「已归档、已清空」目前靠脚本一次跑完，没有单独的复核步骤，升级别人的库时建议先 `preview` 看 `outfitRows`。
3. **真实模型与真实生图验收**：界面布局、角色主流程与迁移复核面板已在 Windows chromium 上验证（见第 5 节）；真实试演与真实生图仍需要可用的模型与生图配置，本轮未执行。
4. **门禁外的既有失败**：`tests/e2e/portal.spec.ts` 中公共服务模型、叙事工作台检索两条用例当前失败，涉及的都是上一批公共服务与叙事改动，与本次人设精简无关，未一并修改。
5. **`.codex/review-visual/` 是本次核查留下的临时目录**（真实库副本与界面截图），可随时删除。
6. **`tests/e2e/portal.spec.ts` 里原有的「窄屏不裁切」用例仍未覆盖编辑器**：它在访问首页时就因 `进入邻舍` 的无关断言失败而退出。本轮已新增独立用例 `character editor tabs stay inside a 390px viewport` 覆盖编辑器各分区；那条旧用例自身的前置断言（与本次无关）尚未修。

## 8. 主要改动文件

契约与共享逻辑：

- `packages/contracts/src/index.ts`：V2 草稿与联合类型、`toCharacterRuntime()`、视觉编译、上下文预算、迁移纯函数、`compileLinshePrompt()`。

服务端：

- `apps/service/src/characters.ts`、`characters/draft.ts`、`characters/persona-compiler.ts`、`characters/import-sessions.ts`、`characters/birthday.ts`
- `apps/service/src/activities/context.ts`、`activities/characters.ts`
- `apps/service/src/database.ts`（迁移 20、21、22）、`apps/service/src/artifacts.ts`

前端：

- `app/features/characters/components/character-form.tsx`、`identity-section.tsx`、`personality-section.tsx`、`appearance-section.tsx`、`character-editor.tsx`、`publish-section.tsx`、`character-import-dialog.tsx`、`character-library.tsx`
- `app/features/characters/api.ts`、`mutations.ts`、`schemas.ts`、`components/migration-review-panel.tsx`（新增）、`components/character-audition-panel.tsx`

脚本与文档：

- `scripts/character-model-audit.mjs`、`scripts/character-model-migration.mjs`（含旧服装归档）
- `apps/service/src/runtime.ts`（端口探测与 Windows 启动 npm 的修复）
- `packages/contracts/src/character-model.test.ts`（新增）、`apps/service/src/artifact-reconcile.test.ts`（新增）、`apps/service/src/linshe-contract.test.ts`、`apps/service/src/characters.test.ts`、`apps/service/src/database.test.ts`
- `tests/e2e/portal.spec.ts`、`tests/e2e/visual.spec.ts`（角色流程改用 V2 界面）、`app/lib/query-keys.ts`
- `docs/development/plans/CHARACTER_MODEL_SIMPLIFICATION_V2_IMPLEMENTATION_PLAN.md`、本文件
