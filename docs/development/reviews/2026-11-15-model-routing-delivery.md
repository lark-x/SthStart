# 模型设置简化与路由交付记录

日期：2026-11-15

## 结论

`/settings/public-services` 已从五页签收敛为「模型 / 扩展服务」两页签。模型配置按“服务连接 → 模型 → 路由”组织：公共文本与看图各有一条常用模型链，主模型后最多两个备用；应用默认继承，必要时在「应用例外」单独覆盖。模型编辑只保留 modelId、文本/看图能力、上下文、最大输出、思考强度和超时，不再出现温度、top_p 或大段参数说明。

本轮同时修复了两个浮层缺陷：

- Dialog/Drawer 内的 Select 菜单被错误地放进带 transform 和横向滚动的模态内容，导致菜单偏移和右侧裁切；现在 Portal 到 body 直系的浮动根、使用视口坐标，并在滚动/缩放/390px 下重新定位和翻转。
- 右侧 Drawer 固定 28rem，在 390px 视口下左侧内容被裁掉；现改为 `min(28rem, 100vw)`。

## 数据与兼容

- 新增迁移 60：`model_profiles.thinking_level`、`model_profiles.timeout_ms`、`model_routes` 表。
- 迁移把现有 `app_llm_assignments` 逐条种成 app route，不新增公共默认、不改原有应用选择。生产库 9 条历史分配生成 9 条 app route（文本 5、看图 4）。
- 旧 `PUT /api/v1/admin/apps/:appId/llm-assignments` 仍可用，但在同一事务内同步 `model_routes`；新路由保存也同步旧分配投影。删除应用覆盖会同时删除两边记录。
- 调用解析顺序：显式模型 > purpose binding > app route > 较新的旧分配 > 公共路由。主模型失效明确报 `model_route_unavailable`；失效备用跳过。
- 公共文本主模型支持看图时，看图路由沿用同一主模型；否则要求单独选择看图模型。备用链统一去重、最多两个。
- 模型未显式配置温度时不再发送固定 0.7，避免推理模型拒绝采样参数；历史 `extraBody` 中的显式温度仍保留。

## 代码范围

- 契约：`packages/contracts/src/model-routing.ts`、`ModelProfile.thinkingLevel/timeoutMs`。
- 服务：`model-routing.ts`、`model-routes.ts`、`providers.ts`、`llm/common-llm.ts`、`models-routes.ts`、`llm-status.ts`、迁移 60、旧分配同步；删除模型会同时检查路由、旧分配、用途绑定和角色专属绑定。
- 前端：两页签、常用模型卡、应用例外汇总/抽屉、按连接分组的模型库、模型编辑、供应商四步向导、扩展服务页；旧连接/完整模型表折叠为「高级接入管理」。
- 共享 UI：Select 浮动根、overlay-policy inert 豁免、Drawer 视口宽度。

## 验证证据

- `npm run test:contracts`：59/59 通过。
- 定向服务测试：23/23 与最终 LLM 客户端 7/7 通过（路由优先级、迁移 60、旧分配同步、删除引用、fallback 审计、思考强度、超时、温度省略、llm-status）。
- `npm run test:regression`：最终冻结后复跑 269 个测试文件全部通过，0 失败、0 跳过。报告：`artifacts/testing/1794698291743-42664/report.md`。
- 根 `npm run typecheck`、service `tsc` 通过；定向 ESLint 0 errors、0 warnings。
- `npm run check:architecture`：656 files、2750 edges、0 violations。
- `npm run build`：Portal 与 Service 均成功。
- 门户 Playwright：17/17 通过（含新模型向导、常用路由、应用例外及原有工作流回归）；最终构建后受影响用例复跑 2/2 通过。
- Select 浮层 Playwright：3/3 通过；Dialog 菜单左边缘与控件一致、菜单不增加面板 scrollWidth；390px Drawer 菜单右边界 374px。
- 主题与视觉：light-paper/dark-espresso 2/2 通过；模型页视觉用例通过，桌面 1440、手机 390、暖白/暖夜、应用例外抽屉与抽屉内 Select 均有截图。
- 设计令牌/对比度/视口矩阵：11 passed、6 skipped（既有条件跳过），无失败。
- 截图：`artifacts/visual-verification/model-settings/`。

## 部署与回滚

- 部署前备份：`/app/data/backups/2026-11-15-model-routing-before`（`sthstart.db`、`narrative.db`、`media-manifest.json`）。
- 回滚镜像：`sthstart:rollback-model-routing-20261115-before`，image sha `f8f10ed4a70541b8c717971bf85526d11f9c20da7cd093bac8c95e15848f54fd`。
- 部署命令：`npm run deploy:docker -- --skip-build`；容器 `sthstart` 状态 healthy，入口 `http://127.0.0.1:9320/apps/activities` 返回 200。
- 部署后校验：schema 60；`quick_check=ok`；`foreign_key_check` 0 行；业务行数不变（9 apps、7 connections、5 models、9 assignments、0 worlds、275 artifacts）；9 条 app route 保留。
- 只读检查 9320 桌面 1440、手机 390、暖夜抽屉：无横向溢出，抽屉宽度 390、位置 x=0。

## 边界与未验证项

- 本轮没有对真实付费模型发起推理调用；路由、fallback、思考强度和审计使用测试替身验证，真实供应商兼容性仍取决于各供应商是否接受 `reasoning_effort` 或 `thinking` 字段。
- 回滚镜像运行的是迁移前 schema 59 代码，不能直接对着已升级到 60 的库启动；完整回滚顺序为停止容器、恢复 `2026-11-15-model-routing-before` 中的数据库与 narrative 库、再启动回滚镜像。
- 公共环境未配置 Tavily 密钥与本任务无关；本轮不涉及联网搜索。
- 迁移保留现有 9 条应用选择，因此生产页初始没有公共常用模型，5 个带 LLM 的应用显示自定义。用户需要先设置公共主模型，再决定是否「全部继承常用模型」；这是刻意避免静默改写既有选择。
- 工作区原本存在大量未提交改动，本轮没有 reset、stage、commit 或 push。
