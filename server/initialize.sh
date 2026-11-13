#!/bin/bash
# Explicitly destructive maintenance helper. Never run this during normal startup.
set -euo pipefail
cd "$(dirname "$0")"
if [[ "${1:-}" != "--yes" ]]; then
    echo "This deletes server/model_dir and server/pretrain." >&2
    echo "Re-run with --yes only if you intend to remove all downloaded models and weights." >&2
    exit 1
fi
for directory in model_dir pretrain; do
    if [[ -e "$directory" ]]; then rm -rf -- "$directory"; fi
done
