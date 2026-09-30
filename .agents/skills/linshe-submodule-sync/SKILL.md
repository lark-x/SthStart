---
name: linshe-submodule-sync
description: >-
  Use when initializing, updating, or troubleshooting the upstream/linshe Git submodule
  in SthStart, or checking its integration contract and runtime. Distinguish restoring
  the parent repository's pinned commit from intentionally advancing or editing Linshe.
---

# 邻舍子模块与集成维护

`upstream/linshe` 是 Git 子模块。当前 `.gitmodules` 指向 `lark-x/galgame-with-comfyUI` 的 `lark` 分支，操作前以仓库实际配置为准，不自动重写为文档里的固定值。

## 先确认目标与工作区

- 查看父项目 `git status --short`、`git submodule status upstream/linshe`；子模块已初始化时再查看 `git -C upstream/linshe status --short` 和实际远程配置。
- 分清用户希望恢复父仓库锁定版本、引入指定远程版本，还是修改邻舍代码。只读审查不更新指针。
- 子模块 detached HEAD 是锁定提交的正常状态，不必为了检查切换分支。发现已有修改时保留它们，不用 reset、clean、强制 checkout 或覆盖拉取解决问题。

## 三种操作

### 恢复父仓库锁定版本

在没有会被覆盖的本地改动时：

```bash
git submodule update --init --recursive upstream/linshe
```

该命令检出父项目记录的 SHA，不会自动获取配置分支的最新提交。

### 引入指定提交或远程分支版本

先检查子模块实际 remote，再 fetch 用户所需 ref，确认提交内容并检出明确的目标 SHA；不要无条件 `git pull`。若用户指定最新分支，以 fetch 后的远程 ref 为准，不猜测提交号。父项目差异应能解释此次子模块指针变化。

`npm run linshe:use-fork` 会修改子模块配置，仅在用户要求使用该 fork 或确认当前配置确实需要修复时运行，不作为例行更新的第一步。

### 修改邻舍代码

用户明确要求邻舍修复时，可以在子模块内开发；先选定合适的分支并保留已有工作。区分子模块文件修改、子模块提交以及父项目指针更新，不能只提交父项目指针就宣称未提交代码已被保存。

## 按变化验证与交付

- 集成接口或子模块版本变更运行 `npm run test:linshe-contract`，有邻舍业务修改时增加对应检查。
- Python、模型权重或启动环境相关变化再运行 `npm run doctor`；不要求普通指针审查下载模型或配置未使用的能力。
- 交付说明旧、新 SHA、相关变化和验证结果。仅在用户任务包含提交或推送时执行这些动作；不要自动提交整个父仓库或混入无关改动。
