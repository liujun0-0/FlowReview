import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTarget } from '../lib/legacy/yadiff/target/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (name, args = []) => execFileSync(process.execPath, [`bin/${name}`, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

test('FlowReview and the legacy report command preserve the same help contract', () => {
  const current = cli('flowreview.js', ['--help']);
  assert.match(current, /FlowReview/);
  assert.equal(cli('yadiff-review.js', ['--help']), current);
  assert.equal(cli('flowreview.js'), current);
});

test('the upstream viewer remains available through its compatibility command', () => {
  assert.match(cli('yadiff.js', ['--help']), /Usage: yadiff/);
});

test('the relocated upstream Git backend still resolves and reads real Git revisions', async () => {
  const target = createTarget({ repo: root, vcs: 'git', target: 'HEAD..HEAD' });
  assert.equal(target.source, 'git');
  assert.equal(await target.getPatch(), '');
  assert.match(target.getHead(), /^[a-f0-9]{7,40}$/);
});
