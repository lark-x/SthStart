---
name: frontend-visual-qa
description: >-
  Use after layout, styling, theme, skin, or interaction changes in SthStart to collect browser evidence
  and judge visual quality. Covers isolated Playwright runs, the viewport and theme matrix, pixel
  baselines, accessibility and contrast checks, a defect checklist, and a scoring rubric for whether a
  page actually looks better. Replaces frontend-visual-verification. Test selection beyond the browser
  lives in project-verifier.
---

# SthStart 前端视觉验收

分两步：**先采集证据，再评分**。测试通过只说明没坏，不说明好看。

UI 文档、规则或纯文案调整不要求浏览器回归（见 `app/AGENTS.md`）。

## 1. 证据采集

### 环境

- 使用仓库 `playwright.config.ts`：门户 `4273`、测试后端 `4200`、本轮临时数据目录，跑完由 `tests/e2e/global-setup.ts` 清理。不在 `9320` 或正式数据上做浏览器验收。
- 截图上下文使用 `deviceScaleFactor: 2`；等待 `networkidle` 后再等 400–800ms，让字体、图标和过渡完成。
- 管理会话通过 `POST /api/auth/admin-session`（带 `origin` 头）获取 `sthstart_admin_session`，写入浏览器上下文。
- 默认用 Playwright Chromium；涉及浮层定位、侧栏、Select 时加 WebKit。

### 矩阵

| 改动范围 | 视口 | 主题 |
| --- | --- | --- |
| 单个页面 | 1440×900、390×844 | `light-paper`、`dark-espresso` |
| 工作台或分栏 | 再加 1024×768、1920×1080 | 同上 |
| 共享外框、原语、`app/styles/` | 每种页面原型取 1 个代表路由（Overview / Collection / Detail / Workbench / Reader） | 4 套基础主题 |
| 皮肤 | 1440×900、390×844 | 该皮肤 × 一亮一暗 |

截图保存到 `artifacts/visual-verification/<日期>-<主题>/`，文件名 `<theme>-<skin>-<width>-<page>.png`。改动前后各拍一组，便于对比。

### 自动检查

- 路由矩阵：`tests/e2e/mantine-route-matrix.spec.ts`（HTTP 状态、主区域、横向溢出、浏览器异常）。
- 像素基线：`tests/e2e/visual.spec.ts`。页面原型用例（制作项目、制作工作台、角色库、作品、资料库、媒体库、设置 × 暖白 / 暖夜）回放 `tests/e2e/visual-fixtures/*.har` 里录好的接口数据，不受共享测试库漂移影响；接口变化时用 `STHSTART_VISUAL_RECORD=1 npx playwright test tests/e2e/visual.spec.ts -g "record page archetype fixtures"` 重录，再更新截图。**有意改变外观时**用 `--update-snapshots` 更新，并在交付记录里写明更新了哪几张、为什么；`win32` 与 `darwin` 基线分别维护。非有意的差异按缺陷处理。
- 对比度与字阶：`contrast.spec.ts`、`typography.spec.ts`、`design-tokens.spec.ts`。
- 无障碍：`tests/e2e/a11y-routes.spec.ts` 用 `@axe-core/playwright` 扫描主路由（WCAG 2.1 A/AA，1440 与 390，默认暖白与暖夜），serious / critical 必须为 0。改动主题、共享原语或大面积替换颜色 token 时，设 `STHSTART_A11Y_THEMES=light-paper,light-zinc,dark-espresso,dark-obsidian` 扫四套基础主题。不关闭规则、不排除区域；确需延后的问题写进该文件的 `KNOWN_ISSUES`，注明路由、规则、原因和收敛任务。键盘路径与焦点归还另由 `mantine-overlays.spec.ts` 等用例覆盖。
  ```bash
  npx playwright test tests/e2e/a11y-routes.spec.ts
  ```
- token 守门：`npm run check:ui`，数量不得高于 `scripts/ui/baseline.json`；清理后用 `npm run check:ui -- --update` 收紧。

### 人工查看

必须用图像查看工具打开实际截图逐张看。只看脚本退出码不算验收。

## 2. 评分表

对每个受影响的页面打 1–5 分。改动后任何一项低于改动前，或"可读性""一致性"低于 4，不能交付。

| 维度 | 5 分 | 3 分 | 1 分 |
| --- | --- | --- | --- |
| 第一印象 | 首屏主角是作品，一眼知道这是什么页面 | 清楚但平淡，像后台 | 首屏主要是控件或空白 |
| 层级 | 主标题、主操作、内容、辅助信息四层分明 | 有层级但次要信息抢眼 | 平铺，找不到重点 |
| 密度与留白 | 符合原型密度，少数据态有专门设计 | 多数据时好，少数据时空 | 拥挤，或大片无意义空白 |
| 控件预算 | 页头 ≤1 主 + 2 次 + 溢出，筛选渐进暴露 | 略超但有分组 | 平铺 6 个以上同级控件 |
| 可读性 | 字号符合下限，对比度达标，中文换行自然 | 个别辅助字偏小 | 有截断、重叠或低对比 |
| 一致性 | 只用原语和 token，与同原型页面观感一致 | 少量局部样式 | 自造卡片、色板或圆角 |
| 主题与皮肤 | 四套主题都成立，皮肤缩略到 25% 仍可辨认 | 暗色或皮肤有小瑕疵 | 某主题下不可用 |
| 状态完整 | 加载、空、少数据、错误、离线都有设计 | 有空态，缺少数据或错误态 | 状态缺失或死锁 |

"第一印象""层级""密度"属于主观项，交付时附截图让用户确认。交付记录里写一张表：页面 × 8 个维度，改动前 / 改动后分数，附代表截图路径。

## 3. 常见缺陷清单

逐张截图检查：

- 文字首尾被裁切（画布空态说明、时间轴首尾刻度、标签组末项）；
- 输入框预留了图标位，但图标不可见；
- 可滚动的标签组或选项条没有边缘渐隐；
- 同一状态在页头和副栏重复出现；
- 浮层、抽屉打开后底层仍能被键盘聚焦，或关闭后焦点没有回到触发控件；
- 窄屏下主操作不可达，或被挤出视口；
- 工作台出现整窗外层滚动条，长内容撑高相邻栏；
- 加载态没有 `Skeleton` 或指示器，空态没有主操作；
- 出现表情符号，或 `✓`、`○` 等字符代替图标；
- 画布或预览区残留无意义的小矩形、调试元素。

## 4. 边界

- 不调用收费模型，不生成真实媒体，不执行正式备份恢复，不改正式数据库。
- 没有物理手机、系统软键盘、真实中文输入法和读屏器时，在记录中写明"浏览器模拟"。
- 测试结束释放端口，结束子进程。
- 部署到 `9320` 按项目约定在验证完成后进行，不属于本 Skill 的默认步骤。
