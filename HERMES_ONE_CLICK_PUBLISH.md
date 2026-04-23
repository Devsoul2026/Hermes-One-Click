# Hermes One-Click

<p align="center"><a href="#中文版">中文</a> · <a href="#english">English</a></p>

---

## 中文版

本目录用于生成可开源的 **`repository/`** 镜像，并说明如何在 **Windows** 上从源码构建 **Hermes One-Click** 安装包。

**与上游的关系：**本仓库导出的可运转可视化桌面包 **Hermes One-Click** 建立在 **Hermes**（智能体、CLI、工具链、消息网关等）与 **Hermes Web UI**（目录 **`hermes-UI`**，浏览器端界面）之上，由桌面壳与嵌入式运行时整合为「一键」体验。上游版权、MIT 正文与第三方说明见 **`THIRD_PARTY_NOTICES.md`**；Hermes 核心与 Nous Research 的关系见镜像内 **`README`** / 关于页所引用的开源条款。

### `$ROOT` 指哪里？

即同时包含 **`pyproject.toml`** 与 **`hermes-desktop/`** 的那一层目录。

- 若只把 **`github/repository/`** 推到 GitHub：**`$ROOT`** = 你克隆下来的仓库根目录。
- 若在完整 Hermes 工作区里阅读 **`github/README.md`**：**`$ROOT`** = **`github` 的上一级**（导出镜像在 **`github/repository/`**）。

### 构建 Windows 安装包

**环境：** Windows 10/11 x64、**Rust + MSVC**、可访问外网（首次会下载嵌入式 Python、pip、NSIS 等）、已执行过一次 **`cargo install tauri-cli --locked`**。

```powershell
cd $ROOT
.\hermes-desktop\scripts\build-embedded-python.ps1
cd .\hermes-desktop\src-tauri
cargo tauri build
```

上一步中 `build-embedded-python.ps1` 为推荐步骤；若跳过，首次 `cargo tauri build` 会花更长时间。

**产物：** `hermes-desktop\src-tauri\target\release\bundle\nsis\HermesOneClick_*_x64-setup.exe`，以及同目录下的 `HermesOneClick.exe`。  
**排错：** 见 **`hermes-desktop/README.md`** 中的「打包失败排查」。

**仅本地运行（不打包）：** 在 `$ROOT` 下进入 `hermes-desktop\src-tauri`，执行 `cargo run --release`；需要控制台日志时加 `--features console`。

**可选：** 需要强化学习相关子模块时再执行 `git submodule update --init --recursive`；只做桌面端可忽略。

### 维护者：重新导出镜像

在 **`$ROOT` = `github` 上一级** 执行：

```powershell
.\github\sync-export.ps1
```

脚本会刷新 **`github/repository/`**，用本文件覆盖 **`repository/README.md`**（GitHub 仓库首页），并写入内容相同的 **`HERMES_ONE_CLICK_PUBLISH.md`**；同时用 **`github/LICENSE`**、**`github/SECURITY.md`** 覆盖镜像根目录的 **`LICENSE`**、**`SECURITY.md`**（避免仍为上游 Nous 文案）。

**更新镜像并推到 GitHub：**先在 **`$ROOT`** 执行 **`.\github\sync-export.ps1`**。脚本会**删除并重建** `github\repository\`，其内 **`.git` 会被清掉**；若你要保留提交历史，请把 Git 仓库放在别处（例如单独克隆 `Hermes-One-Click`），每次导出后用文件同步进克隆目录再 `git push`，或在导出后于 `github\repository` 重新 `git init` 再关联 `origin` 推送。推送示例：

```powershell
cd $ROOT\github\repository
git init
git add .
git commit -m "sync: Hermes One-Click export"
git branch -M main
git remote add origin https://github.com/<你>/<仓库>.git
git push -u origin main --force
```

已配置过 `remote` 时用 **`git remote set-url origin ...`** 再 **`git push`** 即可。

### `github/` 目录说明

| 路径 | 说明 |
|------|------|
| `LICENSE` | 导出层 MIT，Devsoul（发布前请核对署名） |
| `SECURITY.md` | 本仓库安全披露说明（非上游 Nous 渠道） |
| `THIRD_PARTY_NOTICES.md` | 第三方与上游许可说明 |
| `repository/` | 导出结果，请用脚本更新，勿手改 |
| `sync-export.ps1` | 导出脚本 |

---

## English

This folder produces the open-sourceable **`repository/`** mirror and documents how to build the **Hermes One-Click** Windows installer from source.

**Upstream basis:** The runnable desktop experience **Hermes One-Click** is built on **Hermes** (agent stack, CLI, tools, messaging gateway) and **Hermes Web UI** (the **`hermes-UI`** browser UI), packaged with a desktop shell and embedded runtime. See **`THIRD_PARTY_NOTICES.md`** for licenses and third-party notices; the Hermes core and Nous Research attribution are reflected in the mirrored **`README`** / About flow and linked MIT texts.

### What is `$ROOT`?

The directory that contains both **`pyproject.toml`** and **`hermes-desktop/`**.

- If you only publish **`github/repository/`** to GitHub: **`$ROOT`** is the root of that clone.
- If you are in the full Hermes tree reading **`github/README.md`**: **`$ROOT`** is the **parent of `github/`** (the mirror lives under **`github/repository/`**).

### Build the Windows installer

**Requirements:** Windows 10/11 x64, **Rust + MSVC**, network access (first build pulls embedded Python, pip, NSIS, etc.), and a one-time **`cargo install tauri-cli --locked`**.

```powershell
cd $ROOT
.\hermes-desktop\scripts\build-embedded-python.ps1
cd .\hermes-desktop\src-tauri
cargo tauri build
```

`build-embedded-python.ps1` is recommended; skipping it makes the first `cargo tauri build` slower.

**Artifacts:** `hermes-desktop\src-tauri\target\release\bundle\nsis\HermesOneClick_*_x64-setup.exe` and `HermesOneClick.exe` in the same folder.  
**Troubleshooting:** see **`hermes-desktop/README.md`** (packaging / failure notes).

**Run locally without an installer:** from `$ROOT`, `cd hermes-desktop\src-tauri`, then `cargo run --release`; add `--features console` for console logs.

**Optional:** run `git submodule update --init --recursive` only if you need RL-related submodules; desktop-only builds can ignore this.

### Maintainers: regenerate the mirror

From **`$ROOT`** (parent of `github/`):

```powershell
.\github\sync-export.ps1
```

This refreshes **`github/repository/`**, overwrites **`repository/README.md`** (GitHub landing page), and writes **`HERMES_ONE_CLICK_PUBLISH.md`** with the same content. It also overwrites **`repository/LICENSE`** and **`repository/SECURITY.md`** from **`github/LICENSE`** and **`github/SECURITY.md`** so the published root is not the upstream Nous files.

**Update the mirror and push to GitHub:** run **`.\github\sync-export.ps1`** from **`$ROOT`**. The script **removes and recreates** `github\repository\` — any **`.git` inside it is deleted**. To keep Git history, either maintain a separate clone of your GitHub repo and copy/sync files into it after each export, or re-`git init` under `github\repository` and push again. Example:

```powershell
cd $ROOT\github\repository
git init
git add .
git commit -m "sync: Hermes One-Click export"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main --force
```

Use **`git remote set-url origin ...`** if `origin` already exists, then **`git push`**.

### Layout of `github/`

| Path | Description |
|------|-------------|
| `LICENSE` | MIT export layer, Devsoul (verify attribution before publishing) |
| `SECURITY.md` | Vulnerability reporting for this repo (not upstream Nous channels) |
| `THIRD_PARTY_NOTICES.md` | Third-party / upstream notices |
| `repository/` | Generated mirror; update via script, not by hand |
| `sync-export.ps1` | Export script |

---
