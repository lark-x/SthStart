# ComfyUI 提示词与上下文升级交付记录

日期：2026-10-13

后续验收更新：简单/专业配置统一已在当前工作台接回素材、分镜历史与细化，完整生产浏览器回归 14 项通过，VAL-016 已完成；见[配置交付](2026-10-13-image-configuration-simple-professional-delivery.md)。下文原轮次验证保留为历史记录，VAL-015 真实生图仍未验证。

## 结果

四阶段代码已实施，真实生图验收尚未完成。保留现有工作流、用途默认绑定、任务历史及用户已有工作区修改；未提交或推送代码，未启动连接真实数据库的新服务。

### 角色与设定

- 素材 recipe 改用统一 V1/V2 runtime 视觉构建器，不再丢失 V2 `baseText`。活动角色导入继承 V2 默认服装，显式空服装表示清空。
- 通用准备接受本地角色 ID、草稿修订和笔记 ID；服务端读取权威数据，记录来源/版本/哈希。头像绑定当前角色；创作中心可选择画面角色及世界观资料。
- 活动优化器读取已采用企划的 `activity.planningBasis.knowledge`，复用冻结引用；旧数据回落到企划快照。
- 提交检查准备记录的应用、工作流、配置和 contextHash；角色、设定、LoRA 变化后拒绝旧准备。上下文哈希进入任务幂等身份，准备记录关联生成调用。
- lore 复用既有引用预算和 canon/未确认资料区分，不自动注入全笔记库。来源选择与生成草稿一起恢复。

### 提示词与 LoRA
 JSON 协议、actorId 集合校验、作用域裁决与诊断；prose 使用自然英文，不支持 prose + knowledge 的策略组合明确失败。
- 通用准备执行 keyword/hybrid，记录知识版本、命中、删词与降级。用 avatar/standalone 限定
- AI 调用受请求 `ai` 和工作流策略 `enabled` 共同控制；`manualFinal` 独立表达最终文本，不做自动补词/后缀/触发词追加。旧 `ai=false` 请求保持原文行为。
- 选角 tags 模式复用活动词表用途。
- 活动、头像和选角创作复用 LoRA 合并/冻结；路径统一为模型目录相对路径，全局 < 角色 < 镜头覆盖，多角色冲突明确拒绝。实际原生请求在调用 LLM 前校验动态插入点及 LoRA 工作流依赖。

### 邻舍公共图片托管

- 版本 1 的 `managedImage` 只携带有限业务字段和 LoRA，不接受任意工作流/引擎执行授权。
- 邻舍投影保留模型加载器、普通采样参数、LoRA、触发词和显式空负面词；无标题负面编码器可沿采样器输入查找。
- 本项目按已授权用途映射语义键；最终文本工作流可合并 artist/quality/trigger。不能消费的参数或 LoRA 插入能力明确拒绝；不支持的参考图、细化、多采样器、高级采样器和修改文本编码器的 LoRA 图明确拒绝，避免默默变成另一种生成。
- 公共请求有固定逻辑请求键；外层不重发已接收或结果未知的请求。公共任务进度转发到邻舍。
- 邻舍补丁保存在当前 `lark` 分支的 4 个文件中，HEAD 仍为 `6b4c2e5`，未创建子模块提交或推进父项目指针。交付或提交时必须单独保存这些子模块改动。

### 执行与知识治理

- 直连新增带鉴权头的 WebSocket 观察器，经 generation events/SSE 发布真实采样步数；过滤任务身份、坏帧与重复事件，断连有限重连，history/产物仍负责最终状态。
- 在异步凭据读取前预留 poller，防止重复执行；任务结束关闭 socket，原取消、恢复、结果未知保护不变。
- hybrid 使用配置的向量 profile；按 profile 身份和词表哈希判断索引就绪，向量 ID/metadata 带版本，过滤旧版本和外来结果，用 RRF 融合。
- 后台在没有活跃生图任务时每分钟检查已选 hybrid 的策略，12 条一批增量索引；批次成功后推进游标。未就绪、2.5 秒超时或服务失败回落 keyword，连续失败进入 5 分钟冷却。关闭服务停止索引并等待当前批次退出。
- 离线生成脚本增加 `--check`，核对邻舍来源 commit 和快照字节，不写文件；上游变化要求显式审查。

## 数据与运行

- 新迁移 **52** 扩展知识模式约束，重建策略表并原样复制历史修订。临时版本 51 数据库升级、旧记录保留、integrity/外键检查通过。
- **真实用户数据库未迁移**。启用代码前按现有 `db:check → db:backup → db:migrate → db:check → db:integrity` 流程处理；启动新服务会应用待执行迁移。
- 新增服务端直接依赖 `ws` 和声明包 `@types/ws`。没有运行破坏性 dependency audit fix。
- 实际 ComfyUI 软件、模型和自定义节点没有升级：本机默认 `127.0.0.1:8188` 只读预检离线，无法确定兼容版本或验证真实图片。

## 验证

| 检查 | 结果 |
| --- | --- |
| 受影响服务联合回归 | 157 项通过；随后新增一项结构化角色协议用例，准备模块最终 12 项通过；最新进度/索引 3 项通过 |
| 共享契约 | 最终 41 项通过，覆盖本地上下文引用和拒绝任意执行授权 |
| 邻舍 `publicImageManaged.test.js` | 8 项通过，包含外层接受后查询失败只提交一次 |
| 类型检查 | 所有工作区通过 |
| 新核心模块定向 ESLint | 通过 |
| 服务构建 | 通过 |
| 离线词表 `--check` | 通过，141 条/1962 标签，来源版本与哈希不变 |
| 受影响浏览器行为 | 最终当前可达用例 9 项通过（明确排除下述两项未接回的活动入口）；覆盖头像草稿、手动最终词、手机恢复、来源恢复、配置切换与隔离真实准备 API；来源测试覆盖 390/1024/1440/1920 |
| 视觉查看 | 四视口 Retina 截图通过；实际查看手机与桌面截图，新增来源区域无横向溢出，控制与文案可达 |
| 全套 ComfyUI E2E 初跑 | 7 通过/3 失败：头像旧按钮名修复并通过；另两项仍等待「素材制作」「绘制设置」。复核当前 StudioShell 后确认素材 ImageWorkbench、分镜 BeatRenderWorkbench 未挂载，分镜历史/细化入口缺失，移动端为只读速览；不是仅替换测试按钮名称即可恢复覆盖 |
| 真实 ComfyUI 预检 | 文本/细化均 `reachable=false`，没有提交真实或付费任务 |

隔离浏览器服务已由 Playwright 关闭。真实图片三模式对照、在线 LoRA/参考图/细化验收和 ComfyUI 软件版本变更列为 VAL-015；活动工作台能力接回与浏览器用例适配列为 VAL-016。不能用 Mock 产物宣称真实画质已通过。

收尾复核：准备/进度/索引/邻舍契约联合 17 项、共享契约 41 项、邻舍托管 8 项和所有工作区类型检查通过。当前可达浏览器验证命令为 `npm run test:e2e:comfy -- --grep-invert "activity drawing|scene and comic"`，两项排除用例保持原样，不作删除或跳过标记。默认实例 `/system_stats` 只读探测仍为 `ECONNREFUSED`。本次相关文件差异格式检查通过；全工作区另有用户已有 Python 测试尾随空格，未修改。

已知实现边界：向量索引游标保存在进程内，进程重启会幂等重建该数据集；按版本隔离过滤旧索引，不删除邻舍或其他数据集向量。公共托管不支持的复杂图明确失败，需另行配置对应用途协议后才能启用。浏览器 dev 模式刷新仍记录 details 的 hydration 警告，行为测试通过，未据此宣称生产构建视觉全部无警告。

## 主要文件

- [image-context.ts](../../../apps/service/src/generation/image-context.ts)：权威来源与提交校验。
- [image-preparation.ts](../../../apps/service/src/generation/image-preparation.ts)：通用准备、策略与诊断。
- [managed-image.ts](../../../apps/service/src/generation/managed-image.ts)：公共托管语义投影与能力拒绝。
- [comfy-progress.ts](../../../apps/service/src/generation/comfy-progress.ts)：直连进度观察。
- [image-knowledge-index.ts](../../../apps/service/src/generation/image-knowledge-index.ts)：hybrid 与索引治理。
- [image-generation.ts](../../../packages/contracts/src/image-generation.ts)：跨层契约。
- [image-generation-panel.tsx](../../../app/features/generation/components/image-generation-panel.tsx)：角色/lore 选择、草稿与诊断。

详细计划与阶段日志按仓库规则保留在本地 `plans/`、`logs/`；本交付记录位于可跟踪的 `reviews/`，便于后续审查与保存。
