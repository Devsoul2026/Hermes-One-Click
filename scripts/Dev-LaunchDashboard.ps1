#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Run hermes dashboard (Vite UI + FastAPI) from sibling hermes-agent. Requires hermes-agent[web] in that interpreter.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root "hermes-agent"

$pyCandidates = @(
  (Join-Path $agent ".venv\Scripts\python.exe"),
  (Join-Path $agent "venv\Scripts\python.exe"),
  (Join-Path $root ".venv\Scripts\python.exe")
)
$python = $pyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) { $python = "python" }

Set-Location $agent
& $python -m hermes_cli.main dashboard --host 127.0.0.1 --port 9119 @args
