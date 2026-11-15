# 前端视觉优化收尾验收

本轮收尾的是 2026-11-10 全局视觉优化计划中尚未完成的三项：字号 Token 接入、首页卡片样式去重、四视口加载态视觉验收。改动已完成并通过生产构建，本地 9320 已更新。

## 实现收尾

- 页面标题改用 --text-page。共享 PageHeader、移动端样式和工作台覆盖不再把标题压回 20px。
- 共享正文、分区标题、控件字号及卡片标题分别接入 --text-body、--text-section 和字号 Token；Tailwind 的 text-sm、text-xs 也映射到同一语义字号，避免两套字号来源。
- .home-card 的填充留在 shell.css，表面、发丝边和投影只在 workspace-b.css 定义。
- 新增 tests/e2e/visual-optimization.spec.ts，使用隔离测试库创建真实项目、角色、笔记和服务连接，在四种视口与两套主题下截取首页、项目、角色、资料库和设置页。

## 验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm run test:portal | 29/29 个测试文件通过 |
| npm run test:quick | 13/13 个测试文件通过 |
| npm run build | 通过 |
| 视觉矩阵 | 5 页面 × 4 视口 × 2 主题，共 40 组通过 |
| 主题与组件回归 | 主题、分页、窄屏入口、编辑区共 12 项通过 |
| 四主题实时检查 | 正文粒度对比度、控件描边、四级表面区分和键盘焦点通过 |
| 9320 部署后检查 | 5 页面 × 4 视口 × 2 主题，共 40 组只读检查通过 |
| 数据库 | 部署前后迁移版本和完整性检查均通过 |

验收截图位于 artifacts/visual-verification/2026-11-10-optimization/。部署前备份、部署日志、生产只读截图及校验结果位于 artifacts/deploy-visual-optimization-20261110/。

首次主题与分页组合回归中，窄屏分页菜单出现过一次未打开；该目标用例独立连续运行 5 次均通过，随后完整组合 12 项复跑通过，未再复现。日志保留在 artifacts/visual-completion-pagination-investigation.log 和 artifacts/visual-completion-interactions-rerun.log。
