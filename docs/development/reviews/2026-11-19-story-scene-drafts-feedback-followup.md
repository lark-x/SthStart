# 一幕故事构图与资料检索问题修复

## 修复内容

- 画面设计将七个构图字段合并到「构图说明」多行输入框。输入仍使用七个标签段落，保存时映射回既有字段，图片提示词和版本记录继续沿用原有数据结构。
- 资料检索保留没有行号摘要的语义搜索结果供精读，优先处理角色正文命中和角色名相关标题。精读后过滤未找到正文提示、目录表格、元数据行和只有简介或描述的索引卡。实际正文仍按读取行段生成出处。

## 验证

- `node --import tsx/esm --test apps/service/src/story-scene-drafts/text.test.ts`：13 项通过，覆盖新版和旧版 MCP、缺少搜索摘要、索引卡过滤以及行段证据校验。
- `npm.cmd run typecheck`、`npm.cmd run build:portal`、`npm.cmd run build:service` 和 `npm.cmd run check:architecture` 均通过。架构检查结果为 711 个文件、3097 条本地依赖边、0 项违规。
- 隔离 Playwright Chromium 的构图场景通过。390px 和 1440px 截图显示单一构图输入框、标签可读且无横向溢出，测试中的图片任务使用模拟供应商。
- 截图保存在 `test-results/story-scene-drafts-窄屏精读出处、输入法与长对话、写稿、构图确认、丢失响应后恢复图片/`。

## 本地部署

- 部署前数据库备份位于容器 `/app/data/backups/pre-story-scene-drafts-feedback-20261119-1256`，含 `sthstart.db`、`narrative.db` 和 `media-manifest.json`。
- 运行时发布快照为 `artifacts/story-scene-drafts-release/final-release-20261119-124953`，发布清单包含 4184 个文件。部署后容器文件 SHA-256 全部与清单一致，`sthstart` 容器健康。
- 业务数据库版本为 66，叙事数据库版本为 2。两个数据库完整性检查通过，外键违规数均为 0。
- 作品目录、新建一幕、温妮莎样例草稿和其草稿读取 API 均返回 HTTP 200。样例 API 返回 5 条原作来源，联想状态为 ready，构图方案仍保留七个后端字段。

## 验收边界

生产样例仅进行了读取核验，本次没有再次触发生产资料搜索、草稿改写或图片生成。资料筛选变化由 MCP 夹具测试和隔离环境验证。温妮莎候选内容、故事表现与已有代表图仍需作者确认。
