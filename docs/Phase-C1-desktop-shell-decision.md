# Phase C1 — 桌面壳技术选型（决策记录）

> **目标**（见 `HERMES-VISUAL-APP.md`）：Windows 用户**双击 EXE** 打开**内嵌或固定**的 Hermes 可视化界面；底层仍为 **Python `hermes-UI/server.py`** + Agent。  
> **本文结论**：**主选 Tauri 2 + WebView2**；**Electron 为备选**；**PyInstaller / 纯启动器**作为**最快验证路径**，不作为长期主壳。

---

## 1. 候选方案对比

| 维度 | Tauri 2 + WebView2 | Electron | PyInstaller / 启动器 + 系统浏览器 |
|------|-------------------|----------|-------------------------------------|
| **安装包体积** | 小（壳 + 资源，无 Chromium 全集） | 大（自带 Chromium） | 中到大（若带嵌入式 Python）；仅 launcher 则小 |
| **运行时内存** | 低 | 高 | 取决于 Python + 浏览器 |
| **Windows 体验** | 系统 WebView2（Win10 20H2+ 常见已装），可无边框应用窗口 | 一致但偏「重应用」 | 依赖用户浏览器或 `webview` 库，易像「网页」 |
| **与 Python 集成** | 壳内 `std::process::Command` 启 `python.exe` / `venv`，IPC 传端口 | `child_process` 同理 | 最直接：同进程或子进程启 `server.py` |
| **团队技能** | Rust + 少量 TS（前端可复用现有静态 UI） | TS/JS 全栈 | Python 为主即可 |
| **自动更新 / 签名** | 与 Electron 同属「需自建更新通道」；体积小利于 CDN | 成熟方案多（electron-builder 等） | PyInstaller 需另做更新器 |
| **国内环境** | WebView2 离线包策略需文档化；无 npm 运行时依赖（壳构建期除外） | 可配国内镜像打依赖；安装包更大 | 与现有 `setup-windows.ps1` 路径一致，易落地 |

---

## 2. 决策

1. **主路径（推荐）**：**Tauri 2** 壳 + **WebView2** 加载 `http://127.0.0.1:<port>/`（或等价子路径），子进程启动 **本机或打包目录内的 Python**，执行 **`hermes-UI/server.py`**（或仓库内统一入口）。  
2. **备选**：若团队**零 Rust 意愿**且接受体积：**Electron** + 同一套 sidecar Python 策略。  
3. **短期验证 / 过渡**：**PyInstaller** 或 **小 exe + bat 等价物** 仅负责拉起 Python 并 **用默认浏览器打开 localhost** — 用于验证打包与权限流程，**不作为「产品级内嵌窗口」终态**。

---

## 3. 架构要点（Tauri 主路径）

- **进程模型**：壳进程 **1** + **Python 子进程 1**（`server.py`）；退出窗口时 **TerminateProcess / 等价** 杀子进程（对应路线图 **C3**）。  
- **端口**：启动时选空闲端口（或固定端口冲突则递增），通过 **IPC / 启动参数** 传给 WebView 加载 URL；与现有 `HERMES_WEBUI_PORT` 逻辑对齐时可读环境变量。  
- **数据目录**：`%LOCALAPPDATA%\HermesVisual\`（或产品名统一常量），**不写安装目录**；与 **D1** 内置/外置 Python 方案解耦。  
- **静态资源**：继续由 **现有 `server.py` 提供**，壳不重复打包 `hermes-UI/static`（除非做离线嵌入优化，属后期优化）。  
- **安全**：仅绑定 `127.0.0.1` 为默认；若未来需局域网访问，单独产品决策。

---

## 4. 与后续阶段映射

| 路线图 | 说明 |
|--------|------|
| **C2 MVP** | 已实现于本仓库 **`hermes-desktop/`**：启 Python → 等 `/health` → **WebView2 内嵌** `http://127.0.0.1:<port>/`（见该目录 `README.md`）。 |
| **C3** | `on_window_event` CloseRequested → 杀 Python；处理端口占用与崩溃重启策略。 |
| **D1** | 选择 **本机 Python + 首次引导**（与当前 `setup-windows.ps1` 一致）或 **嵌入式 Python**（体积与更新成本）。 |
| **D2 / D3** | 代码签名与自动更新与壳技术正交；Tauri 有现成更新模式可参考。 |

---

## 5. 风险与缓解

| 风险 | 缓解 |
|------|------|
| WebView2 未安装（企业 LTSC 等） | 安装程序或首次运行检测并引导 **Evergreen Runtime** 下载（国内需 CDN/镜像策略）。 |
| 杀毒误报 | 计划 **D2 签名**；避免往 `Program Files` 写可执行更新；日志可导出（**F2**）。 |
| Rust 工具链成本 | 仅壳层使用 Rust；UI 仍复用 Web 资源；CI 缓存 `cargo`。 |
| Agent 与 WebUI 路径 | 沿用 **`HERMES_WEBUI_AGENT_DIR`**；壳内设置工作目录为 **Agent 根** 或文档化双根布局。 |

---

## 6. 否决或降级理由摘要

- **纯 Electron 主选**：在无强需求（系统托盘深度集成、大量 Node 原生模块）时，**体积与内存**对用户下载与「国内弱网」不友好。  
- **纯浏览器打开**：与路线图「可视化桌面应用」目标不一致，仅作 **MVP 验证**。

---

*文档版本：C1 决策冻结；实施时以独立桌面子项目 README 为准。若变更主选，请更新本文件与 `HERMES-VISUAL-APP.md` 第三节 Phase C。*
