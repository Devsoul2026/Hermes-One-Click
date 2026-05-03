@echo off
setlocal EnableExtensions
rem Desktop-window launcher: starts the local WebUI server, then opens a standalone Edge app window.
rem Install layout: {app}\runtime\python, {app}\app\hermes-agent, {app}\app\hermes-webui, {app}\tools\bin, {app}\node
set "ROOT=%~dp0.."
set "PATH=%ROOT%\runtime\python;%ROOT%\tools\bin;%ROOT%\node;%PATH%"
set "HERMES_WEBUI_NATIVE_FOLDER_PICKER=1"
set "HERMES_WEBUI_AGENT_DIR=%ROOT%\app\hermes-agent"
set "HERMES_WEBUI_PYTHON=%ROOT%\runtime\python\python.exe"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "HERMES_WEBUI_PORT=%HERMES_WEBUI_PORT%"
if "%HERMES_WEBUI_PORT%"=="" set "HERMES_WEBUI_PORT=8787"

if not exist "%HERMES_WEBUI_PYTHON%" (
  rem Compatibility fallback for older staging builds.
  set "HERMES_WEBUI_PYTHON=%ROOT%\runtime\venv\Scripts\python.exe"
)

if not exist "%HERMES_WEBUI_PYTHON%" (
  rem Development/staging fallback when Build-Staging.ps1 was run with -SkipVenv.
  set "HERMES_WEBUI_PYTHON=%ROOT%\..\..\hermes-agent\.venv\Scripts\python.exe"
)

if not exist "%HERMES_WEBUI_PYTHON%" (
  echo Missing Python runtime: "%ROOT%\runtime\python\python.exe"
  echo Complete the staging/build pipeline so runtime\python exists.
  exit /b 1
)

set "EDGE_EXE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if "%EDGE_EXE%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if "%EDGE_EXE%"=="" (
  for /f "delims=" %%E in ('where msedge.exe 2^>nul') do (
    if "%EDGE_EXE%"=="" set "EDGE_EXE=%%E"
  )
)

if "%EDGE_EXE%"=="" (
  echo Microsoft Edge was not found. Install Edge/WebView2 runtime, or open:
  echo http://127.0.0.1:%HERMES_WEBUI_PORT%
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%HERMES_WEBUI_PORT%/api/settings' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if errorlevel 1 (
  cd /d "%ROOT%\app\hermes-webui"
  start "Hermes WebUI Server" /min "%HERMES_WEBUI_PYTHON%" server.py
)

for /l %%I in (1,1,40) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%HERMES_WEBUI_PORT%/api/settings' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
  if not errorlevel 1 goto :open_window
  timeout /t 1 /nobreak >nul
)

echo Hermes WebUI did not become ready on http://127.0.0.1:%HERMES_WEBUI_PORT%
exit /b 1

:open_window
set "HERMES_EDGE_PROFILE=%LOCALAPPDATA%\Hermes\WebUIWindow"
rem Purge any stale Service Worker / HTTP cache entries that an older build
rem registered.  This guarantees the desktop window always loads the freshest
rem static assets shipped with the current installer.  Set HERMES_WEBUI_KEEP_CACHE=1
rem to skip the purge if you are debugging cache behaviour.
if /i not "%HERMES_WEBUI_KEEP_CACHE%"=="1" (
  if exist "%HERMES_EDGE_PROFILE%\Default\Service Worker" rmdir /s /q "%HERMES_EDGE_PROFILE%\Default\Service Worker" >nul 2>&1
  if exist "%HERMES_EDGE_PROFILE%\Default\Cache" rmdir /s /q "%HERMES_EDGE_PROFILE%\Default\Cache" >nul 2>&1
  if exist "%HERMES_EDGE_PROFILE%\Default\Code Cache" rmdir /s /q "%HERMES_EDGE_PROFILE%\Default\Code Cache" >nul 2>&1
)
start "Hermes" "%EDGE_EXE%" --user-data-dir="%HERMES_EDGE_PROFILE%" --no-first-run --no-default-browser-check --disable-background-networking --app="http://127.0.0.1:%HERMES_WEBUI_PORT%/" --new-window
