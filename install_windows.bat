@echo off
setlocal
cd /d "%~dp0"

echo === VoiceChanger Windows Setup (No Preinstalled Python Required) ===

set "PYTHON_EXE="
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_EXE=venv\Scripts\python.exe"
)
if not defined PYTHON_EXE if exist ".python310\tools\python.exe" (
    ".python310\tools\python.exe" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_EXE=%~dp0.python310\tools\python.exe"
)
for %%v in (Python310 Python311 Python312) do (
    if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\%%v\python.exe" (
        "%LOCALAPPDATA%\Programs\Python\%%v\python.exe" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
        if not errorlevel 1 set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\%%v\python.exe"
    )
    if not defined PYTHON_EXE if exist "%ProgramFiles%\%%v\python.exe" (
        "%ProgramFiles%\%%v\python.exe" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
        if not errorlevel 1 set "PYTHON_EXE=%ProgramFiles%\%%v\python.exe"
    )
)
if not defined PYTHON_EXE (
    for /f "delims=" %%p in ('where python 2^>nul') do (
        echo "%%p" | findstr /i "WindowsApps" >nul
        if errorlevel 1 if not defined PYTHON_EXE (
            "%%p" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
            if not errorlevel 1 set "PYTHON_EXE=%%p"
        )
    )
)

if not defined PYTHON_EXE (
    where winget >nul 2>nul
    if not errorlevel 1 (
        echo Installing Python 3.10 per-user via official Microsoft winget...
        winget install -e --id Python.Python.3.10 --scope user --accept-package-agreements --accept-source-agreements
        if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
            "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
            if not errorlevel 1 set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
        )
    )
)

if not defined PYTHON_EXE (
    echo Bootstrapping portable Python 3.10.11 into .python310\ via official NuGet package...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$ErrorActionPreference='Stop'; " ^
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
        "$zip = Join-Path $PWD 'python310.nupkg.zip'; " ^
        "Invoke-WebRequest -Uri 'https://www.nuget.org/api/v2/package/python/3.10.11' -OutFile $zip -UseBasicParsing; " ^
        "if (Test-Path '.python310') { Remove-Item '.python310' -Recurse -Force }; " ^
        "Expand-Archive -Path $zip -DestinationPath '.python310' -Force; " ^
        "Remove-Item $zip -Force"
    if exist ".python310\tools\python.exe" (
        ".python310\tools\python.exe" -m ensurepip --upgrade >nul 2>nul
        set "PYTHON_EXE=%~dp0.python310\tools\python.exe"
    )
)

if not defined PYTHON_EXE (
    echo [FAIL] Could not find or bootstrap Python 3.10+.
    echo Install Python 3.10 from https://www.python.org/downloads/windows/ OR use https://nimuthuganegoda.github.io/voice-changer/
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
