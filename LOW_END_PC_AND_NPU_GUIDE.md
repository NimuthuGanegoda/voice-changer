# Optimization Guide for Potato PCs & Intel NPUs

This repository includes optimizations to ensure the Voice Changer runs smoothly on low-end hardware ("Potato PCs"), integrated graphics, and the latest **Intel NPUs**.

## 1. Intel NPU / OpenVINO Acceleration

If your laptop or PC has an **Intel Core Ultra processor** with a built-in NPU (Neural Processing Unit), you can offload the AI inference to the NPU. This saves battery life and frees up your CPU/GPU for gaming.

### How to enable NPU support:
1. Open your command prompt or terminal in the project folder.
2. Uninstall the standard ONNX runtime:
   ```bash
   pip uninstall -y onnxruntime onnxruntime-gpu
   ```
3. Install the OpenVINO execution provider:
   ```bash
   pip install onnxruntime-openvino
   ```
4. Start the Voice Changer. In the client interface, select **NPU** or **OpenVINO** from the GPU/Device selection dropdown (usually listed as device `65536`).

## 2. Potato PC / Low-End CPU Optimization

By default, PyTorch and ONNX try to use as many CPU threads as possible. On a low-end CPU (e.g., 2 or 4 cores), this causes "thrashing"—where the CPU wastes time switching between threads instead of actually processing the audio, leading to stuttering and robotic noises.

### Automatic Optimizations
The code has been updated to automatically detect your CPU core count and limit ONNX thread usage to a safe number (usually half your physical cores, max 4) to prevent freezing.

### Manual Launch Script (Windows)
For the best experience on a very old or low-end PC, we have provided an optimized launch script:

1. Double-click the `start_optimized_low_end.bat` file.
2. This script automatically restricts PyTorch background threads (`OMP_NUM_THREADS=2`) to prevent CPU 100% lockups.
3. In the Voice Changer UI, ensure you select **CPU** and use a smaller Chunk Size (e.g., 96 or 128) and Extra Size (e.g., 4096) to keep memory usage low.

## 3. Web Client Optimization
If the web interface is lagging your browser, use the optimized build:
Check `recorder/LOW_END_OPTIMIZATION_README.md` for instructions on running the minimal-bundle version of the UI.
