import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCRIPT_BRIDGE, SCRIPT_HOOK } from './constants';

export interface EnsureInput {
  assetsDir: string;      // <extensionPath>/assets
  storageDir: string;     // context.globalStorageUri.fsPath
  isWindows: boolean;     // process.platform === 'win32'
  extensionPath: string;  // 用于版本比对
  nodePath:
      string;  // 解析到的 node/electron 二进制绝对路径（NodeRuntime.command）
  nodeIsElectron:
      boolean;  // 是否 Electron 运行时（NodeRuntime.env?.ELECTRON_RUN_AS_NODE
                // 存在）
}

export interface EnsureResult {
  binDir: string;
  bridgeScript: string;
  hookScript: string;
  nodeCommand: string;  // 写入 settings.json 的 node
                        // 命令：稳定符号链接，失败时降级为绝对路径
  mode: 'link' | 'copy';
}

export type SymlinkFn =
    (target: string, linkPath: string, type: 'junction'|'dir'|'file') => void;

const SCRIPTS = [SCRIPT_BRIDGE, SCRIPT_HOOK];
const NODE_LINK_NAMES = ['node', 'node.exe'];
const defaultSymlink: SymlinkFn = (target, linkPath, type) => fs.symlinkSync(target, linkPath, type);

interface Marker { extensionPath: string; mode: 'link' | 'copy'; }

function markerPath(storageDir: string): string {
  return path.join(storageDir, '.linked.json');
}

function readMarker(storageDir: string): Marker | null {
  try { return JSON.parse(fs.readFileSync(markerPath(storageDir), 'utf8')) as Marker; }
  catch { return null; }
}

function removeEntry(target: string): void {
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink() || st.isFile()) {
      fs.unlinkSync(target);
    } else {
      fs.rmSync(target, {recursive: true, force: true});
    }
  } catch { /* 不存在 */ }
}

function nodeLinkPath(storageDir: string, isWindows: boolean): string {
  return path.join(storageDir, isWindows ? 'node.exe' : 'node');
}

// 为 node 运行时建立/刷新稳定符号链接，返回写入配置用的 node 命令路径。
// 关键：VSCode 版本更新后 node 的绝对路径会变（如
// .vscode-server/.../<commit>/server/node）， 但扩展目录不变、无法用
// extensionPath 版本比对短路，故本函数每次都刷新链接指向当前 node。
function ensureNodeLink(input: EnsureInput, symlink: SymlinkFn): string {
  // Electron（桌面）运行时：其二进制路径随 VSCode 原地更新保持稳定，无需链接；
  // 且对 Electron 二进制做符号链接在 macOS 上可能破坏 framework 定位 →
  // 直接用绝对路径。
  if (input.nodeIsElectron) {
    return input.nodePath;
  }
  const linkPath = nodeLinkPath(input.storageDir, input.isWindows);
  try {
    removeEntry(linkPath);
    symlink(input.nodePath, linkPath, 'file');
    return linkPath;
  } catch {
    return input
        .nodePath;  // 降级：符号链接不可用（如 Windows 无权限）→ 用绝对路径
  }
}

function result(storageDir: string, mode: 'link'|'copy', nodeCommand: string):
    EnsureResult {
  const binDir = path.join(storageDir, 'bin');
  return {
    binDir,
    bridgeScript: path.join(binDir, SCRIPT_BRIDGE),
    hookScript: path.join(binDir, SCRIPT_HOOK),
    nodeCommand,
    mode,
  };
}

export function ensure(input: EnsureInput, symlink: SymlinkFn = defaultSymlink): EnsureResult {
  const binDir = path.join(input.storageDir, 'bin');
  fs.mkdirSync(input.storageDir, { recursive: true });

  // node 稳定链接：独立于 bin 的 up-to-date 逻辑，每次都刷新（见 ensureNodeLink
  // 注释）。
  const nodeCommand = ensureNodeLink(input, symlink);

  const marker = readMarker(input.storageDir);
  const upToDate =
    marker !== null &&
    marker.extensionPath === input.extensionPath &&
    fs.existsSync(binDir);
  if (upToDate) {
    return result(input.storageDir, marker.mode, nodeCommand);
  }

  removeEntry(binDir);

  let mode: 'link' | 'copy';
  try {
    symlink(input.assetsDir, binDir, input.isWindows ? 'junction' : 'dir');
    mode = 'link';
  } catch {
    fs.mkdirSync(binDir, { recursive: true });
    for (const s of SCRIPTS) {
      fs.copyFileSync(path.join(input.assetsDir, s), path.join(binDir, s));
    }
    mode = 'copy';
  }

  fs.writeFileSync(markerPath(input.storageDir), JSON.stringify({ extensionPath: input.extensionPath, mode } as Marker));
  return result(input.storageDir, mode, nodeCommand);
}

export function clean(storageDir: string): void {
  removeEntry(path.join(storageDir, 'bin'));
  for (const name of NODE_LINK_NAMES) {
    removeEntry(path.join(storageDir, name));
  }
  try { fs.unlinkSync(markerPath(storageDir)); } catch { /* 不存在 */ }
}
