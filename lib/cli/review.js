#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../review/snapshot.js';
import { createReviewApp } from '../review/server.js';

const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), '..', '..');
const runtimeRoot = process.env.FLOWREVIEW_RUNTIME || process.env.YADIFF_REVIEW_RUNTIME || join(homedir(), '.yadiff-review');
const registry = join(runtimeRoot, `runtime-${createHash('sha256').update(root).digest('hex').slice(0, 12)}.json`);

export function parseReviewArgs(argv) {
  const args = { port: 5188, foreground: false, open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['--review', '--snapshot', '--out', '--port'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      args[arg.slice(2)] = arg === '--port' ? Number(value) : resolve(value);
    } else if (arg === '--foreground') args.foreground = true;
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--build-only') args.buildOnly = true;
    else if (arg === '--stop') args.stop = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error('端口必须在 1–65535 之间');
  if (args.review && args.snapshot) throw new Error('--review 和 --snapshot 二选一');
  return args;
}

function openBrowser(url) {
  let child;
  if (process.platform === 'win32') child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' });
  else child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error('自动打开失败，请打开上方地址')); child.unref();
}

async function request(runtime, path, body) {
  const res = await fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`本地阅读服务返回 ${res.status}`);
  return res.json();
}

async function existing() {
  try { const runtime = JSON.parse(readFileSync(registry, 'utf8')); await request(runtime, 'heartbeat', {}); return runtime; } catch { return null; }
}

export async function reviewMain(argv = process.argv.slice(2)) {
  const args = parseReviewArgs(argv);
  if (args.help) { console.log('FlowReview — 功能链代码评审\nflowreview --review review.json [--out 快照目录] [--build-only]\nflowreview --snapshot 快照目录 [--foreground] [--no-open] [--port 5188]\nflowreview --stop\n首次：npm ci && npm run build；之后直接启动，不重新安装依赖。'); return; }
  let runtime = await existing();
  if (args.stop) { if (runtime) await request(runtime, 'stop', {}); console.log(runtime ? '已停止阅读器' : '阅读器未运行'); return; }
  let folder = args.snapshot;
  if (args.review) {
    folder = args.out || join(dirname(args.review), 'reader-snapshots', new Date().toISOString().replace(/[:.]/g, '-'));
    const manifest = buildSnapshot(args.review, folder);
    console.log(`已生成固定源码快照：${folder}\n${Object.keys(manifest.files).length} 个文件，${Object.keys(manifest.nodes).length} 个阅读节点`);
    if (args.buildOnly) return;
  }
  if (!folder || !existsSync(join(folder, 'manifest.json'))) throw new Error('请用 --review 指定报告，或 --snapshot 指定已生成的快照目录');
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('前端尚未构建，请在 FlowReview 安装目录执行 npm ci 和 npm run build');
  if (runtime) {
    const { id } = await request(runtime, 'register', { folder });
    const url = `http://127.0.0.1:${runtime.port}/review/${id}#${runtime.token}`;
    console.log(`复用本地阅读器：${url}`); if (args.open) openBrowser(url); return;
  }
  if (!args.foreground) {
    const child = spawn(process.execPath, [self, '--snapshot', folder, '--foreground', '--no-open', '--port', String(args.port)], {
      detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env,
    }); child.unref();
    const url = await new Promise((ok, fail) => {
      const timer = setTimeout(() => { child.kill(); fail(new Error('启动本地阅读器超时')); }, 30_000);
      child.on('message', message => { clearTimeout(timer); message.url ? ok(message.url) : fail(new Error(message.error)); });
      child.on('error', error => { clearTimeout(timer); fail(error); });
      child.on('exit', code => { clearTimeout(timer); fail(new Error(`阅读器提前退出：${code}`)); });
    }); if (child.connected) child.disconnect(); console.log(`阅读地址：${url}`); if (args.open) openBrowser(url); return;
  }
  mkdirSync(runtimeRoot, { recursive: true });
  let server;
  function stop() {
    clearInterval(idle);
    try { const saved = JSON.parse(readFileSync(registry)); if (saved.pid === process.pid) unlinkSync(registry); } catch {}
    server.close(() => process.exit(0)); server.closeIdleConnections();
  }
  const reader = createReviewApp({ dist: join(root, 'dist'), stateRoot: join(runtimeRoot, 'reading-state'), onStop: stop });
  const id = reader.register(folder);
  server = await new Promise((ok, fail) => {
    const first = reader.app.listen(args.port, '127.0.0.1', () => ok(first));
    first.on('error', error => { if (error.code === 'EADDRINUSE') { const free = reader.app.listen(0, '127.0.0.1', () => ok(free)); free.on('error', fail); } else fail(error); });
  });
  runtime = { port: server.address().port, token: reader.token, pid: process.pid };
  writeFileSync(registry, JSON.stringify(runtime), { mode: 0o600 });
  const url = `http://127.0.0.1:${runtime.port}/review/${id}#${runtime.token}`;
  const idle = setInterval(() => { if (Date.now() - reader.lastActivity() > 5 * 60_000) stop(); }, 30_000); idle.unref();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`阅读地址：${url}`);
  if (process.send) process.send({ url });
  if (args.open) openBrowser(url);
}

if (resolve(process.argv[1] || '') === self) reviewMain().catch(error => {
  if (process.send) process.send({ error: error.message });
  console.error(error.message); process.exitCode = 1;
});
