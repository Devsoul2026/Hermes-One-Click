# Hermes One-Click

![Hermes One-Click Demo](Example.gif)

<p align="center"><a href="#中文版">中文</a> · <a href="#english">English</a></p>

---

## 中文版

Hermes One-Click 是一个面向 Windows 的 Hermes 可视化桌面包。它把 `hermes-agent`、`hermes-webui`、原生 WebView2 壳、便携 Python 运行时、Node 运行时、WebView2 Fixed Runtime、内置技能和便携工具一起打进安装包，让最终用户安装后无需配置开发环境，双击 `HermesWebUI.exe` 即可打开可视化应用。

### 仓库结构

- `hermes-agent/`：Hermes agent、CLI、工具、技能系统和前端 dashboard 源码。
- `hermes-webui/`：本地 WebUI 服务、API、静态资源和会话管理。
- `packaging/windows/launcher-native/`：Windows 原生 WebView2 启动器项目，负责启动 WebUI、等待本地端口打开并进入桌面窗口。
- `packaging/windows/hermes-installer-staging.iss`：Inno Setup 安装包脚本。
- `scripts/Build-Staging.ps1`：从源码生成 `_staging/Hermes` 完整运行目录。
- `vendor/`：本地下载的离线运行时和便携工具缓存，默认不提交到 Git。
- `_staging/`、`_dist/`：构建输出目录，默认不提交到 Git。

### 构建环境

推荐在 Windows 10/11 x64 上构建。

必需工具：

- PowerShell
- Git for Windows，提供 Git Bash，前端构建脚本会用到 `rm` / `cp`
- Python 3.11 或更高版本
- Node.js + npm
- .NET 8 SDK
- Inno Setup 6

可用 `winget` 安装常见依赖：

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Microsoft.DotNet.SDK.8 -e
winget install --id JRSoftware.InnoSetup -e
```

### 准备离线运行时

为了让用户安装后不再依赖系统 WebView2，需要下载 Microsoft WebView2 Fixed Version Runtime。当前构建使用的是 `147.0.3912.98 x64`：

```powershell
New-Item -ItemType Directory -Force -Path ".\vendor" | Out-Null
curl.exe -L --fail -o ".\vendor\Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab" "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/01f18384-38a3-449b-ac04-2aa1777b26fe/Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab"
```

如果这个 Microsoft 直链过期，请到 [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) 下载 Fixed Version Runtime，选择 `x64`，然后把 `.cab` 文件放到 `vendor/`。

### 准备 Skillhub 中国源

安装包可以内置 Skillhub CLI，作为中国网络环境下优先使用的技能商店来源。`vendor/` 默认不提交到 Git，因此从干净仓库构建时需要先拉取一次：

```powershell
curl.exe -L --fail --retry 8 --retry-delay 5 -o ".\vendor\skillhub-latest.tar.gz" "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz"

if (Test-Path ".\vendor\skillhub-kit") { Remove-Item -Recurse -Force ".\vendor\skillhub-kit" }
if (Test-Path ".\vendor\skillhub") { Remove-Item -Recurse -Force ".\vendor\skillhub" }
New-Item -ItemType Directory -Force -Path ".\vendor\skillhub-kit", ".\vendor\skillhub" | Out-Null

tar -xzf ".\vendor\skillhub-latest.tar.gz" -C ".\vendor\skillhub-kit"
Copy-Item ".\vendor\skillhub-kit\cli\skills_store_cli.py" ".\vendor\skillhub\skills_store_cli.py" -Force
Copy-Item ".\vendor\skillhub-kit\cli\skills_upgrade.py" ".\vendor\skillhub\skills_upgrade.py" -Force
Copy-Item ".\vendor\skillhub-kit\cli\version.json" ".\vendor\skillhub\version.json" -Force
Copy-Item ".\vendor\skillhub-kit\cli\metadata.json" ".\vendor\skillhub\metadata.json" -Force
```

然后创建 Windows wrapper：

```powershell
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
'@ | Set-Content -Path ".\vendor\skillhub\skillhub.cmd" -Encoding ascii
```

### 从根目录生成 exe 安装包

在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Build-Staging.ps1" -Clean -DownloadNode -WebView2FixedRuntimePath ".\vendor\Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab"
```

然后编译安装包：

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" ".\packaging\windows\hermes-installer-staging.iss"
```

默认产物：

```text
.\_dist\HermesOneClickSetup-Devsoul-0.1.0-dev.exe
```

安装包内会包含：

- `HermesWebUI.exe`
- `runtime/python` 便携 Python 运行环境
- `runtime/webview2` WebView2 Fixed Runtime
- `node/node.exe`
- `tools/bin/skillhub.cmd`
- `tools/bin/rg.exe`，如果构建机能找到 `rg`
- `hermes-agent/skills` 内置技能，包括 `ddgr-2.2`

### 启动器行为

`HermesWebUI.exe` 会启动内置的 `runtime/python/python.exe`，运行 `app/hermes-webui/server.py`，并把 WebUI 的输出写入：

```text
%LOCALAPPDATA%\Hermes\logs\webui.log
```

启动器会先等待 `127.0.0.1:8787` 本地端口打开，然后立即进入 WebView2 窗口。`/api/settings`、网关、日志和初始化配置等接口由前端继续加载，不会阻塞桌面窗口启动。这样可以减少低性能机器、首次杀软扫描或配置读取较慢时的误报超时。

### 常见问题

如果 `Build-Staging.ps1 -Clean` 删除 `_staging` 失败，通常是旧的 `HermesWebUI.exe`、`python.exe` 或 gateway 进程仍在运行。关闭可视化窗口后重试，必要时在任务管理器中结束相关进程。

如果前端构建失败并提示 `rm` 或 `cp` 不存在，请安装 Git for Windows。脚本会自动把 npm project 的 `script-shell` 设置为 Git Bash。

如果安装包图标没有刷新，请确认使用的是最新输出文件 `HermesOneClickSetup-Devsoul-0.1.0-dev.exe`。Windows Explorer 可能会缓存旧的同名 exe 图标。

如果用户反馈 `Hermes One-Click WebUI did not open port http://127.0.0.1:8787/ within 120 seconds`，请先收集 `%LOCALAPPDATA%\Hermes\logs\webui.log`。常见原因包括杀软拦截/扫描内置 Python、旧进程占用 `8787`、安装目录文件被拦截或首次启动机器性能较慢。

---

## English

Hermes One-Click is a Windows desktop distribution of Hermes. It packages `hermes-agent`, `hermes-webui`, a native WebView2 launcher, a portable Python runtime, Node runtime, WebView2 Fixed Runtime, bundled skills, and portable tools into one installer. End users can install it and launch the visual app by double-clicking `HermesWebUI.exe`.

### Repository Layout

- `hermes-agent/`: Hermes agent, CLI, tools, skill system, and dashboard source.
- `hermes-webui/`: local WebUI server, APIs, static assets, and session handling.
- `packaging/windows/launcher-native/`: native Windows WebView2 launcher project that starts WebUI, waits for the local port, and opens the desktop window.
- `packaging/windows/hermes-installer-staging.iss`: Inno Setup installer script.
- `scripts/Build-Staging.ps1`: builds the complete `_staging/Hermes` runtime directory.
- `vendor/`: local runtime/tool cache, ignored by Git.
- `_staging/`, `_dist/`: generated build outputs, ignored by Git.

### Requirements

Build on Windows 10/11 x64.

Required tools:

- PowerShell
- Git for Windows, including Git Bash
- Python 3.11+
- Node.js + npm
- .NET 8 SDK
- Inno Setup 6

Install common dependencies with `winget`:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Microsoft.DotNet.SDK.8 -e
winget install --id JRSoftware.InnoSetup -e
```

### Prepare Offline Runtimes

Download WebView2 Fixed Version Runtime:

```powershell
New-Item -ItemType Directory -Force -Path ".\vendor" | Out-Null
curl.exe -L --fail -o ".\vendor\Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab" "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/01f18384-38a3-449b-ac04-2aa1777b26fe/Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab"
```

If the direct Microsoft URL expires, download the Fixed Version Runtime from [Microsoft Edge WebView2](https://developer.microsoft.com/microsoft-edge/webview2/), choose `x64`, and place the `.cab` file under `vendor/`.

To bundle the China Skillhub CLI, download and unpack the Skillhub kit into `vendor/skillhub`, then provide `vendor/skillhub/skillhub.cmd`. See the Chinese section above for the exact PowerShell commands.

### Build the Installer from Repository Root

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Build-Staging.ps1" -Clean -DownloadNode -WebView2FixedRuntimePath ".\vendor\Microsoft.WebView2.FixedVersionRuntime.147.0.3912.98.x64.cab"
```

Then compile the installer:

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" ".\packaging\windows\hermes-installer-staging.iss"
```

Output:

```text
.\_dist\HermesOneClickSetup-Devsoul-0.1.0-dev.exe
```

The installer includes the native launcher, bundled Python environment, WebView2 Fixed Runtime, Node runtime, Skillhub CLI when prepared, and bundled skills such as `ddgr-2.2`.

### Launcher Behavior

`HermesWebUI.exe` starts the bundled `runtime/python/python.exe`, runs `app/hermes-webui/server.py`, and writes WebUI output to:

```text
%LOCALAPPDATA%\Hermes\logs\webui.log
```

The launcher waits for `127.0.0.1:8787` to accept connections and then opens the WebView2 window. `/api/settings`, gateway status, logs, and onboarding state continue loading from the frontend, so slower first-run initialization does not block the desktop window.

If a user sees `Hermes One-Click WebUI did not open port http://127.0.0.1:8787/ within 120 seconds`, collect `%LOCALAPPDATA%\Hermes\logs\webui.log` first. Common causes are antivirus scanning/blocking the bundled Python runtime, a stale process occupying port `8787`, blocked install files, or very slow first launch on low-end machines.
