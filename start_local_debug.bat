@echo off
rem Debug launcher - same as start_local.bat but echoes every command and never
rem auto-opens the browser, so you can read exactly what ran and what failed.
setlocal
cd /d "%~dp0"

echo === VoiceChanger debug launch ===
echo Working dir: %cd%

where python >nul 2>nul
if errorlevel 1 (
    echo [FAIL] python not found on PATH.
    goto :fail
)
for /f "delims=" %%v in ('python --version 2^>^&1') do echo Python: %%v

set "VENV_ACTIVATE="
if exist "venv\Scripts\activate.bat" set "VENV_ACTIVATE=venv\Scripts\activate.bat"
if not defined VENV_ACTIVATE if exist ".venv\Scripts\activate.bat" set "VENV_ACTIVATE=.venv\Scripts\activate.bat"

if not defined VENV_ACTIVATE (
    echo [FAIL] No virtualenv (venv\ or .venv\) found. Set it up first:
    echo   python -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r server\requirements.txt
    goto :fail
)

python -c "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'"
if errorlevel 1 goto :fail

call "%VENV_ACTIVATE%"
echo Venv: activated (%VENV_ACTIVATE%)

where nvidia-smi >nul 2>nul
if errorlevel 1 (
    echo GPU: no NVIDIA GPU detected - will run on CPU or DirectML if available.
) else (
    echo GPU: NVIDIA GPU detected, details:
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
)

cd server

echo Launching MMVCServerSIO.py on 127.0.0.1:18888...
echo.
python MMVCServerSIO.py -p 18888 --content_vec_500 pretrain/checkpoint_best_legacy_500.pt --content_vec_500_onnx pretrain/content_vec_500.onnx --content_vec_500_onnx_on true --hubert_base pretrain/hubert_base.pt --hubert_soft pretrain/hubert/hubert-soft-0d54a1f4.pt --nsf_hifigan pretrain/nsf_hifigan/model --crepe_onnx_full pretrain/crepe_onnx_full.onnx --crepe_onnx_tiny pretrain/crepe_onnx_tiny.onnx --rmvpe pretrain/rmvpe.pt --rmvpe_onnx pretrain/rmvpe.onnx --host 127.0.0.1 --test_connect 127.0.0.1 --model_dir model_dir %*

if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo [FAIL] Server stopped with an error - see above.
pause
exit /b 1
