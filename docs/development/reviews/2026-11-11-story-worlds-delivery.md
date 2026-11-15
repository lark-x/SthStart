# 故事世界实施与验收记录

最近更新：2026-11-12。范围：[已批准计划](../STORY_WORLDS_PLAN.md)。长期规则：[故事世界架构](../STORY_WORLDS_ARCHITECTURE.md)、[前端架构](../../FRONTEND_ARCHITECTURE.md)。工作区保留既有未提交修改，本轮未提交、推送或重置。

## 当前结论

世界、人物、分支、持续模拟、时间长卷、多视角阅读、配图、公共生图队列和采纳为项目章节已实现，并部署到 localhost:9320。完成审计后，补齐计划与个人摘要、来源更新预览、数值时钟、场景/道具参考，并修复持续事件分叉及明确拒绝后的恢复问题。正式数据库版本57，完整性正常、外键零违规。

**核心首版已交付，原计划仅剩Comfy实际单图与真实双引擎跨模块混合队列验收。** ComfyUI生成线程故障，获准清理/重启后仍被自动审批拒绝，操作未执行，完整计划尚不能标全部验收。有限文本实际阅读和GPT连续参考图已有证据；长期原作口吻、复杂生活交织与更多视觉样本属于持续改善，不另设无界首版关卡，也不外推为所有事件或供应商的质量保证。

## 需求、实现与证据

| 范围 | 已验证结果 | 适用边界 |
| --- | --- | --- |
| 世界/分支/人物/来源 | 创建、角色库已发布版本导入、原创与配角、来源快照、历史分支及项目采纳均有隔离测试和浏览器流程 | 来源快照不是完整原作资料库；世界经历不覆盖角色卡 |
| 历史分叉 | 只继承tick+duration不晚于分叉点的完整事件及关联记忆/状态；中途与结束边界、并行事件均覆盖 | 按原子事件处理，不从未结束事件推断部分结果 |
| 运行与恢复 | 成功阶段持久化；额度暂停后重开只补未完成调用；明确HTTP429经显式resume继续，旧失败保留、新调用计额 | unknown不得自动重投；所有故障组合没有都经真实上游演练 |
| 日常计划/个人摘要 | 迁移57增加计划/步骤意图/摘要表；情境失效、远处配角背景意图；摘要最多24事实/12记忆/8信念/10000字符；普通进度经结构及语义审查可延续 | 11-12内容补丁相关102项通过；过夜样本未跨步复用，不宣称实测调用节省 |
| 来源影响预览 | 人物/来源/地点/世界字段及角色库新版本；确认核对世界与分支修订；409后重新比较可直接继续，原事件保留 | 比较保存快照，不自动覆盖人物卡 |
| 时刻与参考 | 可选开始时刻、安全数值clock、独立场景/道具参考；创建/重读/编辑保存/390窄屏通过 | 不从自由文本标签猜钟点；当前cloud实际只发首张参考图并明示 |
| 故事浏览器 | 共9项不同用例最终通过：主要流程、12人规模交互、世界新字段与来源冲突恢复 | 初轮7项、表单补跑1项、来源补跑1项；未累计重复次数，供应商为夹具 |
| 12人1000事件 | 同一样本完成时间/人物/故事线筛选、缩放平移、390阅读/详情/暂停，四视口无横向溢出 | 本机交互性能，不是模型吞吐或跨机器SLA |
| 公共队列 | 跨连接/模块同类限额、总限额、事务领取、未知占位及单幅规则通过 | 真实双引擎混合未通过；GPT采样最大cloud=1、总数=1 |
| 真实文本 | 六人三地点24小时124调用、42事件、131记忆；同点两模式各20调用；五地点过夜复验86调用、17新事件、57记忆、52视角 | 过夜含前次失败共96调用；有进食/睡眠/次日不同选择，但叙事仍同质 |
| GPT Image | 累计14张成功；最新5张实际1536×1024；参考后人物/服饰/灯主体及海港桌面保持一致，动作可辨 | 纯文字三图灯结构漂移保留为失败证据；手部等局部仍变化 |
| 核心回归 | ci:core的239个测试文件全通过；类型、技能同步、Portal/Service构建通过；615文件/2251依赖，0违规/过期例外 | 最后弹窗及重新比较补丁另经Portal类型/构建、5项组件测试、定向lint与浏览器验证 |
| 旧流程 | 32项不同旧页面用例最终通过，覆盖角色、资料、笔记、写作保存及生图配置 | 历史有效补跑，不重复累计；配置测试不等于真实Comfy生成 |
| 部署保护 | 备份后部署57；7桌面页面加390手机入口通过，0pageerror；Magpie文本/参考图入口ready | 正式世界列表为空；真实测试世界在隔离库 |

11-12追加后的当前差异：运行/计划/摘要/模型/裁定118项回归通过；真实睡眠三步12次意图复用、新知后续保留消息但未追查；最新部署检查与原浏览器主用例延伸见下文。上表历史验证数量不与追加重复相加。

## 真实文本阅读结果

早期六人两轮44调用、16事件、57记忆；第40调用额度暂停，重开进程后只补4调用完成。该样本有虚构许可障碍、重复边界说明及代词漂移。改提示词后同设定独立样本40调用、15事件、78记忆、28段视角，逐段阅读确认送信、扶灯、紧固连接环及交谈后独立工作有所改善，不同视角仍较同质。

追加一日样本包括琴、丽莎及四位明确标注的原创成年人，3个地点。原作来源保存在canon-source-evidence.json（虚空终端387491、387616、387621），生成情节不是官方剧情。运行在第36调用遇HTTP429；沿同一run新增88调用后，总124次完成tick1→1441，42事件、131记忆、68段视角。没有重建世界或重放成功阶段。

该样本未设置数值起始钟点，夜间仍重复白天活动。补充startMinuteOfDay后，从父分支已完成历史点tick721创建两个分支，起点480分钟；实际每人行动请求收到clock={day:0,minuteOfDay:1201}（20:01）。各推进120分钟、20调用，完成至tick841，父分支事件序列完全相同。

- 原作留白分支：8新事件、20新记忆；收好文书、停止重复核查、喝水、散步。tick733–740丽莎在接待台告知艾文R-17蓝色书签及左抽屉位置。艾文行动请求原先无此秘密，交谈后保存heard记忆，sourceEventId=author-private-bookmark、fromActorId=lisa、learnedAt=740。其他人物未获知。
- 改编分支：6新事件、27新记忆；丽莎邀请艾文闲读，双方选书、共读、归还，其他人物休息。艾文没有另一分支的书签秘密，此分支知情者仍只有丽莎。
- 两分支新正文已逐段阅读。晚间收尾改善，但多视角常复述同一对话；庭院人物谈晚饭却无餐饮/住处地点可去，未证明进食、睡眠及次日生活。导演明确给出晚间方向，不能把改善仅归因于时钟。
- 真实个人摘要每人重建一次。留白分支无计划行；改编分支一条计划因情境变化失效，reuse_count均为0。跨步节省只有离线验证；新知后的下一轮自主行动未追加实跑。

证据：canon-day-resumed-result.json、canon-day-inspection.json、canon-fork-results.json、canon-fork-evidence.json、live-canon-forks.log。隔离库：容器/tmp/sthstart-worlds-canon-day-20261111/service.db。

## 内容质量补充验证（2026-11-12）

普通进度可通过可选routineProgressFactIds保留计划，但仅在明确continue、本人单独参与、原地点、正时长、独知事实且无状态/传播/猜测/新增因果时成立。未分类的新发现仍使计划失效；正常一致性审查另核对自由文本语义。仅对有效继续更新知识指纹，其他基线保留，与事件同事务提交。旧输出不含该字段时维持原有保守行为。叙事只接收本人的ownIntent，不接收其他人物的私下意图。

补充样本使用同六人，保留三个原地点，新增明确标为作者设定的餐室和共用临时休息室（独立床位），以18:00数值时钟和当天工作已完成为起点。目标从tick1推进840分钟，分步240分钟，两个运行合计最多112次文本调用。该条件不同于旧三地点样本，不作单变量效果对照。

首次运行34102689-0e2f-4a55-ba28-cc41531095fd首请求被HTTP429并发限制拒绝。沿同run显式恢复后共10调用：柯拉意图targetLocationId=dining，文字又说之后去quarters，裁定安排未经意图允许的第二次移动；唯一修正只换了事件地点仍不合法，运行在tick1暂停、没有新事件提交。原始两个响应均已使用新错误反馈离线复验，准确指出cora/dining/quarters且不改原状态；没有覆盖真实失败记录。

据此补充单目的地提示与具体位置错误反馈，未放宽校验。相关运行/计划/摘要/模型/裁定共102项通过，Service重新构建通过。独立复验分支从原始tick1继承已完成的作者起始事件，运行5c9f0b6c-a831-4792-b5e0-8696a7b5ade5使用余下102调用额度，实际86调用完成tick841。两个样本合计96调用；不是清空原运行的修正次数。

复验新增17事件、57记忆、52段视角，全部正文已逐段阅读。18:02–18:07六人分别步行到餐室，18:08–18:48用餐；22:02–22:07去共用休息室，22:08–22:21安顿入睡，22:22–次日02:01持续睡眠；02:02–06:01各自继续睡眠。06:02后琴、艾文、米娜、奥提斯、柯拉醒来，整理、步行并于06:22–06:57吃早餐；丽莎选择继续睡至08:01。晚餐结束至22:02之间、其余五人06:57至08:01之间为未描述的安静空白，不将空白冒充睡眠或工作；步边界保留一分钟事件间隔。

R-17事实只保留在作者起始事件，knownBy仅lisa；所有其他人物行动上下文均未含秘密，没有新增传播记忆。此样本无新知交流，不能替代旧分支的传播证据，也没有证明获知后下一步行为。人物出现了早餐与补眠的不同选择，但步行、饭食和睡眠段落仍高度同质、频繁复述精确分钟；只是生活时序改善，尚不满足自然叙事与长期原作口吻。

真实计划仍没有跨步复用：02:01的六个计划到06:01均因同地点其他事件标为new-relevant-event，且validUntil也正好为721；丽莎最后一条因companions-changed失效。24个步骤意图全为model，7条计划invalid，各人摘要重建4次、reuse_count=0。六人去休息室时均把移动后的睡眠误附routine计划，经一次修正去掉计划，增加6调用。纯进度字段实际被使用并审查通过，但本样本不能证明节省调用。

证据：content-movement-regression.log、content-final-service-build.log、live-overnight-quality.log、resume-overnight-quality.log、overnight-evidence.json、overnight-result.json、overnight-rejection-evidence.json、retest-overnight-quality.log、overnight-retest-evidence.json、overnight-retest-result.json、[52段正文](../../../artifacts/story-worlds-implementation/overnight-retest-reading.md)。定向lint无错误、5条未使用变量警告；未声称全仓lint清零。

## 复用与正文补丁（11-12追加）

Gemini 3.8 Flash high通过Antigravity CLI只读复核全部52段过夜正文，确认第一人称睡眠精确报时、日常流水账和人物表达同质等问题。该报告还建议补景物和合并共享睡眠事件；主代理只采纳有事实依据的表达改进，不新增未裁定感官事实，也不把合并事件作为额外硬门槛。报告见gemini-overnight-review.json/md。Workbuddy DS本轮文档核对再次因429未完成，由主代理接手，未计入独立复核通过。

叙事改为纯睡眠的简短有限第三人称概述，精确时段由时间轴表示；移动后日常不能在起点附routine/work计划，validUntil按本人准备改变活动的时刻选择而非机械等于本步终点。旁人同地点独立纯进度只在对应裁定attempt语义审查通过、所有事实有合法分类、无状态/传播/信念/因果变化且本人未参与获知时豁免相关事件失效；途中进出地点仍打断。没有按“睡觉”文本猜测安全。

合并后的118项运行/模型/计划/摘要/裁定回归通过，Service构建通过；定向lint零错误、仍有5条未使用变量警告。新增真实样本只读备份原隔离库后创建独立分支：从tick481连续睡眠180分钟、每步60分钟，上限56调用；从已获书签秘密的留白分支tick841再推进60分钟，上限24调用。总上限80次，结果以本节追加为准，不改变先前失败或通过证据。

睡眠样本已完成tick481→661，实际48调用、18新事件、18记忆、18段视角。六人各只提出一次行动，后两步共有12次reused意图，三个裁定及各自审查仍执行；相对逐步重问六人少12次行动调用（该结构若全重问需60次，不是另做付费对照）。六计划仍active、validUntil720，个人摘要各建一次但reuse_count=0，不能把意图复用写成摘要命中。18段正文已读，均为简短第三人称睡眠概述，无第一人称报时；睡眠本身不能证明复杂交谈中的人物差异。秘密仍只在丽莎行动输入，未新增传播；父历史不变。证据：final-sleep-evidence.json、final-sleep-reading.md、live-final-content.log。

新知后续样本完成tick841→901，20调用、7新事件、12记忆、8视角；同睡眠样本合计68调用，未超80。艾文行动上下文已包含R-17事实及heard来源，其他四人仍无秘密，丽莎本来就知道。艾文选择伏桌休息，本轮没有找书签主人，不能把记住事实等同于采取追查行动。米娜与柯拉讨论哪里能吃热饭、住一晚，未把不确定营业情况说成可靠推荐；馆内及办公室人物选择休息。这8段正文已读，交谈中两人关注点和语气可辨，纯睡眠不再第一人称报时；仍有否定句与流程感，不外推长期原作风格已通过。该三地点旧样本没有新增旅店，人物没有瞬移到未定义地点。父历史不变。证据：final-knowledge-evidence.json、final-knowledge-reading.md及result文件。

## 生图配置与画面检查

已按用户授权配置Magpie连接/引擎magpie-gpt-image，模型codex/gpt-image-2。文生图工作流magpie-gpt-image-single v5为自由生成文生图默认；参考工作流magpie-gpt-image-reference v1为图生图默认。参考输入png/jpeg/webp、最多一张12MiB；参考配方1536×1024、medium。工作流额外提示词优化策略关闭；页面“AI生成专业提示词”是独立选项，不能混为一项。未把密钥写入文档。

故事世界文本默认magpie-world-sol使用chatflowsai/gpt-6.1-sol medium；其他应用文本默认未改。cloud准备支持直接提示词和参考素材映射，不要求伪造Comfy节点；负面词传上游，所选recipe默认参数不再被故事世界固定值覆盖。

累计14张成功。早期9张包含作者修灯及真实文本交谈事件；旧请求1024×1024曾返回其他画幅，不能作为尺寸精确遵从证据。最新纯文字三图虽成功，但灯从小顶盖、无顶盖变大灯罩，连续性未通过；其中结果图走自由生成，不能说三张全都挂回故事配图节点。

以建立图18c3a205-b3d6-4cd9-825a-20053f58f927为参考，生成行动69a67582-daf6-4852-81b8-73f140cfb9de、结果c3d6ff09-bee0-4381-b087-011c3a0069b3，两张均由故事世界完成。已查看三帧：深蓝衣修理者、绿衣同伴、海港桌面、玻璃灯罩/护架/顶盖一致；扶灯、调整连接环和稳定后检查可辨，灯未点燃。手部和细部不是逐像素一致。最新5张PNG实际均1536×1024。

最新文字批次106次队列采样、参考批次215次，最大cloud=1、总数=1，故事/自由生成未绕过同类名额；不能据此宣称真实双类总并发2验证通过。

正式部署后文生图ready、v5、提示词可编辑、生成按钮可用；图生图ready、v1、referenceInputKey=referenceImage，上传入口可见，未选图时生成禁用。正式页面检查未点击生成。

## 浏览器修复与部署

来源预览原先在会transform的手机侧栏内，390宽度时移出屏幕。现仅该预览挂到body，不改变通用Dialog；桌面/390截图已查看，正文独立滚动。“重新比较”同步刷新overview和branch，解决预览已新而父级修订仍旧导致确认禁用的问题。浏览器验证409后重比可直接确认，不依赖刷新。测试另修正必填名称定位、门户/api/admin与服务/api/v1/admin的响应路径，未放宽业务断言。

原主要浏览器用例延伸到采纳后的后续操作：章节编辑→Ctrl+S保存→刷新读回→创建制作版本→核对冻结最新章节修订→新增关键镜头/对白→保存→刷新读回。定向单用例7.2秒通过（含启动14.6秒），证据browser-adoption-production-final.log。首次因测试脚本转义语法错误未执行，保留browser-adoption-production.log；修正为pathname.startsWith后完整通过。没有修改产品代码或放宽断言。这证明制作编辑链路，未触发真实配图/配音或视频制作；真实生图仍依赖已有GPT证据及未完成Comfy项。

前次备份data/backups/story-worlds-pre-audit57-20261111/；11-12内容补丁部署前新增一致备份data/backups/story-worlds-pre-content-20261112/，包含业务库、叙事库与媒体引用清单，不声称复制媒体二进制。Service重新构建后完整同步并重启sthstart；2026-11-12 00:29（UTC+8，原始日志2026-11-11T16:29:21Z）检查schema57、integrity=ok、外键0、worldCount=0。

与首次部署前备份逐表比对：已检查项目/正文/修订/角色/笔记等数量及内容保留；character_birthdays只有updated_at因既有启动投影重建变化。隔离旧库54→57保留项目、正文、角色版本与链接的测试通过。

部署后故事世界、角色库、资料库、创作项目、写作工作室、自由生成、生成配置均HTTP200，另验390故事入口，0脚本错误、无横向溢出。正式库无测试世界。

11-12内容部署后另验1440与390故事入口，均HTTP200、无脚本错误和横向溢出。deployed-check-content.json逐表对比本次备份，项目/正文/角色/笔记等保持，character_birthdays仅updated_at因启动投影变化。证据：backup-content.log、deploy-content.log、deployed-check-content.json、deployed-content-browser.json。此处不把前次7页面检查计成新的重复验收。

同室计划及有限叙事补丁完成有限实测后，再建立一致备份story-worlds-pre-final-content-20261112并部署。2026-11-12 01:40（UTC+8）健康/数据库检查schema57、integrity=ok、外键0、worldCount0；1440/390故事入口HTTP200、无脚本错误/横向溢出，原数据仅生日投影updated_at变化。证据：backup-final-content.log、deploy-final-content.log、deployed-check-final-content.json、deployed-final-content-browser.json。正式页面没有触发付费生图。

## 阅读页补充修复与部署（2026-11-12）

默认客观阅读每个事件只呈现一次概要，不再自动串接所有人物正文。选择人物后只显示该人物已有记录；缺少时明确“尚未记录”并提供切换客观叙述，不能把全局概要或另一人物的段落归到本人。参与者与已有视角作者的入口取并集，记录仍可逐个访问；睡眠的第三人称正文仅标为个人视角记录。导演主动查看全局事实/状态/档案的能力保留，未把界面选择当成权限隔离。事实和状态按钮修复第一次点击不展开的问题，并通过aria-expanded标明状态；分支/事件局部状态隔离保留。

13项阅读组件测试通过，原主要浏览器用例内增加个人/客观切换、缺失记录、非在场作者、事实/状态展开和收起；唯一用例1/1通过（最终22.8秒），仍覆盖后续配图规划、分支、采纳、章节编辑和制作保存。两次执行是同一用例，未累计为新增测试。最终Portal类型检查、生产构建通过；局部lint零错误、2条既有警告，设计检测返回空数组。1920/1440/1024/390与深色主题五张截图均已查看，页面/阅读区无横向溢出或脚本异常；人物按钮条保留局部横滚。证据：reader-verification-summary.json、artifacts/testing/1794420526422-10004/、reader-portal-typecheck.log、reader-portal-build.log、reader-lint.log、reader-design-detect.json；截图reader-1920/1440/1024/390及reader-dark.png。

一致备份story-worlds-pre-reader-20261112后部署至9320。2026-11-12 02:22（UTC+8）健康正常、schema57、完整性ok、外键0、正式世界0；项目/正文/角色/笔记等逐表数量及内容保留，仅character_birthdays.updated_at随既有启动投影更新。部署后1440/390使用浏览器拦截的隔离GET样例验证真实发布页面：缺失视角提示、客观切换、事实和状态首次展开均通过，HTTP200、0溢出、0脚本错误；没有写入正式故事或调用模型。缺失记录桌面/手机实际截图已查看。此样例证明发布产物，不宣称正式库已有故事。证据：backup-reader.log、deploy-reader.log、deployed-check-reader.json、deployed-reader-browser.json/.log、reader-browser-fixture.json；截图reader-deployed-missing-1440/390.png。

此补丁改善阅读呈现，没有重写已生成正文，也未产生新的真实模型质量证据。后续开发按架构标准§6的叙述归属与展开行为执行。

## 叙事修正反馈与固定事实复验（2026-11-12）

个人正文和个人审查的表达规则提取到story-worlds/narration.ts；正文优先当前动作/关键回应，省略与结果无关的计划进度和旧工作未变化列账，保留有意义的拒绝与未知。叙事审查原先丢弃具体issues，现可传回唯一修正。安全前提同时收敛：个人审查只见与作者相同的actor、ownIntent、显式摘取的个人已知事件事实，不再见全局来源/导演方向/其他人状态；全局原作/约束仍由裁定审查负责。

复用持久阶段时核对实际保存的审查input是否与当前个人input的JSON表示完整一致；旧全局审查的意见只返回通用理由，不转述其未知内容，原审计保留且不重置修正或新增调用。具体意见最多8项/6000字符。首次回归发现TypeBox内存Symbol不进入JSON导致新旧输入比较误判，已按实际持久JSON归一化；最终117项运行/模拟/模型/计划回归通过，Service类型及构建通过，产品定向lint零错误/3条既有警告。测试文件原有any债务仍在，初次全文件lint失败保留，新增测试未新增any；不宣称全仓lint通过。证据：narration-review-regression-final2.log、narration-review-typecheck-final3.log、narration-review-build-final2.log、narration-review-lint-final.log。

有限复验直接读取旧knowledge样本四人的成功narration请求，actor/ownIntent/events/facts和schema未变，仅替换task，逐人保存除task外输入SHA一致证据。Mina/Cora/Lisa/Otis共6段，实际8调用（含4审查），未超16上限，四审查均首轮通过，没有触发真实拒绝/修正；该路径由上述隔离回归证明，不能拿本批当真实修正证据。未重跑行动或裁定，隔离库事件历史保持，正式库未写入。

六段新旧全文均已阅读，Sol独立复核：米娜休息、丽莎闭目、奥提斯坐下休息不再追加工作未重开/清单不动/计划未走完等尾句，保留实际动作；问答保留营业与空房未知、当面询问建议、感谢、尚未选定去处，没有新造店名或住宿结果。Mina/Cora仍复述相近完整问答，选材差异有限；不把变短等同原作口吻与长期叙事已完成。证据：narration-quality-result.json、narration-quality-reading.md、live-narration-quality.log、narration-quality-review.md；隔离运行/tmp/sthstart-worlds-narration-quality-20261112。

一致备份story-worlds-pre-narration-20261112后部署。2026-11-12 02:58（UTC+8）健康/schema57/完整性ok/外键0/正式世界0；原项目/正文/角色/笔记逐表保留，只有生日投影updated_at随启动更新。1440/390读取隔离GET样例，发布页面视角/事实/状态操作正常、无脚本错误与溢出。证据：backup-narration.log、deploy-narration.log、deployed-check-narration.json、deployed-narration-browser.json/.log。本轮未改变UI样式，不重复计算前次四视口截图；未在正式页面触发模型。

## 最终有限审计与恢复准备（2026-11-12）

对照已批准原计划的独立有限审计已结束，报告见[最终收尾审计](../../../artifacts/story-worlds-implementation/final-plan-closure-audit.md)。未发现新的首版产品实现任务。前端S0–S6状态已统一为完成，最新架构检查615文件/2251依赖、零违规/过期例外；未把旧扫描或重复浏览器执行累加为新覆盖。

只读核对确认原实例PID26172、唯一待排队项及隔离任务对应关系不变，生成线程因CUDA错误退出。新进程一个GPU小张量运算、读回和同步通过，仅证明该操作可用，不能替代Comfy模型或图片成功。已核实本版CLI支持保守候选参数，但未应用，也未重装环境。恢复对象和操作顺序见[Comfy恢复交接](2026-11-12-comfy-recovery.md)。

已准备[有界生图脚本](../../../artifacts/story-worlds-implementation/live-final-image-acceptance.ts)：默认只读预检；单幅模式最多1个Comfy任务，混合模式最多4个故事/自由生成任务，运行前需空队列、旧未知已核销、正式服务无活动生图及工作流就绪。同一隔离库使用公共调度器，记录任务、事件和每秒/事件占位采样；不自动重提，不自行清理或重启，成功终态仍需人工查看图片。脚本语法转换零诊断，不声称执行路径已通过实际验收。

09:03（UTC+8）未带执行开关运行预检，按预期退出2：Comfy队列0运行/1待处理、旧隔离任务仍未知、正式活动生图0。随后只读确认新测试库与开始标记均未创建，旧任务upstream_may_continue=1/queue_slot_held=1保持。证据：[预检日志](../../../artifacts/story-worlds-implementation/final-image-preflight.log)、[预检后状态](../../../artifacts/story-worlds-implementation/final-image-preflight-state.log)。没有提交新图片或执行被拒绝动作。本轮仅更新交接、准备脚本与文档，产品继续使用02:58已验证部署。

## 剩余验收与持续改善

### VAL-017关闭：Comfy单图与双引擎混合（2026-11-12 12:2x UTC+8）

用户手动结束原CUDA实例，用原便携版Python与保守参数（去掉`--fast`，加`--disable-cuda-malloc --disable-async-offload --disable-dynamic-vram --disable-fast-disk --lowvram`）重启8188。重启后队列清零、显存查询恢复（RTX3080 12GiB，空闲约10.9GiB），`system_stats`确认embedded_python与torch2.13.0+cu130。

先核对上游确实为空，再用现有`confirmGenerationTaskUncertainOutcome`把旧隔离任务37f4d955…由abandoned确认为cancelled，`upstream_may_continue`与`queue_slot_held`归零；操作前备份隔离库到`user-restart-reconciliation/before.db`。没有直接改SQL字段。

Comfy单图：隔离库`/tmp/sthstart-worlds-final-image-20261112-single`，task93088bf6-991b-406e-8308-62d2b104bb47，prompt1b9023c3…，约22秒succeeded，artifact 175079字节。图片可解码，但中文提示词只画出一个黑白人物，内容不合格。

混合批次：`/tmp/sthstart-worlds-final-image-20261112-mixed`，4个任务（故事配图Comfy+GPT、自由生成Comfy+GPT）全部succeeded；152次采样中maxComfy=1、maxCloud=1、maxTotal=2，04:27:03出现真实的Comfy+Cloud同时占位，随后按终态继续领取。证据final-mixed-result.json、final-mixed-samples.json、final-mixed-output/。

### Anima提示词语言修复

同批Comfy图片暴露系统性问题：Anima以英文语料训练，服务端中文长描述只得到黑白草图/白底立绘。原实现把中文直接注入文本编码器。

新增`apps/service/src/story-worlds/image-prompt-language.ts`：工作流`editorConfig.promptLanguage='en'`时，提交前用应用已配置文本模型把中文场景改写为两行英文（PROMPT/NEGATIVE），按提示词SHA缓存到ai_call_records，重试不重复计费；未配置文本模型、上游失败或返回不完整时明确报错，不静默退回中文。契约增加可选`promptLanguage`，发布`anima-activity-linshe-parity` v2声明英文；v1保留。

三阶段复验（`-phases`隔离库）：3个任务全部成功，得到建立、擦灯、确认提手三张连续彩色画面，人物服装与灯主体保持一致。仍存在脸型/发式漂移、灯罩发光与“未点燃”冲突，归入VAL-018。

LoRA对比（1024×768，seed424242，同一英文动作提示）：无LoRA构图正常但灯罩发光；`anima-highres-aesthetic-boost`0.6保持构图并减少重复道具；`Anima_Detail_Tweaker`0.5额外生成了第二盏灯，判定不适合默认启用。建议默认使用aesthetic-boost0.5–0.6，并在负向词补充second lantern/duplicate prop/lit lamp/flame。

定向测试：image-prompt-language 3项、images 14项、契约53项通过；Service类型与构建通过；备份`2026-11-12T04-32-43.149Z`后两次部署容器健康。MCP校验原9节点工作流零错误，`system_stats`读显存成功。

证据：final-single-result.json、final-single-live-after-restart.log、final-mixed-result.json、final-mixed-samples.json、final-single-en3.log、final-phases-result.json、final-phases-output/、lora-compare/、publish-anima-en.log、reconcile-after-user-restart.log。

### ComfyUI升级与MOSS-Image实测（2026-11-12）

经用户同意把ComfyUI从v0.37.2（830232b8，detached）升级到v0.45.2（6e8488ef）：先停止原实例，`git checkout v0.45.2`，用`python_embeded`安装requirements（只升级comfy-frontend1.58.5、templates0.11.106、comfy-kitchen0.2.41、comfy-aimdo0.6.0；torch2.13.0+cu130未变），再以原保守参数重启。升级后同一Anima工作流、同种子输出与升级前一致，说明现有链路未被破坏。

MOSS-Image按官方Comfy-Org仓库下载`moss_image_base_int8_convrot`（5.4GB）、`qwen3.5_9b_int8_convrot`（9.7GB）、`flux2-vae_small`（250MB），使用官方`image_moss_image_t2i`模板（moss_image CLIP类型在v0.45.2才存在）。12GB显存下9B文本编码器加载到CPU，关闭扩展思考后25步、0.8MP约75秒出图；画面为暖纸质感双人海港场景，人物面部与灯结构完整，灯未点燃。默认25步/CFG2.5/er_sde/simple。

新增依赖与运行状态：ComfyUI当前由独立常驻进程在8188提供（日志comfy-0452-detached.log），不再依赖交互窗口；如需手动启动可用`run_nvidia_gpu.bat`。MOSS尚未注册为SthStart工作流，接入需要把模板转成API JSON并去掉9B文本扩展节点，列为DEV-024。

证据：comfy-upgrade-pip.log、comfy-0452.log、comfy-0452-detached.log、post-upgrade-anima/、moss_t2i_run.json、moss-output/。

11-12 10:05（UTC+8）按用户要求实查现有ComfyUI MCP：可连本机8188、读取原pending任务，原9节点工作流校验零错误/警告；显存查询仍因当前CUDA故障失败。MCP旧日志与当前实例日志已区分；其默认Python为CPU版Torch且未登记原进程，不能直接使用默认重启。仅只读探测，未取消/重启或派发，详见[恢复交接的MCP实查](2026-11-12-comfy-recovery.md#comfyui-mcp实查2026-11-12-1005utc8)。

1. **VAL-017：ComfyUI与混合队列。** 本次PID26172生成线程CUDA unknown error后退出；测试项62001702-c2f3-4f1c-ab2f-47759c493a2d未清理。用户批准清理与兼容重启后，自动审批仍只返回blocked by policy，操作未执行，未换工具绕过。解除执行阻塞后补Comfy单图、两类/两模块混合并发及图片检查，不再索取相同授权。
2. **VAL-018：持续内容质量改善，不是新增首版阻塞。** 过夜已有用餐/睡眠及次日不同选择，追加三步睡眠实证12次意图复用，后续行动保留艾文经交流获知的消息；艾文本轮选择休息属于合法自主行动，不要求为验收强制追查。交谈语气部分可辨，问答选材仍相近，长期原作口吻及复杂交织生活仍待改善。连续参考图只验证一个事件。

范围不扩张：六人真实内容加十二人规模夹具符合6–12建议范围，不追加付费十二人长跑；正式备份恢复演练是额外建议，不冒充已通过或新增门槛。

## 证据索引

除另注外，以下位于artifacts/story-worlds-implementation/；本机artifact不保证随Git发布。旧失败日志保留，以有效补跑为准。

- ci-core-audit57.log；[239文件报告](../../../artifacts/testing/1794404506489-37584/report.md)；runtime57-combined.log、upgrade57.log。
- browser-audit57.log（7/9）、browser-audit57-targeted.log（表单通过、来源等待路径失败）、browser-source-preview-final.log（来源完整通过）；最终Portal类型/构建、source-preview-final.log 5/5与lint-audit57-final.log。
- [12人1000事件报告](../../../artifacts/story-worlds-implementation/large-workflow-report.md)；截图在artifacts/visual-verification/story-worlds/，包括source-preview-1440/390、world-form-390及references。
- live-canon-day.log、resume-canon-day.log、live-canon-forks.log及上文JSON；旧两小时质量样本live-six-actors-quality-result.json。
- audit-evidence-summary.json、reference-request-evidence.json、action-image-files/、reference-image-files/及队列采样。
- backup-audit57.log、deploy-audit57.log、deployed-check-audit57.json、deployed-browser-audit57.log、live-image-form-audit57.log、deployed-reference-check.json、deployed-browser/。
- [初次审计与修复跟进](2026-11-11-story-worlds-completion-audit.md)：前五节保留初审快照，第六节为修复结果。
