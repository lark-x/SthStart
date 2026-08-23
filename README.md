# SthStart

SthStart 是一个本地优先的互动应用门户。当前接入完整的邻舍.EXE，并预留 TypeScript 公共服务边界，后续可以增加生图、记忆、角色或其他应用模块。

## 结构

```text
app/                 SthStart 门户与邻舍内嵌页
apps/service/        本地公共服务（Fastify + TypeScript）
packages/contracts/  共享 API 类型
upstream/linshe/     邻舍 Git Submodule
```

邻舍保持独立运行，门户只通过健康检查发现它，并在 `/apps/linshe` 使用 iframe 加载其原始前端。SthStart 不访问邻舍 SQLite，也不改写其 API 和静态资源路径。

## 开始使用

环境要求：Node.js 22、npm 11、Python 3.10+（仅邻舍向量服务需要）、Git，以及按需运行的 ComfyUI。

```bash
cp .env.example .env
npm run setup
```

`setup` 会初始化 Submodule、安装三组 Node 依赖、创建 Python 虚拟环境并下载约 164 MB 的 Jina 模型。若只想先运行不带长期向量记忆的降级版本，可设置 `STHSTART_SKIP_VECTOR=1`；之后再执行 `npm run setup:vector` 即可补齐。

仅启动门户和公共服务：

```bash
npm run dev
```

同时启动门户、公共服务和邻舍：

```bash
npm run dev:all
```

默认地址：门户 `http://127.0.0.1:4173`，公共服务 `http://127.0.0.1:4100`，邻舍开发前端 `http://127.0.0.1:5173`。

首次进入邻舍后，请在其“设置”页面填写 LLM、ComfyUI、天气等实际配置；邻舍会按原项目逻辑写入自己的数据库与 `agent-core/.env`，SthStart 不复制或接管这些敏感配置。

## 邻舍 Fork 与同步

当前 Submodule 临时指向原项目 `icecranberry/galgame-with-comfyUI`。创建 `lark-x/galgame-with-comfyUI` Fork 及 `lark` 分支后运行：

```bash
npm run linshe:use-fork
git submodule update --remote upstream/linshe
```

Fork 的 `main` 只跟随原作者上游，定制修改放在 `lark`。SthStart 只更新经过测试的 Submodule commit，不直接修改 `upstream/linshe`。

第三方来源和分发注意事项见 [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md)。

仓库内包含两层自动同步：

1. `sync-linshe-fork.yml` 每日把原项目同步到 Fork 的 `main`，并在有新提交时创建 `main → lark` 审核 PR。
2. 合并该 PR 后，`update-linshe.yml` 会为 SthStart 创建更新 Submodule 指针的 PR。

在 SthStart 仓库中配置 `LINSHE_FORK_TOKEN` Secret 后第一层才会执行；Token 需要对 `lark-x/galgame-with-comfyUI` 拥有 Contents 与 Pull requests 写权限。未配置时定时任务会安全跳过。这样上游更新不会直接覆盖自定义改动，冲突也会留在 PR 中人工处理。

## 公共服务

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `GET /api/v1/apps`
- `GET /api/v1/apps/linshe`

服务默认只绑定 `127.0.0.1`，没有公网鉴权。若未来需要远程访问，应先增加认证和限流。
