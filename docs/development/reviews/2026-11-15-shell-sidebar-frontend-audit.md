# 工作台侧栏修复与前端审查

日期：2026-11-15

## 根因

故事世界、创作项目编辑、活动工作台等页面自带 `WorkspaceHeader`。`AppShell` 在这些页面强制侧栏保持紧凑，并把侧栏底部的“展开侧栏”按钮改成了“打开右侧导航抽屉”。图标仍是展开侧栏，用户点击后却看到覆盖在右侧的「导航」，因此产生截图中的误导和遮挡。

## 修复

- 工作台页面保持默认紧凑，但新增按会话生效的展开状态；底部按钮现在只执行侧栏展开/收起，不再打开导航抽屉。
- 工作台页头的「导航」按钮和 `sthstart:open-nav-drawer` 事件继续打开全站导航，移动端入口不变。
- 导航抽屉中的「搜索与命令」先关闭抽屉，再打开命令面板。
- 设置中心二级导航在手机上按行换行，五个分类全部可见，不再只露出前三项并依赖隐藏横向滚动条。

## 浏览器审查范围

- `29` 路由 × `1440px` / `390px` 全站矩阵：所有路由 HTTP 200、恰好一个可见主标题、无横向溢出、无 hydration/runtime 错误。
- 代表性布局 `1920×1080` 暖白、`1024×768` 云白/暖夜、`390×570` 深空：首页、设置、正文编辑器、日历通过。
- 外框专项：9/9 通过，覆盖工作台侧栏展开/收起、全站导航抽屉入口、手机设置五项分类、WorkspaceHeader 去重和停止状态圆点。
- 主题、对比度与视口专项：16/16 通过；侧栏收起不丢输入/不重置选择用例 1/1 通过。
- 门户 E2E：17 项中 16 项一次通过；`narrative` 用例首次运行遇到环境的 `ERR_NO_BUFFER_SPACE`，单独重跑通过。产品断言未降低。
- `npm run test:quick`：13/13 通过。
- `npm run test:regression`：269 个测试文件全部通过，0 失败、0 跳过（`artifacts/testing/1794700795329-22020/report.md`）。
- 架构检查：656 files、2750 local edges、0 violations。

## 部署

- 部署前镜像：`sthstart:rollback-shell-sidebar-20261115-before`，sha `c7bbd37cfbbf96c5e8b728d5275e762f46937da5ba488b4d94cd9d1acf5db7a7`。
- `npm run deploy:docker -- --skip-build` 完成，9320 容器 healthy。
- 生产只读实测：故事世界侧栏可从 56px 展开到 224px，不出现导航抽屉；收起后页头「导航」仍能打开抽屉；390px 设置页五个分类全部可见且无横向溢出。
- 截图：`artifacts/visual-verification/frontend-audit/live-story-worlds-sidebar-expanded.png`、`live-settings-390.png`。

## 未改变

- 资料库等长页签仍使用横向滚动（`PageTabs` 已有的键盘 reveal 与触控滚动行为），本轮未把所有局部页签改成换行，以免改变工作台信息密度。
- 未做真机触屏和真实 WebKit 本轮复验；移动布局证据来自 Chromium 390px 与既有 WebKit 回归。
