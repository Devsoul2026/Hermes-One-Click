#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Run hermes-webui against sibling hermes-agent (dev tree). Uses repo .venv if present, else python on PATH.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root "hermes-agent"
$webui = Join-Path $root "hermes-webui"

$pyCandidates = @(
  (Join-Path $root "hermes-agent\.venv\Scripts\python.exe"),
  (Join-Path $root "hermes-agent\venv\Scripts\python.exe"),
  (Join-Path $root ".venv\Scripts\python.exe")
)
$python = $pyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) { $python = "python" }

$env:HERMES_WEBUI_AGENT_DIR = $agent
$env:HERMES_WEBUI_PYTHON = $python
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
if ($IsWindows -or $env:OS -match "Windows") {
  $env:HERMES_WEBUI_NATIVE_FOLDER_PICKER = "1"
}
Write-Host "HERMES_WEBUI_AGENT_DIR=$($env:HERMES_WEBUI_AGENT_DIR)"
Write-Host "HERMES_WEBUI_PYTHON=$($env:HERMES_WEBUI_PYTHON)"
Write-Host "PYTHONUTF8=$($env:PYTHONUTF8)"
Write-Host "PYTHONIOENCODING=$($env:PYTHONIOENCODING)"
Set-Location $webui
& $python server.py @args
