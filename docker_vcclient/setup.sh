#!/bin/bash
set -euo pipefail
USER_ID=${LOCAL_UID:-10001}
GROUP_ID=${LOCAL_GID:-10001}
if ! getent group "$GROUP_ID" >/dev/null; then groupadd -g "$GROUP_ID" vcclient; fi
if ! id -u "$USER_ID" >/dev/null 2>&1; then useradd -u "$USER_ID" -g "$GROUP_ID" -m vcclient; fi
mkdir -p model_dir pretrain upload_dir tmp_dir keys
chown -R "$USER_ID:$GROUP_ID" model_dir pretrain upload_dir tmp_dir keys
exec /usr/sbin/gosu "$USER_ID:$GROUP_ID" /bin/bash exec.sh "$@"
