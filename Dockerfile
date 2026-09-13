# syntax=docker/dockerfile:1

# ==========================================
# 1. Build Stage
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Configure npm mirror for fast and reliable dependency installation
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG HF_ENDPOINT=https://hf-mirror.com
RUN npm config set registry ${NPM_REGISTRY}

# The embedded Linshe vector service is a Python application. Keep its
# environment in the image so the Docker deployment can manage it just like
# the Node services.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-dev python3-venv python3-pip build-essential \
 && rm -rf /var/lib/apt/lists/*

# Copy package manifests for dependency layer caching
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/activity-playback/package.json ./packages/activity-playback/
COPY apps/service/package.json ./apps/service/

# Install all workspace dependencies
RUN npm ci

# Copy project source code
COPY . .

# Install the vector runtime and its local Jina model during the image build.
# The model is intentionally baked into the image; Chroma data is persisted
# separately through the /app/data bind mount below.
RUN python3 -m venv /app/upstream/linshe/vector-service/venv \
 && /app/upstream/linshe/vector-service/venv/bin/python -m pip install --upgrade pip \
 && /app/upstream/linshe/vector-service/venv/bin/python -m pip install --no-cache-dir -r /app/upstream/linshe/vector-service/requirements.txt \
 && HF_ENDPOINT="${HF_ENDPOINT}" /app/upstream/linshe/vector-service/venv/bin/python /app/upstream/linshe/vector-service/download_model.py

# 安装邻舍（内嵌应用）依赖：upstream/linshe 是独立 Submodule，不属于根 npm workspace，
# 根目录的 npm ci 不会覆盖它。镜像内需要能直接拉起邻舍核心（3099，含已构建界面）与前端开发服务器。
RUN cd upstream/linshe/agent-core && npm ci --no-audit --no-fund \
 && cd ../web-ui && npm ci --no-audit --no-fund

# Build Portal and Service
RUN npm run build

# ==========================================
# 2. Production Runtime Stage
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# The vector virtualenv created in the builder uses the system Python runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Optional FFmpeg installation for advanced video processing
ARG INSTALL_FFMPEG=false
RUN if [ "$INSTALL_FFMPEG" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_ENV=production
ENV SERVICE_HOST=127.0.0.1
ENV SERVICE_PORT=4100
ENV PORTAL_PORT=4173
ENV STHSTART_DATABASE_PATH=/app/data/sthstart.db
ENV STHSTART_NARRATIVE_DATABASE_PATH=/app/data/narrative.db
ENV STHSTART_ARTIFACT_DIR=/app/data/artifacts
ENV STHSTART_LOG_DIR=/app/data/logs

# Copy application artifacts and node_modules from builder
COPY --from=builder /app /app

# Create data directories for persistence
RUN mkdir -p /app/data/artifacts /app/data/logs

# Volume for database, media artifacts, and logs
VOLUME ["/app/data"]

# Portal external port
EXPOSE 4173

# Node-native healthcheck (no external curl required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:4173/'), fetch('http://127.0.0.1:4100/api/v1/health')]).then(rs => rs.every(r => r.ok) ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start SthStart portal and service via supervisor script
CMD ["npm", "run", "start:docker"]
