# Hermes One-Click（Hermes 可视化桌面 / Windows 一键 EXE）— 项目跟踪

> **最终目标**：普通用户在 Windows 上**双击一个 EXE**，即可通过 **Hermes One-Click** 打开 Hermes 的**可视化界面**并直接使用（无需自行部署服务器、不必熟悉命令行与 venv）。  
> **技术现实**：底层仍依赖 Hermes Agent（Python）与社区 Web UI（`hermes-UI`）；桌面壳负责**打包、启动、更新与体验层**（汉化、镜像等）。

本文档用于**分步实施**与**进度对照**；完成后请在本仓库更新对应勾选与日期。

---

## 一、范围与原则

| 维度 | 说明 |
|------|------|
| 复用 | 优先复用现有 **Agent API** 与 **`hermes-UI`**，避免重写业务逻辑。 |
| 壳 | 「套壳」工作量不小：需处理 **进程生命周期、端口、数据目录、升级、权限、杀毒误报** 等。 |
| 上游 | 与官方 / 社区 **hermes-UI** 保持可合并路径；本地差异化（汉化、镜像）尽量**配置化或可脚本合并**。 |

---

## 二、你已提出的产品要求（纳入 backlog）

1. **深度汉化（简体中文）**  
   所有用户可见文案（含设置、弹窗、向导子步骤、空状态、错误提示等）在默认「国内版」下应为**一致、完整的中文**；避免中英混杂与漏翻（当前 `hermes-UI/static/i18n.js` 的 `zh` 与 `index.html` 等仍有缺口，见下文清单）。

2. **版本升级默认开启 + 国内镜像**  
   当界面提示可升级时，**默认引导用户升级**；拉取代码/依赖时需支持**国内镜像**（例如你提到的 `mirrors.aliyun.com`）。  
   注意：需拆成多条技术线——**Git 远程镜像**、**pip/uv 镜像**、**可选 Node 构建镜像**（若壳工具链需要）——在实现阶段分别落地。

---

## 三、建议分阶段路线（按依赖排序）

### Phase A — 体验与内容（可先并行）

- [x] **A1 深度汉化审计**  
  - 清单与工具：**`hermes-UI/docs/A1-i18n-audit-zh.md`**、**`hermes-UI/scripts/audit_i18n_locales.py`**（`en` / `zh` / `zh-Hant` 顶层键对齐、`zh-Hant` 缺键与重复键、`cmd_help` 与 `en` 不一致）；`static/index.html` 与 **`hermes-UI/api`** 用户可见英文见文档抽样。  
  - 约定（不变）：`zh` 为国内版主 bundle；缺失键当前仍回退 `en`（见 `i18n.js`），交付前需按清单逐项消灭。  
  - **目标态验收**（主要路径无英文残留）：**未达标**，归 **A2 及后续迭代**（`zh-Hant` 大块补译、表单 placeholder、API 错误串策略等见审计文档 §6）。

- [x] **A2 默认语言与地区构建**  
  - 首次启动 / 无本地偏好时默认 **`zh`**：`api/config.py` 的 **`DEFAULT_UI_LANGUAGE`**（环境变量 **`HERMES_WEBUI_DEFAULT_LANGUAGE`**，默认 `zh`）、`static/i18n.js` 的 **`HERMES_DEFAULT_LOCALE`**、`boot.js` / `panels.js` 回退与 **`index.html`** 初始 `lang`。设置页语言下拉仍写入 **`settings.json`** 的 `language`，可切换。  
  - （可选）单独 `zh-CN` 资源包：未拆包；简体仍用 **`zh`** bundle。

### Phase B — Windows 无 EXE 的「准产品」形态（降低风险）

- [x] **B1 启动前依赖检测（Git Bash）** — `hermes-UI/scripts/check-windows-prereqs.ps1` + `start-webui.bat` / `start-webui.ps1` 已接入。  
- [x] **B2 Agent 侧 Windows 终端 bash 选择** — `tools/environments/local.py` 中避免 WSL 占位 `bash`、支持 `HERMES_GIT_BASH_PATH`。  
- [x] **B3 一键创建 venv + 安装依赖（可选脚本）** — `hermes-UI/scripts/setup-windows.ps1`（可选 `-UseCnMirror`、`-SkipGitCheck`）；`start-webui.bat` / `start-webui.ps1` 在缺少 venv 时提示运行该脚本。  
- [x] **B4 文档** — `hermes-UI/README.md` 已增加 **Windows (native) & mainland China**：Git / venv 布局、`setup-windows.ps1`、镜像环境变量、`start-webui` 启动方式。

### Phase C — 桌面壳选型与最小可运行 EXE

- [x] **C1 技术选型（已决策）** — 结论见 **`docs/Phase-C1-desktop-shell-decision.md`**：**主选 Tauri 2 + WebView2**（sidecar 启动 `hermes-UI/server.py`）；**Electron 备选**；**PyInstaller / 浏览器打开**仅作短期验证，不作产品终态。  
- [x] **C2 MVP（内嵌窗口）** — 已落地 **`hermes-desktop/`**（Tauri 2）：启动子进程运行 **`hermes-UI/server.py`**，轮询 **`/health`** 后 **`WebviewUrl::External`** 加载 `http://127.0.0.1:<port>/`；关闭进程时结束 Python。详见 **`hermes-desktop/README.md`**。  
  - **未含**：安装包 / 嵌入式 Python（**D1**）、`%LOCALAPPDATA%` 专用数据目录（仍用现有 `HERMES_WEBUI_STATE_DIR` 等）。  
- [x] **C3 退出与清理**  
  - 主窗口 **`CloseRequested` / `Destroyed`** 与 **`RunEvent::Exit` / `ExitRequested`** 均会结束 Python；子进程异常退出时壳进程退出；Windows 默认 **无控制台**（`cargo run --features console` 可开控制台调试）。单实例 / 托盘未做。

### Phase D — 打包与分发

- [ ] **D1 内置运行时**  
  - 方案 A：携带 **嵌入式 Python** + 预装 wheel（体积大、更新复杂）。  
  - 方案 B：首次运行检测本机 Python，引导安装（体验差但包小）。  
  - 方案 C：混合（小安装包 + 首次下载运行时）——需下载与国内 CDN 策略。  
- [ ] **D2 代码签名**  
  - 降低 SmartScreen 拦截；需证书成本与发布流程。  
- [ ] **D3 自动更新**  
  - 差分或全量更新包；校验签名与哈希。

### Phase E — 升级与国内镜像（与你的需求对齐）

- [x] **E1 盘点现有「检查更新」实现**（结论见 **附录 A — Phase E1**）  
- [x] **E2 默认升级策略**  
  - **`check_for_updates`** 默认仍为 **`true`**（`api/config.py`）。更新横幅展示 **标题 + 每仓库一行**：分支、`current_sha`→`latest_sha`、**`git describe` 版本提示**、**上游最新提交标题**（`api/updates.py` 提供 `version_hint` / `latest_subject`；`ui.js` + `i18n`）。  
- [x] **E3 国内镜像**（Git + pip/uv 已落地；Node 仍可选）  
  - **Git**：见 **`HERMES_WEBUI_UPDATE_GIT_REMOTE`** / **`HERMES_WEBUI_UPDATE_GIT_REMOTE_FALLBACK`** 与附录 A。  
  - **pip / uv**：**`hermes-UI/pypi_mirror.py`** + **`api/startup.py`**（`auto_install_agent_deps`）+ **`bootstrap.py`**。环境变量 **`HERMES_WEBUI_CN_MIRROR=1`** 时使用阿里云 PyPI simple；或 **`HERMES_WEBUI_PIP_INDEX_URL` / `HERMES_WEBUI_UV_INDEX_URL`** 覆盖；仍可使用标准 **`PIP_INDEX_URL`**（不设 Hermes 变量时本模块不追加 `-i`）。详见 **`hermes-UI/.env.example`**。  
  - **若壳内带 Node**：`npm`/`pnpm` registry（未做；留给桌面壳或文档）。  
- [x] **E4 失败降级（Git fetch）**  
  - 主远程 `git fetch` 失败后自动 **`HERMES_WEBUI_UPDATE_GIT_REMOTE_FALLBACK`**（默认 `origin`，可显式关闭）；服务端日志 + API 字段 **`fetch_fallback`** + 前端 **`update_fetch_fallback`** toast。若分支跟踪的远程与 fallback 不一致，落后计数仍可能依赖原远程 refs（见附录 A 限制说明）。

### Phase F — 质量与合规

- [ ] **F1 离线/弱网**  
- [ ] **F2 日志与诊断导出**（便于客服）  
- [ ] **F3 隐私说明**（本地模型与 API Key 存储路径）

---

## 四、进度清单（对照本仓库当前状态）

### 已完成（可勾选维护）

- [x] Windows 上 Agent 文件工具/终端：**避免误用 System32 WSL `bash.exe`**；支持 **`HERMES_GIT_BASH_PATH`**（`tools/environments/local.py`）。  
- [x] Web UI 服务：**Ctrl+C 友好退出**（`hermes-UI/server.py`）。  
- [x] Windows 启动脚本：**Git Bash 前置检测**（`hermes-UI/scripts/check-windows-prereqs.ps1` + `start-webui.bat` / `start-webui.ps1`）。  
- [x] **i18n 基础设施**与 **`zh` 大量词条**（`hermes-UI/static/i18n.js`）；向导等有多语言能力（历史迭代中已部分落地）。  
- [x] **Phase E1**：「检查更新」全链路已盘点并写入 **附录 A**（`hermes-UI/api/updates.py`、`routes`、`boot.js`、`ui.js`）。  
- [x] **Phase E3（Git + pip/uv）**：Git 见 `api/updates.py`；**`hermes-UI/pypi_mirror.py`** + `api/startup.py` / `bootstrap.py`（国内 PyPI / uv 环境变量）；`.env.example` 已说明。  
- [x] **Phase E4（Git fetch）**：`HERMES_WEBUI_UPDATE_GIT_REMOTE_FALLBACK` + 失败回退 fetch + `fetch_fallback` / toast（`updates.py`、`boot.js`、`ui.js`、`i18n.js`）。  
- [x] **Phase E2**：更新横幅版本/摘要（`latest_subject`、`version_hint`）+ 相关 i18n 与 `applyUpdates` 文案（`updates.py`、`routes.py` simulate、`index.html`、`style.css`、`ui.js`、`i18n.js`）。  

- [x] **Phase B3 / B4**：Windows 一键 venv + 依赖（`hermes-UI/scripts/setup-windows.ps1`）与 README 说明（`hermes-UI/README.md`）。  
- [x] **Phase A1（深度汉化审计）**：清单 **`hermes-UI/docs/A1-i18n-audit-zh.md`** + 键差脚本 **`hermes-UI/scripts/audit_i18n_locales.py`**。  
- [x] **Phase A2（默认语言）**：默认 UI 语言 **`zh`** + **`HERMES_WEBUI_DEFAULT_LANGUAGE`**；设置内可改语言。  
- [x] **Phase C1（桌面壳选型）**：**`docs/Phase-C1-desktop-shell-decision.md`**（Tauri 2 + WebView2 主路径）。  
- [x] **Phase C2（桌面 MVP 内嵌窗口）**：**`hermes-desktop/`** Tauri 壳 + 子进程 `server.py` + WebView2（见 **`hermes-desktop/README.md`**）。  
- [x] **Phase C3（退出与清理）**：**`hermes-desktop/src-tauri/src/main.rs`** — 关主窗即杀 Python；`ExitRequested` 双保险；Python 先退出则关壳；Windows 默认 GUI 子系统（无终端）；详见 **`hermes-desktop/README.md`**。

### 进行中 / 未达标（需专门迭代）

- [ ] **深度汉化**：全界面、全弹窗、全设置说明、全错误串的中英一致性；**禁止**依赖英文 fallback 作为「国内版」交付。  
- [ ] **国内镜像（Node registry）+ 其它**：**E3** 仅 Node 线未做；其余见上。  
- [ ] **双击 EXE**：未开始（依赖 Phase C/D）。  

### 未开始

- [x] ~~桌面壳仓库/目录结构~~ — 已建 **`hermes-desktop/`**（Tauri 2）；后续可拆独立 Git 仓库。  
- [ ] 嵌入式 Python 或首次环境引导。  
- [ ] 安装包签名与自动更新通道。  

---

## 五、近期建议的「下一步」（执行顺序）

1. ~~**Phase A1**~~：见 **`hermes-UI/docs/A1-i18n-audit-zh.md`** 与 **`hermes-UI/scripts/audit_i18n_locales.py`**。  
2. ~~**Phase A2**~~：默认 UI 语言 **`zh`**（`HERMES_WEBUI_DEFAULT_LANGUAGE`、`i18n.js`、`index.html`）。  
3. ~~**Phase E1**~~（已完成；见附录 A）  
4. ~~**Phase E3（Git）**~~：`HERMES_WEBUI_UPDATE_GIT_REMOTE` + 随 `@{upstream}` fetch（见附录 A）。  
5. ~~**Phase E4（Git fetch 回退）**~~：见附录 A。  
6. ~~**Phase E2**~~：横幅已含版本提示与最新提交标题。  
7. ~~**Phase E3（pip/uv）**~~：见 `pypi_mirror.py` 与 `.env.example`。  
8. ~~**Phase B3 / B4**~~：`hermes-UI/scripts/setup-windows.ps1` 与 README Windows 小节。  
9. ~~**Phase C1**~~：见 **`docs/Phase-C1-desktop-shell-decision.md`**（**Tauri 2 + WebView2** 主选）。  
10. ~~**Phase C2 MVP**~~：**`hermes-desktop/`** 内嵌 WebView + 子进程 `server.py`（安装包 / 嵌入式 Python 见 **D1**）。  
11. ~~**Phase C3**~~（退出清理）：已落地（关窗杀子进程、无控制台运行方式见 **`hermes-desktop/README.md`**）；单实例 / 托盘仍可选。或 **Phase E3（Node，可选）**：npm 镜像文档。  

（若你回复 **「执行」+ 阶段编号**，可按你的流程在仓库内落地具体改动。）

---

## 附录 A — Phase E1：「检查更新」实现说明（本仓库现状）

### 行为摘要

| 环节 | 说明 |
|------|------|
| 开关 | `settings.json` 字段 **`check_for_updates`**，默认 **`true`**（`hermes-UI/api/config.py` 默认 settings）。关闭后 `GET /api/updates/check` 返回 `{ "disabled": true }`，前端不拉检查。 |
| 触发 | 页面加载后 **`hermes-UI/static/boot.js`**：若未在 `sessionStorage` 标记已检查/已关闭，且设置未关，则 **`GET /api/updates/check`**（每个浏览器标签会话最多触发一次逻辑上的检查请求；由服务端 **30 分钟 TTL** 缓存实际控制 `git fetch` 频率）。 |
| 服务端检查 | **`hermes-UI/api/updates.py`**：`check_for_updates()` 对 **`REPO_ROOT`（WebUI 仓库根）** 与 **`_AGENT_DIR`（Agent 目录）** 分别调用 `_check_repo()`。无 `.git` 则跳过（如 Docker 烘焙镜像）。每个仓库结果含 **`latest_subject`**（上游 tip 提交标题）、**`version_hint`**（`git describe --tags --always`）供横幅展示（**E2**）。 |
| Git 操作 | `_check_repo`：先 **`git fetch <primary>`**（`primary` 同上一行）；若失败则按 **`HERMES_WEBUI_UPDATE_GIT_REMOTE_FALLBACK`**（默认 **`origin`**，可置空/`none` 等关闭）**再 fetch 一次**。成功后再 `rev-parse @{upstream}` → `rev-list --count` 得 **`behind`**。若 **`@{upstream}`** 为 `mirror/main` 而仅 fallback 更新了 `origin/*`，则 **`mirror/*` refs 可能仍旧**，落后条数可能不准——推荐镜像与跟踪远程一致或只用 **`set-url origin`**。`apply_update` 使用同一套 fetch + fallback。 |
| 应用更新 | **`POST /api/updates/apply`**，`body: { "target": "webui" \| "agent" }`** → **`apply_update()`**：`fetch` → 有本地改动则 **`git stash`** → **`git pull --ff-only <remote> <branch>`** → **`stash pop`**；失败返回英文 `message`（前端 `showToast`）。 |
| 前端展示 | **`hermes-UI/static/ui.js`**：`_showUpdateBanner` / `dismissUpdate` / `applyUpdates`；按钮等使用 **`data-i18n`** / **`t()`**（部分 toast 仍可能为英文）。 |
| 联调 | `GET /api/updates/check?simulate=1` 仅在 **127.0.0.1** 返回假数据（`hermes-UI/api/routes.py`）；URL **`?test_updates=1`** 可强制走模拟并展示横幅（`boot.js`）。 |

### 与「国内镜像」的关系

- **已实现（Git）**：`hermes-UI/api/updates.py` 中 **`HERMES_WEBUI_UPDATE_GIT_REMOTE`**、**`HERMES_WEBUI_UPDATE_GIT_REMOTE_FALLBACK`**（E4）；未设置 override 时 **按 `@{upstream}` 解析主 fetch 远程**。镜像 URL 仍常由 **`git remote set-url`** / **`url.insteadOf`** 配置（见 `hermes-UI/.env.example`）。  
- **已实现（pip/uv）**：**`hermes-UI/pypi_mirror.py`** — **`HERMES_WEBUI_CN_MIRROR`**、**`HERMES_WEBUI_PIP_INDEX_URL`**、**`HERMES_WEBUI_UV_INDEX_URL`**；由 **`api/startup.py`**（缺依赖自动安装）与 **`bootstrap.py`**（本地 `.venv` 安装）使用。  
- **未实现**：**`apply_update` 成功后自动 `pip install`**（升级后 Python 依赖仍建议用户自行安装或另做钩子）；**npm/pnpm** 镜像（可选）。  
- **`apply_update` 本身不执行 `pip install`**。

---

## 六、附录 — 维护说明

- **更新本文档**：每完成一个子阶段，将第三节对应 `[ ]` 改为 `[x]`，并在第四节补充「已完成」一行（含日期/PR 可选）。  
- **与上游同步**：合并上游 `hermes-UI` 后，优先跑 **A1 汉化回归** 与 **E 更新/镜像** 相关测试。

---

*文档版本：初稿（与仓库内实现同步，随开发更新）。*
