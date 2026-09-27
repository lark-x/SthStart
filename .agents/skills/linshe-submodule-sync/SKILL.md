---
name: linshe-submodule-sync
description: >-
  Use this skill when updating, syncing, or troubleshooting the upstream/linshe git submodule,
  or verifying the Linshe character contract and runtime environment in SthStart.
---

# 邻舍 Submodule 同步与适配指南 (Linshe Submodule Sync)

`upstream/linshe` 是 SthStart 的核心集成子模块（Git Submodule），指向 Fork 仓库 `lark-x/galgame-with-comfyUI` 的 `lark` 分支。

为了保障多应用协同稳定，**严禁直接在 SthStart 仓库中随意修改 `upstream/linshe` 内部代码**，所有更新必须遵循 Submodule 指针管理与契约冒烟流程。

---

## 核心工作流速览

```text
1. 确认/修复 Fork 指向
   └── npm run linshe:use-fork
        ↓
2. 拉取更新或切换指针
   └── git submodule update --init --recursive
        ↓
3. 环境体检与契约冒烟
   └── npm run doctor && npm run test:linshe-contract
        ↓
4. 父项目提交指针
   └── git add upstream/linshe && git commit -m "chore(linshe): update submodule pointer"
```

---

## 具体操作步骤

### 步骤 1：初始化或修复 Submodule 指向

在新的克隆或 Submodule 指针异常时，运行自带脚本将 Submodule 锁定至 `lark-x` Fork 的 `lark` 分支：

```bash
npm run linshe:use-fork
git submodule update --init --recursive
```

---

### 步骤 2：同步 Submodule 最新提交

当 Fork 仓库的 `lark` 分支有新更新需要引入 SthStart 时：

```bash
# 进入子模块拉取最新提交
cd upstream/linshe
git fetch origin
git checkout lark
git pull origin lark
cd ../..
```

> [!WARNING] 避免 Detached HEAD（头指针分离）
> 如果在 `upstream/linshe` 中处于 `(HEAD detached at ...)` 状态，请务必先 `git checkout lark` 再拉取或修改代码。

---

### 步骤 3：环境体检与契约冒烟测试

Submodule 更新后，必须验证本地运行环境及两端的契约兼容性：

1. **环境诊断**（检查 Python 虚拟环境、Jina 向量模型、端口占用）：
   ```bash
   npm run doctor
   ```
2. **邻舍角色契约冒烟测试**（验证 SthStart 公共服务是否能被邻舍适配器正常消费）：
   ```bash
   npm run test:linshe-contract
   ```

---

## 步骤 4：在 SthStart 中提交指针更新

当体检与契约测试全部通过后，在 SthStart 根目录提交子模块指针更新：

```bash
git add upstream/linshe
git commit -m "chore(linshe): update upstream/linshe pointer"
```

---

## 常见问题与避坑指南

1. **Submodule 存在未提交修改 (Dirty Submodule)**：
   - 如果 `git status` 显示 `upstream/linshe (modified content)`，先进入 `upstream/linshe` 查看 `git status`。
   - 不要把未受版本控制的临时调试文件或日志提交到父仓库。
2. **上游原作者仓库更新流程**：
   - SthStart 不直接跟原作者仓库通信。
   - Fork 仓库内置 GitHub Action `sync-upstream.yml`，每日同步原作者到 `main` 并提 PR 到 `lark` 分支。
   - 在 Fork 审核合并 PR 之后，再通过本流程更新 SthStart 的指针。
