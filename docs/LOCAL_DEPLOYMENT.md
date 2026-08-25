# SthStart 本地部署

## 推荐形态

当前版本推荐部署在一台长期运行的个人电脑上：

```text
浏览器 → SthStart Portal :4173
                   ↓ 服务端 BFF
          公共服务 :4100（只监听回环）
             ├─ data/sthstart.db
             ├─ data/narrative.db
             ├─ data/artifacts/
             └─ data/logs/

控制中心 → 邻舍前端 :5173 → 邻舍核心 :3099 → 可选向量服务 :8765
```

公共服务始终只监听 `127.0.0.1`，管理令牌只由 Portal 的服务端 BFF 持有。不要把 4100、3099 或 8765 直接映射到局域网或公网。

## 首次安装

环境要求：Node.js 22.13 以上、npm、Git；启用邻舍向量服务时还需要 Python 3.10 以上。

```bash
git submodule update --init --recursive
cp .env.example .env
npm run setup
```

生成两个不同的随机密钥，分别填入 `.env`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

至少配置：

```dotenv
STHSTART_ADMIN_TOKEN=<第一个随机值>
STHSTART_IMAGE_SIGNING_SECRET=<第二个随机值>
STHSTART_AKASHA_MCP_URL=https://agent.zlb.ink/api/mcp/
```

Akasha 地址只代表允许主动调用；服务启动和打开页面不会自动请求 MCP。

## 开发与本地生产运行

日常开发：

```bash
npm run dev
```

构建并启动 Portal 与公共服务：

```bash
npm run deploy:local
```

之后再次启动不必重建：

```bash
npm start
```

打开 Portal 后进入“控制中心”，点击“启动邻舍”。公共服务会托管邻舍子进程并收集日志。兼容旧命令的别名仍可使用：

```bash
npm run start:local:all
```

默认入口：

- Portal：`http://127.0.0.1:4173`
- 公共服务健康检查：`http://127.0.0.1:4100/api/v1/health`
- 邻舍：`http://127.0.0.1:5173`

`start:local:all` 现在只启动 Portal 和公共服务，邻舍由控制中心按需启动。仅在调试旧启动流程时使用 `npm run start:local:legacy`；该模式启动的邻舍会显示为“外部启动”，控制中心不会停止它，也无法保证取得完整日志。

## 控制中心与日志

控制中心地址为 `http://127.0.0.1:4173/settings/control-center`。它提供：

- 邻舍 Web、主控后端和向量服务的启动、停止、状态与 PID。
- 原 `launcher_config.json` 的一次性导入预览。
- ComfyUI、工作流、常用功能和公共模型配置。
- 全局及各服务日志级别、实时筛选和脱敏诊断包。

默认日志为平衡模式：保存 7 天或总计 200 MB，Debug 和敏感正文诊断默认关闭。详细诊断与敏感正文开关都会在 30 分钟后自动失效。令牌、Key、用户目录和 URL 中的签名参数始终会脱敏。

## 后台常驻

个人电脑上可使用操作系统登录启动项、systemd 或 PM2 执行以下单一命令：

```bash
npm start
```

工作目录必须固定为仓库根目录。更新版本时按以下顺序执行：

```bash
git pull
git submodule update --init --recursive
npm install
npm run build
```

完成后再重启常驻进程。不要在旧服务仍写数据库时覆盖或删除 `data/`。

## 数据与备份

需要备份：

- `data/sthstart.db` 及可能存在的 `-wal`、`-shm` 文件。
- `data/narrative.db` 及可能存在的 `-wal`、`-shm` 文件。
- `data/artifacts/`。
- `data/logs/`（若需要保留历史排查记录）。
- 根目录 `.env`。
- 邻舍自己的数据库和配置目录。

最稳妥的方式是先停止 SthStart 与邻舍，再整体复制 `data/` 和邻舍数据目录。恢复时使用相同路径，并确保文件只对当前系统用户可读写。

## 手机访问

当前默认部署刻意只允许本机访问。不要简单把 Portal 改为 `0.0.0.0`：Portal 的 BFF 持有管理员权限，而当前尚未实现用户登录。

后续手机编辑推荐增加一层带身份验证的 Tailscale、Cloudflare Access 或本地反向代理，只暴露 Portal，公共服务继续保持回环监听。完成访问认证之前，手机访问不属于当前安全支持范围。
