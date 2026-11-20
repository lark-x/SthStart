# 角色资料库与多源管线完成度审计

日期：2026-11-16。基线：`feat/character-library-upstream`，HEAD `5b55c39`，包含工作树原有角色外键修复。验收标准为用户本轮提供的阶段 2/3 决定。结论：框架和局部交互已实现，端到端产品目标未完成，不能将“字段、适配器、入口存在”记作完整交付。

本轮只审查、测试和写证据，没有修改产品源码、迁移、清库或部署。所有写入测试使用内存/临时数据库；未调用收费模型。用户要求停止 computer use 后已停止，不再操作桌面；后续浏览器验证全部为隔离环境的 headless Playwright。

审查分工：独立产品审查 A=`audit_character_ux`；静态检测 B=`audit_character_ui_evidence`；上游=`audit_rp_pipeline`；领域链路=`audit_domain_chain`，均使用 `xingchi/gpt-6.1-sol / xhigh`。主代理阅读关键源码、复跑领域探针并核对截图。没有依据不完整视觉观察打综合设计分数。

## 完成度矩阵

| 用户目标 | 当前判断 | 尚未完成的验收条件 |
|---|---|---|
| 头像/信息卡双视图、高频快筛 | 基础完成，有缺陷 | V2 有外貌筛选错误；触摸收藏及筛选状态无障碍需修复 |
| 三 Tab 清晰详情，去机器信息 | 结构完成，体验部分完成 | 详情仍主要为编辑表单；主档案与形态编辑范围并列，生成未跟随形态；新增流程缺真实内容验收 |
| 完整原文支持 RP | 未达标 | BWiki 真正文被删、注释占位被误采；Akasha 只取 snippets；原文未完整归档 |
| 可靠多源与 SP/装甲识别 | 部分实现 | 星铁漏巡猎三月七；崩3候选标题代替装甲详情；通用作品路由不足 |
| 皮肤/形态双轨+服饰故事 | 部分实现，有数据丢失 | 无图皮肤不保存文字；形态不随发布快照；皮肤故事未进入邻舍提示词 |
| 原创显式阶段，IP/同人自动快照 | 未按约定完成 | 原创下游自动发布；保存失败仍发布旧稿；导入/批量变更漏自动快照 |
| 作品 canon/derivative/original 全链路 | 部分实现 | 名称充当关联身份；改名产生重复目录；母作品自由文本；主要入口仍为故事世界 |
| 同源派生及全局选角折叠 | 库内基础完成，下游未完成 | 详情复制同人实际复制根卡；活动/剧情/世界选角无家族聚合切换 |
| 邻舍方式 A 唯一静态权威 | 部分实现 | pull 已禁用，但邻舍仍可改静态人设；资产更新不触发重编译；即时图片仅确认手动回流入口 |
| 清库首次部署 | 当前清库状态可确认 | 真实库角色/版本/资产/来源均为0，连接6、生成方案8、作品2；不证明已有可用角色样本 |

## 优先问题与证据

### P1：采集内容不可靠

真实公开请求 `fetchBwikiCharacter('琴','genshin')` 得到13张图、0条语音，故事仅86/21/29字；原文在 `{{角色/故事}}` 模板里被 `apps/service/src/characters/upstream/types.ts:79` 删除。`bwiki-adapter.ts:151` 先分节后删注释，使注释里的“这里是皮肤的背景故事”变成皮肤候选。既有伪故事还让 `orchestrator.ts:98` 跳过兜底。证据：`artifacts/character-audit-upstream-live.json`。

真实 StarRailRes 里巡猎三月七 id1224 同样名为“三月七”；`starrailres-adapter.ts:42` 硬编码名称匹配漏掉她。服装和故事为模板句。Yatta两次TLS ECONNRESET，仅说明本次环境不可用，不断言服务永久失效。

### P1：皮肤文字静默丢失，失败仍展示完成

`apps/service/src/characters.ts:1332` 将皮肤文字绑定图片下载成功才落库。临时库提交含服装描述和故事但无图片的皮肤，HTTP200、createdSkinCount0、warnings空、资产空；图片404时同样不保存文字。`character-upstream-dialog.tsx:183` 忽略返回warnings并关闭向导。形态图片404也没有warnings。证据：`artifacts/character-audit-upstream-repro.json`。

### P1：原创阶段保存会发布旧稿

`character-editor.tsx:575` 忽略 `session.handleSave()` 的null失败返回，继续publish。headless Chromium实证：原创角色名称清空，保存新阶段，页面同时显示“请先填写角色名称”和“已保存阶段版本v1”；publish返回201，新v1仍为服务器旧名称、旧摘要。证据：`artifacts/character-audit-probes/stage-empty-name-result.json`、`stage-empty-name.png`、`stage-empty-name.spec.ts`。

仅标签/形态修改不一定反映到RHF isDirty，阶段保存也可能跳过草稿保存。代码定位：`use-character-draft-session.ts:103`、`:150`。

### P1：原创显式阶段边界被下游绕过

`linshe-bridge.ts:101` 对所有origin自动publish，甚至allowIncomplete。`world-resource-picker.tsx:807`、`story-work-cast-dialog.tsx:59`、`projects/published-character.ts:9` 在首次选角时自动发布。内存探针证实缺简介/人设的原创push仍产生v1。现有lineage测试还明确要求原创push自动发布，所以测试绿灯不代表符合产品约定。

### P1：皮肤更新后的邻舍push报成功但仍是旧服饰

资产上传和metadata修改不增加draft_revision；bridge仅比较该修订决定是否重编译。探针：已有v1上传costume再push，仍version1，compiledPrompt无新服饰。定位：`characters.ts:1559`、`:1641`、`:223`，`linshe-bridge.ts:103`。

### P1：从同人详情派生复制错源

`character-editor.tsx:546` 给fork传 `familyRootId || characterId`；服务 `characters.ts:1104` 从该ID整份clone。打开已经改写的AU角色继续派生，会复制原作卡而非当前AU卡。谱系根与复制源应分开。

### P2：自动快照、作品与筛选仍有断点

- 导入IP后latestVersion=null；批量改作品/来源后草稿revision2、快照仍旧作品/ip/revision1。定位 `characters/import-sessions.ts:369`、`:418`，`characters/organization.ts:202`。
- V2保存appearance.baseText，筛选仍查appearance.description，实证有外貌角色在“有外貌”total0。定位 `characters/organization.ts:150`。
- 世界改名后旧/新作品名同时存在并指同world_id，角色work字符串不联动。定位 `story-worlds/store.ts:369`、`characters/organization.ts:55`。
- 活动/剧情/世界选角未传collapseDerivatives且不消费familyMembers；库内聚合不等于全链路聚合。
- 邻舍关联角色仍能改base_prompt/display_name，之后主库push会409。定位 `upstream/linshe/agent-core/src/routes/characters.js:508`、`:136`。更新路径未发现清理记忆/情绪/日程表，但未进行真实邻舍运行验收。

以上领域问题可复跑：`node --import tsx/esm artifacts/character-audit-domain-probes.mjs`。主代理已复跑确认，结果 `artifacts/character-audit-domain-probes.json`。

### 原文、形态及视觉消费尚未形成闭环

来源落库为截断excerpt，source_snapshot_id为NULL（characters.ts:1421），没有使用既有原始快照机制。Akasha只search、不read正文（akasha-bridge.ts:31）。RP降级只取前5故事每篇900字和4条示例；稳定外貌是泛称（rp-synthesizer.ts:20）。

形态保存于variants_json，但发布data_json只存draft（characters.ts:268）。编辑器有独立形态服装/故事框，不能说完全没做；但主三Tab仍编辑主draft，AI生图使用主draft提示词（character-editor.tsx:114），未形成明确的“选择形态→生成/选角使用该形态”。皮肤loreStory也不进入邻舍编译，仅outfitDescription被使用。

## 验证结果与边界

- 前端/契约9文件109/109通过，`artifacts/testing/character-audit-frontend/report.json`。
- 领域服务5文件44/44通过，`artifacts/testing/character-audit-domain/report.json`。
- 上游单测5/5通过，全部模拟HTTP；重复跑characters 9项不再累计。
- 既有角色筛选/窄屏编辑E2E Chromium+WebKit 14/14通过，`artifacts/character-audit-e2e.log`。
- 新增临时审计用例1项确认上述错误行为；它的通过意味着缺陷复现成功，不是修复通过。
- 6个内存领域探针均得到断点结果；3个皮肤/形态导入探针确认失败路径。
- 静态设计检测1条animate-bounce advisory，属于电话反馈动效，非主要阻断。没有完整实屏视觉验收；CUA停止前未进入角色页面，无注入、无live-server。测试端口最终释放。

## 建议的纠偏顺序

1. 先统一版本与变更规则：原创只显式阶段；非原创所有入口自动快照；保存失败不发布；资产修改纳入快照失效；fork源ID正确。
2. 选少量真实角色逐个验收上游：普通皮肤、SP、崩3装甲各一类。保存完整原文及出处，解析真实模板，以角色ID归组；图片失败也保留文本，缺证据明确显示。
3. 打通同一份角色资源在世界/故事/活动/邻舍中的消费，统一家族/形态/服装选择与来源提示。
4. 在真实内容样本上完成界面精简：默认读档，编辑为明确动作；统一作品目录入口与身份；去掉多个含义重叠入口和误导性的“完整/完成”提示。

新的完成标准应是“真实样本能完整走通并被正确消费”，而非增加组件、字段或适配文件。当前不建议继续大规模导入，也不需要再次清库。
