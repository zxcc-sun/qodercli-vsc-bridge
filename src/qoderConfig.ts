import * as fs from 'node:fs';
import { MCP_SERVER_KEY, HOOK_MARK, SCRIPT_HOOK } from './constants';

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

function readOrThrow(settingsPath: string): Settings {
  if (!fs.existsSync(settingsPath)) {
    throw new QoderConfigError(
        'NOT_INSTALLED',
        'qodercli not detected: ~/.qoder/settings.json does not exist');
  }
  const text = fs.readFileSync(settingsPath, 'utf8');
  try { return JSON.parse(text) as Settings;
  } catch {
    throw new QoderConfigError(
        'INVALID_JSON',
        '~/.qoder/settings.json is not valid JSON; changes were skipped');
  }
}

function backupOnce(settingsPath: string): void {
  const bak = settingsPath + '.bak';
  if (!fs.existsSync(bak)) { fs.copyFileSync(settingsPath, bak); }
}

function writeAtomic(settingsPath: string, obj: unknown): void {
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
  const settings = readOrThrow(settingsPath);
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
