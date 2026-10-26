import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readState, applyStateChange, writeState, StateError } from './reading-state.js';

export function createReviewApp({ dist, stateRoot, token = randomBytes(32).toString('hex'), onStop = () => {} }) {
  const app = express();
  const reports = new Map();
  let lastActivity = Date.now();
  if (stateRoot) mkdirSync(stateRoot, { recursive: true });
  const stateFile = report => stateRoot ? join(stateRoot, `${report.manifest.id}.json`) : join(report.root, 'reading-state.json');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return res.status(403).send('只允许本机访问');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ app: 'yadiff-review', version: 1 }));
  app.use('/api', (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ error: '阅读器访问凭证失效，请重新打开' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return res.status(403).json({ error: '请求来源不匹配' });
    res.setHeader('Cache-Control', 'no-store');
    lastActivity = Date.now(); next();
  });
  app.use('/api', express.json({ limit: '1mb' }));
  function register(folder) {
    const root = resolve(folder);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    if (manifest.version !== 1 || !/^[a-f0-9]{24}$/.test(manifest.id) || !manifest.files || !manifest.nodes) throw new Error('不支持的阅读快照格式');
    reports.set(manifest.id, { root, manifest });
    return manifest.id;
  }
  app.post('/api/register', (req, res) => {
    try { res.json({ id: register(req.body.folder) }); } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/heartbeat', (_req, res) => res.json({ ok: true }));
  app.post('/api/stop', (_req, res) => { res.json({ ok: true }); setTimeout(onStop, 100).unref(); });
  app.get('/api/reports/:id', (req, res) => {
    const report = reports.get(req.params.id);
    if (!report) return res.status(404).json({ error: '快照未打开，请使用启动器重新打开' });
    res.json(report.manifest);
  });
  app.get('/api/reports/:id/source/:fileId', (req, res) => {
    const report = reports.get(req.params.id);
    if (!report || !Object.hasOwn(report.manifest.files, req.params.fileId) || !/^[a-f0-9]{20}$/.test(req.params.fileId)) return res.status(404).json({ error: '源码不在本快照中' });
    res.type('json').send(readFileSync(join(report.root, 'sources', `${req.params.fileId}.json`), 'utf8'));
  });
  app.get('/api/reports/:id/state', (req, res) => {
    const report = reports.get(req.params.id);
    if (!report) return res.sendStatus(404);
    const path = stateFile(report);
    try { res.json(readState(path)); }
    catch { res.status(500).json({ error: '阅读进度读取失败，原文件已保留' }); }
  });
  function saveState(patch) {
    return (req, res) => {
      const report = reports.get(req.params.id);
      if (!report) return res.sendStatus(404);
      const path = stateFile(report);
      try {
        const next = applyStateChange(readState(path), req.body, report.manifest.nodes, patch);
        writeState(path, next); res.json(next);
      } catch (error) {
        res.status(error instanceof StateError ? error.status : 500).json({ error: error.message || '阅读标记保存失败，原进度已保留', state: error.state });
      }
    };
  }
  app.patch('/api/reports/:id/state', saveState(true));
  app.put('/api/reports/:id/state', saveState(false));
  if (existsSync(join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get(['/review/:id', '/'], (_req, res) => res.sendFile(join(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message || '本地阅读器错误' }));
  return { app, register, token, lastActivity: () => lastActivity };
}
