#!/bin/bash
set -eu

# Navigate to the voice-changer directory
cd "$(dirname "$0")"

# Activate the existing virtual environment
source venv/bin/activate

# Start the server with the necessary arguments
cd server
python3 MMVCServerSIO.py -p 18888 \
    --content_vec_500 pretrain/checkpoint_best_legacy_500.pt \
    --content_vec_500_onnx pretrain/content_vec_500.onnx \
    --content_vec_500_onnx_on true \
    --hubert_base pretrain/hubert_base.pt \
    --hubert_soft pretrain/hubert/hubert-soft-0d54a1f4.pt \
    --nsf_hifigan pretrain/nsf_hifigan/model \
    --crepe_onnx_full pretrain/crepe_onnx_full.onnx \
    --crepe_onnx_tiny pretrain/crepe_onnx_tiny.onnx \
    --rmvpe pretrain/rmvpe.pt \
    --rmvpe_onnx pretrain/rmvpe.onnx \
    --host 127.0.0.1 \
    --test_connect 127.0.0.1 \
    --model_dir model_dir \
    --samples samples.json

echo "Server started on http://127.0.0.1:18888"
