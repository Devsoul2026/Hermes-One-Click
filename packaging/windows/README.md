# Windows installer (Inno Setup)

## Prerequisites

- [Inno Setup 6](https://jrsoftware.org/isinfo.php)
- **Full bundle** additionally requires a completed staging tree from `scripts/Build-Staging.ps1` (Python 3.11+, Node for `npm ci`, Git Bash recommended for npm `prebuild` shell steps on Windows).

## Two installers

| Script | Purpose |
|--------|---------|
| `hermes-installer.iss` | **Minimal**: ships `launcher/*.cmd` + short readme only (smoke / dev). |
| `hermes-installer-staging.iss` | **Bundle**: packs entire repo `_staging\Hermes\` (run `Build-Staging.ps1` first). |

## Build staging (full tree)

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Build-Staging.ps1
```

Options:

- `-PipExtras "all,web"` — full agent extras (slow; may fail on some Windows setups).
- `-SkipWebBuild` — skip `npm ci` / `npm run build` if `hermes_cli/web_dist` is already populated in the source tree.
- `-SkipVenv` — only copy files + launcher + optional Node (no `pip install`).
- `-DownloadNode` — download Node.js portable zip into `vendor\` and stage `node\`.
- `-Clean` — delete `_staging\Hermes` before build.

## Compile

```text
ISCC.exe packaging\windows\hermes-installer.iss
ISCC.exe packaging\windows\hermes-installer-staging.iss
```

Output: repo `_dist\` (relative to the `.iss` file location).

## User-selectable install path

Both scripts use `DisableDirPage=no` so the destination folder can be changed in the wizard.

## Staging layout (reference)

See root `README.md`. After staging, `launcher\HermesWebUIWindow.cmd` opens the desktop-style WebUI window, while `launcher\HermesWebUI.cmd` remains the server-only debug entry. Both expect `runtime\venv`, `app\hermes-agent`, `app\hermes-webui`, optional `tools\bin`, optional `node`.
