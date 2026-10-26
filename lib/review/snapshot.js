import { resolveBusinessFlow } from './business-flow.js';
import { literalEndpoint, methodChangeStatus } from './method-metadata.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lexAndParse } from 'java-parser';

export const FORMAT_VERSION = 1;
const hash = (text) => createHash('sha256').update(text).digest('hex');

function git(root, args) {
  return execFileSync('git', ['-C', root, '--literal-pathspecs', ...args], {
    maxBuffer: 128 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
  });
}

export function repositoryPath(root, file) {
  if (typeof file !== 'string' || !file || isAbsolute(file) || /^[A-Za-z]:/.test(file)) throw new Error(`非法仓库相对路径：${file}`);
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || !rel) throw new Error(`路径超出仓库：${file}`);
  if (existsSync(target)) {
    const actual = relative(realpathSync(root), realpathSync(target));
    if (actual.startsWith(`..${sep}`) || actual === '..' || isAbsolute(actual)) throw new Error(`符号链接超出仓库：${file}`);
  }
  return target;
}

function decode(buffer) {
  if (buffer === null) return { text: '', status: 'missing', hash: hash('missing') };
  if (buffer.length > 4 * 1024 * 1024) return { text: '', status: 'too-large', hash: hash(buffer) };
  if (buffer.includes(0)) return { text: '', status: 'binary', hash: hash(buffer) };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), status: 'text', hash: hash(buffer) }; }
  catch { return { text: '', status: 'non-utf8', hash: hash(buffer) }; }
}

function readAt(root, sha, file) {
  const name = `${sha}:${file}`;
  try { git(root, ['cat-file', '-e', name]); } catch { return null; }
  return git(root, ['show', name]);
}

function sourceAt(repo, file) {
  const old = decode(readAt(repo.path, repo.base, file));
  let next;
  if (repo.mode === 'worktree') {
    const target = repositoryPath(repo.path, file);
    next = decode(existsSync(target) && statSync(target).isFile() ? readFileSync(target) : null);
  } else next = decode(readAt(repo.path, repo.head, file));
  return { old, new: next };
}

function resolveRepository(config) {
  const path = realpathSync(config.path);
  const top = realpathSync(git(path, ['rev-parse', '--show-toplevel']).toString('utf8').trim());
  if (top !== path) throw new Error(`仓库路径需指向 Git 根目录：${top}`);
  const sha = (ref) => git(path, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).toString().trim();
  const scope = config.scope || { mode: 'worktree' };
  let base, head = null;
  if (scope.mode === 'worktree') base = sha(scope.base || 'HEAD');
  else if (scope.mode === 'range' || scope.mode === 'branch') {
    base = sha(scope.base); head = sha(scope.head || 'HEAD');
    if (scope.mode === 'branch') base = git(path, ['merge-base', base, head]).toString().trim();
  } else if (scope.mode === 'commit') {
    head = sha(scope.commit || 'HEAD');
    const parents = git(path, ['rev-list', '--parents', '-n', '1', head]).toString().trim().split(' ');
    if (parents.length > 2) throw new Error('合并提交请使用 range 明确指定父基点');
    base = parents[1] || git(path, ['hash-object', '-t', 'tree', '--stdin']).toString().trim();
  } else throw new Error(`不支持的比较模式：${scope.mode}`);
  const args = head ? [base, head] : [base];
  return { path, mode: scope.mode, base, head, args };
}

function changedFiles(repo) {
  const names = git(repo.path, ['diff', '--no-renames', '--name-only', '-z', ...repo.args]).toString('utf8').split('\0');
  if (repo.mode === 'worktree') names.push(...git(repo.path, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0'));
  return [...new Set(names.filter(Boolean))].sort();
}

function findChild(node, name) {
  if (node.name === name) return node;
  for (const list of Object.values(node.children || {})) for (const child of list) {
    if (child.children) { const found = findChild(child, name); if (found) return found; }
  }
}

function allTokens(node) {
  const result = [];
  for (const list of Object.values(node.children || {})) for (const child of list) {
    if (child.children) result.push(...allTokens(child)); else if (typeof child.image === 'string') result.push(child);
  }
  return result.sort((a, b) => a.startOffset - b.startOffset);
}

export function indexJava(text, fileId, side) {
  if (!text.trim()) return { symbols: [], references: [], error: null };
  try {
    const { cst, tokens } = lexAndParse(text);
    const symbols = [];
    function visit(node, owners = []) {
      let nested = owners;
      if (['normalClassDeclaration', 'normalInterfaceDeclaration', 'enumDeclaration', 'recordDeclaration'].includes(node.name)) {
        const nameToken = allTokens(node).find((t, i, all) => i > 0 && ['class', 'interface', 'enum', 'record'].includes(all[i - 1].image));
        if (nameToken) {
          nested = [...owners, nameToken.image];
          const ts = allTokens(node), start = ts[0], end = ts.at(-1);
          const signature = `class ${nested.join('.')}`;
          symbols.push({ id: hash(`${fileId}:${side}:${signature}:${start.startOffset}`).slice(0, 20), name: nameToken.image, owner: owners.join('.'), kind: 'class', start: start.startLine, end: end.endLine, nameLine: nameToken.startLine, signature, pairKey: signature });
        }
      }
      if (['methodDeclaration', 'constructorDeclaration', 'fieldDeclaration', 'interfaceMethodDeclaration'].includes(node.name)) {
        const ts = allTokens(node);
        const declarator = findChild(node, 'methodDeclarator') || findChild(node, 'constructorDeclarator') || findChild(node, 'variableDeclaratorId');
        const identifier = declarator && allTokens(declarator).find(t => t.tokenType.name === 'Identifier');
        if (identifier && ts.length) {
          const start = ts[0], end = ts.at(-1);
          const kind = node.name.includes('field') ? 'field' : 'method';
          const signatureEnd = ts.find(t => t.image === '{' && t.startOffset > identifier.endOffset)?.startOffset ?? end.endOffset + 1;
          const signature = text.slice(start.startOffset, signatureEnd).replace(/\s+/g, ' ').trim();
          const identity = `${nested.join('.')}:${kind}:${signature}`;
          symbols.push({ id: hash(`${fileId}:${side}:${identity}:${start.startOffset}`).slice(0, 20), name: identifier.image,
            owner: nested.join('.'), kind, start: start.startLine, end: end.endLine, nameLine: identifier.startLine,
            signature, pairKey: `${nested.join('.')}:${kind}:${signature}` });
        }
      }
      for (const list of Object.values(node.children || {})) for (const child of list) if (child.children) visit(child, nested);
    }
    visit(cst);
    const references = tokens.filter(t => t.tokenType.name === 'Identifier').map(t => ({ name: t.image, line: t.startLine, column: t.startColumn }));
    return { symbols, references, error: null };
  } catch (error) {
    return { symbols: [], references: [], error: String(error.message).split('\n')[0] };
  }
}

export function validateReport(report) {
  if (!report || typeof report !== 'object' || !report.meta || typeof report.meta.title !== 'string' || !Array.isArray(report.flowPoints)) throw new Error('报告需包含 meta.title 和 flowPoints 数组');
  if (!report.repositories || typeof report.repositories !== 'object' || !Object.keys(report.repositories).length) throw new Error('报告需配置 repositories：项目名 → {path, scope}');
  const nodes = [];
  for (const fp of report.flowPoints) {
    if (!fp || typeof fp.title !== 'string' || !Array.isArray(fp.chains)) throw new Error('功能点需要 title 和 chains');
    for (const chain of fp.chains) {
      if (!chain || !Array.isArray(chain.hops)) throw new Error('调用链需要 hops 数组');
      nodes.push(...chain.hops);
    }
  }
  for (const orphan of report.orphans || []) {
    const match = orphan.location?.match(/^(.*):(\d+)$/);
    nodes.push({ ...orphan, file: orphan.file || match?.[1], line: orphan.line || Number(match?.[2]), id: orphan.id || `orphan-${nodes.length}`, type: '未对应需求的改动', why: orphan.what, risk_detail: orphan.reason });
  }
  for (const node of nodes) {
    if (!node || !report.repositories[node.project] || typeof node.file !== 'string' || !Number.isInteger(node.line) || node.line < 1) throw new Error(`节点定位非法或缺少项目映射：${node?.id || node?.file}`);
  }
  return nodes;
}

export function buildSnapshot(reportPath, output) {
  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const inputNodes = validateReport(report);
  if (existsSync(output)) throw new Error('快照目录已存在，请指定新目录以保留旧报告');
  const warnings = [];
  const repos = Object.fromEntries(Object.entries(report.repositories).map(([name, config]) => [name, resolveRepository(config)]));
  const files = {}, sources = {}, repoRecords = [], nodeRecords = {}, inputToNode = new Map();
  for (const [project, repo] of Object.entries(repos)) {
    const changed = changedFiles(repo);
    const referenced = inputNodes.filter(n => n.project === project).map(n => n.file);
    const names = [...new Set([...changed, ...referenced])].sort();
    const stamps = [];
    for (const path of names) {
      repositoryPath(repo.path, path);
      const id = hash(`${project}:${path}`).slice(0, 20);
      const source = sourceAt(repo, path);
      const indexes = {};
      for (const side of ['old', 'new']) {
        indexes[side] = path.endsWith('.java') && source[side].status === 'text' ? indexJava(source[side].text, id, side) : { symbols: [], references: [], error: null };
        if (indexes[side].error) warnings.push(`${project}/${path} ${side}：Java 解析失败，保留源码，方法跳转不可用`);
      }
      files[id] = { id, project, path, changed: changed.includes(path), statuses: { old: source.old.status, new: source.new.status },
        hashes: { old: source.old.hash, new: source.new.hash }, indexes, nodeIds: [],
        changeInfo: git(repo.path, ['diff', '--no-renames', '--summary', ...repo.args, '--', path]).toString('utf8').trim() };
      sources[id] = source;
      stamps.push([path, source.old.hash, source.new.hash]);
    }
    repoRecords.push({ project, path: repo.path, mode: repo.mode, base: repo.base, head: repo.head, fingerprint: hash(JSON.stringify(stamps)) });
    // A second read detects concurrent edits to both changed and related files.
    if (repo.mode === 'worktree') {
      if (JSON.stringify(changedFiles(repo)) !== JSON.stringify(changed)) throw new Error(`${project} 采集期间变更文件清单发生变化，请重试`);
      for (const file of Object.values(files).filter(f => f.project === project)) {
        if (sourceAt(repo, file.path).new.hash !== sources[file.id].new.hash) throw new Error(`${project}/${file.path} 采集期间发生变化，请重试`);
      }
    }
  }
  if (!report.sourceSnapshots?.length) warnings.push('输入说明未附带机器生成的版本证据；本阅读器已重新采集代码快照，说明与本次代码是否一致仍需核对。');
  for (const old of report.sourceSnapshots || []) {
    if (old.base !== repos[old.project]?.base || old.head !== repos[old.project]?.head || old.mode === 'worktree') warnings.push(`${old.project}：说明来自较早的采集记录，已使用本次重新采集的固定源码；请核对说明是否仍适用。`);
  }
  for (let i = 0; i < inputNodes.length; i++) {
    const input = inputNodes[i];
    const file = Object.values(files).find(f => f.project === input.project && f.path === input.file);
    const side = input.side === 'old' || input.type === '删除' ? 'old' : 'new';
    const symbols = file.indexes[side].symbols.filter(s => s.start <= input.line && s.end >= input.line).sort((a, b) => a.end - a.start - (b.end - b.start));
    const symbol = symbols[0];
    const key = `${file.id}:${side}:${symbol?.id || 'file-context'}`;
    const id = hash(key).slice(0, 20);
    const other = symbol && file.indexes[side === 'new' ? 'old' : 'new'].symbols.filter(s => s.pairKey === symbol.pairKey);
    const pair = other?.length === 1 ? other[0] : null;
    if (!nodeRecords[id]) {
      const total = sources[file.id][side].text.split('\n').length;
      const located = sources[file.id][side].status === 'text' && input.line <= total;
      nodeRecords[id] = { id, fileId: file.id, title: symbol?.name || input.func || file.path, signature: symbol?.signature,
        side, range: symbol ? [symbol.start, symbol.end] : [Math.max(1, input.line - 8), Math.min(total, input.line + 12)],
        oldRange: side === 'old' && symbol ? [symbol.start, symbol.end] : pair ? [pair.start, pair.end] : null,
        newRange: side === 'new' && symbol ? [symbol.start, symbol.end] : pair ? [pair.start, pair.end] : null,
        rangeKind: symbol ? symbol.kind : 'context', located, annotations: [], relatedOnly: true, symbolId: symbol?.id,
      };
      file.nodeIds.push(id);
    }
    const node = nodeRecords[id];
    if (!symbol && node.annotations.length) {
      node.range = [Math.min(node.range[0], Math.max(1, input.line - 8)), Math.max(node.range[1], Math.min(sources[file.id][side].text.split('\n').length, input.line + 12))];
    }
    node.relatedOnly &&= input.type === '穿越未改';
    // Exclude embedded code and accept only prose/anchors from the author's report.
    node.annotations.push(Object.fromEntries(Object.entries(input).filter(([k]) => !['code', 'codeStatus'].includes(k))));
    inputToNode.set(input, id);
  }
  for (const node of Object.values(nodeRecords)) {
    const file=files[node.fileId], source=sources[node.fileId];
    node.changeStatus=methodChangeStatus(node,file,source);
    const symbol=file.indexes[node.side].symbols.find(s=>s.id===node.symbolId);
    node.endpoint=literalEndpoint(source[node.side].text,symbol,file.indexes[node.side].symbols);
  }
  const flows = report.flowPoints.map((fp, index) => ({ id: fp.id || `flow-${index}`, title: fp.title, status: fp.status,
    journey: resolveBusinessFlow(fp.journey, new Map(fp.chains.flatMap(c=>c.hops.map(h=>[h.id,inputToNode.get(h)])))),
    requirement: fp.requirement || '', before: fp.before || '', after: fp.after || '',
    chains: fp.chains.map((chain, ci) => ({ id: chain.id || `chain-${index}-${ci}`, name: chain.name || '关联阅读路径',
      sideEffect: chain.sideEffect || '', nodeIds: [...new Set(chain.hops.map(h => inputToNode.get(h)))],
      links: (chain.links || []).map(link => {
        const from = chain.hops.find(h => h.id === link.from), to = chain.hops.find(h => h.id === link.to);
        if (!from || !to) throw new Error(`调用边引用未知节点：${link.from} → ${link.to}`);
        return { from: inputToNode.get(from), to: inputToNode.get(to), label: link.label || '', confidence: link.confidence || '猜', evidence: link.evidence || '' };
      }) })) }));
  const snapshotId = hash(JSON.stringify([FORMAT_VERSION, hash(reportBytes), repoRecords.map(r => r.fingerprint)])).slice(0, 24);
  const manifest = { version: FORMAT_VERSION, id: snapshotId, createdAt: new Date().toISOString(), title: report.meta.title,
    reportHash: hash(reportBytes), repositories: repoRecords, warnings, flows, nodes: nodeRecords, files,
    unknowns: report.unknowns || [], verifyPlan: report.verifyPlan || [] };
  const parent = dirname(resolve(output)); mkdirSync(parent, { recursive: true });
  // Publish the manifest last. Incomplete output is not a valid report, and
  // Windows indexers cannot block publishing by holding a directory rename.
  mkdirSync(output); mkdirSync(join(output, 'sources'));
  for (const [id, source] of Object.entries(sources)) writeFileSync(join(output, 'sources', `${id}.json`), JSON.stringify(source));
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' });
  return manifest;
}
