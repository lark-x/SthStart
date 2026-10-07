# Upgrade an already-built image without rebuilding its bundled vector model.
# Example: docker build -f scripts/docker/media-runtime.Dockerfile \
#   --build-arg BASE_IMAGE=sthstart:before-media -t sthstart:latest .
ARG BASE_IMAGE=sthstart:latest
FROM ${BASE_IMAGE}
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -version >/dev/null \
 && ffprobe -version >/dev/null
