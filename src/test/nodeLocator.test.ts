import { describe, it, expect } from 'vitest';
import { resolveNodeRuntime } from '../nodeLocator';

describe('resolveNodeRuntime', () => {
  it('execPath 是纯 node（remote/server 宿主）→ 直接用', () => {
    expect(resolveNodeRuntime({ execPath: '/x/server/node', hasElectron: false }))
      .toEqual({ command: '/x/server/node' });
  });

  it('桌面 Electron 宿主 → execPath + ELECTRON_RUN_AS_NODE', () => {
    expect(resolveNodeRuntime({ execPath: '/Applications/Code.app/Contents/MacOS/Electron', hasElectron: true }))
      .toEqual({ command: '/Applications/Code.app/Contents/MacOS/Electron', env: { ELECTRON_RUN_AS_NODE: '1' } });
  });

  it('execPath 非 node 且无 electron 时，用 askpassNode 兜底', () => {
    expect(resolveNodeRuntime({ execPath: '/usr/bin/foo', hasElectron: false, askpassNode: '/x/server/node' }))
      .toEqual({ command: '/x/server/node' });
  });

  it('仅有 PATH node 时用之', () => {
    expect(resolveNodeRuntime({ execPath: '/usr/bin/foo', hasElectron: false, pathNode: '/usr/bin/node' }))
      .toEqual({ command: '/usr/bin/node' });
  });

  it('都没有 → null', () => {
    expect(resolveNodeRuntime({ execPath: '/usr/bin/foo', hasElectron: false })).toBeNull();
  });

  it('Windows node.exe 识别为纯 node', () => {
    expect(resolveNodeRuntime({ execPath: 'C:\\vscode\\node.exe', hasElectron: false }))
      .toEqual({ command: 'C:\\vscode\\node.exe' });
  });
});
