# SthStart

SthStart 是一个本地优先的互动应用门户。当前接入完整的邻舍.EXE，并提供 TypeScript 公共服务层，可让邻舍和之后的新应用共享 LLM、向量、生图、通用角色模板、运行管理与日志诊断能力。

## 结构

```text
app/                 SthStart 门户与邻舍内嵌页
apps/service/        本地公共服务（Fastify + TypeScript）
packages/contracts/  共享 API 类型
upstream/linshe/     邻舍 Git Submodule
```

当前包含三个应用入口：

- 邻舍.EXE：保持独立 Submodule 与原技术栈，通过公共服务渐进接入。
- 创作笔记：React 移动端适配应用，用于记录日记、灵感、剧情素材、角色设定和世界资料，支持文本、图片及链接块。
- 叙事档案：多作品剧情回顾与研究应用，支持任务树、连续阅读、全文检索、可预览的增量导入和带原文快照的笔记摘录。

叙事档案的数据模型、JSON 导入契约和 MCP 连接器边界见 [`docs/NARRATIVE_ARCHIVE.md`](docs/NARRATIVE_ARCHIVE.md)。
本地生产启动、常驻运行、数据备份与手机访问边界见 [`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md)。

邻舍仍保持独立数据和前端，门户在 `/apps/linshe` 使用 iframe 加载其原始页面。正式本地运行时可由控制中心托管邻舍进程并通过公开配置接口应用常用设置；SthStart 不直接访问邻舍 SQLite。

## 开始使用

环境要求：Node.js 22、npm 11、Python 3.10+（仅邻舍向量服务需要）、Git，以及按需运行的 ComfyUI。

```bash
cp .env.example .env
npm run setup
```

先用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 分别生成管理令牌和图片签名密钥，填入 `.env` 的 `STHSTART_ADMIN_TOKEN` 与 `STHSTART_IMAGE_SIGNING_SECRET`。两者少于 32 个字符时服务会拒绝启动。

`setup` 会初始化 Submodule、安装三组 Node 依赖、创建 Python 虚拟环境并下载约 164 MB 的 Jina 模型。若只想先运行不带长期向量记忆的降级版本，可设置 `STHSTART_SKIP_VECTOR=1`；之后再执行 `npm run setup:vector` 即可补齐。

仅启动门户和公共服务：

```bash
npm run dev
```

开发时仍可使用旧的三进程启动方式：

```bash
npm run dev:all
```

默认地址：门户 `http://127.0.0.1:4173`，公共服务 `http://127.0.0.1:4100`，邻舍开发前端 `http://127.0.0.1:5173`。

打开 `/settings/control-center` 可托管邻舍、迁移 EXE 运行配置并查看有界实时日志；打开 `/settings/public-services` 可创建应用令牌、供应商配置和通用角色模板。供应商密钥优先保存到 macOS Keychain、Windows Credential Manager 或 Linux Secret Service；系统安全存储不可用时只能通过明确的环境变量提供，不会静默写入明文文件。

邻舍默认仍按原项目逻辑运行。需要逐模块迁移时，在根目录 `.env` 填入设置页创建的邻舍应用令牌与对应 Profile ID，再依次打开 `STHSTART_PUBLIC_LLM`、`STHSTART_PUBLIC_VECTOR`、`STHSTART_PUBLIC_IMAGE`。`dev:all` 会把根环境传给邻舍；每个模块仍保留原实现回退。

## 邻舍 Fork 与同步

当前 Submodule 指向 `lark-x/galgame-with-comfyUI` Fork 的 `lark` 分支。若在新的克隆或重新初始化的仓库中需要修复该配置，可运行：

```bash
npm run linshe:use-fork
git submodule update --init --recursive
```

Fork 的 `main` 只跟随原作者上游，定制修改放在 `lark`。SthStart 只更新经过测试的 Submodule commit，不直接修改 `upstream/linshe`。

第三方来源和分发注意事项见 [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md)。

仓库内包含两层自动同步：

1. Fork 的 `lark` 分支内置 `sync-upstream.yml`，每日用 Fork 自己的 `GITHUB_TOKEN` 把原项目同步到 `main`，并在有新提交时创建 `main → lark` 审核 PR。
2. 合并该 PR 后，`update-linshe.yml` 会为 SthStart 创建更新 Submodule 指针的 PR。

不需要额外保存个人访问 Token。上游更新不会直接覆盖自定义改动，冲突会留在 Fork PR 中人工处理；通过邻舍冒烟检查并合并后，SthStart 才会更新固定指针。

## 公共服务

- `GET /api/v1/health`
- `GET /api/v1/capabilities`
- `GET /api/v1/apps`
- `GET /api/v1/apps/linshe`
- `GET /v1/models`、`POST /v1/chat/completions`
- `POST /api/v1/vector/{embed,search,upsert,upsert-batch,delete}`
- `/api/v1/images/tasks` 与短期签名产物 URL
- `/api/v1/personas` 与应用内固定版本快照
- `/api/v1/logs`（带 `logs` 能力的应用写入自身结构化日志）
- `/api/v1/admin/runtime/*`、`/api/v1/admin/logs*` 与脱敏诊断导出
- `/api/v1/admin/*`（仅由门户服务端 BFF 注入管理令牌）

服务强制只绑定回环地址。公共能力使用独立应用 Bearer Token，管理接口使用单独的服务端令牌；浏览器不会取得管理令牌。完整协议、数据边界与迁移说明见 [`docs/PUBLIC_SERVICES.md`](docs/PUBLIC_SERVICES.md)。
内置应用包括邻舍入口、创作笔记与叙事档案。叙事档案的多作品数据模型、JSON 导入契约和 MCP 连接器边界见 [docs/NARRATIVE_ARCHIVE.md](docs/NARRATIVE_ARCHIVE.md)。
