#!/bin/bash
echo "========================================================"
echo "  Optimized Launch for Potato PCs and Intel NPUs"
echo "========================================================"
echo ""
echo "Limiting PyTorch threads to prevent CPU thrashing..."
export OMP_NUM_THREADS=2
export MKL_NUM_THREADS=2
export OPENBLAS_NUM_THREADS=2
export VECLIB_MAX_THREADS=2
export NUMEXPR_NUM_THREADS=2

echo "Optimizing ONNX Runtime memory usage..."
export ORT_TENSORRT_FP16_ENABLE=1

echo ""
echo "If you have an Intel Core Ultra (NPU), please run:"
echo "   pip uninstall -y onnxruntime onnxruntime-gpu"
echo "   pip install onnxruntime-openvino"
echo ""

echo "Starting Voice Changer Server..."
echo "--------------------------------------------------------"
python3 server/MMVCServerSIO.py -p 18888 --https False
