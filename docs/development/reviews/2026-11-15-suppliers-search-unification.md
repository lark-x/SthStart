# 供应商、多类型模型与联网搜索统一

日期：2026-11-15。工作区：`F:/Project/SthStart`。保留当前工作树原有修改，未提交或推送；已按用户要求随当前工作树部署至本地 9320。本文同时记录完整实施计划和最终交付证据。

## 目标与实施计划

| 阶段 | 工作 | 验收条件 |
| --- | --- | --- |
| 1. 还原供应商入口 | 将供应商作为主列表，不再只根据已选模型显示分组；连接与选模型分成两个动作。 | 零模型供应商仍可见；保存、刷新后可编辑原连接并继续添加模型，不重新输入密钥。 |
| 2. 统一模型用途 | 同一连接下添加文本/看图、向量计算、绘图模型；统一契约、数据库类型和运行解析。 | 三类均能保存、刷新和按类型调用；向量/绘图不进入文本路由，显式错误选择不误用默认服务。 |
| 3. 简化扩展服务 | 默认只显示联网搜索、资料连接；应用令牌与工具诊断折叠。 | 用户能看出功能用途；普通设置不要求手填内部 ID，不展示大段权限和工具名。 |
| 4. 增加免费搜索 | 保留 Tavily，新增 AnySearch 和 Exa；独立密钥、匿名模式、显式保存、测试和试搜。 | 旧配置兼容；切换不清除原密钥，也不将未保存密钥带到其他服务；禁用时不调用上游。 |
| 5. 接通真实执行路径 | 向量走已有网关；绘图模型可创建工作流方案，沿用任务、用途绑定和产物生命周期。 | 创建方案不生成图片；调用复用连接凭据、请求头、参数与超时；已有引用阻止破坏性修改。 |
| 6. 回归与交付 | 临时旧库迁移、相关服务/契约/页面检查、双浏览器、多尺寸及深色外观。 | 相关检查通过，说明真实外部调用和部署边界，不修改真实用户配置做测试。 |

## 已实现行为

模型页先显示「供应商与模型」，再显示常用模型。每个供应商一直保留「添加模型」入口，可获取目录、多选、筛选和手动加入 ID。部分保存失败保留失败项与原因，成功项不重复提交。密钥留空保留原值；首次保存遇到凭据库警告也保留已生成的供应商 ID。

模型采用 `chat|embedding|image` 类型，文本模型可额外标记看图。旧 OpenAI 文本/图片连接均可承载这三种用途；本地向量服务只承载向量，ComfyUI/Worker 使用生成工作流。未知类型、无效参数和不兼容协议在服务端拒绝。既有连接与模型 ID 不自动合并。

绘图模型菜单可创建文生图或参考图方案，之后在「生成方案」绑定用途。任务执行复用供应商地址、密钥、请求头、额外参数；模型超时优先，连接超时兜底。创建方案本身不提交图片任务。文本/向量测试与绘图创建方案分别命名，避免误触计费生成。

扩展服务默认只展示「联网搜索」「资料连接」。原应用权限与令牌列表收进「应用访问授权（高级）」；MCP 工具、数量和凭据诊断收进「连接详情」。移除该页重复的向量/绘图 Provider 表单。

搜索支持 AnySearch 匿名或密钥、Exa、Tavily。三家配置分别保存，切换清空未保存输入。测试和搜索使用已保存设置，切换后需保存才生效。每次请求使用同一份供应商与密钥配置，不自动跨服务降级。上游错误只返回安全信息；AnySearch 402 错误正文可能含自动生成凭据，因此不读取或回传该正文。

## 免费方案及接口依据

2026-11-15 核对官方资料：

| 服务 | 免费方式 | 约束 |
| --- | --- | --- |
| AnySearch | 每天 1,000 次，最高 10 QPS，可匿名 | 按客户端 IP 计量；搜索成功且非空计一次，正文有效内容计一次，北京时间每日 08:00 重置。 |
| Exa | 每月 10 美元免费额度，另有 10 美元开户奖励 | 需要 API Key，官方标注无需支付方式，额度不是固定调用次数。 |
| Tavily | 每月 1,000 API credits | 需要 API Key，无需信用卡，不同接口用量不同。 |

来源：[AnySearch 价格](https://www.anysearch.com/pricing)、[AnySearch 鉴权](https://www.anysearch.com/docs/auth)、[Exa 价格](https://exa.ai/pricing)、[Tavily 价格](https://www.tavily.com/pricing)。

AnySearch 适配 `POST /v1/search` 的 `query/max_results` 与 `data.results`，正文使用 `/v1/extract` 的 `url` 与 `data.content`，检查 `code: 0` 及返回网址对应关系。Exa 使用 `/search`、`/contents` 和 `x-api-key`，超长网址保留摘要，正文必须匹配原网址。正文失败逐项保留原因。

接口文档：[AnySearch 搜索](https://www.anysearch.com/docs/api-endpoints/v1-search)、[AnySearch 正文](https://www.anysearch.com/docs/api-endpoints/v1-extract)、[Exa 搜索](https://exa.ai/docs/reference/search)、[Exa 正文](https://exa.ai/docs/reference/get-contents)。

## 数据与兼容

迁移 61 增加模型类型、生成引擎的连接引用；旧字段和绑定保留。迁移测试使用内存旧库比较每个原有字段、外键及完整性。旧 `/admin/profiles` 入口同步时明确写入模型类型，避免 vector/image 被默认成 chat。旧 `vision` 能力输入归一为 `multimodal`；旧 Tavily 请求及配置继续有效。

本次部署同时包含工作树内已验收的迁移 62 与页面修改。部署前保存了容器快照镜像 `sthstart:rollback-2026-11-15-pre-suppliers-search`（`f50bd5cff891`），并用项目备份工具生成 `data/backups/2026-11-15-before-suppliers-search-deploy/`；备份主库 schema60、叙事库 schema2，两个库 `integrity_check=ok`，主库 SHA-256 为 `f2b383f39796…a879`，叙事库为 `5c16492e5985…c694`。部署后主库 schema62、叙事库 schema2，`db:check` 与 `db:integrity` 均通过，外键 0 违规；应用 9、供应商 6、模型 1、路由 2、生成引擎 2 的部署前基数保持不变，唯一的既有模型正确投影为 `chat`。

## 验证与边界

最终验证：

- 服务回归 19 个文件、126/126 项通过：其中主体 15 文件 103 项，调用适配补充 4 文件 23 项；覆盖旧库升级、连接模型、引用保护、公共路由、状态、向量、绘图、搜索与旧入口兼容。
- 共享契约 62/62 项、模型设置辅助逻辑 8/8 项通过。
- 根项目及全部工作区类型检查、门户/服务构建、改动文件 ESLint 通过。架构检查 665 文件、2790 条本地依赖，0 违规、0 过期例外。
- Chromium 与 WebKit 最终 10/10 场景通过。包括零模型供应商、重复进入添加、三种模型用途、刷新、常用模型与应用例外、搜索显式保存及切换、密钥写入失败重试、供应商列表失败、停用供应商手动添加、删除受引用时的原因提示。
- 最后一处首次加载状态收敛后，重新构建门户并单独复跑列表失败/密钥重试，双浏览器 2/2 通过，不重复累计场景数；日志 `artifacts/model-settings-retry-e2e-final.log`。
- 布局覆盖 1920、1440、1024、390px，高分屏截图及手机深色。截图保存到 `artifacts/visual-verification/suppliers-search/`；主代理实际查看桌面模型、平板扩展服务、手机添加弹窗及深色页面，未见横向溢出或操作裁切。

浏览器使用生产构建、临时业务库和受控目录/搜索响应，禁用 Service Worker 以保证拦截不绕过。修复了跨浏览器共享测试数据的初始状态、重名选择器、通知遮挡和刷新后 URL 自动恢复抽屉的测试流程；最终结果不包含中途失败次数。

审查后补修：密钥写入失败保留输入及原供应商 ID；首次加载和失败重试不误显示创建空态；后续保存刷新不重建弹窗；停用供应商仍可手动加入模型并显示真实停用状态；删除受阻展示服务端原因；刷新失败向调用方报告，避免误关对话框。

AnySearch 有限匿名实测：仅发送 1 次搜索请求，HTTP 200，约 3.43 秒，返回 2 条有效结果；没有命中期望的 TypeScript 官方文档范围，因此没有扩大搜索或提取其他网页。真实正文提取仍未验证；未使用用户配置或密钥，未改真实库，未调用 Exa/Tavily。

日志：`artifacts/model-settings-e2e-final.log`、`artifacts/model-settings-typecheck-final.log`、`artifacts/model-settings-build-final.log`、`artifacts/model-settings-build-portal-final.log`、`artifacts/model-settings-contracts-final.log`、`artifacts/model-settings-ui-tests-final.log`；服务详细报告位于 `artifacts/testing/model-settings-final/` 和 `artifacts/testing/model-settings-runtime-final/`。

部署后检查 9320：容器 `healthy`，Portal 与 `/api/v1/health` 均为 200；真实页面标题为“模型与公共服务 — SthStart”，显示 6 个供应商、1 个模型，扩展页“联网搜索”可达，浏览器控制台无错误。1440px 与 390px 实际页面截图分别保存在 `artifacts/deploy-20261115-live-desktop.png` 和 `artifacts/deploy-20261115-live-mobile.png`，主代理已查看。部署日志为 `artifacts/deploy-20261115-deploy.log`，构建日志为 `artifacts/deploy-20261115-build.log`。测试结束后 4200/4273 的监听已释放。

真实供应商的文本、向量与付费绘图未调用；不会把模拟响应通过称为真实供应商验收。Exa/Tavily 的实际账户额度、外网连接和检索质量仍以用户账户为准。Windows 上自动化 WebKit 不等同于 macOS Safari 或手机真机验收。
