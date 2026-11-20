# 资料库间距与行内输入聚焦修复

日期：2026-11-17。工作分支：`codex/resources-ui-polish`。

## 问题与修复

资料库页头直接贴着下方面板；笔记标题虽用无框工具类，仍被笔记编辑器的通用 `:focus-visible` 规则添加外侧矩形轮廓，皮肤也会重新注入输入边框和阴影。

- 资料库外壳统一提供页头到内容的间距：桌面 16px，1024px 以下 12px。五个资料库视图共用该间距。
- 共享 `Input`、`Textarea` 增加 `variant="inline"`，在真实输入元素上输出语义标记。默认透明、无外框，聚焦显示 2px 底线；预留底线位置，避免聚焦时布局跳动。悬停不会覆盖聚焦色。
- 行内输入保留错误状态底线与强制高对比度模式的 outline 回退。普通输入不输出 `data-ui-variant="default"`，避免误触发卡片皮肤。
- 笔记编辑器的通用焦点规则排除由共享控件管理焦点的 `.ui-control`，消除重复轮廓。
- 正文继续由内容块侧边标记指示聚焦，去掉皮肤残留的表单边框、填充与阴影。
- 资料库选中笔记与分类按钮使用局部选中样式，消除皮肤带来的重复厚框和实体投影；笔记辅助文字使用可读的 muted token。

迁移的实际调用方：笔记标题、图片说明、参考链接地址/标题/备注，剧情章节标题，角色名称，活动标题，场次标题，故事世界人物卡名称，以及记录编辑器的追加台词输入。创作项目的标准表单没有改为行内输入。

## 验收环境与结果

浏览器验收全程使用 Playwright Chromium，页面端口 `4273`、测试后端 `4200`、独立临时数据库，未使用 computer use，也没有在 `9320` 上做浏览器验收。

- `npm run typecheck` 通过。
- `npm run build:portal` 通过。
- 主题、Provider、共享原语与分页定向单测：63/63 通过。
- `resources-ui-polish.spec.ts`：1/1 通过，包含四组主题/皮肤 × 四个视口（1920×1080、1440×900、1024×768、390×844），以及资料库另外四个视图。检测标题聚焦轮廓、正文边框、顶部间距、键盘返回焦点和整页横向溢出。
- `inline-title-focus.spec.ts`：2/2 通过，日间/夜间 genshin 皮肤下检查角色、剧情、活动、场次标题和普通表单对照。
- 既有 `theme-polish.spec.ts` 中 `note sections are distinct and block controls work in the writing pane`：1/1 通过，覆盖正文输入、插入、移动、保存、重载和窄屏操作。
- 受影响文件定向 ESLint 通过；`records-editor.tsx` 的既有 2 处 `react-hooks/set-state-in-effect` 错误与 16 条 unused 警告仍在，相关逻辑不属于本轮修改。
- Impeccable 机械检查返回空问题列表；截图另行打开核对，未仅以测试通过作为视觉结论。

截图为 2x 像素密度，共 30 张，保存在 `artifacts/visual-verification/resources-polish/`。代表性文件：

- `dark-espresso-genshin-1440-focus.png`
- `light-paper-genshin-1440-focus.png`
- `dark-espresso-genshin-390-focus.png`
- `inline-character-dark-espresso.png`
- `inline-story-dark-espresso.png`
- `inline-scene-dark-espresso.png`
- `regular-input-light-paper.png`

部分跨路由浏览器测试期间，vinext 输出 `ERR_STREAM_UNABLE_TO_PIPE`（响应流关闭）日志；相关页面断言与最终用例均通过，本轮没有修改 vinext 服务端实现。世界人物卡与追加台词使用同一已验证原语，但未单独截图该两条业务路径。四套基础主题均有截图覆盖，未穷举每套主题与全部皮肤的笛卡尔积。

## 部署与工作区边界

验收后沿用既有本地部署授权，仅同步已验证的门户 `dist` 到现有 `sthstart` 容器并重启。同步前比对后端编译产物、服务源码、契约、回放产物、脚本与公共资源均与容器一致，因此没有同步其他工作区改动。邻舍前端产物不同，未纳入本次更新。

部署前门户备份：`artifacts/visual-verification/resources-polish/deployed-portal-before/dist`。部署后逐文件核对当前构建的 640 个文件，差异数为 0；容器状态 `running healthy`。服务器入口 SHA256：`155285804a92d886727b90ec606998c343d705ac50e45c7b451cc75333c17f27`。

`9320` 仅作为部署目标；未以浏览器访问它验收。测试结束后 `4273`、`4200` 均无监听进程。

当前分支由原工作树直接切出，保留了此前未提交的其他任务改动。本轮未提交、推送或合并；整树 diff 不能当成本轮产出。
