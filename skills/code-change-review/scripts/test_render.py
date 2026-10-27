"""Regression tests against disposable real Git repositories; no network or LLM."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import render
from git_source import Snapshot, enrich, git, legacy_scope


def report(file='same.txt', line=1, **changes):
    hop = dict(id='h1', file=file, line=line, type='改实现', tier='细看', focus=['边界'],
               risk='中', confidence='确定', evidence='same.txt:1，读取函数实现',
               why='对应需求：更改输出', risk_detail='边界输入需要验证', verify='运行测试',
               role='输出结果', verdict='必要改动', counterfactual='保留旧输出')
    hop.update(changes)
    return {'meta': {'title': '输出调整'}, 'unknowns': [], 'flowPoints': [
        {'id': 'fp1', 'title': '输出', 'status': '完整', 'requirement': '更改输出',
         'chains': [{'id': 'c1', 'name': 'main → output', 'sideEffect': '返回结果', 'hops': [hop]}]}]}


def node(data):
    return data['flowPoints'][0]['chains'][0]['hops'][0]


class GitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='review-tests-', dir=os.environ.get('REVIEW_TEST_TMP'))
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q')
        git(self.repo, 'config', 'user.email', 'test@example.invalid')
        git(self.repo, 'config', 'user.name', 'Test')
        git(self.repo, 'config', 'core.autocrlf', 'false')
        self.write('same.txt', '\n'.join('old%d' % i for i in range(100)) + '\n')
        self.commit()

    def write(self, name, text):
        (self.repo / name).write_text(text, encoding='utf-8')

    def commit(self):
        git(self.repo, 'add', '--all')
        git(self.repo, 'commit', '-qm', 'fixture')

    def snapshot(self, scope=None):
        return Snapshot(self.repo, scope or {'mode': 'worktree'}, render.parse_hunks)

    def test_no_nearest_hunk_and_supplied_code_replaced(self):
        self.write('same.txt', 'new\n' + (self.repo / 'same.txt').read_text().split('\n', 1)[1])
        data = report(line=90, code=[{'t': '+', 'n': 90, 'c': 'invented'}])
        enrich(data, self.repo, '', render.parse_hunks)
        self.assertEqual(node(data)['code'], [])
        self.assertEqual(data['coverage'][0]['status'], '未覆盖')

    def test_staged_unstaged_untracked_and_remaining_hunk(self):
        self.write('staged.txt', 'staged\n')
        git(self.repo, 'add', 'staged.txt')
        self.write('new.txt', 'new file without newline')
        text = (self.repo / 'same.txt').read_text().replace('old0\n', 'changed0\n').replace('old99\n', 'changed99\n')
        self.write('same.txt', text)
        data = report()
        enrich(data, self.repo, '', render.parse_hunks)
        self.assertEqual(data['meta']['stats']['files'], 3)
        same = next(r for r in data['coverage'] if r['file'] == 'same.txt')
        self.assertEqual(same['missingHunks'], [2])
        snap = self.snapshot()
        code, status = snap.code_for({'file': 'new.txt', 'line': 1})
        self.assertEqual(code[0]['c'], 'new file without newline')
        self.assertIn('精确', status)

    def test_deleted_coordinate_and_unchanged_context(self):
        self.write('same.txt', 'tail\n')
        snap = self.snapshot()
        self.assertTrue(snap.code_for({'file': 'same.txt', 'line': 90, 'type': '删除'})[0])
        self.assertFalse(snap.code_for({'file': 'same.txt', 'line': 90, 'side': 'new'})[0])
        code, status = snap.code_for({'file': 'same.txt', 'line': 1, 'type': '穿越未改'})
        self.assertEqual(code[0]['c'], 'tail')
        self.assertEqual(code[0]['t'], ' ')
        self.assertIn('非 diff', status)

    def test_same_paths_in_two_repositories(self):
        other = Path(self.tmp.name) / 'other'
        git(self.repo, 'clone', '-q', str(self.repo), str(other))
        self.write('same.txt', 'first repository\n')
        (other / 'same.txt').write_text('second repository\n')
        data = report(project='one')
        second = copy.deepcopy(node(data)); second.update(id='h2', project='two')
        data['flowPoints'][0]['chains'][0]['hops'].append(second)
        data['repositories'] = {key: {'path': str(path), 'scope': {'mode': 'worktree'}}
                                for key, path in [('one', self.repo), ('two', other)]}
        enrich(data, None, '', render.parse_hunks)
        hops = data['flowPoints'][0]['chains'][0]['hops']
        self.assertIn('first repository', [r['c'] for r in hops[0]['code']])
        self.assertNotIn('second repository', [r['c'] for r in hops[0]['code']])
        self.assertIn('second repository', [r['c'] for r in hops[1]['code']])
        self.assertEqual(len(data['sourceSnapshots']), 2)

    def test_branch_and_commit_snapshot_ignore_worktree(self):
        base = git(self.repo, 'rev-parse', 'HEAD').decode().strip()
        git(self.repo, 'checkout', '-qb', 'feature')
        self.write('same.txt', 'committed feature\n'); self.commit()
        head = git(self.repo, 'rev-parse', 'HEAD').decode().strip()
        self.write('same.txt', 'uncommitted\n')
        for scope in [{'mode': 'branch', 'base': base, 'head': 'feature'},
                      {'mode': 'commit', 'commit': head}]:
            snap = self.snapshot(scope)
            code, _ = snap.code_for({'file': 'same.txt', 'line': 1})
            self.assertIn('committed feature', [r['c'] for r in code])
            self.assertNotIn('uncommitted', [r['c'] for r in code])
            self.assertEqual(snap.head, head)

    def test_binary_and_rename_coverage(self):
        (self.repo / 'binary.dat').write_bytes(b'\0binary')
        git(self.repo, 'mv', 'same.txt', 'renamed.txt')
        snap = self.snapshot()
        rows = snap.report('', [])['coverage']
        self.assertEqual({r['file'] for r in rows}, {'binary.dat', 'same.txt', 'renamed.txt'})
        self.assertTrue(all(r['status'] == '未覆盖' for r in rows))
        row = next(r for r in snap.report('', [{'file': 'binary.dat', 'reason': '人工核对哈希'}])['coverage'] if r['file'] == 'binary.dat')
        self.assertEqual(row['status'], '明确排除')

    def test_strict_cli_rejects_gap_and_accepts_covered(self):
        self.write('same.txt', 'new\n')
        fixture = Path(self.tmp.name) / 'review.json'
        def run(data):
            fixture.write_text(json.dumps(data), encoding='utf-8')
            return subprocess.run([os.sys.executable, '-B', render.__file__, str(fixture), '--repo', str(self.repo), '--validate', '--strict'], capture_output=True)
        self.assertEqual(run(report()).returncode, 0)
        self.write('uncovered.txt', 'missing')
        self.assertNotEqual(run(report()).returncode, 0)

    def test_path_escape_rejected(self):
        with self.assertRaises(ValueError):
            self.snapshot().code_for({'file': '../outside', 'line': 1})

    def test_root_commit(self):
        snap = self.snapshot({'mode': 'commit', 'commit': 'HEAD'})
        code, _ = snap.code_for({'file': 'same.txt', 'line': 1})
        self.assertTrue(code)
        self.assertTrue(all(row['t'] == '+' for row in code))

    def test_unknown_exclusion_rejected(self):
        with self.assertRaises(ValueError):
            self.snapshot().report('', [{'file': 'absent.txt', 'reason': 'mistake'}])

    def test_branch_uses_merge_base(self):
        initial = git(self.repo, 'rev-parse', 'HEAD').decode().strip()
        git(self.repo, 'checkout', '-qb', 'feature')
        self.write('feature.txt', 'feature\n'); self.commit()
        git(self.repo, 'checkout', '-qb', 'target', initial)
        self.write('target.txt', 'target\n'); self.commit()
        branch = self.snapshot({'mode': 'branch', 'base': 'target', 'head': 'feature'})
        direct = self.snapshot({'mode': 'range', 'base': 'target', 'head': 'feature'})
        self.assertEqual(set(branch.files), {'feature.txt'})
        self.assertEqual(set(direct.files), {'feature.txt', 'target.txt'})


class ValidationTests(unittest.TestCase):
    def test_bundled_examples_validate(self):
        example = render.load_json(Path(render.__file__).parent.parent / 'examples/review.example.json')
        self.assertFalse(render.validate(example)[0])
        self.assertFalse(render.validate(render.DEMO)[0])

    def test_minimal_payload_and_missing_required_fields_rejected(self):
        self.assertTrue(render.validate({'meta': {}})[0])
        for key in ['line', 'why', 'verify', 'risk_detail', 'tier', 'role', 'verdict']:
            data = report(); node(data).pop(key)
            self.assertTrue(render.validate(data)[0], key)

    def test_empty_unknowns_and_pending_verdict(self):
        data = report(verdict='待确认', assessmentReason='需要外部调用方约束')
        self.assertEqual(render.validate(data), ([], []))
        self.assertIn('待确认', render.render(data))

    def test_actual_and_legacy_stats(self):
        for meta in [{'stats': {'files': 15, 'added': 0, 'removed': 0}},
                     {'stat': '15 files changed, 10 insertions(+), 5 deletions(-)'},
                     {'stat': '2 files changed, 401 insertions(+)'}]:
            self.assertTrue(render.is_big_change({'meta': meta}))
        data = report(); data['meta']['stats'] = {'files': 15, 'added': 0, 'removed': 0}
        self.assertTrue(render.validate(data)[0])

    def test_executed_verification_requires_result_and_evidence(self):
        data = report(verifyStatus='通过')
        self.assertTrue(render.validate(data)[0])
        node(data).update(verifyResult='exit 0', verifyEvidence='test-results.txt')
        self.assertFalse(render.validate(data)[0])

    def test_nested_bad_types_are_errors(self):
        for key in ['unknowns', 'verifyPlan', 'orphans', 'exclusions']:
            data = report(); data[key] = [None]
            self.assertTrue(render.validate(data)[0])

    def test_range_semantics(self):
        self.assertEqual(legacy_scope('main...HEAD')['mode'], 'branch')
        self.assertEqual(legacy_scope('main..HEAD')['mode'], 'range')
        self.assertEqual(legacy_scope('')['mode'], 'worktree')

    def test_bad_stats_and_project_types_report_errors(self):
        data = report(project=[])
        data['repositories'] = {'one': {'path': 'x', 'scope': {'mode': 'worktree'}}}
        data['meta']['stats'] = {'files': '15', 'added': None}
        self.assertTrue(render.validate(data)[0])

    def test_script_data_escaped(self):
        data = report(); data['meta']['title'] = '</script><script>alert(1)</script>'
        page = render.render(data)
        self.assertNotIn('"title": "</script>', page)
        self.assertIn('<\\/script>', page)


class LegacyEntryTests(unittest.TestCase):
    def test_html_is_rejected_by_default_and_existing_output_is_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'review.html'
            out.write_text('existing report', encoding='utf-8')
            result = subprocess.run([os.sys.executable, '-X', 'utf8', '-B', render.__file__, '--demo', '-o', str(out)], capture_output=True, encoding='utf-8')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('open_reader.py', result.stderr)
            self.assertEqual(out.read_text(encoding='utf-8'), 'existing report')

    def test_explicit_legacy_html_still_works(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'explicit.html'
            result = subprocess.run([os.sys.executable, '-X', 'utf8', '-B', render.__file__, '--demo', '--legacy-html', '-o', str(out)], capture_output=True, encoding='utf-8')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('<!DOCTYPE html>', out.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
