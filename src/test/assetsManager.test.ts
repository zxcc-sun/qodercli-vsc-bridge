import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensure, clean } from '../assetsManager';

let tmp: string;
let assetsDir: string;

const lstatExists = (p: string) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qvb-am-'));
  assetsDir = path.join(tmp, 'ext-0.0.1', 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'vscode-mcp-bridge.mjs'), '// bridge');
  fs.writeFileSync(path.join(assetsDir, 'inject-ide-context.mjs'), '// hook');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('ensure', () => {
  it('默认建目录链接，脚本可解析', () => {
    const storageDir = path.join(tmp, 'storage');
    const res = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    expect(res.mode).toBe('link');
    expect(fs.readFileSync(res.bridgeScript, 'utf8')).toBe('// bridge');
    expect(fs.readFileSync(res.hookScript, 'utf8')).toBe('// hook');
    expect(fs.lstatSync(res.binDir).isSymbolicLink()).toBe(true);
  });

  it('链接失败时降级复制文件', () => {
    const storageDir = path.join(tmp, 'storage2');
    const throwing = () => { throw new Error('EPERM'); };
    const res = ensure(
        {
          assetsDir,
          storageDir,
          isWindows: false,
          extensionPath: path.join(tmp, 'ext-0.0.1'),
          nodePath: '/x/node',
          nodeIsElectron: false
        },
        throwing);
    expect(res.mode).toBe('copy');
    expect(fs.existsSync(res.bridgeScript)).toBe(true);
    expect(fs.lstatSync(res.binDir).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(res.hookScript, 'utf8')).toBe('// hook');
  });

  it('extensionPath 变化时重建链接指向新目录', () => {
    const storageDir = path.join(tmp, 'storage3');
    ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    // 新版本
    const assets2 = path.join(tmp, 'ext-0.0.2', 'assets');
    fs.mkdirSync(assets2, { recursive: true });
    fs.writeFileSync(path.join(assets2, 'vscode-mcp-bridge.mjs'), '// bridge2');
    fs.writeFileSync(path.join(assets2, 'inject-ide-context.mjs'), '// hook2');
    const res = ensure({
      assetsDir: assets2,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.2'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    expect(res.mode).toBe('link');
    expect(fs.readFileSync(res.bridgeScript, 'utf8')).toBe('// bridge2');
  });

  it('相同 extensionPath 再次 ensure 不报错且路径稳定', () => {
    const storageDir = path.join(tmp, 'storage4');
    const a = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    const b = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    expect(b.bridgeScript).toBe(a.bridgeScript);
  });

  it('为纯 node 建立稳定符号链接，nodeCommand 指向 storageDir/node', () => {
    const storageDir = path.join(tmp, 'storageNode');
    const res = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/some/server/node',
      nodeIsElectron: false
    });
    expect(res.nodeCommand).toBe(path.join(storageDir, 'node'));
    expect(fs.lstatSync(res.nodeCommand).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(res.nodeCommand)).toBe('/some/server/node');
  });

  it('VSCode 版本更新后（nodePath 变、extensionPath 不变）刷新 node 链接、稳定路径不变',
     () => {
       const storageDir = path.join(tmp, 'storageUpd');
       const ext = path.join(tmp, 'ext-0.0.1');
       const r1 = ensure({
         assetsDir,
         storageDir,
         isWindows: false,
         extensionPath: ext,
         nodePath: '/old/server/node',
         nodeIsElectron: false
       });
       expect(fs.readlinkSync(r1.nodeCommand)).toBe('/old/server/node');
       const r2 = ensure({
         assetsDir,
         storageDir,
         isWindows: false,
         extensionPath: ext,
         nodePath: '/new/server/node',
         nodeIsElectron: false
       });
       expect(r2.nodeCommand)
           .toBe(r1.nodeCommand);  // settings.json 里的路径稳定不变
       expect(fs.readlinkSync(r2.nodeCommand))
           .toBe('/new/server/node');  // 但链接已刷新指向新 node
     });

  it('Electron 运行时不建 node 链接，nodeCommand 用绝对路径', () => {
    const storageDir = path.join(tmp, 'storageEl');
    const electron = '/Applications/Code.app/Contents/MacOS/Electron';
    const res = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: electron,
      nodeIsElectron: true
    });
    expect(res.nodeCommand).toBe(electron);
    expect(lstatExists(path.join(storageDir, 'node'))).toBe(false);
  });

  it('node 符号链接失败时 nodeCommand 降级为绝对路径', () => {
    const storageDir = path.join(tmp, 'storageNF');
    const throwing = () => {
      throw new Error('EPERM');
    };
    const res = ensure(
        {
          assetsDir,
          storageDir,
          isWindows: false,
          extensionPath: path.join(tmp, 'ext-0.0.1'),
          nodePath: '/x/node',
          nodeIsElectron: false
        },
        throwing);
    expect(res.nodeCommand).toBe('/x/node');
  });
});

describe('clean', () => {
  it('删除 bin、node 链接与标记文件', () => {
    const storageDir = path.join(tmp, 'storage5');
    const res = ensure({
      assetsDir,
      storageDir,
      isWindows: false,
      extensionPath: path.join(tmp, 'ext-0.0.1'),
      nodePath: '/x/node',
      nodeIsElectron: false
    });
    expect(fs.lstatSync(res.nodeCommand).isSymbolicLink()).toBe(true);
    clean(storageDir);
    expect(fs.existsSync(res.binDir)).toBe(false);
    expect(lstatExists(res.nodeCommand)).toBe(false);
    expect(fs.existsSync(path.join(storageDir, '.linked.json'))).toBe(false);
  });
});
