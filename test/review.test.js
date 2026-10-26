import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSnapshot, indexJava, repositoryPath, validateReport } from '../lib/review/snapshot.js';
import { createReviewApp } from '../lib/review/server.js';
import { parseReviewArgs } from '../bin/yadiff-review.js';

function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(); }
function fixture(t) {
  const root = mkdtempSync(join(process.env.REVIEW_TEST_TMP || tmpdir(), 'yadiff-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const repo = join(root, 'repo'); mkdirSync(repo);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.email', 'test@example.invalid'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'A.java'), 'class A {\n  void work() {\n    System.out.println("before");\n  }\n}\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'initial');
  const report = { meta: { title: '变更阅读测试' }, repositories: { project: { path: repo, scope: { mode: 'worktree' } } },
    flowPoints: [{ id: 'fp', title: '完整功能', requirement: '调整输出', status: '完整', chains: [{ id: 'chain', name: '入口 → 输出', hops: [{ id: 'a', project: 'project', file: 'A.java', line: 3, type: '改实现', why: '需求要求调整输出', risk_detail: '核对旧路径' }] }] }], unknowns: [], orphans: [] };
  const path = join(root, 'review.json');
  const build = (name = 'snapshot') => { writeFileSync(path, JSON.stringify(report)); return buildSnapshot(path, join(root, name)); };
  return { root, repo, report, path, build, hops: report.flowPoints[0].chains[0].hops };
}

test('Java parser excludes string/comment false methods and keeps overloads separate', () => {
  const source = 'class A {\n // void fake() {}\n String text="void fake() {}";\n void run(int a) { System.out.println("}"); }\n void run(String a) {}\n}';
  const result = indexJava(source, 'file', 'new');
  assert.equal(result.error, null);
  assert.equal(result.symbols.filter(s => s.name === 'fake').length, 0);
  const runs = result.symbols.filter(s => s.name === 'run');
  assert.equal(runs.length, 2); assert.notEqual(runs[0].id, runs[1].id); assert.notEqual(runs[0].pairKey, runs[1].pairKey);
  assert.ok(result.symbols.some(s => s.kind === 'class' && s.name === 'A'));
});
test('invalid Java retains explicit parse error rather than guessing', () => {
  const result = indexJava('class A { void broken(', 'file', 'new');
  assert.ok(result.error); assert.equal(result.symbols.length, 0);
});
test('fixed snapshot includes untracked files and is unaffected by later source edits', t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'A.java'), readFileSync(join(f.repo, 'A.java'), 'utf8').replace('before', 'after'));
  writeFileSync(join(f.repo, 'extra.txt'), 'untracked');
  const m = f.build(); assert.equal(Object.keys(m.files).length, 2);
  const file = Object.values(m.files).find(x => x.path === 'A.java');
  const saved = readFileSync(join(f.root, 'snapshot', 'sources', `${file.id}.json`), 'utf8');
  assert.match(JSON.parse(saved).new.text, /after/); assert.match(JSON.parse(saved).old.text, /before/);
  writeFileSync(join(f.repo, 'A.java'), 'later');
  assert.equal(readFileSync(join(f.root, 'snapshot', 'sources', `${file.id}.json`), 'utf8'), saved);
  assert.ok(m.warnings.some(w => w.includes('说明未附带')));
});
test('multiple report atoms in one actual method merge into one reading node', t => {
  const f = fixture(t); f.hops.push({ ...f.hops[0], id: 'second', line: 2 });
  const m = f.build(); assert.equal(Object.keys(m.nodes).length, 1);
  assert.equal(Object.values(m.nodes)[0].annotations.length, 2);
  assert.equal(m.flows[0].chains[0].nodeIds.length, 1);
});
test('same file paths from different repositories never share source identity', t => {
  const f = fixture(t); const repo2 = join(f.root, 'other'); git(f.repo, 'clone', '-q', f.repo, repo2);
  writeFileSync(join(repo2, 'A.java'), 'class A { void other() {} }');
  f.report.repositories.other = { path: repo2, scope: { mode: 'worktree' } }; f.hops.push({ ...f.hops[0], id: 'b', project: 'other', line: 1 });
  const m = f.build(); const files = Object.values(m.files); assert.equal(files.length, 2); assert.notEqual(files[0].id, files[1].id);
  assert.equal(new Set(Object.values(m.nodes).map(n => n.fileId)).size, 2);
});
test('snapshot identity is deterministic and existing snapshot is never overwritten', t => {
  const f = fixture(t); const one = f.build('one'), two = f.build('two'); assert.equal(one.id, two.id);
  assert.throws(() => f.build('one'), /已存在/);
});
test('deletion uses old side while missing new source is represented explicitly', t => {
  const f = fixture(t); rmSync(join(f.repo, 'A.java')); f.hops[0].type = '删除';
  const m = f.build(); const node = Object.values(m.nodes)[0]; assert.equal(node.side, 'old');
  assert.equal(m.files[node.fileId].statuses.new, 'missing'); assert.equal(node.located, true);
});
test('binary files remain in changed inventory with an explicit status', t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'asset.bin'), Buffer.from([0, 1, 2]));
  const m = f.build(); const binary = Object.values(m.files).find(x => x.path === 'asset.bin');
  assert.equal(binary.statuses.new, 'binary'); assert.equal(binary.changed, true);
});
test('range and branch modes read committed snapshots rather than dirty workspace', t => {
  const f = fixture(t); const initial = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'checkout', '-qb', 'feature'); writeFileSync(join(f.repo, 'A.java'), 'class A { void feature() {} }'); git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'feature');
  git(f.repo, 'checkout', '-qb', 'target', initial); writeFileSync(join(f.repo, 'target.txt'), 'target'); git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'target');
  f.report.repositories.project.scope = { mode: 'branch', base: 'target', head: 'feature' }; f.hops[0].line = 1;
  const m = f.build(); assert.ok(!Object.values(m.files).some(x => x.path === 'target.txt'));
  f.report.repositories.project.scope.mode = 'range'; const direct = f.build('direct'); assert.ok(Object.values(direct.files).some(x => x.path === 'target.txt'));
});
test('path escape and invalid report coordinates are rejected', t => {
  const f = fixture(t); assert.throws(() => repositoryPath(f.repo, '../outside.txt'), /超出/);
  assert.throws(() => repositoryPath(f.repo, 'C:\\private.txt'), /非法/);
  f.hops[0].line = 0; assert.throws(() => validateReport(f.report), /非法/);
});
test('invalid line cannot silently select a nearby method', t => {
  const f = fixture(t); f.hops[0].line = 9999; const m = f.build();
  assert.equal(Object.values(m.nodes)[0].located, false); assert.equal(Object.values(m.nodes)[0].rangeKind, 'context');
});
test('HTTP API authenticates requests, contains source access, and persists independent marks', async t => {
  const f = fixture(t); const m = f.build(); const reader = createReviewApp({ dist: join(f.root, 'absent-dist'), token: 'test-token' }); reader.register(join(f.root, 'snapshot'));
  const server = await new Promise(resolve => { const s = reader.app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/reports/${m.id}`)).status, 401);
  assert.equal((await fetch(`${base}/api/reports/${m.id}`, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
  const result = await fetch(`${base}/api/reports/${m.id}`, { headers }); assert.equal((await result.json()).id, m.id);
  assert.equal((await fetch(`${base}/api/reports/${m.id}/source/not-a-file`, { headers })).status, 404);
  const fileId = Object.keys(m.files)[0]; assert.equal((await fetch(`${base}/api/reports/${m.id}/source/${fileId}`, { headers })).status, 200);
  const nodeId = Object.keys(m.nodes)[0];
  const saved = await fetch(`${base}/api/reports/${m.id}/state`, { method: 'PUT', headers, body: JSON.stringify({ marks: { [nodeId]: { read: true, question: true, note: '需要核对' } } }) }); assert.equal(saved.status, 200);
  const state = await (await fetch(`${base}/api/reports/${m.id}/state`, { headers })).json();
  assert.deepEqual(state.marks[nodeId], { read: true, question: true, note: '需要核对' });
  const invalid = await fetch(`${base}/api/reports/${m.id}/state`, { method: 'PUT', headers, body: JSON.stringify({ marks: { unknown: { read: true } } }) }); assert.equal(invalid.status, 400);
});
test('CLI validates conflicting inputs and invalid ports', () => {
  assert.throws(() => parseReviewArgs(['--review', 'a.json', '--snapshot', 'b']), /二选一/);
  assert.throws(() => parseReviewArgs(['--port', '65536']), /端口/);
  assert.throws(() => parseReviewArgs(['--unknown']), /未知/);
  assert.equal(parseReviewArgs(['--snapshot', '.', '--no-open']).open, false);
});


test('test classification recognizes conventional test sources without hiding business services', async () => {
  const { isTestSource } = await import('../lib/review/file-kind.js');
  for (const path of ['src/test/java/A.java', 'src/testFixtures/java/Fake.java', 'src/main/java/OrderTest.java', 'ui/a.spec.tsx', 'ui/a.test.js', 'tests/fixture.json', 'test_orders.py', 'order_test.go', 'src\\test\\java\\A.java']) assert.equal(isTestSource(path), true, path);
  for (const path of ['src/main/java/ContestService.java', 'src/main/java/Latest.java', 'src/main/java/Audit.java', 'src/main/java/TestOrderService.java', 'src/main/resources/test-config.yaml', 'package.json']) assert.equal(isTestSource(path), false, path);
});


test('snapshot maps explicit relationship anchors to reader nodes and rejects unknown endpoints', t => {
 const f = fixture(t); const chain = f.report.flowPoints[0].chains[0];
 chain.links = [{ from:'a', to:'a', label:'回到当前方法', confidence:'确定', evidence:'source checked' }];
 const m=f.build(); const edge=m.flows[0].chains[0].links[0];
 assert.ok(m.nodes[edge.from]); assert.equal(edge.from,edge.to); assert.equal(edge.evidence,'source checked');
 chain.links[0].to='not-existing'; assert.throws(()=>f.build('invalid-links'), /调用边引用未知节点/);
});


test('snapshot retains business context and maps unchanged implementation anchors into business steps',t=>{
 const f=fixture(t);f.report.flowPoints[0].journey={source:{actor:'客户端',entry:'POST /import',purpose:'业务全流程',input:'文件',outcome:'结果'},coverage:{status:'partial',boundaries:['未执行测试']},steps:[{id:'entry',title:'业务入口',project:'project',layer:'接口层',purpose:'接收请求',input:'文件',output:'任务',process:'委派服务',branches:[],tables:[],downstreams:[],implementationIds:['a'],evidence:['A.java:3'],change:{status:'unchanged'}}],links:[]};
 const m=f.build();const journey=m.flows[0].journey;assert.equal(journey.source.entry,'POST /import');assert.ok(m.nodes[journey.steps[0].implementationIds[0]]);assert.equal(journey.steps[0].change.status,'unchanged');
});
