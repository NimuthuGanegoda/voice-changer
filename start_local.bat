@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE="
for /f "delims=" %%p in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%p"
if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
if not defined PYTHON_EXE if exist "%ProgramFiles%\Python310\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python310\python.exe"

if not defined PYTHON_EXE (
    echo python not found on PATH or standard Windows Python 3.10 directories.
    echo Choose one option:
    echo   1^) No Python at all: run install_windows.bat ^(installs user-scoped Python 3.10 + venv via winget^)
    echo   2^) Zero-install EXE: download VoiceChangerSetup.exe / VoiceChanger.exe ^(bundles Python internally^)
    echo   3^) Web Browser only: open https://nimuthuganegoda.github.io/voice-changer/ ^("Browser Neural ONNX" tab^)
    goto :fail
)

set "VENV_ACTIVATE="
if exist "venv\Scripts\activate.bat" set "VENV_ACTIVATE=venv\Scripts\activate.bat"
if not defined VENV_ACTIVATE if exist ".venv\Scripts\activate.bat" set "VENV_ACTIVATE=.venv\Scripts\activate.bat"

if not defined VENV_ACTIVATE (
    echo No virtualenv ^(venv\ or .venv\^) found. Run install_windows.bat, or manually:
    echo   "%PYTHON_EXE%" -m venv venv
    echo   venv\Scripts\activate
    echo   pip install -r server\requirements.txt
    goto :fail
)

"%PYTHON_EXE%" -c "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ is required'"
if errorlevel 1 goto :fail

call "%VENV_ACTIVATE%"

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
    %*

if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo Server stopped with an error - see above.
pause
exit /b 1
