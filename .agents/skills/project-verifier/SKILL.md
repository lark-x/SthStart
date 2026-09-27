---
name: project-verifier
description: >-
  Use this skill when verifying changes, running tests, type-checking, diagnosing environment issues,
  or preparing code for commit in the SthStart monorepo. Enforces tiered, targeted verification to maximize efficiency.
---

# 项目分级与靶向验证指南 (Project Verifier)

SthStart 是一个包含前端门户、后端 Fastify 服务、TypeBox 共享契约、Playwright E2E、Windows Worker 等多子项目的 Monorepo。

为了避免无谓的全量测试等待，验证必须按**分级（Tiered）**和**靶向（Targeted）**原则进行：**只运行与当前改动相关的最轻量命令**。

---

## 验证分级指南

| 级别 | 适用场景 | 预计耗时 | 推荐命令 |
| :--- | :--- | :--- | :--- |
| **Level 1 (靶向单测)** | 日常改动某个具体文件后的即时反馈 | 1~3 秒 | 见下方“靶向命令速查” |
| **Level 2 (类型检查)** | 修改了契约、跨模块调用或重构后 | 5~15 秒 | `npm run typecheck` |
| **Level 3 (环境诊断)** | 运行时报错、子模块或环境变量异常 | 3~8 秒 | `npm run doctor` |
| **Level 4 (全量预提交)** | 完成功能开发、准备提交代码或合并 PR | 30~60 秒 | `npm run ci:core` |

---

## Level 1：靶向命令速查

根据你修改的文件路径，直接运行对应的精准命令：

### 1. 修改了契约 (`packages/contracts/`)
```bash
npm run test:contracts
```

### 2. 修改了后端服务业务代码 (`apps/service/src/`)
直接用 `tsx/esm` 运行对应的单个测试文件，无需重新 build：
```bash
# 示例：修改了 activities 模块
node --import tsx/esm --test apps/service/src/activity-production.test.ts

# 示例：修改了 topics 模块
node --import tsx/esm --test apps/service/src/topics.test.ts

# 示例：修改了 mcp 模块
node --import tsx/esm --test apps/service/src/mcp.test.ts
```

### 3. 修改了前端门户工具或库 (`app/lib/`)
```bash
npm run test:portal
```

### 4. 修改了 Windows Worker 脚本 (`workers/windows-worker/`)
```bash
npm run test:windows-worker
```

### 5. 涉及邻舍 Submodule 适配与集成
```bash
npm run test:linshe-contract
```

---

## Level 2：类型检查 (Typecheck)

当修改了接口字段、函数签名或 contracts 时，运行类型检查：
```bash
npm run typecheck
```
> **注意**：该命令会自动先构建依赖包（如 `@sthstart/activity-playback`），然后检查全局及各 workspace 的 TypeScript 类型。

---

## Level 3：环境体检 (Doctor)

当本地运行出现端口冲突、邻舍 Submodule 未同步、Python 虚拟环境丢失或模型权重未就绪时：
```bash
npm run doctor
```
如果需要检查远程部署或性能基准：
```bash
npm run doctor:remote
```

---

## Level 4：全量与 CI 验证 (Pre-commit / CI)

### 核心 CI 冒烟测试 (推荐在提交前执行)
包含类型检查、门户测试、服务测试与打包构建：
```bash
npm run ci:core
```

### 完整验证 (包含 ESLint)
```bash
npm run verify
```

### E2E 端到端测试 (Playwright)
```bash
npm run test:e2e
```
