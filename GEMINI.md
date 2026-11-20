# Antigravity 项目协作规则（外部 Codex CLI 子代理）

本文件仅用于指导 **Antigravity** 在 `SthStart` 仓库中的任务编排（不影响直接运行 Codex CLI 等其他仅读取 `AGENTS.md` 的工具）。

## Codex CLI 外部子代理委派约定

为节省 Antigravity 额度，按任务难度与上下文消耗进行分工：

- **适合委派给 Codex CLI（高耗额的中低难度任务）**：
  - 边界清晰、重复度高或改动面广但设计明确的中低难度编码（如批量单测编写、样板代码生成、常规 CRUD/样式迁移、按明确方案批量重构）
  - 常规代码审查与只读排查（`codex exec review` / `-s read-only`）
- **由 Antigravity 亲自完成（高难度或高耦合任务）**：
  - 复杂系统架构设计、跨模块疑难排查、高耦合核心逻辑改造、需要多轮交互或依赖内置浏览器进行视觉验证与端到端联调的任务
  - 极轻量的快速检索或简单只读确认（无需启动外部 Codex 进程）

调用参数与隔离规范：

- **可执行路径**：`C:\Users\12938\AppData\Roaming\npm\codex.cmd`（依赖本机 Magpie 网关处于运行状态）
- **默认模型参数**：`-m auto/deepseek-v4.1-flash -c model_reasoning_effort="max"`
- **非交互调用方式**：使用 `codex exec`（或只读审查 `codex exec review`），并通过 `-o <输出文件路径>` 保存最终回复文本以便完整读取
- **工作区与沙箱隔离**：
  - 写代码任务必须在独立的 `git worktree` 中进行（通过 `-C <worktree目录>` 或 `--worktree` 指定），严禁与主工作区并发修改同一目录；沙箱默认使用 `-s workspace-write`
  - 只读分析或审查任务使用 `-s read-only`
- **主代理职责（规划 + 验收）**：
  - Antigravity 负责理解需求、拆分边界清晰的 Prompt、准备隔离 worktree，并在 Codex 返回后核查 `git diff`、运行定向检查（如 `npm run typecheck`、`npm run check:architecture` 或相关测试）后再汇总交付
  - 若调用失败（例如本机 Magpie 网关未启动），如实向用户反馈错误并等待处理，不擅自切换其他高耗额方案或绕过限制
