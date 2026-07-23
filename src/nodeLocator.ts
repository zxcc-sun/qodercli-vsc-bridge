export interface NodeRuntime {
  command: string;
  env?: Record<string, string>;
}

export interface NodeProbe {
  execPath: string;       // process.execPath
  hasElectron: boolean;   // !!process.versions.electron
  askpassNode?: string;   // process.env.VSCODE_GIT_ASKPASS_NODE
  pathNode?: string;      // PATH 中解析到的 node（可选）
}

function baseName(p: string): string {
  const seg = p.split(/[\\/]/).pop() ?? p;
  return seg.toLowerCase();
}

export function resolveNodeRuntime(probe: NodeProbe): NodeRuntime | null {
  const base = baseName(probe.execPath);
  const looksLikeNode = base === 'node' || base === 'node.exe';

  // 1) 宿主本身就是 node 二进制（remote/server 扩展宿主）
  if (looksLikeNode && !probe.hasElectron) {
    return { command: probe.execPath };
  }
  // 2) 桌面 Electron：以 node 模式运行
  if (probe.hasElectron) {
    return { command: probe.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  // 3) VSCODE_GIT_ASKPASS_NODE 兜底（指向 server/node）
  if (probe.askpassNode) {
    return { command: probe.askpassNode };
  }
  // 4) PATH 中的 node 兜底
  if (probe.pathNode) {
    return { command: probe.pathNode };
  }
  return null;
}
