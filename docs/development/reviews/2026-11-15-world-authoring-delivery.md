# 故事世界简化配置与 AI 填充交付验收

日期：2026-11-15；执行范围：本地 `F:/Project/SthStart` 与既有 9320 服务。未提交或推送远端，保留原工作区修改。

## 交付范围

- 独立创建、编辑页，四个日常区域；详细人物、地点、模型、时间和参考图按需展开。
- 角色已发布版本、知识资料、笔记、叙事档案、项目与网页的统一资源选择；版本更新需完整比较，已删除、解绑人物不能被旧候选复活，同 URL 的不同来源族不互相覆盖。
- Tavily 服务端配置、状态、连接测试、Search/Extract、快照与显式另存资料库。默认关闭，不返回密钥，不自动换供应商。
- 真实模型的设定候选、出处、依赖、逐项确认、草稿变化核对、字段级撤销；候选默认不选中，未选不写入。
- 草稿独立基准、403 invalid_csrf 单次恢复、世界与初始主线原子幂等创建、分支修订校验、项目绑定比较交换、独立历史分页采纳与章节制作入口。
- 跨应用实际发送的参考图采用 24h 新授权与提交租约；失败不会撤销并发使用的授权。单实例启动清理崩溃遗留租约，恢复已落库任务、释放无任务预约预算，不自动重复付费。

共享接口和数据语义由主代理统筹；开发使用 `auto/deepseek-v4.1-flash`、max 子智能体。主代理阅读关键服务和前端实现、独立运行检查、阅读真实模型内容并查看截图，不以子任务报告代替验收。

## 实际检查证据

| 检查 | 结果与证据 |
| --- | --- |
| 全量回归 | 264 个测试文件全部通过；`artifacts/testing/1794679467096-56384/report.md`、`artifacts/world-authoring-regression-final.log`。后续最后修复另有定向回归。 |
| 共享契约 | 57 项通过；`artifacts/world-authoring-contracts-delivery.log`。 |
| 配置、会话、资源、AI 最终定向 | 133 项通过；`artifacts/world-authoring-targeted-last.log`。 |
| 媒体授权、并发、恢复及服务路由 | 43 项通过；`artifacts/world-authoring-image-grants-delivery.log`，使用临时数据库和受控上游。 |
| 类型与架构 | `artifacts/world-authoring-typecheck-delivery.log`、`artifacts/world-authoring-architecture-delivery.log`；646 文件、2692 条本地依赖、0 违规、0 过期例外。 |
| 构建 | 完整构建通过；最后门户产物 `artifacts/world-authoring-build-portal-last.log`，最后服务构建包含启动恢复。 |
| 定向 lint | 0 错误，媒体原生 img 两条性能建议保留；`artifacts/world-authoring-lint-delivery.log`。既有旧测试 any 债务不纳入本次修复。 |
| 旧浏览器流程 | 9/9 通过；`artifacts/visual-verification/world-authoring/story-worlds-legacy-run.log`；包含运行、历史采纳、正文编辑保存及制作衔接。 |
| 新浏览器流程 | 最终 16/16 通过（36 秒）；`artifacts/visual-verification/world-authoring/world-authoring-run-final.log`。真实浏览器发现分侧保存缓存未同步、完整分支响应元数据混入草稿两项缺陷，均已修根因并增加回归；覆盖世界→分支、分支→世界及再次连续保存，无旧修订冲突或草稿结构错误。 |
| 数据迁移 | 新增 59，不修改已应用迁移；临时 v58 数据库升级测试验证世界、历史分支、事件、人物状态保留及 integrity/foreign_key_check。 |

全部测试业务写入在隔离库进行，不向真实库添加验收世界或章节。

## 真实模型内容验收

使用只读现有配置与安全凭据，复制必要模型配置到临时库；不复制业务正文，不迁移真实库。模型为已配置的 `chatflowsai/gpt-6.1-sol`，用途继承故事世界文本模型，没有替换供应商或用途绑定。

- 首次调用发现真实模型对非实体候选输出 `entityId: null`，严格结构校验拒绝。修复仅将可选空 entityId 规范为省略，非法数值、身份、媒体和引用仍严格检查，并补回归；没有自动付费重试。
- 修复后人工主动再次调用成功，单次约 22 秒，返回 2 条中文候选，审计仅 1 条，3283 tokens；`artifacts/testing/world-authoring-live-delivery-2.json`。
- 主代理实际阅读摘要、方向、note 和 gaps：封航港口、钟楼、潮汐表与守望者来自明确选中的验收资料；异常钟声、冰下水道、失踪船信号灯明确标为原创，未伪称原作事实；故事方向围绕救援与共同查证，和摘要相符。引用 ID 有效，方向对摘要的候选依赖正确，无伪造角色库绑定或媒体。
- 本样本内容验收通过，不等于长期剧情或任意原作人物一致性全面合格。

## 视觉与交互

主代理查看 `artifacts/visual-verification/world-authoring/` 下的 1440、390、暖夜、冲突比较和人物版本升级截图。另有 1920、1024 实际截图及无横向溢出检查。小屏单栏、详细资料折叠、主要保存与候选操作可达。去除 AI 模型用途的重复说明。

隔离浏览器覆盖默认不选、部分采纳/撤销、候选依赖取消、版本保护、资料部分读取失败、409 完整比较、响应丢失后同幂等键重试。中文输入法与键盘行为以现有事件防护及测试为证，不声称经过所有原生输入法人工打字验证。

## 外部条件与未完成门槛

真实 Tavily 凭据当前缺失，环境变量和安全凭据库均未配置。已验证受控 Search/Extract 响应、单项失败及错误提示，但 **真实联网搜索 → 选网页 → AI 引用这次真实网页** 的整链验收尚未通过。不能用 mock 搜索或本次作者资料模型样本替代。需要在公共服务配置有效 Tavily 密钥后补验。

## 部署与回滚

- 已生成 WAL 一致备份：`data/backups/2026-11-15-world-authoring-before/`；部署前再次备份到 `data/backups/2026-11-15-world-authoring-deploy/`。均包含两份数据库与媒体清单，不复制媒体二进制。
- 已保留部署前镜像：`sthstart:rollback-world-authoring-20261115-before`，image id `a40e02748f4010c7e7de793ad1659cb3c49f6b3af57b25019d1515fbb8186a53`。
- 部署前只读检查：schema58，integrity ok，无外键错误；世界、分支、事件、运行均 0；4 个项目、13 篇正文、275 个素材、120 个角色档案、10 个发布版本。证据：`artifacts/world-authoring-production-before.json`。
- 已同步并重启既有容器，9320 健康、服务健康接口 HTTP 200；schema59，integrity ok，无外键错误，前述业务数量完全不变。证据：`artifacts/world-authoring-deploy.log`、`artifacts/world-authoring-production-after.json`、`artifacts/world-authoring-production-health.json`。
- 部署后 1440/390 暖夜下新建世界、故事世界、公共服务共 6 个页面全部通过，只读浏览器请求无业务 mutation，横向溢出均 0；主代理查看桌面、手机及 Tavily 设置实际截图。证据：`artifacts/visual-verification/world-authoring/deploy-9320-smoke.json` 及同目录 `deploy-9320-*.png`。线上 Tavily 明确显示停用、密钥未配置。
- 真实库未写测试世界；隔离浏览器端口 4973/4974/4983/4984 已释放，容器内临时验收代码目录已移除。
- 回滚时使用保留镜像恢复运行代码；若必须回退数据库，先停止服务，核验备份，并按项目恢复工具恢复两库。不能只复制活跃 db 文件，也不能无视部署后新业务内容直接覆盖数据库。
