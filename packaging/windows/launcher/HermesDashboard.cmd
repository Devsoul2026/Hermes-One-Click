@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "PATH=%ROOT%\tools\bin;%ROOT%\node;%PATH%"
set "HERMES_EXE=%ROOT%\runtime\venv\Scripts\hermes.exe"
if not exist "%HERMES_EXE%" (
  echo Missing Hermes CLI: "%HERMES_EXE%"
  exit /b 1
)
cd /d "%ROOT%\app\hermes-agent"
"%HERMES_EXE%" dashboard --host 127.0.0.1 --port 9119 %*
