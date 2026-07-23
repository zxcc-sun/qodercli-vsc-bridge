import * as fs from 'node:fs';
import * as path from 'node:path';

import {HOOK_MARK, MCP_SERVER_KEY, SCRIPT_HOOK} from './constants';

export interface BridgeConfig {
  node: string;
  env?: Record<string, string>;
  bridgeScript: string;
  hookScript: string;
}

export class QoderConfigError extends Error {
  constructor(public code: 'NOT_INSTALLED' | 'INVALID_JSON', message: string) {
    super(message);
    this.name = 'QoderConfigError';
  }
}

interface HookEntry { type?: string; command?: string; statusMessage?: string; [k: string]: unknown; }
interface HookGroup { hooks?: HookEntry[]; [k: string]: unknown; }
interface Settings {
  mcpServers?: Record<string, unknown>;
  hooks?: { UserPromptSubmit?: HookGroup[]; [k: string]: unknown };
  [k: string]: unknown;
}

function parseSettings(text: string): Settings {
  try {
    return JSON.parse(text) as Settings;
  } catch {
    throw new QoderConfigError(
        'INVALID_JSON',
        '~/.qoder/settings.json is not valid JSON; changes were skipped');
  }
}

function readOrThrow(settingsPath: string): Settings {
  if (!fs.existsSync(settingsPath)) {
    throw new QoderConfigError(
        'NOT_INSTALLED',
        'qodercli not detected: ~/.qoder/settings.json does not exist');
  }
  return parseSettings(fs.readFileSync(settingsPath, 'utf8'));
}

// qodercli 已安装但从未运行时 settings.json 尚未生成；
// 此处不视为“未安装”，返回空配置，稍后由 writeAtomic 主动创建文件。
function readOrInit(settingsPath: string): Settings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  return parseSettings(fs.readFileSync(settingsPath, 'utf8'));
}

function backupOnce(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) {
    return;
  }  // 新建文件时没有原内容可备份
  const bak = settingsPath + '.bak';
  if (!fs.existsSync(bak)) { fs.copyFileSync(settingsPath, bak); }
}

function writeAtomic(settingsPath: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(settingsPath), {recursive: true});
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, settingsPath);
}

function isOurHookGroup(group: HookGroup): boolean {
  return Array.isArray(group.hooks) && group.hooks.some(h =>
    (typeof h.statusMessage === 'string' && h.statusMessage.includes(HOOK_MARK)) ||
    (typeof h.command === 'string' && h.command.includes(SCRIPT_HOOK)));
}

function quote(p: string): string { return `"${p}"`; }

export function enable(settingsPath: string, cfg: BridgeConfig): void {
  const settings = readOrInit(settingsPath);
  backupOnce(settingsPath);

  settings.mcpServers = settings.mcpServers ?? {};
  settings.mcpServers[MCP_SERVER_KEY] = {
    command: cfg.node,
    args: [cfg.bridgeScript],
    ...(cfg.env ? { env: cfg.env } : {}),
  };

  settings.hooks = settings.hooks ?? {};
  const existing = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
  const kept = existing.filter(g => !isOurHookGroup(g));
  kept.push({
    hooks: [{
      type: 'command',
      command: `${quote(cfg.node)} ${quote(cfg.hookScript)}`,
      timeout: 10,
      ...(cfg.env ? { env: cfg.env } : {}),
      statusMessage: `${HOOK_MARK}: inject IDE context`,
    }],
  });
  settings.hooks.UserPromptSubmit = kept;

  writeAtomic(settingsPath, settings);
}

export function disable(settingsPath: string): void {
  if (!fs.existsSync(settingsPath)) { return; }
  const settings = readOrThrow(settingsPath);
  let changed = false;

  if (settings.mcpServers && MCP_SERVER_KEY in settings.mcpServers) {
    delete settings.mcpServers[MCP_SERVER_KEY];
    changed = true;
  }
  const list = settings.hooks?.UserPromptSubmit;
  if (Array.isArray(list)) {
    const kept = list.filter(g => !isOurHookGroup(g));
    if (kept.length !== list.length) {
      settings.hooks!.UserPromptSubmit = kept;
      changed = true;
    }
  }
  if (changed) { writeAtomic(settingsPath, settings); }
}

export function getStatus(settingsPath: string): { mcp: boolean; hook: boolean } {
  try {
    const settings = readOrThrow(settingsPath);
    const mcp = !!(settings.mcpServers && settings.mcpServers[MCP_SERVER_KEY]);
    const list = settings.hooks?.UserPromptSubmit;
    const hook = Array.isArray(list) && list.some(isOurHookGroup);
    return { mcp, hook };
  } catch {
    return { mcp: false, hook: false };
  }
}
