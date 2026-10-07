# 真实数据库修复与全量验收（2026-10-04）

## 结论

**真实数据库异常已修复并成功重启部署；本报告所列技术检查通过，不代表目标成片的视觉质量通过。** 全站 17 个路由、剧情→发布入口、原活动真实生图、类型检查、契约 37/37、门户 18/18、服务 633/633 与制作台靶向 18/18 的当轮结果如下。原活动出图不能替代新发布模式的完整验收。

后续真实 DSH → 六镜头方案 → ComfyUI → Step TTS → Docker 视频/发布包验收见 `story-publication-production-acceptance-2026-10-04.md`。技术链路通过，但上下留边、物体特写和人物动作仍不达标，不能宣称「全部内容验收通过」。

## 异常原因

`data/sthstart.db` 被破坏：文件头声明 3593 页，但表 btree 引用了远超出文件末尾的页（最高到 3835）。`activity_prompt_optimization_runs`、`activity_comic_drafts` 等表的页被截断，导致 `btreeInitPage() returns error code 11`，服务启动时的迁移与完整性校验直接失败并 crash-loop。

这是「较旧的数据库文件覆盖到较新文件上」的典型特征：内容页物理丢失，主要索引残留。逐表核验显示 `activities` 等核心表的更新行已不可读，19 条只在损坏库中存在的活动是自动生成的「邻舍对齐验收」测试数据。

## 修复过程

1. 停止容器，避免写入继续扩大损坏。
2. 将损坏文件（含 WAL/SHM）完整冻结到 `artifacts/db-recovery-20261004-100824/_corrupt-backup-20261004-093034/`，可回溯。
3. 逐一核验全部 32 个备份目录，确认均为健康快照，选择最新的 `data/backups/2026-10-03T07-11-28.124Z`（迁移 48）作为恢复源。
4. `npm run db:restore -- <备份> --confirm`，随后 `db:migrate` 升到迁移 50。
5. 校验 `db:check` 版本 50、`db:integrity` 两库 ok、`PRAGMA integrity_check` ok、`foreign_key_check` 0 违规。
6. 补回被回滚的配置：从损坏库中读取出仅存在于其中的用户配置并重新写入——服务连接 `conn-mut24bmg`（stepaudio）、3 个模型档案、3 个 provider profile 及选项；Anima 工作流族改用受支持的 `scripts/activity-image-parity-config.ts --apply --confirm` 重新注册。
7. 重建镜像补齐 `@deepseek-ai/dsh` 运行依赖（`docker compose up -d --build`），再执行标准 `npm run deploy:docker`。

恢复后的数据与配置：12 个活动（与备份一致）、2 个剧情项目、9 个剧情文档、35 条条目修订、120 个角色档案、4 个 persona、5 个工作流、10 个预设、4 个服务连接。

## 验收证据

| 检查 | 结果 |
| --- | --- |
| `npm run deploy:docker` | 构建、同步、重启成功，容器健康 |
| 容器状态 | `Up (healthy)`，重启后数据保留（重启前后均为 13 个活动，含当轮测试件） |
| 全路由浏览器验收 | 17/17 路由返回 200，0 页面错误 |
| 内容模块核对 | 活动/剧情/角色/生成/服务/归档/调用/制作/漫画逐项通过 |
| 剧情→发布入口 | “制作作品”弹窗显示章节冻结，可进入制作台 |
| 发布工作台 | 三步导航正常，桌面与 390×844 无横向溢出，0 页面错误 |
| 真实端到端生图 | 提示词优化→ComfyUI 出图→自动入镜→调用日志一致，`result=passed` |
| `npm run typecheck` | 通过 |
| `npm run test:contracts` | 37/37 |
| `npm run test:portal` | 18/18 |
| `npm run test --workspace @sthstart/service` | 633/633 |
| 制作台靶向测试 | 18/18 |

## 遗留与说明

- 归档表中约 180 条记录标记为 `missing`，这是历史状态而非本次恢复造成：备份本身不含媒体二进制，磁盘上现有 24 个文件，与备份记录一致。这些记录在界面中明确显示“文件不可用”，不会误解为可用画面。
- 活动文本模型默认绑定为 `ds-jy`（deepseek-flash），该上游当前返回 HTTP 402 余额不足；验收时将活动文本角色临时切换到可用的 step 模型并保留该绑定。
- 未进行平台自动上传；这部分本就不属于交付范围。

## 相关产物

- 全路由验收：`artifacts/all-routes-acceptance/2026-10-04T03-23-05.805Z/`
- 内容验收：`artifacts/content-acceptance/2026-10-04T02-58-55.011Z/content-acceptance.json`
- 发布入口验收：`artifacts/publication-entry-acceptance/2026-10-04T03-31-30.602Z/`
- 发布工作台验收：`artifacts/publication-workstation-acceptance/2026-10-04T06-31-13.149Z/`
- 端到端生图：`artifacts/activity-studio-abc/real-sample-2026-10-04T06-41-32/`
- 恢复前备份与冻结的损坏库：`artifacts/db-recovery-20261004-100824/`
