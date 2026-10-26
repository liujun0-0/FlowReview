"""Read-only Git snapshots, exact hunk selection and mechanical diff coverage."""
import difflib
import hashlib
import os
import re
import subprocess
from pathlib import Path


def git(repo, *args):
    result = subprocess.run(
        ['git', '-C', str(repo), '--literal-pathspecs', *args],
        capture_output=True, timeout=60)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8', 'replace').strip())
    return result.stdout


def select_hunks(hunks, line, side='new'):
    """Match only the requested coordinate system. Never choose a nearby hunk."""
    if not isinstance(line, int) or isinstance(line, bool) or line < 1:
        return []
    tag = '+' if side == 'new' else '-'
    return [h for h in hunks if any(
        row['n'] == line and row['t'] in (tag, ' ') for row in h['lines']
    )] if side == 'new' else [h for h in hunks if
        h['old_start'] <= line < h['old_start'] + sum(
            row['t'] in ('-', ' ') for row in h['lines'])]


class Snapshot:
    def __init__(self, repo, scope, parse_hunks):
        self.repo = Path(repo).resolve()
        root = Path(git(self.repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
        if root != self.repo:
            raise ValueError('repo 必须指向仓库根目录：' + str(root))
        self.parse_hunks = parse_hunks
        self.mode = scope.get('mode', 'worktree')
        self.base = self.head = None
        if self.mode == 'worktree':
            self.base = self.resolve(scope.get('base', 'HEAD'))
            self.args = [self.base]
        elif self.mode == 'commit':
            self.head = self.resolve(scope.get('commit', 'HEAD'))
            parents = git(self.repo, 'rev-list', '--parents', '-n', '1', self.head).decode().split()
            if len(parents) > 2:
                raise ValueError('合并提交请用 range 显式选择比较基点')
            self.base = parents[1] if len(parents) == 2 else git(
                self.repo, 'hash-object', '-t', 'tree', '--stdin').decode().strip()
            self.args = [self.base, self.head]
        elif self.mode in ('range', 'branch'):
            self.base = self.resolve(scope['base'])
            self.head = self.resolve(scope.get('head', 'HEAD'))
            if self.mode == 'branch':
                self.base = git(self.repo, 'merge-base', self.base, self.head).decode().strip()
            self.args = [self.base, self.head]
        else:
            raise ValueError('未知 scope.mode：' + str(self.mode))
        self.files = self.collect()
        self.digest = self.fingerprint(self.files)
        self.covered = set()

    def resolve(self, ref):
        return git(self.repo, 'rev-parse', '--verify', '--end-of-options',
                   str(ref) + '^{commit}').decode().strip()

    def collect(self):
        names = git(self.repo, 'diff', '--no-renames', '--name-only', '-z', *self.args).decode('utf-8', 'replace').split('\0')
        untracked = set()
        if self.mode == 'worktree':
            untracked = set(git(self.repo, 'ls-files', '--others', '--exclude-standard', '-z').decode('utf-8', 'replace').split('\0')) - {''}
        files = {}
        for name in sorted((set(names) | untracked) - {''}):
            if name in untracked:
                path = self.safe_path(name)
                if not path.is_file() or path.is_symlink():
                    raw = b'Binary or unsupported untracked entry\n'
                else:
                    content = path.read_bytes()
                    if b'\0' in content:
                        raw = b'Binary untracked file ' + hashlib.sha256(content).hexdigest().encode()
                    else:
                        raw = ''.join(difflib.unified_diff([], [line + '\n' for line in content.decode('utf-8', 'replace').splitlines()],
                                      fromfile='/dev/null', tofile='b/' + name, n=6)).encode('utf-8')
            else:
                raw = git(self.repo, 'diff', '--no-renames', '--no-ext-diff', '--no-textconv',
                          '--binary', '--unified=6', '--no-color', *self.args, '--', name)
            hunks = self.parse_hunks(raw.decode('utf-8', 'replace'))
            files[name] = {'raw': raw, 'hunks': hunks}
        return files

    def safe_path(self, name):
        path = (self.repo / name).resolve()
        if not path.is_relative_to(self.repo) or Path(name).is_absolute():
            raise ValueError('文件路径超出仓库：' + str(name))
        return path

    @staticmethod
    def fingerprint(files):
        digest = hashlib.sha256()
        for name, item in sorted(files.items()):
            digest.update(name.encode()); digest.update(b'\0'); digest.update(item['raw']); digest.update(b'\0')
        return digest.hexdigest()

    def code_for(self, node):
        name, line = node.get('file'), node.get('line')
        side = node.get('side', 'old' if node.get('type') == '删除' else 'new')
        self.safe_path(name)
        if node.get('type') == '穿越未改':
            if self.mode == 'worktree' and side == 'new':
                path = self.safe_path(name)
                content = path.read_bytes() if path.is_file() else b''
            else:
                ref = self.base if side == 'old' else self.head
                content = git(self.repo, 'show', ref + ':' + name)
            lines = content.decode('utf-8', 'replace').splitlines()
            if b'\0' in content or not (0 < line <= len(lines)):
                return [], '未定位：源码行不存在或为二进制'
            return [{'t': ' ', 'n': i + 1, 'c': lines[i]} for i in range(max(0, line - 7), min(len(lines), line + 6))], '源码上下文（非 diff）'
        hunks = self.files.get(name, {}).get('hunks', [])
        selected = select_hunks(hunks, line, side)
        for index, hunk in enumerate(hunks):
            if hunk in selected:
                self.covered.add((name, index))
        return [row for hunk in selected for row in hunk['lines']], '已精确定位 diff' if selected else '未定位：无匹配 hunk（请核对版本及 side/line）'

    def report(self, project, exclusions):
        excluded = {e['file']: e['reason'] for e in exclusions if e.get('project', '') == project}
        invalid = set(excluded) - set(self.files)
        if invalid:
            raise ValueError('exclusions 引用了范围内不存在的变更：' + ', '.join(sorted(invalid)))
        rows = []
        added = removed = 0
        for name, item in self.files.items():
            hunks = item['hunks']
            added += sum(row['t'] == '+' for h in hunks for row in h['lines'])
            removed += sum(row['t'] == '-' for h in hunks for row in h['lines'])
            missing = [i + 1 for i in range(len(hunks)) if (name, i) not in self.covered]
            status = '已展示' if hunks and not missing else '未覆盖'
            if name in excluded:
                status = '明确排除'
            rows.append({'project': project, 'file': name, 'status': status,
                         'missingHunks': missing, 'reason': excluded.get(name, '')})
        return {'project': project, 'repo': str(self.repo), 'mode': self.mode,
                'base': self.base, 'head': self.head, 'diffSha256': self.digest,
                'files': len(self.files), 'added': added, 'removed': removed,
                'coverage': rows}


def legacy_scope(rng):
    if not rng:
        return {'mode': 'worktree'}
    if '...' in rng:
        base, head = rng.split('...', 1)
        return {'mode': 'branch', 'base': base, 'head': head or 'HEAD'}
    if '..' in rng:
        base, head = rng.split('..', 1)
        return {'mode': 'range', 'base': base, 'head': head or 'HEAD'}
    return {'mode': 'worktree', 'base': rng}


def enrich(data, repo, rng, parse_hunks):
    """Snapshot each repository separately and replace supplied code with Git evidence."""
    repositories = data.get('repositories') or {'': {'path': repo, 'scope': legacy_scope(rng)}}
    if not data.get('repositories') and any(e.get('project') for e in data.get('exclusions', [])):
        raise ValueError('单仓库 exclusions 请省略 project，或配置 repositories 映射')
    sources = {key: Snapshot(value['path'], value.get('scope', {}), parse_hunks)
               for key, value in repositories.items()}
    nodes = [h for fp in data.get('flowPoints', []) for ch in fp.get('chains', []) for h in ch.get('hops', [])]
    nodes += data.get('orphans', [])
    for node in nodes:
        key = node.get('project', '') if data.get('repositories') else ''
        if key not in sources:
            raise ValueError('project 未配置仓库：' + key)
        if not node.get('file'):
            match = re.match(r'^(.*):(\d+)$', node.get('location', ''))
            if not match:
                raise ValueError('孤儿变更需要 file/line 或 location=file:line')
            node['file'], node['line'] = match.group(1), int(match.group(2))
        code, status = sources[key].code_for(node)
        node['code'], node['codeStatus'] = code, status
    reports = [source.report(key, data.get('exclusions', [])) for key, source in sources.items()]
    for source in sources.values():
        if source.mode == 'worktree' and source.fingerprint(source.collect()) != source.digest:
            raise ValueError('取码过程中工作区发生变化，请重新生成报告')
    data['sourceSnapshots'] = reports
    data['coverage'] = [row for report in reports for row in report['coverage']]
    data['meta']['stats'] = {key: sum(r[key] for r in reports) for key in ('files', 'added', 'removed')}
    s = data['meta']['stats']
    data['meta']['stat'] = f"{s['files']} 个文件，+{s['added']} / -{s['removed']} 行"
    return sum(bool(n['code']) for n in nodes)
