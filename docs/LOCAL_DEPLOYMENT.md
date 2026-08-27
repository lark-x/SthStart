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

生成三个不同的随机密钥，分别填入 `.env`：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

至少配置：

```dotenv
STHSTART_ADMIN_TOKEN=<第一个随机值>
STHSTART_IMAGE_SIGNING_SECRET=<第二个随机值>
STHSTART_SESSION_SECRET=<第三个随机值>
STHSTART_AKASHA_MCP_URL=https://agent.zlb.ink/api/mcp/
```

Akasha 地址只代表允许主动调用；服务启动和打开页面不会自动请求 MCP。

新版本采用显式数据库版本。若这是从旧开发版本升级，且你已确认旧的主项目数据可删除，请只执行一次：

```bash
npm run db:reset -- --confirm
```

该命令只重建 `sthstart.db`、`narrative.db`、对应 WAL/SHM、主项目笔记图片与公共制品；不会删除日志、`.env` 或邻舍自己的数据。日后正常升级使用 `npm run db:migrate`，检查使用 `npm run db:check`，完整检查使用 `npm run db:integrity`。

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

从其他终端安全停止当前工作区的 Portal、公共服务以及由公共服务托管的邻舍进程：

```bash
npm stop
```

该命令会核对监听进程的工作目录；如果 4173 或 4100 被其他项目占用，会拒绝误杀。前台运行时仍可直接按 `Control + C`。

打开 Portal 后进入“控制中心”，点击“启动邻舍”。公共服务会托管邻舍子进程并收集日志。兼容旧命令的别名仍可使用：

```bash
npm run start:local:all
```

邻舍启动不再要求 ComfyUI 已运行。没有启动 ComfyUI 时对话等文本功能可正常使用，生图功能会保持不可用；需要时可在控制中心单独启动 ComfyUI。

默认入口：

- Portal：`http://127.0.0.1:4173`
- 公共服务健康检查：`http://127.0.0.1:4100/api/v1/health`
- 邻舍：`http://127.0.0.1:5173`

### 受信任家庭局域网

仅在可信的家庭 Wi-Fi 中，可以使用：

```bash
npm run start:lan
```

命令会自动识别私有 IPv4 地址并在终端显示手机访问链接，例如 `http://192.168.1.11:4173`。局域网浏览器无需配对即可建立管理会话；Portal 使用 4173，控制中心启动邻舍后其 Web 页面使用 5173。公共服务 4100、邻舍后端 3099、ComfyUI 8188 和向量服务 8765 仍保持回环监听。

此模式等同于信任同一局域网内的设备，不要在公司、学校、酒店或公共 Wi-Fi 使用。若自动选择了错误的网卡，可临时指定：

```bash
STHSTART_LAN_HOST=192.168.1.11 npm run start:lan
```

停止仍使用 `npm stop`。

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

主项目数据库可以在服务停止后在线性备份：

```bash
npm run db:backup
```

恢复时保持服务停止，并显式给出备份目录：

```bash
npm run db:restore -- ./data/backups/<时间目录> --confirm
```

制品、日志、`.env` 与邻舍数据仍需按上面的清单单独复制。

完整的媒体制品配额、Windows Worker 算力节点、H3 视频生成与灾难恢复流程详见 [`docs/OPERATIONS_AND_BACKUP.md`](OPERATIONS_AND_BACKUP.md)。

## 手机远程访问：最小方案

第一阶段只暴露 Portal，不需要 Docker、Nginx、公网 IP 或端口映射。公共服务、数据库和向量服务继续保持本机回环监听。

先在 Mac 上启动：

```bash
npm run deploy:local
```

这个命令会持续运行 Portal 和公共服务，请保持该终端开启；下面的 `cloudflared` 命令在另一个终端执行。

确认 `http://127.0.0.1:4173` 可以打开后，安装 Cloudflare Tunnel：

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create sthstart
cloudflared tunnel route dns sthstart sth.example.com
```

创建 `~/.cloudflared/config.yml`，将 `sth.example.com` 替换为你的域名：

```yaml
tunnel: <Tunnel UUID>
credentials-file: /Users/<你的用户名>/.cloudflared/<Tunnel UUID>.json

ingress:
  - hostname: sth.example.com
    service: http://127.0.0.1:4173
  - service: http_status:404
```

启动隧道：

```bash
cloudflared tunnel run sthstart
```

需要检查配置时可以先运行：

```bash
cloudflared tunnel ingress validate
```

然后在 Cloudflare Zero Trust 中为 `sth.example.com` 创建 Access Application，只允许自己的邮箱。手机访问 `https://sth.example.com` 即可。

Portal 管理接口会复用 Cloudflare Access 身份，并换成 8 小时的 HttpOnly、SameSite=Strict 会话。远程启用前还必须在 `.env` 配置：

```dotenv
STHSTART_PUBLIC_ORIGINS=https://sth.example.com
CF_ACCESS_TEAM_DOMAIN=<你的团队名>.cloudflareaccess.com
CF_ACCESS_AUD=<Access Application Audience Tag>
```

缺少任一 Cloudflare 配置时，远程浏览器不能建立管理会话；公共服务的 4100 端口仍必须保持回环监听。

### 邻舍远程访问

SthStart、创作笔记和叙事档案只需要 4173。邻舍暂时使用第二个域名：

```text
linshe.example.com → http://127.0.0.1:5173
```

开发运行邻舍：

```bash
npm run dev:linshe
```

如果不从 SthStart 控制中心启动邻舍，请在第三个终端保持这个命令运行。

并在根目录 `.env` 中设置：

```dotenv
LINSHE_APP_URL=https://linshe.example.com
LINSHE_HEALTH_URL=http://127.0.0.1:3099/api/health
NEXT_PUBLIC_LINSHE_APP_URL=https://linshe.example.com
```

`NEXT_PUBLIC_LINSHE_APP_URL` 是离线或公共服务暂时不可用时的浏览器回退地址。修改 `.env` 后重新执行 `npm run deploy:local`，让它进入 Portal 构建产物。

需要为 `linshe.example.com` 增加第二条 Tunnel ingress，例如：

```yaml
  - hostname: linshe.example.com
    service: http://127.0.0.1:5173
```

并为两个 hostname 都配置同样的 Cloudflare Access 规则。`LINSHE_APP_URL` 用于让远程手机点击邻舍入口时跳转到第二个域名；健康检查仍然走 Mac 本机的 3099，邻舍 Web 进程状态则探测 Mac 本机的 5173。

邻舍 Web 的 `/api`、`/images` 和 `/avatars` 请求由 5173 代理到本机 3099，所以手机不需要直接访问 3099。8765、8188 也不需要暴露。

### 注意

- `npm run deploy:local` 只启动 SthStart Portal 和公共服务；邻舍需要另运行 `npm run dev:linshe`，或从控制中心按需启动。
- 不要把 4100、3099、8765 或 8188 直接暴露到公网。
- 先验证 4173 单域名方案，再接入邻舍第二个域名；开机自启可以最后使用 `launchd` 或 PM2 配置。
