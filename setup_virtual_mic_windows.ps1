# Installs VB-Cable (a free, pre-signed virtual audio driver from VB-Audio) so
# ANY Windows app (Discord, Zoom, games, browsers...) can pick the converted
# voice as its mic input. This automates installing VB-Audio's existing signed
# driver - it does not ship a custom driver, since that would need its own EV
# code-signing certificate and WHQL submission.
#
# Usage (run as Administrator - driver install requires it):
#   powershell -ExecutionPolicy Bypass -File setup_virtual_mic_windows.ps1
#   powershell -ExecutionPolicy Bypass -File setup_virtual_mic_windows.ps1 -Uninstall

param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script installs a system driver and must be run as Administrator. Right-click PowerShell -> 'Run as administrator', then re-run this script."
    exit 1
}

$downloadUrl = "https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip"
$workDir = Join-Path $env:TEMP "voicechanger_vbcable_setup"
$zipPath = Join-Path $workDir "VBCABLE_Driver_Pack.zip"

if ($Uninstall) {
    $installer = Get-ChildItem -Path $workDir -Filter "VBCABLE_Setup_x64.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $installer) {
        Write-Error "Installer not found in $workDir - run without -Uninstall first, or uninstall 'VB-Audio Virtual Cable' from Windows Settings > Apps."
        exit 1
    }
    Write-Host "Uninstalling VB-Cable..."
    Start-Process -FilePath $installer.FullName -ArgumentList "-u", "-h" -Wait
    Write-Host "Done. A reboot may be required for the audio device list to update."
    exit 0
}

if (Test-Path $workDir) { Remove-Item -Path $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir | Out-Null

Write-Host "Downloading VB-Cable from vb-audio.com (one-time, requires internet for this step only)..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Error "Download failed (VB-Audio may have moved to a newer pack version, breaking this URL). Download it yourself from https://vb-audio.com/Cable/ , extract it, and run VBCABLE_Setup_x64.exe as Administrator instead."
    exit 1
}

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $workDir -Force

$installer = Get-ChildItem -Path $workDir -Filter "VBCABLE_Setup_x64.exe" -Recurse | Select-Object -First 1
if (-not $installer) {
    Write-Error "VBCABLE_Setup_x64.exe not found after extraction - the download layout may have changed. Install manually from https://vb-audio.com/Cable/"
    exit 1
}

Write-Host "Installing VB-Cable driver (silent)..."
Start-Process -FilePath $installer.FullName -ArgumentList "-i", "-h" -Wait

Write-Host ""
Write-Host "Done. Reboot (or at least restart the Windows Audio service) for the new devices to appear."
Write-Host "Setup:"
Write-Host "  1. In VCClient's web UI, enable Server Audio and set the OUTPUT device to 'CABLE Input'."
Write-Host "  2. In any other app, pick 'CABLE Output' as the microphone."
