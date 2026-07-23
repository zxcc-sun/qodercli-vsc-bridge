# QoderCLI Bridge for VS Code

> 🌏 **语言 / Language:** 中文（下方） · [English](#english)

> ⚠️ **非官方**：本扩展为第三方社区工具，与 Microsoft、Qoder 无隶属或背书关系；它依赖 GitHub Copilot 未公开的本地接口，可能随上游更新而失效。

在 **VSCode 内置终端**里为 [`qodercli`](https://docs.qoder.com/en/cli/quick-start) 自动接入 IDE 上下文（当前文件路径 / 选中文本）。

## 工作原理
- 激活时（需首次同意）向 `~/.qoder/settings.json` 写入：
  - `mcpServers.vscode`：一个 stdio MCP 桥接，连 VSCode 内置 Copilot 扩展的 MCP 服务（unix socket）。
  - `hooks.UserPromptSubmit`：每次输入前注入 `<ide-context>`（当前文件/选中）。
- 运行时脚本随扩展打包，激活时在扩展数据目录（globalStorage）以目录链接暴露稳定路径。
- 仅在 **VSCode 内置终端**生效（脚本按 `TERM_PROGRAM=vscode` 门控），外部终端不注入。

## 使用
1. 安装扩展 → 首次弹出同意提示 → 点「启用」。
2. **新开**一个内置终端，运行 `qodercli`。`qodercli mcp list` 应显示 `vscode ... Connected`。

## 命令
- `QoderCLI Bridge: 启用/禁用/清理/查看状态`

## 本扩展会修改哪些文件（透明披露）
| 位置 | 变更 | 撤销 |
|---|---|---|
| `~/.qoder/settings.json` | 增加 `mcpServers.vscode` 与一个 `UserPromptSubmit` 钩子（写前自动备份为 `settings.json.bak`） | 运行「禁用」或「清理」 |
| 扩展 globalStorage 目录 | 创建 `bin` 目录链接（失败则复制脚本） | 运行「清理」 |

> **globalStorage 目录在哪？** 由 VSCode 的 `context.globalStorageUri` 决定，形如 `<VSCode 用户数据目录>/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`：
> - **Windows**：`%APPDATA%\Code\User\globalStorage\zxcc-sun.qodercli-vsc-bridge`
> - **macOS**：`~/Library/Application Support/Code/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
> - **Linux**：`~/.config/Code/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
> - **远程开发（Remote-SSH / WSL / Dev Container / Codespaces）**：位于远端主机 `~/.vscode-server/data/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
>
> 使用 VSCode 变体时，将路径中的 `Code` 替换为对应目录名：Insiders → `Code - Insiders`、VSCodium → `VSCodium`、Cursor → `Cursor`。

- 不联网、无运行时依赖、不存储任何 token；VSCode ↔ qodercli 的认证 Nonce 仅由脚本运行时从 `~/.copilot/ide/*.lock` 读取，扩展本身不读取、不转发。
- 使用 Node/文件系统 API（扩展标记为 "unrestricted"）仅用于上述本地配置写入与脚本释放。

## 卸载
先运行「QoderCLI Bridge: 清理」再卸载，可完全移除写入项与释放物。

---

<a id="english"></a>

# QoderCLI Bridge for VS Code (English)

> 🌏 **语言 / Language:** [中文](#qodercli-bridge-for-vs-code) · English (below)

> ⚠️ **Unofficial**: A third-party community tool, not affiliated with or endorsed by Microsoft or Qoder; it relies on GitHub Copilot's undocumented local interface and may break with upstream updates.

Automatically wire IDE context (current file path / selected text) into [`qodercli`](https://docs.qoder.com/en/cli/quick-start) inside the **VSCode integrated terminal** — no manual config, no separate Node install.

## How it works
- On activation (after your first-run consent), it writes to `~/.qoder/settings.json`:
  - `mcpServers.vscode`: a stdio MCP bridge that connects to the VSCode built-in Copilot extension's MCP service (unix socket).
  - `hooks.UserPromptSubmit`: injects `<ide-context>` (current file / selection) before each prompt.
- Runtime scripts ship with the extension and are exposed at a stable path via a directory link in the extension's data folder (globalStorage) on activation.
- Effective only inside the **VSCode integrated terminal** (scripts gate on `TERM_PROGRAM=vscode`); external terminals are not injected.

## Usage
1. Install the extension → a consent prompt appears on first run → click "Enable".
2. Open a **new** integrated terminal and run `qodercli`. `qodercli mcp list` should show `vscode ... Connected`.

## Commands
- `QoderCLI Bridge: Enable / Disable / Clean / Status`

## Which files this extension modifies (transparent disclosure)
| Location | Change | How to revert |
|---|---|---|
| `~/.qoder/settings.json` | Adds `mcpServers.vscode` and one `UserPromptSubmit` hook (auto-backed up to `settings.json.bak` before writing) | Run "Disable" or "Clean" |
| Extension globalStorage folder | Creates a `bin` directory link (falls back to copying scripts) | Run "Clean" |

> **Where is the globalStorage folder?** It is determined by VSCode's `context.globalStorageUri`, shaped like `<VSCode user-data dir>/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`:
> - **Windows**: `%APPDATA%\Code\User\globalStorage\zxcc-sun.qodercli-vsc-bridge`
> - **macOS**: `~/Library/Application Support/Code/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
> - **Linux**: `~/.config/Code/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
> - **Remote development (Remote-SSH / WSL / Dev Container / Codespaces)**: on the remote host at `~/.vscode-server/data/User/globalStorage/zxcc-sun.qodercli-vsc-bridge`
>
> For VSCode variants, replace `Code` in the path accordingly: Insiders → `Code - Insiders`, VSCodium → `VSCodium`, Cursor → `Cursor`.

- No network access, no runtime dependencies, no token storage; the VSCode ↔ qodercli auth Nonce is read only at script runtime from `~/.copilot/ide/*.lock` — the extension itself neither reads nor forwards it.
- Node/filesystem APIs (the extension is marked "unrestricted") are used solely for the local config writes and script staging described above.

## Uninstall
Run "QoderCLI Bridge: Clean" before uninstalling to fully remove the written entries and staged files.