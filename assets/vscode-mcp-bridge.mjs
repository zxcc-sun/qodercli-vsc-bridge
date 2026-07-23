#!/usr/bin/env node
// vscode-mcp-bridge.mjs
// 作用：把 qodercli 的「stdio MCP server」桥接到 VSCode 内置 Copilot 扩展在 unix socket 上
//       暴露的 Streamable-HTTP MCP server（即 Copilot CLI 用的 /ide 服务）。
//
// 为什么需要桥接（三个 qoder 原生 http 传输无法直连的原因）：
//   1) VSCode 监听的是 unix domain socket（/tmp/mcp-XXX/mcp.sock），不是 http://host:port，
//      qoder 的 -t http 只能填 URL，连不上 socket。
//   2) 认证 Nonce 与 socketPath 每次 VSCode 会话都变，静态配置写不死。
//   3) VSCode 要求 client 在 initialize 就自带 mcp-session-id（源码 _handlePost），
//      而标准 MCP http client（含 qoder 内置）initialize 时不发 session-id → 会被 400 拒绝。
//
// 本桥接进程用 qoder 的 stdio 传输接入（-t stdio，最通用、无上述限制），
// 内部把每条 JSON-RPC 转成带全部必需头的 POST /mcp，并维持一条 GET /mcp SSE 长连接接收推送。
//
// 用法（在 qoder 中注册）：
//   qodercli mcp add vscode -- node /绝对路径/vscode-mcp-bridge.mjs
// 依赖：仅 Node 内置模块（http/fs/os/crypto/readline），无需 npm 安装。
//
// 「仅 VSCode 内置终端可见」的原理：VSCode 内置终端会给子进程注入 TERM_PROGRAM=vscode /
//   VSCODE_IPC_HOOK_CLI 等环境变量；qoder spawn 本桥接时这些变量被继承，外部终端则没有。
//   因此桥接据此门控：非内置终端启动 → 直接退出（qoder 显示 Disconnected，即不可见）。
//   逃生阀：BRIDGE_REQUIRE_VSCODE_TERMINAL=0 关闭门控，恢复「任何终端都可连」。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';

const log = (...a) => process.stderr.write('[vscode-mcp-bridge] ' + a.join(' ') + '\n'); // 只往 stderr 打日志
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');                    // stdout 只走 JSON-RPC

// ---------- 1) 发现层：读锁文件，拿 socketPath + Nonce ----------
function discover() {
  // —— 门控①：仅允许从 VSCode 内置终端启动（外部终端不可见）——
  const inVscodeTerminal = process.env.TERM_PROGRAM === 'vscode' || !!process.env.VSCODE_IPC_HOOK_CLI;
  if (process.env.BRIDGE_REQUIRE_VSCODE_TERMINAL !== '0' && !inVscodeTerminal) {
    throw new Error(
        `Access denied: not a VSCode integrated terminal (TERM_PROGRAM=${
            process.env.TERM_PROGRAM || '(empty)'}).` +
        ` Please start qodercli from a VSCode integrated terminal; if you really need to connect from an external terminal, set the environment variable BRIDGE_REQUIRE_VSCODE_TERMINAL=0.`);
  }

  const dir = `${os.homedir()}/.copilot/ide`;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.lock')); } catch { }
  if (!files.length)
    throw new Error(`No lock file found: ${
        dir}/*.lock (is VSCode open with Copilot installed?)`);

  const wanted = process.env.BRIDGE_WORKSPACE; // 可选：多窗口时手动指定工作区路径片段
  const alive = files.map(f => {
    try { return { f, info: JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')) }; } catch { return null; }
  }).filter(Boolean).filter(({ info }) => {
    try { process.kill(info.pid, 0); } catch { return false; }          // 进程存活
    if (!fs.existsSync(info.socketPath)) return false;                   // socket 存在
    if (wanted && !(info.workspaceFolders || []).some(w => w.includes(wanted))) return false;
    return true;
  });
  if (!alive.length)
    throw new Error(
        'All lock files point to dead IDEs (process gone / socket missing / workspace mismatch)');

  // —— 门控②：多窗口归属，优先选 workspaceFolders 包含当前 cwd 的那个 IDE ——
  const cwd = process.cwd();
  const byCwd = alive.find(({ info }) =>
    (info.workspaceFolders || []).some(w => cwd === w || cwd.startsWith(w.replace(/\/$/, '') + '/')));
  const chosen = (byCwd || alive[0]).info;
  log(`discovered socket=${chosen.socketPath} ide=${chosen.ideName} ws=${(chosen.workspaceFolders||[]).join(',')} matchedByCwd=${!!byCwd}`);
  return chosen;
}

let lock;
try {
  lock = discover();
} catch (e) {
  log('discover failed: ' + e.message);
  process.exit(1);
}

const socketPath = lock.socketPath;
const auth = lock.headers.Authorization;      // "Nonce <uuid>"
const sessionId = crypto.randomUUID();        // 本桥接自选 session id，全程复用；与运行中的 Copilot CLI 互不干扰
let protocolVersion = '2025-06-18';
const forwardPush = process.env.BRIDGE_FORWARD_PUSH !== '0';

function baseHeaders(extra = {}) {
  return {
    'Host': 'localhost',                                 // 绕过 DNS rebinding 保护（allowedHosts:['localhost']）
    'Authorization': auth,                               // Nonce 认证，否则 401
    'Accept': 'application/json, text/event-stream',     // MCP Streamable HTTP 必需，否则 406
    'mcp-session-id': sessionId,                         // VSCode 要求 client 自带（关键点）
    'x-copilot-session-id': sessionId,
    'mcp-protocol-version': protocolVersion,
    'x-copilot-pid': String(process.pid),
    'x-copilot-parent-pid': String(process.ppid),
    ...extra,
  };
}

// 从一段 buffer 里抽出所有 SSE 的 data: JSON（也兼容纯 JSON body）
function extractMessages(buf) {
  const msgs = [];
  let matchedSSE = false;
  for (const line of buf.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.+)$/);
    if (m) { matchedSSE = true; try { msgs.push(JSON.parse(m[1])); } catch { } }
  }
  if (!matchedSSE) { try { msgs.push(JSON.parse(buf)); } catch { } }
  return msgs;
}

// ---------- 2) 把一条来自 qoder 的 JSON-RPC 转成 POST /mcp ----------
function forwardToServer(msg) {
  const isRequest = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== null && msg.method;
  const payload = JSON.stringify(msg);
  const headers = baseHeaders({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });

  const req = http.request({ socketPath, path: '/mcp', method: 'POST', headers }, (res) => {
    let buf = '';
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      for (const m of extractMessages(buf)) {
        // 协商到的协议版本记录下来，后续请求头带上
        if (m.result?.protocolVersion) protocolVersion = m.result.protocolVersion;
        out(m);                                   // 把服务端返回的每条消息（响应/交错通知）转回 qoder
        if (isRequest && String(m.id) === String(msg.id) && ('result' in m || 'error' in m)) {
          if (msg.method === 'initialize') openPushStream(); // initialize 成功后开推送长连接
        }
      }
      if (res.statusCode >= 400 && isRequest && !buf.includes('"id"')) {
        out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `HTTP ${res.statusCode} from VSCode MCP server: ${buf.slice(0,200)}` } });
      }
    };
    res.on('data', (c) => {
      buf += c;
      // 请求：一旦拿到匹配 id 的最终响应即可收流（VSCode 每请求一条 SSE 后关闭）
      if (isRequest && buf.includes(`"id":${JSON.stringify(msg.id)}`) && (buf.includes('"result"') || buf.includes('"error"'))) {
        finish(); res.destroy();
      }
    });
    res.on('end', finish);
    res.on('close', finish);
  });
  req.on('error', (e) => {
    log('POST error: ' + e.message);
    if (isRequest) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'bridge->VSCode socket error: ' + e.message } });
  });
  req.write(payload); req.end();
}

// ---------- 3) GET /mcp SSE 长连接：接收 selection_changed / diagnostics_changed 推送 ----------
let pushOpened = false;
function openPushStream() {
  if (pushOpened) return; pushOpened = true;
  const req = http.request({ socketPath, path: '/mcp', method: 'GET', headers: baseHeaders() }, (res) => {
    log(`push stream GET /mcp -> HTTP ${res.statusCode}`);
    if (res.statusCode !== 200) { pushOpened = false; res.resume(); return; }
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {                 // 按 SSE 事件边界切分
        const evt = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const m of extractMessages(evt)) {
          if (forwardPush) out(m);                               // 把推送转给 qoder（未知通知会被忽略，无害）
        }
      }
    });
    res.on('end', () => { pushOpened = false; log('push stream ended'); });
    res.on('close', () => { pushOpened = false; });
  });
  req.on('error', (e) => { pushOpened = false; log('push stream error: ' + e.message); });
  req.end();
}

// ---------- 4) 从 stdin 逐行读 qoder 发来的 JSON-RPC ----------
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch (e) {
    log('stdin invalid JSON: ' + s.slice(0, 120));
    return;
  }
  forwardToServer(msg);
});
rl.on('close', () => { log('stdin closed, exit'); process.exit(0); });

log(`ready. sessionId=${sessionId} pushForward=${forwardPush}`);
