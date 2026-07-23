import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { enable, disable, getStatus, QoderConfigError, BridgeConfig } from '../qoderConfig';

let tmp: string;
let settingsPath: string;
const cfg: BridgeConfig = {
  node: '/x/node',
  env: { ELECTRON_RUN_AS_NODE: '1' },
  bridgeScript: '/store/bin/vscode-mcp-bridge.mjs',
  hookScript: '/store/bin/inject-ide-context.mjs',
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qvb-qc-'));
  settingsPath = path.join(tmp, 'settings.json');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function write(obj: unknown) { fs.writeFileSync(settingsPath, JSON.stringify(obj)); }
function read(): any { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }

describe('enable', () => {
  it('空配置 → 写入 mcpServers.vscode 与 hook，并生成 .bak', () => {
    write({});
    enable(settingsPath, cfg);
    const s = read();
    expect(s.mcpServers.vscode).toEqual({ command: '/x/node', args: [cfg.bridgeScript], env: { ELECTRON_RUN_AS_NODE: '1' } });
    const groups = s.hooks.UserPromptSubmit;
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks[0].command).toContain('inject-ide-context.mjs');
    expect(groups[0].hooks[0].statusMessage).toContain('qodercli-vsc-bridge');
    expect(fs.existsSync(settingsPath + '.bak')).toBe(true);
  });

  it('保留用户既有配置项', () => {
    write({ model: { name: 'x' }, mcpServers: { other: { command: 'o' } }, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'user.sh' }] }] } });
    enable(settingsPath, cfg);
    const s = read();
    expect(s.model).toEqual({ name: 'x' });
    expect(s.mcpServers.other).toEqual({ command: 'o' });
    const cmds = s.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds).toContain('user.sh');
    expect(cmds.some((c: string) => c.includes('inject-ide-context.mjs'))).toBe(true);
  });

  it('幂等：重复 enable 不重复添加本扩展 hook', () => {
    write({});
    enable(settingsPath, cfg);
    enable(settingsPath, cfg);
    const ours = read().hooks.UserPromptSubmit.filter((g: any) =>
      g.hooks.some((h: any) => String(h.command).includes('inject-ide-context.mjs')));
    expect(ours).toHaveLength(1);
  });

  it('无 env 时不写 env 字段', () => {
    write({});
    enable(settingsPath, { ...cfg, env: undefined });
    expect(read().mcpServers.vscode.env).toBeUndefined();
  });

  it('文件不存在 → 抛 NOT_INSTALLED', () => {
    expect(() => enable(settingsPath, cfg)).toThrowError(QoderConfigError);
    try { enable(settingsPath, cfg); } catch (e: any) { expect(e.code).toBe('NOT_INSTALLED'); }
  });

  it('非法 JSON → 抛 INVALID_JSON 且不改文件', () => {
    fs.writeFileSync(settingsPath, '{ not json');
    try { enable(settingsPath, cfg); } catch (e: any) { expect(e.code).toBe('INVALID_JSON'); }
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe('{ not json');
  });
});

describe('disable', () => {
  it('移除本扩展项，保留用户项', () => {
    write({ mcpServers: { other: { command: 'o' } }, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'user.sh' }] }] } });
    enable(settingsPath, cfg);
    disable(settingsPath);
    const s = read();
    expect(s.mcpServers.vscode).toBeUndefined();
    expect(s.mcpServers.other).toEqual({ command: 'o' });
    const cmds = s.hooks.UserPromptSubmit.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds).toContain('user.sh');
    expect(cmds.some((c: string) => c.includes('inject-ide-context.mjs'))).toBe(false);
  });

  it('文件不存在 → 静默', () => {
    expect(() => disable(settingsPath)).not.toThrow();
  });
});

describe('getStatus', () => {
  it('反映启用状态', () => {
    write({});
    expect(getStatus(settingsPath)).toEqual({ mcp: false, hook: false });
    enable(settingsPath, cfg);
    expect(getStatus(settingsPath)).toEqual({ mcp: true, hook: true });
  });

  it('文件缺失/非法 → 全 false', () => {
    expect(getStatus(settingsPath)).toEqual({ mcp: false, hook: false });
    fs.writeFileSync(settingsPath, 'nope');
    expect(getStatus(settingsPath)).toEqual({ mcp: false, hook: false });
  });
});
