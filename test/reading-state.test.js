import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { applyStateChange, StateError } from '../lib/review/reading-state.js';
import { createReviewApp } from '../lib/review/server.js';

const nodes = { a: {}, b: {} };
const empty = () => ({ marks: {}, revision: 0 });
test('separate tabs merge different nodes and different fields on the same node', () => {
  const first = applyStateChange(empty(), { changes: { a: { read: true } }, expected: { a: { read: false } } }, nodes);
  const second = applyStateChange(first, { changes: { b: { note: 'second tab' } }, expected: { b: { note: '' } } }, nodes);
  const third = applyStateChange(second, { changes: { a: { question: true } }, expected: { a: { question: false } } }, nodes);
  assert.deepEqual(third.marks.a, { read: true, question: true, note: '' });
  assert.equal(third.marks.b.note, 'second tab');
});

test('stale edits to the same note conflict; explicit clearing and false values still save', () => {
  const state = applyStateChange(empty(), { changes: { a: { note: 'saved', read: true } }, expected: { a: { note: '', read: false } } }, nodes);
  assert.throws(() => applyStateChange(state, { changes: { a: { note: 'stale overwrite' } }, expected: { a: { note: '' } } }, nodes), error => error instanceof StateError && error.status === 409);
  const cleared = applyStateChange(state, { changes: { a: { note: '', read: false } }, expected: { a: { note: 'saved', read: true } } }, nodes);
  assert.equal(cleared.marks.a.note, ''); assert.equal(cleared.marks.a.read, false);
  assert.throws(() => applyStateChange(state, { marks: {} }, nodes, false), error => error.status === 409);
});

test('PATCH API persists merged state and rejects conflicting or unversioned replacement', async t => {
  const root = mkdtempSync(join(tmpdir(), 'flowreview-state-'));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); });
  const id = 'a'.repeat(24);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, id, files: {}, nodes }));
  const reader = createReviewApp({ dist: join(root, 'no-dist'), token: 'test-only' }); reader.register(root);
  const server = await new Promise(resolve => { const s = reader.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/reports/${id}/state`;
  const headers = { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' };
  const patch = body => fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  assert.equal((await patch({ changes: { a: { note: 'tab A' } }, expected: { a: { note: '' } } })).status, 200);
  assert.equal((await patch({ changes: { b: { read: true } }, expected: { b: { read: false } } })).status, 200);
  assert.equal((await patch({ changes: { a: { note: 'tab B' } }, expected: { a: { note: '' } } })).status, 409);
  assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ marks: {} }) })).status, 409);
  assert.equal((await patch({ changes: { a: { note: 'missing expected' } } })).status, 400);
  const state = await (await fetch(url, { headers })).json();
  assert.equal(state.marks.a.note, 'tab A'); assert.equal(state.marks.b.read, true); assert.equal(state.revision, 2);
});
