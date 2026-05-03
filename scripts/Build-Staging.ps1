#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Assemble _staging/Hermes for Windows installer: app copies, Vite web_dist, portable Python, launcher, optional Node portable.

.PARAMETER PipExtras
  Passed to pip install -e "hermes-agent[PipExtras]". Default "web". Use "all,web" for full agent (slow, may fail on some hosts).

.PARAMETER SkipWebBuild
  Skip npm ci + build in staged hermes-agent/web (use existing hermes_cli/web_dist if present).

.PARAMETER SkipVenv
  Skip portable Python runtime creation and pip install. Kept for backwards-compatible automation naming.

.PARAMETER DownloadNode
  Download Node.js win-x64 zip into staging/node (adds ~50MB+ download).

.PARAMETER SkipNativeLauncher
  Skip publishing the native WebView2 launcher. Use this on machines that only
  have the .NET runtime and no .NET SDK.

.PARAMETER WebView2FixedRuntimePath
  Path to the downloaded/decompressed WebView2 Fixed Version Runtime. Accepts a
  decompressed directory, .zip, or .cab. The contents are staged into
  runtime/webview2 so the final installer has no WebView2 dependency.

.PARAMETER Clean
  Remove staging root before build.
#>
param(
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$StagingRoot = "",
  [string]$PipExtras = "web",
  [switch]$SkipWebBuild,
  [switch]$SkipVenv,
  [switch]$DownloadNode,
  [switch]$SkipNativeLauncher,
  [string]$WebView2FixedRuntimePath = "",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

if (-not $StagingRoot) {
  $StagingRoot = Join-Path $RepoRoot "_staging\Hermes"
}

$srcAgent = Join-Path $RepoRoot "hermes-agent"
$srcWebui = Join-Path $RepoRoot "hermes-webui"
$dstAgent = Join-Path $StagingRoot "app\hermes-agent"
$dstWebui = Join-Path $StagingRoot "app\hermes-webui"
$dstPython = Join-Path $StagingRoot "runtime\python"
$dstWebView2 = Join-Path $StagingRoot "runtime\webview2"
$dstTools = Join-Path $StagingRoot "tools\bin"
$dstNode = Join-Path $StagingRoot "node"
$launcherSrc = Join-Path $RepoRoot "packaging\windows\launcher"
$nativeLauncherProject = Join-Path $RepoRoot "packaging\windows\launcher-native\HermesWebUI.csproj"

function Test-RobocopySuccess([int]$code) {
  if ($code -ge 8) { throw "robocopy failed with exit code $code" }
}

function Invoke-RobocopyCopy([string]$from, [string]$to, [string[]]$excludeDirs) {
  if (-not (Test-Path $from)) { throw "Source missing: $from" }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $args = @($from, $to, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
  foreach ($d in $excludeDirs) {
    $args += "/XD"
    $args += $d
  }
  & robocopy @args
  Test-RobocopySuccess $LASTEXITCODE
}

function Find-PythonExe {
  $candidates = @(@(
    (Join-Path $RepoRoot "hermes-agent\.venv\Scripts\python.exe"),
    (Join-Path $RepoRoot "hermes-agent\venv\Scripts\python.exe"),
    (Join-Path $RepoRoot ".venv\Scripts\python.exe")
  ) | Where-Object { Test-Path $_ })
  if ($candidates.Count -gt 0) { return $candidates[0] }

  try {
    $out = & py -3.12 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
  } catch { }

  try {
    $out = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
  } catch { }

  $p = Get-Command python -ErrorAction SilentlyContinue
  if ($p) { return $p.Source }

  throw "Python 3.11+ not found. Install Python or create hermes-agent\.venv"
}

function Set-NpmScriptShellGitBash([string]$webDir) {
  $bash = @(
    "${env:ProgramFiles}\Git\bin\bash.exe",
    "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $bash) {
    Write-Warning "Git Bash not found. npm prebuild (rm/cp) may fail on Windows; install Git for Windows or use -SkipWebBuild if web_dist is already built."
    return
  }
  Push-Location $webDir
  try {
    $unixPath = $bash -replace "\\", "/"
    & npm config set script-shell $unixPath --location project
  } finally {
    Pop-Location
  }
}

function Test-DotNetSdkAvailable {
  try {
    $sdks = & dotnet --list-sdks 2>$null
    return ($LASTEXITCODE -eq 0 -and $sdks)
  } catch {
    return $false
  }
}

function Publish-NativeLauncher {
  if (-not (Test-Path $nativeLauncherProject)) {
    throw "Native launcher project missing: $nativeLauncherProject"
  }
  if (-not (Test-DotNetSdkAvailable)) {
    throw "The .NET 8 SDK is required to publish HermesWebUI.exe. Install the SDK or rerun Build-Staging.ps1 with -SkipNativeLauncher."
  }

  Write-Host "Publishing native WebView2 launcher -> staging root..."
  & dotnet publish $nativeLauncherProject `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=false `
    -p:PublishTrimmed=false `
    -o $StagingRoot
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish native launcher failed" }

  $exe = Join-Path $StagingRoot "HermesWebUI.exe"
  if (-not (Test-Path $exe)) { throw "Native launcher publish did not produce $exe" }
}

function Copy-DirectoryContents([string]$from, [string]$to) {
  if (-not (Test-Path $from)) { throw "Source missing: $from" }
  if (Test-Path $to) { Remove-Item -Recurse -Force $to }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item -Path (Join-Path $from "*") -Destination $to -Recurse -Force
}

function Stage-PortablePythonRuntime([string]$buildPython) {
  $version = (& $buildPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $version) { throw "Failed to detect build Python version from $buildPython" }

  $shortVersion = (& $buildPython -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')" 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $shortVersion) { throw "Failed to detect build Python short version from $buildPython" }

  $zipName = "python-$version-embed-amd64.zip"
  $zipPath = Join-Path $RepoRoot "vendor\$zipName"
  $url = "https://www.python.org/ftp/python/$version/$zipName"
  New-Item -ItemType Directory -Force -Path (Split-Path $zipPath) | Out-Null

  if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading portable Python $version from $url ..."
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  }

  if (Test-Path $dstPython) {
    Write-Host "Removing existing portable Python runtime..."
    Remove-Item -Recurse -Force $dstPython
  }
  New-Item -ItemType Directory -Force -Path $dstPython | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $dstPython -Force

  $sitePackages = Join-Path $dstPython "Lib\site-packages"
  New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null

  $pth = Join-Path $dstPython "python$shortVersion._pth"
  if (-not (Test-Path $pth)) { throw "Portable Python ._pth file not found: $pth" }
  @(
    "python$shortVersion.zip",
    ".",
    "Lib\site-packages",
    "..\..\app\hermes-webui",
    "..\..\app\hermes-agent",
    "..\..\tools\bin",
    "import site"
  ) | Set-Content -Path $pth -Encoding ascii

  Write-Host "pip install Hermes dependencies into portable Python site-packages..."
  & $buildPython -m pip install --upgrade --target $sitePackages setuptools wheel
  if ($LASTEXITCODE -ne 0) { throw "pip install setuptools/wheel into portable Python failed" }

  $agentSpec = $dstAgent + "[" + $PipExtras + "]"
  & $buildPython -m pip install --upgrade --target $sitePackages $agentSpec
  if ($LASTEXITCODE -ne 0) { throw "pip install Hermes agent dependencies into portable Python failed" }

  $webuiRequirements = Join-Path $dstWebui "requirements.txt"
  if (Test-Path $webuiRequirements) {
    & $buildPython -m pip install --upgrade --target $sitePackages -r $webuiRequirements
    if ($LASTEXITCODE -ne 0) { throw "pip install hermes-webui requirements into portable Python failed" }
  } else {
    Write-Warning "hermes-webui requirements.txt not found; QR/connect-app extras may be missing."
  }

  $portablePython = Join-Path $dstPython "python.exe"
  & $portablePython -c "import sys; import fastapi, uvicorn, yaml, qrcode, openai; import api.config; import tools.skills_tool; print('portable python ok:', sys.executable)"
  if ($LASTEXITCODE -ne 0) { throw "Portable Python smoke test failed" }
}

function Stage-WebView2FixedRuntime {
  if (-not $WebView2FixedRuntimePath) {
    $vendorFixed = Join-Path $RepoRoot "vendor\webview2-fixed"
    if (Test-Path $vendorFixed) {
      $WebView2FixedRuntimePath = $vendorFixed
    }
  }

  if (-not $WebView2FixedRuntimePath) {
    New-Item -ItemType Directory -Force -Path $dstWebView2 | Out-Null
    @"
Place the decompressed Microsoft Edge WebView2 Fixed Version Runtime here for a fully offline installer.

Build example:
  pwsh scripts/Build-Staging.ps1 -WebView2FixedRuntimePath C:\vendor\Microsoft.WebView2.FixedRuntime.x64

Accepted input:
  - decompressed Fixed Runtime directory containing msedgewebview2.exe
  - Fixed Runtime .zip
  - Fixed Runtime .cab (expanded via expand.exe)
"@ | Set-Content -Path (Join-Path $dstWebView2 "README_WEBVIEW2_FIXED_RUNTIME.txt") -Encoding utf8
    Write-Warning "No WebView2 Fixed Runtime was staged. HermesWebUI.exe requires runtime\webview2 for dependency-free installs."
    return
  }

  $resolved = Resolve-Path $WebView2FixedRuntimePath
  $inputPath = $resolved.Path
  $tempExpand = Join-Path $RepoRoot "vendor\webview2-fixed-expand"
  if (Test-Path $tempExpand) { Remove-Item -Recurse -Force $tempExpand }

  if (Test-Path $inputPath -PathType Container) {
    Write-Host "Staging WebView2 Fixed Runtime directory -> $dstWebView2"
    Copy-DirectoryContents $inputPath $dstWebView2
  } elseif ($inputPath.EndsWith(".zip", [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "Expanding WebView2 Fixed Runtime zip..."
    Expand-Archive -Path $inputPath -DestinationPath $tempExpand -Force
    Copy-DirectoryContents $tempExpand $dstWebView2
  } elseif ($inputPath.EndsWith(".cab", [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "Expanding WebView2 Fixed Runtime cab..."
    New-Item -ItemType Directory -Force -Path $tempExpand | Out-Null
    & expand.exe $inputPath -F:* $tempExpand | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "expand.exe failed for $inputPath" }
    Copy-DirectoryContents $tempExpand $dstWebView2
  } else {
    throw "Unsupported WebView2FixedRuntimePath format: $inputPath"
  }

  $runtimeExe = Get-ChildItem $dstWebView2 -Filter "msedgewebview2.exe" -Recurse -File | Select-Object -First 1
  if (-not $runtimeExe) {
    throw "Invalid WebView2 Fixed Runtime: msedgewebview2.exe not found under $dstWebView2"
  }
  Write-Host "WebView2 Fixed Runtime staged: $($runtimeExe.DirectoryName)"
}

function Copy-PortableToolIfAvailable([string]$commandName, [string]$outputName) {
  $cmd = Get-Command $commandName -ErrorAction SilentlyContinue
  if (-not $cmd -or -not $cmd.Source -or -not (Test-Path $cmd.Source)) {
    Write-Warning "$commandName not found; $outputName was not staged into tools\bin."
    return
  }

  $target = Join-Path $dstTools $outputName
  Copy-Item -Path $cmd.Source -Destination $target -Force
  Write-Host "Staged portable tool: $outputName"
}

function Stage-SkillhubCli {
  $vendorDir = Join-Path $RepoRoot "vendor\skillhub"
  $vendorCandidates = @(@(
    (Join-Path $vendorDir "skillhub.exe"),
    (Join-Path $vendorDir "skillhub.cmd"),
    (Join-Path $vendorDir "skillhub.ps1")
  ) | Where-Object { Test-Path $_ })

  if ($vendorCandidates.Count -gt 0) {
    Copy-Item -Path (Join-Path $vendorDir "*") -Destination $dstTools -Recurse -Force
    Write-PortableSkillhubWrapper
    Write-Host "Staged Skillhub CLI from vendor\skillhub"
    return
  }

  $source = $null
  $cmd = Get-Command "skillhub" -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) {
    $source = $cmd.Source
  }

  if (-not $source) {
    Write-Warning "skillhub CLI not found; China Skills Hub source will be disabled until skillhub is on PATH."
    return
  }

  $target = Join-Path $dstTools (Split-Path $source -Leaf)
  Copy-Item -Path $source -Destination $target -Force
  Write-Host "Staged Skillhub CLI: $(Split-Path $target -Leaf)"
}

function Write-PortableSkillhubWrapper {
  $cli = Join-Path $dstTools "skills_store_cli.py"
  if (-not (Test-Path $cli)) { return }

  @'
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PYTHON_EXE=%SCRIPT_DIR%..\..\runtime\python\python.exe"
if exist "%PYTHON_EXE%" goto run_cli
set "PYTHON_EXE=%SCRIPT_DIR%..\..\runtime\venv\Scripts\python.exe"
if exist "%PYTHON_EXE%" goto run_cli
for %%P in (python.exe py.exe) do (
  where %%P >nul 2>nul && set "PYTHON_EXE=%%P" && goto run_cli
)
echo Error: bundled Python runtime not found. 1>&2
exit /b 1
:run_cli
set "SKILLHUB_SKIP_SELF_UPGRADE=1"
"%PYTHON_EXE%" "%SCRIPT_DIR%skills_store_cli.py" --skip-self-upgrade %*
exit /b %ERRORLEVEL%
'@ | Set-Content -Path (Join-Path $dstTools "skillhub.cmd") -Encoding ascii
}

Write-Host "RepoRoot     = $RepoRoot"
Write-Host "StagingRoot  = $StagingRoot"
Write-Host "PipExtras    = $PipExtras"
Write-Host "NativeLauncher = $(-not $SkipNativeLauncher)"
Write-Host "WebView2FixedRuntimePath = $WebView2FixedRuntimePath"

if (-not (Test-Path $srcAgent)) { throw "Missing $srcAgent" }
if (-not (Test-Path $srcWebui)) { throw "Missing $srcWebui" }

if ($Clean -and (Test-Path $StagingRoot)) {
  Write-Host "Cleaning $StagingRoot"
  Remove-Item -Recurse -Force $StagingRoot
}

New-Item -ItemType Directory -Force -Path $dstTools | Out-Null
New-Item -ItemType Directory -Force -Path $dstNode | Out-Null

Write-Host "Robocopy hermes-agent -> staging (excluding .git, caches, local venvs)..."
Invoke-RobocopyCopy $srcAgent $dstAgent @(
  ".git", "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".tox", "node_modules", "tests"
)

Write-Host "Robocopy hermes-webui -> staging (excluding .git, tests for smaller installer)..."
Invoke-RobocopyCopy $srcWebui $dstWebui @(
  ".git", "__pycache__", ".venv", "venv", "node_modules", "tests"
)

Write-Host "Copy launcher templates..."
$dstLauncher = Join-Path $StagingRoot "launcher"
New-Item -ItemType Directory -Force -Path $dstLauncher | Out-Null
Copy-Item -Path (Join-Path $launcherSrc "*") -Destination $dstLauncher -Force

if (-not $SkipNativeLauncher) {
  Publish-NativeLauncher
} else {
  Write-Host "SkipNativeLauncher: HermesWebUI.exe will not be published."
}

Stage-WebView2FixedRuntime

@"
Place portable tools here (add to PATH by launcher):
  - git.exe / busybox (or rely on full Git for Windows elsewhere)
  - rg.exe (ripgrep)
  - skillhub.exe / skillhub.cmd (China Skills Hub CLI)
  - ffmpeg.exe
  - ssh.exe (OpenSSH client)

The installer build copies this folder as-is. Download licenses-compatible builds or vendor your own.
"@ | Set-Content -Path (Join-Path $dstTools "README_HERMES_TOOLS.txt") -Encoding utf8

Copy-PortableToolIfAvailable "rg" "rg.exe"
Stage-SkillhubCli

if (-not $SkipWebBuild) {
  $webDir = Join-Path $dstAgent "web"
  if (-not (Test-Path $webDir)) { throw "Staged web dir missing: $webDir" }
  Write-Host "npm ci + build dashboard (Vite -> hermes_cli/web_dist)..."
  Set-NpmScriptShellGitBash $webDir
  Push-Location $webDir
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
  } finally {
    Pop-Location
  }
  $dist = Join-Path $dstAgent "hermes_cli\web_dist"
  if (-not (Test-Path (Join-Path $dist "index.html"))) {
    throw "Dashboard build did not produce hermes_cli/web_dist/index.html"
  }
} else {
  Write-Host "SkipWebBuild: using whatever web_dist already exists in staging."
}

if ($DownloadNode) {
  $nodeVer = "22.14.0"
  $zipName = "node-v$nodeVer-win-x64.zip"
  $url = "https://nodejs.org/dist/v$nodeVer/$zipName"
  $zipPath = Join-Path $RepoRoot "vendor\$zipName"
  New-Item -ItemType Directory -Force -Path (Split-Path $zipPath) | Out-Null
  if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading $url ..."
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  }
  $expand = Join-Path $RepoRoot "vendor\node-expand-$nodeVer"
  if (Test-Path $expand) { Remove-Item -Recurse -Force $expand }
  Expand-Archive -Path $zipPath -DestinationPath $expand -Force
  $inner = Get-ChildItem $expand -Directory | Select-Object -First 1
  if (-not $inner) { throw "Unexpected Node zip layout" }
  Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $dstNode -Recurse -Force
  Write-Host "Node staged under $dstNode"
} else {
  @"
Optional: run Build-Staging.ps1 -DownloadNode to place node.exe here for Ink TUI / dashboard child processes.
"@ | Set-Content -Path (Join-Path $dstNode "README_NODE.txt") -Encoding utf8
}

if (-not $SkipVenv) {
  $py = Find-PythonExe
  Write-Host "Using build Python: $py"
  Stage-PortablePythonRuntime $py
} else {
  Write-Host "SkipVenv: no portable Python runtime created."
}

Write-Host ""
Write-Host "Done. Staging root: $StagingRoot"
Write-Host "Next: compile packaging/windows/hermes-installer-staging.iss (ISCC) to produce a full installer bundle."
