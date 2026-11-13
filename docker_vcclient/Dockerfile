# Build from the repository root: docker build -f docker_vcclient/Dockerfile .
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/lib/package.json ./client/lib/
COPY client/demo/package.json ./client/demo/
RUN npm ci
COPY client/lib ./client/lib
COPY client/demo ./client/demo
RUN npm run build:client

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip espeak gosu libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /voice-changer/server
COPY server/requirements*.txt ./
RUN python3 -m pip install --upgrade pip && python3 -m pip install -r requirements.txt
COPY server /voice-changer/server
COPY --from=frontend /app/client/demo/dist /voice-changer/client/demo/dist
RUN chmod +x setup.sh exec.sh && mkdir -p model_dir pretrain upload_dir tmp_dir
EXPOSE 18888
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18888/api/hello', timeout=3)"
ENTRYPOINT ["/bin/bash", "setup.sh"]
CMD ["-p", "18888", "--host", "0.0.0.0", "--https", "false", "--model_dir", "model_dir"]
