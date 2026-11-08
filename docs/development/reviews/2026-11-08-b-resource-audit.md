# B 方案资源区审计与稳定排序

状态：本轮代码修改与针对性验证完成，未提交、未部署、未运行完整构建。

## 覆盖范围

- `/apps/calendar`：角色生日与已排期活动日历。
- `/apps/narrative`：原作档案的阅读、检索、研究专题及「数据源与导入」模式。
- `/apps/story?type=reflection`：对话感想入口与感想记录列表。该路由属于 story 文件范围，本轮只读审核，未修改。
- `/apps/resources?view=sources`：资料库统一入口中的数据源页面。
- 媒体库与灵感素材的服务端分页排序。

未修改全局 CSS、contracts、story、activities、creative、settings 或 notebook 文件。

## 稳定排序

### 媒体库

`apps/service/src/media-library.ts` 的候选列表从：

```sql
ORDER BY a.created_at DESC
```

改为：

```sql
ORDER BY a.created_at DESC, a.id DESC
```

这样相同 `created_at` 的产物在 `limit/offset` 分页间保持确定顺序。新增测试用四条同一时间记录逐页读取，验证顺序为 ID 降序且不重复。

### 灵感素材

`apps/service/src/topics/store.ts` 的列表排序改为：

```sql
ORDER BY last_seen_at DESC, created_at DESC, id DESC
```

新增 `apps/service/src/topics-pagination.test.ts`，先将五条话题的时间戳强制设为完全相同，再逐页读取，验证全量顺序与单条分页顺序一致、无重复。

## 页面审计与修复

### 资料库嵌入与分页历史

- `TopicLibraryView embedded` 现在使用 `topic_*` 命名空间，例如 `topic_page`、`topic_q`、`topic_view`；切换素材页码不会再删除或覆写外层 `resources?view=inspiration`。
- 资料库外层标签切换改为读取浏览器当前地址，避免 Next 尚未同步的原生分页历史导致 `topic_*` 状态被旧查询串覆盖。
- `/apps/inspiration` 主入口继续读取原有不带前缀的 `q`、`view`、`page`、`pageSize` 参数，旧链接保持兼容。
- 素材、角色和媒体库翻页改为实际 `history.pushState`。搜索、筛选和页容量变化仍使用 replace，避免每个字符制造历史记录；浏览器后退可以回到上一页并恢复外层资料库视图。
- 灵感选择器同样对自身 `ip_*` 分页参数 push 历史。
- 素材库、灵感选择器、角色搜索、媒体搜索、日历搜索和原作检索在输入法 `compositionstart` 至 `compositionend` 之间只更新输入框，不触发查询；合成结束后再提交搜索。

### 角色日历

- 修复切换月份后选中日期仍停留在旧月份的问题。现在保留原日号；若新月份没有该日，则收至月末。例如 1 月 31 日切到 2 月得到 2 月 28 日，闰年得到 2 月 29 日。
- 搜索增加 250ms 防抖，避免中文输入法组合期间逐键请求。
- 作品筛选读取失败时显示错误，不再把空列表伪装成「没有作品」；加载期间禁用作品下拉框。
- 将「仅显示收藏角色的生日」修正为「仅显示收藏角色相关的事件」，与服务端同时筛选生日和活动参与角色的行为一致。
- 既有月份切换、今天、日期选择、生日多选、创建活动和活动详情入口保留。

### 原作档案

- 当前作品与剧情节点现在写入 `work`、`node` URL 参数。刷新、浏览器前进后退和从检索结果跳转后可以恢复阅读位置。
- 原文检索失败时显示错误与重试，不再伪装成「未找到相关原文片段」。
- 数据源连接器读取失败时显示错误与重试；加载中和没有连接器分别有明确提示，本地 JSON 导入不受影响。
- 既有阅读、检索、概念图、研究专题、导入预览与提交流程未改动。

### 对话感想

- 只读确认资料库入口 `/apps/story?type=reflection` 与 story 页面 URL 类型筛选一致。
- 只读确认感想列表具备加载骨架、错误重试、空态、新建感想和项目详情入口。
- 未修改 story 文件；本页仍需要浏览器和真实数据验证。

### 数据源

- 修复资料源启停接口未检查 HTTP 响应的问题。失败响应现在会抛错并显示失败提示，不会再错误提示「已启用/已停用」。
- 新建或编辑资料源时清除上一次保存失败提示，避免旧错误出现在新表单。
- 启停与删除请求期间显示禁用状态并防止重复操作。
- 既有新增、编辑、密钥不回传、连接测试、工具发现、启停和删除流程保留。

## 验证结果

### 最终浏览器资源验收文件

新增 `artifacts/visual-verification/workspace-b/resources.spec.ts`，使用主代理统一的 `4473` Portal、`4400` Service 和临时隔离数据库，不启动独立 webServer：

- 角色：API 造 25 条，覆盖分页、收藏筛选、无结果和一次失败重试。
- 媒体：受控网络 fixture 提供 55 条，覆盖分页、容量、类型筛选、无结果和失败重试；不触发生成任务。
- 素材：受控网络 fixture 提供 45 条，覆盖 `topic_*` 嵌入分页、`view=inspiration` 冲突回归、收藏筛选、无结果、失败重试和主入口原参数兼容；不触发 MCP 搜集。
- 日历：验证月份切换时选中日期在目标月内，以及「今天」恢复。
- 数据源：模拟保存失败，验证输入值保留；未测试真实外部连接。
- 原作档案：验证阅读、研究专题、数据源与导入标签切换及 URL 模式。

当前 workspace-b config 的 `testMatch` 尚未包含该文件；将 `resources.spec.ts` 加入后可直接运行。使用临时 config 覆盖 `testMatch` 的 `--list` 已确认识别 6 个测试。

| 检查 | 结果 |
| --- | --- |
| `node --import tsx/esm --test apps/service/src/topics-pagination.test.ts` | 1 通过 |
| `node --import tsx/esm --test apps/service/src/media-library.test.ts` | 5 通过 |
| `node --import tsx/esm --test apps/service/src/topics.test.ts` | 18 通过 |
| `node --import tsx/esm --test apps/service/src/calendar-planning.test.ts` | 3 通过 |
| `node --import tsx/esm --test app/features/calendar/calendar-state.test.ts` | 2 通过 |
| `node --import tsx/esm --test apps/service/src/narrative.test.ts` | 5 通过 |
| `node --import tsx/esm --test apps/service/src/mcp.test.ts` | 2 通过 |
| URL / 日历纯函数测试（角色、媒体、素材、日历） | 13 通过 |
| 隔离服务 + Chromium | 25 条素材验证嵌入分页、浏览器后退、IME 合成与主入口兼容参数通过 |
| 目标文件 ESLint | 0 错误，1 个既有 `<img>` 警告 |
| 排除 `artifacts/` 后的 `tsc --noEmit` | 通过 |

实际浏览器验证使用现有开发 Portal 与临时服务/临时 SQLite 数据库：`/apps/resources?view=inspiration` 翻到第 2 页后 URL 为 `?view=inspiration&topic_page=2`，`history.length` 增加；后退恢复第 1 页且 `view=inspiration` 未丢失。中文合成过程中未产生 `/api/admin/topics` 请求，提交后产生搜索请求。`/apps/inspiration?q=历史&page=2` 保持无前缀参数。临时数据库和生成文件已清理，未使用正式数据。

## 未验证与剩余风险

- 除上述素材嵌入分页与 IME 场景外，未做全页面浏览器回归；日历、角色、媒体、原作档案、感想和数据源的视觉布局、错误提示位置及移动端仍需后续浏览器验收。
- 未运行完整构建、Docker 部署或生产数据检查。
- 根目录 `npx tsc --noEmit` 被无关文件 `artifacts/visual-verification/workspace-b/flows.spec.ts` 的语法错误阻断；排除 `artifacts/` 后本轮涉及代码的类型检查通过。该文件不属于本轮范围。
- 日历的月份、搜索和筛选尚未写入 URL；本轮修复了可见行为问题，没有扩展为 URL 持久化。
- 感想页面属于 story 所有权范围，本轮没有修改或其运行时验证。
- 数据源连接测试依赖外部 MCP 服务，本轮只验证了本地服务测试和类型/静态检查，没有验证真实网络认证。
- 星铁、原神等外部资料源的内容正确性不在本轮验证范围。

