import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
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
    mode: 'new', side: 'new', extent: 'range', oldRange: null, newRange: [2, 3], fallbackRange: [2, 3], comparison: 'none', completeMethod: true, split: false, theme: 'light',
    annotations: [{ id: 'inside', side: 'new', line: 2, content: createElement('p', null, 'inside explanation') }, { id: 'outside', side: 'new', line: 4, content: createElement('p', null, 'outside explanation') }],
  };
  const render = value => renderToStaticMarkup(createElement(SourceViewerProvider, { adapter: { Renderer: PlainTextRenderer } }, createElement(SourceViewer, value)));
  const clipped = render(props);
  assert.match(clipped, /2  two/);
  assert.match(clipped, /3  three/);
  assert.doesNotMatch(clipped, /4  four|outside explanation/);
  assert.match(clipped, /inside explanation/);
  const compared = render({ ...props, mode: 'diff', extent: 'file' });
  assert.match(compared, /missing/);
  assert.match(compared, /4  four/);
  assert.match(compared, /outside explanation/);
});
