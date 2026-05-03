@echo off
setlocal EnableExtensions
rem Install layout: {app}\runtime\python, {app}\app\hermes-agent, {app}\app\hermes-webui, {app}\tools\bin, {app}\node
set "ROOT=%~dp0.."
set "PATH=%ROOT%\runtime\python;%ROOT%\tools\bin;%ROOT%\node;%PATH%"
set "HERMES_WEBUI_NATIVE_FOLDER_PICKER=1"
set "HERMES_WEBUI_AGENT_DIR=%ROOT%\app\hermes-agent"
set "HERMES_WEBUI_PYTHON=%ROOT%\runtime\python\python.exe"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
if not exist "%HERMES_WEBUI_PYTHON%" (
  set "HERMES_WEBUI_PYTHON=%ROOT%\runtime\venv\Scripts\python.exe"
)
if not exist "%HERMES_WEBUI_PYTHON%" (
  echo Missing Python runtime: "%ROOT%\runtime\python\python.exe"
  echo Complete the staging/build pipeline so runtime\python exists.
  exit /b 1
)
cd /d "%ROOT%\app\hermes-webui"
"%HERMES_WEBUI_PYTHON%" server.py %*
