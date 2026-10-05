; Lelons Converter installer (built with NSIS).
; Installs just for the current user, so it never asks for admin rights.

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APP_NAME "Lelons Converter"
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"  ; build.sh passes the real one from src/version.py
!endif
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LelonsConverter"
!define APP_PUBLISHER "Lelon"
; STAGE is passed in by build.sh: the folder holding app\ and runtime\.

; The app starts with "Lelons Converter.exe": Python's own pythonw.exe with
; the app's name and icon (see build.sh), so Windows shows it as the app.
; -E and -s keep any Python the user installed themselves from interfering.
!define RUN_EXE "$INSTDIR\runtime\Lelons Converter.exe"
!define RUN_ARGS '-E -s "$INSTDIR\app\main.py"'
!define RUN_ICON "$INSTDIR\app\icon.ico"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${APP_NAME} ${APP_VERSION}"
ShowInstDetails show

; Version details shown in the file's Properties window.
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "${APP_PUBLISHER}"

!define MUI_ICON "../assets/icon.ico"
!define MUI_UNICON "../assets/icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP_NAME} now"

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWelcomeWhenUpdating
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function OpenApp
  Exec '"${RUN_EXE}" ${RUN_ARGS}'
FunctionEnd

; The app starts the installer with /update when it updates itself.
Function SkipWelcomeWhenUpdating
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/update" $1
  IfErrors +2
  Abort
FunctionEnd

; Files of a running app can't be replaced, so close the app first.
; Only programs started from this app's folder, or using a file from it
; (like WebView2Loader.dll), are closed.
!macro CloseRunningApp
  System::Call 'kernel32::SetEnvironmentVariable(t "LELONS_DIR", t "$INSTDIR")'
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d = $$env:LELONS_DIR + '\'; Get-Process -ErrorAction SilentlyContinue | Where-Object { try { ($$_.Path -and $$_.Path.StartsWith($$d, 'OrdinalIgnoreCase')) -or ($$_.Modules | Where-Object { $$_.FileName -and $$_.FileName.StartsWith($$d, 'OrdinalIgnoreCase') }) } catch { $$false } } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  Sleep 800
!macroend

Section "Install"
  !insertmacro CloseRunningApp
  ; Clear out an older version first so no stale files are left behind.
  ; If something still holds a file (an app that's slow to close), close it again and wait a bit.
  StrCpy $1 0
  clear_old:
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  IfFileExists "$INSTDIR\app\*.*" still_there
  IfFileExists "$INSTDIR\runtime\*.*" still_there
  Goto cleared
  still_there:
  IntOp $1 $1 + 1
  IntCmp $1 6 cleared
  DetailPrint "Waiting for Lelons Converter to close..."
  !insertmacro CloseRunningApp
  Sleep 1500
  Goto clear_old
  cleared:
  Delete "$INSTDIR\${APP_NAME}.exe"

  SetOutPath "$INSTDIR"
  File /r "${STAGE}/*.*"
  ; Left over from testing a fix on one PC.
  RMDir /r "$INSTDIR\pycache_backup"
  RMDir /r "$INSTDIR\pycache_backup2"

  ; Python turns its code into a faster-loading form the first time it runs
  ; it, which would make the app's first start slow. Do it now instead.
  ; (Done here rather than shipped, so the download is smaller.)
  DetailPrint "Getting the app ready (this takes a few seconds)..."
  nsExec::Exec '"$INSTDIR\runtime\python.exe" -E -s -m compileall -q -j 0 --invalidation-mode unchecked-hash "$INSTDIR\runtime\Lib" "$INSTDIR\app"'
  Pop $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "${RUN_EXE}" '${RUN_ARGS}' "${RUN_ICON}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "${RUN_EXE}" '${RUN_ARGS}' "${RUN_ICON}"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "${RUN_ICON}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro CloseRunningApp
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
