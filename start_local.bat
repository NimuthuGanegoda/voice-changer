@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo python not found on PATH. Install Python 3.10+ from python.org first,
    echo and check "Add python.exe to PATH" during install.
    goto :fail
)

if not exist "venv\Scripts\activate.bat" (
    echo No venv\ found. Set it up first:
    echo   python -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r server\requirements.txt
    goto :fail
)

call venv\Scripts\activate.bat

where nvidia-smi >nul 2>nul
if errorlevel 1 (
    echo GPU: no NVIDIA GPU detected - will run on CPU or DirectML if available.
) else (
    echo GPU: NVIDIA GPU detected.
)

cd server

echo Starting server on http://127.0.0.1:18888 ...
rem Open the browser a few seconds after launch, from a detached helper, so
rem Ctrl+C here still cleanly stops the server in the foreground below.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:18888"
python MMVCServerSIO.py -p 18888 ^
    --content_vec_500 pretrain/checkpoint_best_legacy_500.pt ^
    --content_vec_500_onnx pretrain/content_vec_500.onnx ^
    --content_vec_500_onnx_on true ^
    --hubert_base pretrain/hubert_base.pt ^
    --hubert_soft pretrain/hubert/hubert-soft-0d54a1f4.pt ^
    --nsf_hifigan pretrain/nsf_hifigan/model ^
    --crepe_onnx_full pretrain/crepe_onnx_full.onnx ^
    --crepe_onnx_tiny pretrain/crepe_onnx_tiny.onnx ^
    --rmvpe pretrain/rmvpe.pt ^
    --rmvpe_onnx pretrain/rmvpe.onnx ^
    --host 127.0.0.1 ^
    --test_connect 127.0.0.1 ^
    --model_dir model_dir ^
    --samples samples.json

if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo Server stopped with an error - see above.
pause
exit /b 1
