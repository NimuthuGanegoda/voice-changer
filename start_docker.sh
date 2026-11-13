#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
IMAGE=${DOCKER_IMAGE:-voice-changer:local}
EX_PORT=${EX_PORT:-18888}
USE_GPU=${USE_GPU:-off}
BIND_HOST=${BIND_HOST:-127.0.0.1}
if [[ "$BIND_HOST" != "127.0.0.1" && "$BIND_HOST" != "localhost" ]]; then
    echo "WARNING: publishing VCClient on $BIND_HOST. Keep the access token secret and use a TLS reverse proxy." >&2
fi
if [[ -z "${VCCLIENT_ACCESS_TOKEN:-}" ]]; then
    VCCLIENT_ACCESS_TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
    echo "Generated access token: $VCCLIENT_ACCESS_TOKEN"
    echo "Enter it in Advanced Settings → Server connection (or the extension popup)."
fi
mkdir -p docker_folder/model_dir docker_folder/pretrain docker_folder/upload_dir
GPU_ARGS=()
if [[ "$USE_GPU" == "on" ]]; then GPU_ARGS=(--gpus all); fi
exec docker run --rm --shm-size=1g "${GPU_ARGS[@]}" \
    -e VCCLIENT_ACCESS_TOKEN="$VCCLIENT_ACCESS_TOKEN" \
    -e LOCAL_UID="$(id -u)" -e LOCAL_GID="$(id -g)" \
    -v "$PWD/docker_folder/model_dir:/voice-changer/server/model_dir" \
    -v "$PWD/docker_folder/pretrain:/voice-changer/server/pretrain" \
    -v "$PWD/docker_folder/upload_dir:/voice-changer/server/upload_dir" \
    -p "$BIND_HOST:$EX_PORT:18888" "$IMAGE" \
    -p 18888 --host 0.0.0.0 --https false --model_dir model_dir \
    --allowed-origins "http://127.0.0.1:$EX_PORT" --allowed-origins "http://localhost:$EX_PORT" \
    --hubert_base pretrain/hubert_base.pt --hubert_base_jp pretrain/rinna_hubert_base_jp.pt \
    --hubert_soft pretrain/hubert/hubert-soft-0d54a1f4.pt --nsf_hifigan pretrain/nsf_hifigan/model \
    --content_vec_500_onnx pretrain/content_vec_500.onnx --content_vec_500_onnx_on true \
    --crepe_onnx_full pretrain/crepe_onnx_full.onnx --crepe_onnx_tiny pretrain/crepe_onnx_tiny.onnx \
    --rmvpe pretrain/rmvpe.pt --rmvpe_onnx pretrain/rmvpe.onnx
