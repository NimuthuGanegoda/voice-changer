; VoiceChanger NSIS installer.
;
; Installs per-user to %LOCALAPPDATA%\VoiceChanger, not Program Files. The app
; resolves its model/pretrain paths relative to its own working directory
; (server/MMVCServerSIO.py's --model_dir/--pretrain/etc default to plain
; relative paths like "pretrain/rmvpe.pt", not an OS-appropriate app-data
; location) and downloads several hundred MB of weights into them on first
; run. Program Files is read-only for standard users, so installing there
; would make first launch fail with a permissions error unless run as
; Administrator every time - installing per-user avoids that, and avoids
; needing a UAC prompt at all.
;
; Build (from repo root, after `pyinstaller VoiceChanger.spec`):
;   makensis /DVERSION=2.2.4.0 /DSOURCE_EXE=dist\VoiceChanger.exe installer\VoiceChanger.nsi

!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0.0"
!endif
!ifndef SOURCE_EXE
  !define SOURCE_EXE "..\dist\VoiceChanger.exe"
!endif

Name "VoiceChanger"
OutFile "..\dist\VoiceChangerSetup.exe"
Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\VoiceChanger"
InstallDirRegKey HKCU "Software\VoiceChanger" "InstallDir"

VIProductVersion "${VERSION}"
VIAddVersionKey "ProductName" "VoiceChanger"
VIAddVersionKey "FileDescription" "VoiceChanger Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

!define MUI_ABORTWARNING
!define MUI_ICON "..\docs\favicon.ico"
!define MUI_UNICON "..\docs\favicon.ico"

!define MUI_FINISHPAGE_RUN "$INSTDIR\VoiceChanger.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch VoiceChanger"
!define MUI_FINISHPAGE_RUN_WORKINGDIR "$INSTDIR"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "VoiceChanger (required)" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "${SOURCE_EXE}"
  File "..\LICENSE"

  WriteRegStr HKCU "Software\VoiceChanger" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\VoiceChanger"
  ; Shortcuts explicitly set "Start in" to $INSTDIR - the app resolves its
  ; model/pretrain paths relative to the process working directory, and a
  ; shortcut with no working directory set inherits whatever launched it
  ; (Explorer's own directory), not the target's directory.
  CreateShortcut "$SMPROGRAMS\VoiceChanger\VoiceChanger.lnk" "$INSTDIR\VoiceChanger.exe" "" "$INSTDIR\VoiceChanger.exe" 0 SW_SHOWNORMAL "" "" "$INSTDIR"
  CreateShortcut "$SMPROGRAMS\VoiceChanger\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "DisplayName" "VoiceChanger"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "DisplayIcon" "$INSTDIR\VoiceChanger.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "Publisher" "VoiceChanger contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "DisplayVersion" "${VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" SEC_DESKTOP
  CreateShortcut "$DESKTOP\VoiceChanger.lnk" "$INSTDIR\VoiceChanger.exe" "" "$INSTDIR\VoiceChanger.exe" 0 SW_SHOWNORMAL "" "" "$INSTDIR"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "The VoiceChanger application itself."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "Add a shortcut to the Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Delete "$INSTDIR\VoiceChanger.exe"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\Uninstall.exe"
  ; Model weights/config the app downloaded/wrote at runtime are left in
  ; place on purpose - a user reinstalling shouldn't have to re-download
  ; several hundred MB of pretrained weights. Remove $INSTDIR manually to
  ; clear those too.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\VoiceChanger\VoiceChanger.lnk"
  Delete "$SMPROGRAMS\VoiceChanger\Uninstall.lnk"
  RMDir "$SMPROGRAMS\VoiceChanger"
  Delete "$DESKTOP\VoiceChanger.lnk"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceChanger"
  DeleteRegKey HKCU "Software\VoiceChanger"
SectionEnd
