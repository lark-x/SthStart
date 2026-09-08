# syntax=docker/dockerfile:1

# ==========================================
# 1. Build Stage
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Configure npm mirror for fast and reliable dependency installation
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry ${NPM_REGISTRY}

# Copy package manifests for dependency layer caching
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/activity-playback/package.json ./packages/activity-playback/
COPY apps/service/package.json ./apps/service/

# Install all workspace dependencies
RUN npm ci

# Copy project source code
COPY . .

# Build Portal and Service
RUN npm run build

# ==========================================
# 2. Production Runtime Stage
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

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
