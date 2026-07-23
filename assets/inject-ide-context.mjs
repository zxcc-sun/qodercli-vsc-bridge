#!/usr/bin/env node
// inject-ide-context.mjs —— qodercli 的 UserPromptSubmit 钩子
// 作用：每次用户输入前，自动把 VSCodeIDE「当前活动文件路径 +
// 选中文本（若有）」注入为额外上下文。 机制：qoder 的 UserPromptSubmit hook 在
// exit 0 时，会把 command 的【纯文本 stdout】
//       作为 additionalContext 注入本轮对话（见 docs.qoder.com/en/cli/hooks）。
// 取数：一次性连 VSCodeIDE 内置 Copilot 扩展的 MCP（unix socket），调
// get_selection。
//
// 铁律：本钩子对用户输入是「旁路增强」，任何异常/超时/无 IDE 都必须【静默 exit
// 0】，
//       绝不阻塞或干扰用户输入。
//
// 注册（~/.qoder/settings.json）：
//   "hooks": { "UserPromptSubmit": [ { "hooks": [
//     { "type":"command", "command":"node /绝对路径/inject-ide-context.mjs",
//     "timeout":10 } ] } ] }
// 开关：HOOK_REQUIRE_VSCODE_TERMINAL=0
// 关闭「仅内置终端」门控；HOOK_DEBUG_FILE=<path> 记录每次注入便于排查。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

// —— 统一出口：可选输出一段文本，然后立刻成功退出（永不阻塞用户）——
// 设 HOOK_DEBUG_FILE 时，把每次注入内容追加落盘，便于排查 hook 是否被触发、注入了什么。
const OK = (text = '') => {
  try { if (process.env.HOOK_DEBUG_FILE) fs.appendFileSync(process.env.HOOK_DEBUG_FILE, `[${new Date().toISOString()}] pid=${process.pid} bytes=${text ? Buffer.byteLength(text) : 0}\n${text || '(no-op)'}\n---\n`); } catch { }
  try { if (text) process.stdout.write(text); } catch { }
  process.exit(0);
};

// 硬兜底：无论如何 3s 内退出，防止卡住用户输入
setTimeout(() => OK(), 3000).unref?.();

// 忽略 stdin（我们注入的是 IDE 上下文，不依赖 prompt 内容）；消费掉避免写方 EPIPE
try { process.stdin.resume(); process.stdin.on('data', () => { }); process.stdin.on('error', () => { }); } catch { }

function discover() {
  // 门控：仅在 VSCode 内置终端启动的 qodercli 才注入（外部终端无 TERM_PROGRAM=vscode）
  const inVscode = process.env.TERM_PROGRAM === 'vscode' || !!process.env.VSCODE_IPC_HOOK_CLI;
  if (process.env.HOOK_REQUIRE_VSCODE_TERMINAL !== '0' && !inVscode) return null;

  const dir = `${os.homedir()}/.copilot/ide`;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.lock')); } catch { return null; }
  const cwd = process.cwd();
  const alive = files.map(f => { try { return JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .filter(info => { try { process.kill(info.pid, 0); } catch { return false; } return fs.existsSync(info.socketPath); });
  if (!alive.length) return null;
  // 多窗口：优先选 workspaceFolders 包含当前 cwd 的那个 IDE
  return alive.find(i => (i.workspaceFolders || []).some(w => cwd === w || cwd.startsWith(w.replace(/\/$/, '') + '/'))) || alive[0];
}

function mcpCall(lock, method, params, id) {
  const { socketPath } = lock;
  const auth = lock.headers.Authorization;
  const sessionId = mcpCall._sid || (mcpCall._sid = crypto.randomUUID());
  const body = JSON.stringify(id ? { jsonrpc: '2.0', id, method, params } : { jsonrpc: '2.0', method, params });
  const headers = {
    Host: 'localhost', Authorization: auth, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'mcp-session-id': sessionId, 'x-copilot-session-id': sessionId,
    'mcp-protocol-version': mcpCall._pv || '2025-06-18', 'Content-Length': Buffer.byteLength(body),
  };
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/mcp', method: 'POST', headers }, (res) => {
      let buf = '', done = false;
      const fin = () => {
        if (done) return; done = true;
        let json = null;
        for (const line of buf.split(/\r?\n/)) { const m = line.match(/^data:\s*(.+)$/); if (m) { try { json = JSON.parse(m[1]); } catch { } } }
        if (!json) { try { json = JSON.parse(buf); } catch { } }
        resolve(json);
      };
      res.on('data', (c) => { buf += c; if (id && buf.includes('"result"') && buf.includes(`"id":${id}`)) { res.destroy(); fin(); } });
      res.on('end', fin); res.on('close', fin);
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

async function getSelection(lock) {
  const init = await mcpCall(lock, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ide-ctx-hook', version: '0.0.1' } }, 1);
  if (init?.result?.protocolVersion) mcpCall._pv = init.result.protocolVersion;
  await mcpCall(lock, 'notifications/initialized', {});
  const sel = await mcpCall(lock, 'tools/call', { name: 'get_selection', arguments: {} }, 3);
  const txt = sel?.result?.content?.[0]?.text;
  return (!txt || txt === 'null') ? null : JSON.parse(txt);
}

const lock = discover();
if (!lock) OK();

const s = await getSelection(lock).catch(() => null);
if (!s || !s.filePath) OK();

let out = `<ide-context source="vscode ide">\nActive file: ${s.filePath}`;
const sr = s.selection;
if (s.text && s.text.length && sr && !sr.isEmpty) {
  out += `\nSelected range: L${sr.start.line + 1}:${
      sr.start.character + 1} – L${sr.end.line + 1}:${sr.end.character + 1}`;
  out += `\nSelected text:\n\`\`\`\n${s.text}\n\`\`\``;
} else if (sr) {
  out += `\nCursor position: L${sr.start.line + 1}:${
      sr.start.character + 1} (no selection)`;
}
out += `\n</ide-context>\n`;
OK(out);
