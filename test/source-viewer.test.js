import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { sourcePosition } from '../lib/source-viewer/pierre/position.js';
import { toGlobalLine, sourceCacheKey } from '../lib/source-viewer/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('clipped token positions retain original snapshot line numbers', () => {
  assert.equal(toGlobalLine(1, 251), 251);
  assert.equal(toGlobalLine(17, 251), 267);
  assert.equal(toGlobalLine(42), 42);
  for (const invalid of [0, -1, NaN, 1.5]) assert.throws(() => toGlobalLine(invalid, 10), RangeError);
});

test('complete files and clipped methods cannot reuse each other’s rendered contents', () => {
  const full = sourceCacheKey('snapshot:file', 'new');
  assert.notEqual(full, sourceCacheKey('snapshot:file', 'new', [55, 193]));
  assert.notEqual(full, sourceCacheKey('snapshot:file', 'old'));
  assert.notEqual(sourceCacheKey('snapshot:file', 'new', [55, 193]), sourceCacheKey('snapshot:file', 'new', [195, 199]));
  assert.equal(full, sourceCacheKey('snapshot:file', 'new'));
});

test('review modules and the public source-viewer contract do not import renderer internals', () => {
  function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
  }
  for (const path of [...files(join(root, 'src/features/review')), ...files(join(root, 'lib/review')), join(root, 'src/shared/source-viewer/types.ts')]) {
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(text, /(?:from\s*|import\s*\()['"]@pierre\//, path);
    assert.doesNotMatch(text, /from\s*['"][^'"]*source-viewer\/pierre\//, path);
  }
});

test('a different renderer can display the same source contract without changing review code', async t => {
  const vite = await createServer({ configFile: false, root, plugins: [react()], optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { SourceViewer, SourceViewerProvider } = await vite.ssrLoadModule('/src/shared/source-viewer/SourceViewer.tsx');
  const { PlainTextRenderer } = await vite.ssrLoadModule('/src/shared/source-viewer/PlainTextRenderer.tsx');
  const props = {
    document: { id: 'snapshot:method', path: 'Example.java', before: { text: '', status: 'missing' }, after: { text: 'one\ntwo\nthree\nfour', status: 'text' } },
    view: { kind: 'source', side: 'new', extent: 'range', range: [2, 3] }, theme: 'light',
    annotations: [{ id: 'inside', side: 'new', line: 2, content: createElement('p', null, 'inside explanation') }, { id: 'outside', side: 'new', line: 4, content: createElement('p', null, 'outside explanation') }],
  };
  const render = value => renderToStaticMarkup(createElement(SourceViewerProvider, { adapter: { Renderer: PlainTextRenderer } }, createElement(SourceViewer, value)));
  const clipped = render(props);
  assert.match(clipped, /2  two/);
  assert.match(clipped, /3  three/);
  assert.doesNotMatch(clipped, /4  four|outside explanation/);
  assert.match(clipped, /inside explanation/);
  const compared = render({ ...props, view: { kind: 'diff', scope: 'file', display: 'file', focus: { side: 'new', line: 2 }, layout: 'unified' } });
  assert.match(compared, /missing/);
  assert.match(compared, /4  four/);
  assert.match(compared, /outside explanation/);
});


test('full-file comparison targets explicitly identify the old or new coordinate system', () => {
  assert.equal(sourcePosition('file', 180, 'old').side, 'deletions');
  assert.equal(sourcePosition('file', 20, 'new').side, 'additions');
  assert.equal(sourcePosition('file', 180, 'old').lineNumber, 180);
});

test('full source and full diff forward inline explanations to the engine', async t => {
  const vite = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { '@pierre/diffs/react': join(root, 'test/fixtures/pierre-react.jsx') } }, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { SourceViewer, SourceViewerProvider } = await vite.ssrLoadModule('/src/shared/source-viewer/SourceViewer.tsx');
  const props = {
    document: { id: 'fixed-file', path: 'A.java', before: { text: 'one\nold\nthree', status: 'text' }, after: { text: 'one\nnew\nthree', status: 'text' } }, theme: 'light',
    annotations: [{ id: 'old', side: 'old', line: 2, content: createElement('b', null, 'old explanation') }, { id: 'new', side: 'new', line: 2, content: createElement('b', null, 'new explanation') }],
  };
  const render = value => renderToStaticMarkup(createElement(SourceViewerProvider, null, createElement(SourceViewer, value)));
  const file = render({ ...props, view: { kind: 'source', side: 'new', extent: 'file', range: [2, 2] } });
  assert.match(file, /new explanation/); assert.doesNotMatch(file, /old explanation/);
  const view = { kind: 'diff', scope: 'file', display: 'file', focus: { side: 'old', line: 2 }, layout: 'split' };
  const diff = render({ ...props, view });
  assert.match(diff, /old explanation/); assert.match(diff, /new explanation/);
  const hidden = render({ ...props, annotations: [], view });
  assert.doesNotMatch(hidden, /old explanation|new explanation/);
});
