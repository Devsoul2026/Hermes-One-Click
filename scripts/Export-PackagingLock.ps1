#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Write packaging/lock.json with current hermes-agent and hermes-webui git revisions.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $root "packaging\lock.json"

function Get-Rev([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  Push-Location $path
  try {
    $sha = git rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $sha.Trim()
  } finally {
    Pop-Location
  }
}

$agent = Join-Path $root "hermes-agent"
$webui = Join-Path $root "hermes-webui"
$agentRev = Get-Rev $agent
$webuiRev = Get-Rev $webui

if (-not $agentRev -or -not $webuiRev) {
  Write-Error "Could not read git HEAD in hermes-agent and/or hermes-webui. Ensure each is a git checkout."
}

$obj = [ordered]@{
  schema       = 1
  description  = "Pinned upstream revisions for reproducible Windows installer builds."
  hermes_agent = [ordered]@{
    git      = "https://github.com/NousResearch/hermes-agent.git"
    revision = $agentRev
  }
  hermes_webui = [ordered]@{
    git      = "https://github.com/NousResearch/hermes-webui.git"
    revision = $webuiRev
  }
}

$json = $obj | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($lockPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $lockPath"
