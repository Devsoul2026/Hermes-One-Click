@echo off
setlocal EnableExtensions
rem Install layout: {app}\runtime\venv, {app}\app\hermes-agent, {app}\app\hermes-webui, {app}\tools\bin, {app}\node
set "ROOT=%~dp0.."
set "PATH=%ROOT%\tools\bin;%ROOT%\node;%PATH%"
set "HERMES_WEBUI_NATIVE_FOLDER_PICKER=1"
set "HERMES_WEBUI_AGENT_DIR=%ROOT%\app\hermes-agent"
set "HERMES_WEBUI_PYTHON=%ROOT%\runtime\venv\Scripts\python.exe"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
if not exist "%HERMES_WEBUI_PYTHON%" (
  echo Missing venv: "%HERMES_WEBUI_PYTHON%"
  echo Complete the staging/build pipeline so runtime\venv exists.
  exit /b 1
)
cd /d "%ROOT%\app\hermes-webui"
"%HERMES_WEBUI_PYTHON%" server.py %*
