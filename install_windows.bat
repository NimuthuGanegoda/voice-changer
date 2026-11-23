@echo off
setlocal
cd /d "%~dp0"

echo === VoiceChanger Windows Setup (No Preinstalled Python Required) ===

set "PYTHON_EXE="
for /f "delims=" %%p in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%p"
if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"

if not defined PYTHON_EXE (
    where winget >nul 2>nul
    if errorlevel 1 (
        echo [FAIL] Neither Python 3.10 nor winget was found.
        echo Install Python 3.10 from https://www.python.org/downloads/windows/ OR use VoiceChangerSetup.exe.
        pause
        exit /b 1
    )
    echo Installing Python 3.10 per-user via official Microsoft winget...
    winget install -e --id Python.Python.3.10 --scope user --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo [FAIL] winget Python installation failed.
        pause
        exit /b 1
    )
    if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
)

if not defined PYTHON_EXE (
    for /f "delims=" %%p in ('where python 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%p"
)
if not defined PYTHON_EXE (
    echo [FAIL] Python installed but not detected yet. Open a new terminal and re-run install_windows.bat.
    pause
    exit /b 1
)

"%PYTHON_EXE%" -c "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ required'"
if errorlevel 1 goto :fail

if not exist "venv\Scripts\python.exe" (
    echo Creating isolated virtual environment in venv\ ...
    "%PYTHON_EXE%" -m venv venv
    if errorlevel 1 goto :fail
)

call "venv\Scripts\activate.bat"
python -m pip install --upgrade pip
if errorlevel 1 goto :fail

pip install -r server\requirements.txt
if errorlevel 1 goto :fail

echo.
echo Setup complete. Launching VoiceChanger server via start_local.bat ...
call start_local.bat %*
goto :eof

:fail
echo.
echo [FAIL] Setup stopped with an error.
pause
exit /b 1
