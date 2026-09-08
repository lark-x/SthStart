# SthStart Docker 容器化部署指南

本文档提供 SthStart 的 Docker 生产级容器化部署方案、架构解析、持久化配置与网络接入指南。

---

## 架构与安全设计

SthStart 采用 **Portal（BFF 前端）+ Public Service（公共服务）** 双进程协同架构：

```text
浏览器 / 手机 / 外部反向代理
          │ (HTTP :4173)
          ▼
┌─────────────────────────────────────────────────────────┐
│ SthStart Docker 容器                                    │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │ SthStart Portal (Next.js / Vinext)              │   │
│   │ 监听: 0.0.0.0:4173                              │   │
│   │ 功能: 页面渲染、CSRF 会话鉴权、BFF 代理中间件   │   │
│   └────────────────────────┬────────────────────────┘   │
│                            │ 内部回环直连               │
│                            │ (127.0.0.1:4100)           │
│   ┌────────────────────────▼────────────────────────┐   │
│   │ Public Service (Fastify + TypeScript)           │   │
│   │ 监听: 127.0.0.1:4100 (严格回环绑定)            │   │
│   │ 功能: SQLite、媒体制品、LLM 路由、ffmpeg 管线  │   │
│   └────────────────────────┬────────────────────────┘   │
│                            │                            │
│                            ▼                            │
│                    持久化数据卷 (/app/data)              │
│               (sthstart.db / narrative.db / artifacts) │
└────────────────────────────┬────────────────────────────┘
                             │
                  挂载映射: ./data:/app/data
                             │
                             ▼
                      宿主机磁盘 ./data
```

### 为什么采用一体化容器（All-in-One）？
1. **安全闭环**：公共服务核心接口持有高权限管理员令牌，系统设计强制只监听 `127.0.0.1` 本地回环。在同一容器内运行时，Portal BFF 通过本地网络调用公共服务，外部网络只能访问经身份校验的 4173 端口，从网络层杜绝 4100 端口意外泄露。
2. **轻量高效**：共享底层 Node.js 22 运行时与 FFmpeg 视频转码工具链，零多余网络开销。
3. **数据自包含**：所有 SQLite 数据库、多媒体制品与日志均汇聚在 `/app/data` 目录下，单一 Volume 即可完成整机备份与迁移。

---

## 快速上手

### 方式一：使用 Docker Compose（推荐）

#### 1. 准备配置文件
复制环境变量模板：
```bash
cp .env.docker.example .env
```

使用 Node.js 生成高熵随机凭据（至少 32 字符），填入 `.env`：
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
确保 `.env` 中至少包含：
```dotenv
PORTAL_PORT=4173
STHSTART_ADMIN_TOKEN=<第1个32位随机密钥>
STHSTART_IMAGE_SIGNING_SECRET=<第2个32位随机密钥>
STHSTART_SESSION_SECRET=<第3个32位随机密钥>
STHSTART_LAN_ACCESS=true
```
> **提示**：若未填写密钥，容器在启动时会自动生成临时高熵密钥保障正常运行；生产环境建议在 `.env` 中固定配置以便重启后会话保持。

#### 2. 构建并启动容器
```bash
docker compose up -d --build
```

#### 3. 访问系统
- 本地浏览器打开：`http://localhost:4173`
- 查看运行日志：`docker compose logs -f`

---

### 方式二：使用 Docker CLI 命令

若不使用 Compose，可直接通过 `docker build` 和 `docker run` 运行：

```bash
# 1. 构建镜像
docker build -t sthstart:latest .

# 2. 运行容器（挂载当前目录的 data 目录）
docker run -d \
  --name sthstart \
  --restart unless-stopped \
  -p 4173:4173 \
  -v $(pwd)/data:/app/data \
  -e STHSTART_LAN_ACCESS=true \
  sthstart:latest
```

---

## 数据持久化与维护

容器将数据统一保存在 `/app/data`，映射到宿主机的 `./data`：

| 容器内路径 | 宿主机路径 | 说明 |
| :--- | :--- | :--- |
| `/app/data/sthstart.db` | `./data/sthstart.db` | 主应用 SQLite 数据库（笔记、角色、生成任务等） |
| `/app/data/narrative.db` | `./data/narrative.db` | 叙事档案 SQLite 数据库 |
| `/app/data/artifacts/` | `./data/artifacts/` | 多媒体存储库（AI 生图、视频剪辑、音频片段） |
| `/app/data/logs/` | `./data/logs/` | 运行排查与脱敏诊断日志 |

### 数据库更新与迁移
容器启动脚本 `scripts/start-docker.mjs` 会在每次服务就绪前自动执行 `npm run db:migrate`，保障数据库 schema 始终与最新版本匹配。

### 数据备份与恢复
在宿主机项目根目录下执行（无需停止容器）：
```bash
# 备份数据库到 ./data/backups/ 目录
npm run db:backup

# 检查数据库完整性
npm run db:integrity
```

---

## 网络访问与反向代理

### 1. 局域网访问（家庭/内网 Wi-Fi）
- 保持 `STHSTART_LAN_ACCESS=true`。
- 手机、平板或同局域网电脑直接通过 `http://<宿主机局域网IP>:4173` 访问。

### 2. Nginx 反向代理与自定义域名
若通过公网域名访问，需配置反向代理并声明 Origin：

1. 在 `.env` 中配置允许的 Origin：
   ```dotenv
   STHSTART_PUBLIC_ORIGINS=https://sth.yourdomain.com
   ```
2. Nginx 配置示例：
   ```nginx
   server {
       listen 80;
       server_name sth.yourdomain.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name sth.yourdomain.com;

       ssl_certificate /path/to/fullchain.pem;
       ssl_certificate_key /path/to/privkey.pem;

       # 允许大文件多媒体上传（如视频、音频片段）
       client_max_body_size 500M;

       location / {
           proxy_pass http://127.0.0.1:4173;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

### 3. Cloudflare Tunnel 远程访问
若使用 Cloudflare Tunnel 实现免公网 IP 访问：
1. 在 `cloudflared` 的 `config.yml` 中映射到容器的 Portal 端口：
   ```yaml
   ingress:
     - hostname: sth.yourdomain.com
       service: http://127.0.0.1:4173
     - service: http_status:404
   ```
2. 若开启了 Cloudflare Access 单点登录保护，在 `.env` 填入对应的凭据：
   ```dotenv
   CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
   CF_ACCESS_AUD=your-application-audience-tag
   ```

---

## 外部算力与 AI 节点桥接

容器内已预先配置 `host.docker.internal` 解析：

1. **连接宿主机 ComfyUI**：
   - 宿主机 ComfyUI 启动时指定 `--listen 0.0.0.0`。
   - 在 SthStart 控制中心的 ComfyUI 地址填入：`http://host.docker.internal:8188`。

2. **连接宿主机 Windows Worker**：
   - 宿主机运行 `workers/windows-worker`。
   - SthStart 可直接通过 `http://host.docker.internal:4101` 与算力节点通信。

3. **内置 FFmpeg 多媒体管线**：
   - 镜像内部已预装完整版 `ffmpeg` 与 `ffprobe`。进入设置页的“媒体诊断”，视频预处理与自动缩略图生成默认处于就绪状态，无需宿主机额外配置。

---

## 常用运维命令

```bash
# 启动服务并在后台运行
docker compose up -d

# 查看实时日志
docker compose logs -f

# 检查容器运行状态与健康检查结果
docker compose ps

# 重启容器
docker compose restart

# 停止并移除容器（数据保留在 ./data）
docker compose down

# 进入容器 Shell 环境排查
docker compose exec sthstart bash
```
