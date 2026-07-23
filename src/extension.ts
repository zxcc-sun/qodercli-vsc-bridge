import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveNodeRuntime, NodeRuntime } from './nodeLocator';
import * as assets from './assetsManager';
import * as qoder from './qoderConfig';

const STATE_KEY = 'consent'; // 'enabled' | 'deferred'
const README_URL = 'https://github.com/zxcc-sun/qodercli-vsc-bridge#readme';

function qoderSettingsPath(): string {
  return path.join(os.homedir(), '.qoder', 'settings.json');
}

function whichNode(): string | undefined {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    return out || undefined;
  } catch { return undefined; }
}

function resolveNode(): NodeRuntime | null {
  return resolveNodeRuntime({
    execPath: process.execPath,
    hasElectron: !!process.versions.electron,
    askpassNode: process.env.VSCODE_GIT_ASKPASS_NODE,
    pathNode: whichNode(),
  });
}

function showErr(e: unknown): void {
  vscode.window.showErrorMessage(`qodercli-vsc-bridge: ${e instanceof Error ? e.message : String(e)}`);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(status);

  const apply = async (interactive: boolean): Promise<void> => {
    const rt = resolveNode();
    if (!rt) {
      status.text = '$(warning) qodercli-vsc-bridge';
      status.tooltip = 'No usable Node runtime found';
      status.show();
      if (interactive) { vscode.window.showWarningMessage('No usable Node runtime found; cannot configure qodercli.'); }
      return;
    }
    let res: assets.EnsureResult;
    try {
      res = assets.ensure({
        assetsDir: path.join(context.extensionPath, 'assets'),
        storageDir: context.globalStorageUri.fsPath,
        isWindows: process.platform === 'win32',
        extensionPath: context.extensionPath,
        nodePath: rt.command,
        nodeIsElectron: !!rt.env?.ELECTRON_RUN_AS_NODE,
      });
    } catch (e) { showErr(e); return; }

    try {
      qoder.enable(qoderSettingsPath(), {
        node: res.nodeCommand, env: rt.env, bridgeScript: res.bridgeScript, hookScript: res.hookScript,
      });
    } catch (e) {
      const code = (e as qoder.QoderConfigError).code;
      if (code === 'INVALID_JSON') {
        vscode.window.showErrorMessage('~/.qoder/settings.json is not valid JSON; changes were skipped. Please fix it and retry.');
        return;
      }
      showErr(e); return;
    }

    await context.globalState.update(STATE_KEY, 'enabled');
    status.text = '$(check) qodercli-vsc-bridge';
    status.tooltip = `connected to qodercli (${res.mode})`;
    status.show();
    if (interactive) {
      vscode.window.showInformationMessage('IDE context has been connected for qodercli. Open a new integrated terminal and run qodercli for it to take effect.');
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('qodercli-vsc-bridge.enable', () => apply(true)),
    vscode.commands.registerCommand('qodercli-vsc-bridge.disable', async () => {
      try { qoder.disable(qoderSettingsPath()); } catch (e) { showErr(e); }
      await context.globalState.update(STATE_KEY, 'deferred');
      status.text = '$(circle-slash) qodercli-vsc-bridge';
      status.tooltip = 'disabled';
      status.show();
      vscode.window.showInformationMessage('Removed the extension configuration from qodercli.');
    }),
    vscode.commands.registerCommand('qodercli-vsc-bridge.clean', async () => {
      try { qoder.disable(qoderSettingsPath()); } catch (e) { showErr(e); }
      try { assets.clean(context.globalStorageUri.fsPath); } catch (e) { showErr(e); }
      await context.globalState.update(STATE_KEY, undefined);
      status.hide();
      vscode.window.showInformationMessage('Removed configuration and cleaned up released scripts.');
    }),
    vscode.commands.registerCommand('qodercli-vsc-bridge.status', () => {
      const st = qoder.getStatus(qoderSettingsPath());
      const rt = resolveNode();
      vscode.window.showInformationMessage(
        `qodercli-vsc-bridge: mcp=${st.mcp} hook=${st.hook} node=${rt?.command ?? 'not found'}`);
    }),
  );

  const consent = context.globalState.get<string>(STATE_KEY);
  if (consent === 'enabled') {
    await apply(false);
  } else if (consent === undefined) {
    const pick = await vscode.window.showInformationMessage(
      'This extension will modify ~/.qoder/settings.json and create script links in the extension data directory to provide IDE context to qodercli in the VSCode integrated terminal. Enable it?',
      'Enable', 'Later', 'Details');
    if (pick === 'Enable') { await apply(true); }
    else if (pick === 'Details') { void vscode.env.openExternal(vscode.Uri.parse(README_URL)); }
    else { await context.globalState.update(STATE_KEY, 'deferred'); }
  }
  // consent === 'deferred' → 静默不处理
}

export function deactivate(): void { /* 保留 qoder 配置 */ }
