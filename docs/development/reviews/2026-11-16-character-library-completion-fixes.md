# 角色资料库完成度审计修正与部署验收

2026-11-16；分支 feat/character-library-upstream，保留既有工作树改动，未提交或推送。对应 [审计记录](2026-11-16-character-library-completion-audit.md)。本轮没有使用 computer use；浏览器写操作均为隔离临时数据库与 headless Playwright。子智能体使用 xingchi/gpt-6.1-sol / xhigh，后续并发上限按用户最新要求降为3。

## 修正矩阵

| 目标 | 本轮完成及证据 |
| --- | --- |
| 模型与供应商持续管理 | 原有模型管理修复保留，生产双浏览器16场景再次通过；供应商可重复添加聊天/向量/绘图模型，历史连接设置与部分失败重试保留。 |
| 简洁角色库与详情 | 双视图、触摸收藏、筛选状态与母作品选择；已有档案默认阅读，三Tab，明确编辑范围；320/390/1024/1440/1920布局验证。 |
| 原创阶段可信保存 | 校验/网络失败不再发布旧稿；标签与形态同属编辑会话，携带实际保存修订发布；原创无阶段不能被下游隐式发布或消费草稿。 |
| 同源与作品体系 | 当前AU作为派生源；共享选角覆盖作品、剧情、项目、快速活动、活动与企划；同world_id改名归并旧目录并迁移引用/保留别名；目录与当前世界属性一致。 |
| 形态/皮肤实际消费 | 冻结variants/assets/视觉引用/头像/标签；故事、作品、活动及企划消费同一选择；无图皮肤保留全文，未知上游字段不清空主档案；生图任务记录variantId并应用至对应形态。 |
| 上游原文可靠性 | BWiki真实模板解析、注释剔除、原始JSON与全文snapshot归档；三月七1224/1413识别；崩三读取实际装甲页核对归属；Akasha搜索后分页读取正文。 |
| RP完整性 | 正常化与保存不再把正文截至60k、对白截至30条；模型按18k证据分组，77条琴语音为1块，逐字段核对引用；未知外貌/故事留空并警告。 |
| 邻舍方式A | 静态人设/名字/头像/立绘等写入口保护；原创只推已保存阶段；运行记忆/情绪/日程逐行保留测试；生成图片不可变副本+持久outbox回流shared_assets，独立Comfy配置保持。 |
| 旧入口补齐 | 企划补人设与世界配角入库新增具名阶段确认；上游与多源图片导入保留部分失败警告，成功后防重复。 |

## 验证

- 主代理服务集成20文件 **165/165**，`artifacts/testing/character-completion-integration/report.json`。涵盖旧库63→64、作品、阶段、来源、活动、故事、邻舍、生成上下文与研究。
- 契约 **66/66**；全工作区 `npm run typecheck` 通过；完整 `npm run build` 通过。最后前端文件清理后再次 `npm run build:portal`，以最后产物验收和部署。
- 生产构建 Chromium + WebKit **40/40**：角色编辑10×2、共享选角2×2、模型管理8×2，`artifacts/character-completion-production-e2e.log`。不请求真实模型。
- 原角色新建视觉基线更新并查看Windows Chromium截图，1/1通过；未重写其他操作系统黄金图。
- 邻舍核心authority/真实导入路由/持久outbox/落盘图片测试主代理重跑 **6/6**，网络在测试导入前mock禁止；子代理另完成UI SSR3及相关业务13。
- 前端模型及作品创建、快筛等定向测试由各实现代理完成；架构检查0违规；改动范围ESLint无错误，保留既有img性能建议。
- 主代理查看手机选角、手机详情、更新后的桌面新建基线。所有浏览器写入发生在临时测试库。

## 上游真实证据及限制

`apps/service/src/characters/upstream/fixtures/README.md`与完整响应记录区分真实请求、回放与受控模拟。琴成功样本含8故事/77语音/2衣装完整故事；芽衣6装甲页核对归属；星铁巡猎三月七1224与长夜月1413归组。BWiki存在间歇EdgeOne567，最终默认fetch仍曾受限，不能保证当前每次采集成功。缺服装/故事的装甲明确缺证据，未伪造。Akasha全页、LLM提炼和生图链路为受控验证，没有调用真实付费模型或已配置Akasha服务。数据保存完整不等于每个角色的上游材料全部齐全，也不等于模型最终演绎质量已通过人工验收。

## 部署

- 备份：`data/backups/2026-11-16-before-character-authority/`，包含主库/叙事库一致快照及额外 `linshe-agent.db` 一致备份。媒体未删除，未再次清库。
- 回滚镜像：`sthstart:rollback-20261116-character-authority`，SHA `f345a342f1bdf668b421da3ec7bbe272b04ea5adb679f904ce26410051d168db`。镜像不替代挂载数据库备份。
- `npm run deploy:docker -- --skip-build` 成功，`artifacts/character-completion-deploy.log`。部署脚本新增邻舍agent-core/src、app.js、public同步，并修正按实际文件类型复制；非skip路径亦构建邻舍UI。
- 当前主库64、叙事库2，db:check/db:integrity均ok，容器healthy，service健康200。
- 角色库、新建角色、新建作品、公共服务设置页面及引用脚本HTTP200，`artifacts/character-completion-live-pages.json`。
- Service入口、邻舍app.js与邻舍public/index.html容器/工作树SHA256一致。邻舍子模块SHA仍e4d524e，改动未提交。
- 运行态控制中心显示autoStart=false且邻舍服务stopped；已同步新代码，但未为了验证启动真实聊天/生图。真实运行中邻舍回流和最终模型效果不冒充已验收。

本次将审计发现的代码与交互缺口修至可复验；用户最终的阅读舒适度与实际模型产出质量仍需在真实使用时评价，不以接口和测试数量替代产品体验。
