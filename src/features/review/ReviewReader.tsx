import { DependencyCanvas, isDependencyFlow } from './DependencyCanvas';
import { BoundaryDetails } from './BoundaryDetails';
import { ChainReader } from './ChainReader';
import { FunctionCanvas } from './FunctionCanvas';
import { BusinessOverview } from './BusinessOverview';
import { BusinessStepDetails } from './BusinessStepDetails';
import { FlowGraph, STATUS_LABELS } from './FlowGraph';
import { moduleStatus } from '../../../lib/review/flow-graph.js';
import { isTestSource } from '../../../lib/review/file-kind.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SourceViewer, SourceViewerProvider, type SourceAnnotation, type SourceViewRequest, type SourceTokenEvent } from '../../shared/source-viewer';
import { useTheme } from '../../shared/useTheme';
import type { Annotation, Manifest, Mark, ReaderNode, ReadingState, SourceFile, SymbolInfo } from './types';
import { api, reportId } from './api';
import { useSource } from './useSource';
import { useReadingState } from './useReadingState';
import { useSourceNavigation } from './useSourceNavigation';
import './reader.css';

function unique<T>(values: T[]) { return [...new Set(values)]; }
function plainType(type = '') { return ({ '穿越未改': '原有代码', '传播变更': '跟随接口调整', '改实现': '逻辑修改', '契约变更': '接口或配置变化', '改签名': '参数或返回值调整' } as Record<string, string>)[type] || type; }
function normalized(text: string) { return text.replace(/\r\n/g, '\n'); }
function slice(text: string, range: [number, number] | null) { return range ? normalized(text).split('\n').slice(range[0] - 1, range[1]).join('\n') + '\n' : ''; }

function Explanation({ values, original = false }: { values: Annotation[]; original?: boolean }) {
  const unchanged = original || values.length > 0 && values.every(a => a.type === '穿越未改');
  return <div className="rr-explanation">{values.map(a => a.readerNodeId && <span className="rr-method-anchor" id={`node-${a.readerNodeId}`} key={a.readerNodeId} />)}{unique(values.map(a => a.func).filter(Boolean)).map(name => <strong className="rr-explanation-method" key={name}>{name}</strong>)}{unique(values.map(a => a.why).filter(Boolean)).map(why => <p key={why}><b>{unchanged ? '关联原因：' : '为什么改：'}</b>{why}</p>)}
    {unique(values.map(a => a.role).filter(Boolean)).map(role => <p key={role}><b>主要功能：</b>{role}</p>)}
    {unique(values.flatMap(a => a.branches || []).filter(Boolean)).map(branch => <p key={branch}><b>处理分支：</b>{branch}</p>)}
    {values.some(a => a.type !== '穿越未改') && !values.some(a => a.branches?.length) && <p className="rr-muted">处理分支：原报告未单独描述，可展开源码核对。</p>}
    {!unchanged && unique(values.map(a => a.behavior).filter(Boolean)).map(behavior => <p key={behavior}><b>本次变化：</b>{behavior}</p>)}
    <details><summary>核对依据、风险与验证结果</summary>{values.map((a, i) => <div className="rr-explanation-detail" key={i}>
      {a.counterfactual && <p><b>不改会怎样：</b>{a.counterfactual}</p>}
      {a.risk_detail && <p><b>需要留意：</b>{a.risk_detail}</p>}
      {a.verdict && a.type !== '穿越未改' && <p><b>说明中的判断：</b>{a.verdict} {a.assessmentReason}</p>}
      <p><b>关系依据：</b>{a.evidence || '没有提供检索证据'}（{a.confidence === '确定' && a.evidence ? '说明标记为已核对' : '还需核对'}）</p>
      <p><b>验证状态：</b>{a.verifyStatus || '未执行'}</p>{a.verify && <p>{a.verify}</p>}{a.verifyResult && <p>{a.verifyResult}</p>}{a.verifyEvidence && <p>{a.verifyEvidence}</p>}
    </div>)}</details></div>;
}

interface Candidate { file: SourceFile; symbol: SymbolInfo; side: 'old' | 'new' }
function DefinitionPeek({ candidates, onClose, onOpen }: { candidates: Candidate[]; onClose: () => void; onOpen: (candidate: Candidate) => void }) {
  const [selected, setSelected] = useState(0);
  const chosen = candidates[selected];
  const { data, error } = useSource(chosen?.file.id || '');
  return <aside className="rr-peek" aria-label="相关定义预览"><header><strong>相关定义 · {candidates.length} 个名称匹配</strong><button onClick={onClose}>收起预览</button></header>
    <p>名称匹配用于帮助查阅，不代表已确认调用；请核对类、参数和接收对象。</p>
    {candidates.length > 1 && <select aria-label="选择相关定义" value={selected} onChange={e => setSelected(Number(e.target.value))}>{candidates.map((c, i) => <option key={c.symbol.id} value={i}>{c.file.project} / {c.symbol.owner}.{c.symbol.signature}</option>)}</select>}
    <p className="rr-path">{chosen.file.project} / {chosen.file.path} · {chosen.side === 'old' ? '修改前' : '修改后'} L{chosen.symbol.start}–{chosen.symbol.end}</p>
    {error ? <p role="alert">{error}</p> : !data ? <p>读取快照源码…</p> : <pre>{slice(data[chosen.side].text, [chosen.symbol.start, Math.min(chosen.symbol.end, chosen.symbol.start + 35)])}</pre>}
    {chosen.symbol.end - chosen.symbol.start > 35 && <p>预览前 36 行，完整内容可在文件中查看。</p>}
    <button onClick={() => onOpen(chosen)}>在完整文件中查看</button>
  </aside>;
}

interface CodeProps {
  node: ReaderNode; file: SourceFile; theme: 'light' | 'dark'; mode: 'diff' | 'old' | 'new'; full: boolean; explain: boolean; completeMethod: boolean;
  onToken: (text: string, side: 'old' | 'new', owner: string) => void; split: boolean; fileAnnotations?: Annotation[];
}
function Code({ node, file, theme, mode, full, explain, completeMethod, onToken, split, fileAnnotations }: CodeProps) {
  const { data, error } = useSource(file.id);
  const sourceDocument = useMemo(() => data ? { id: `${reportId}:${file.id}`, path: file.path, before: data.old, after: data.new } : undefined, [data, file.id, file.path]);
  const sourceAnnotations = fileAnnotations || node.annotations;
  const annotations = useMemo<SourceAnnotation[]>(() => {
    const groups = new Map<string, { side: 'old' | 'new'; line: number; values: Annotation[] }>();
  if (explain) for (const value of sourceAnnotations) {
    const annotationSide = value.side === 'old' || value.type === '删除' ? 'old' : 'new';
    const key = `${annotationSide}:${value.line}`;
    const group = groups.get(key) || { side: annotationSide, line: value.line, values: [] };
    group.values.push(value); groups.set(key, group);
  }
    return [...groups].map(([id, group]) => ({ id, line: group.line, side: group.side, content: <Explanation values={group.values} original={node.relatedOnly || node.changeStatus === 'unchanged'} /> }));
  }, [sourceAnnotations, explain, node.relatedOnly, node.changeStatus]);
  const handleToken = useCallback((event: SourceTokenEvent) => onToken(event.text, event.side, node.id), [onToken, node.id]);
  const side = mode === 'old' ? 'old' : mode === 'new' ? 'new' : node.side;
  const range = side === 'old' ? node.oldRange : node.newRange;
  if (error) return <p className="rr-error" role="alert">{error}</p>;
  if (!data) return <p className="rr-loading">读取固定源码快照…</p>;
  if (data[side].status === 'missing' && mode !== 'diff') return <p className="rr-context-label">{side === 'old' ? '新增文件，没有修改前源码。' : '已删除文件，没有修改后源码。'}</p>;
  if (!['text', 'missing'].includes(data[side].status)) return <p className="rr-warning">该版本为 {data[side].status}，未作为可读文本展示。</p>;
  const before = node.oldRange ? slice(data.old.text, node.oldRange) : '';
  const after = node.newRange ? slice(data.new.text, node.newRange) : '';
  const sameMethod = !!node.oldRange && !!node.newRange && before === after;
  const matchingSides = !((!node.oldRange && data.old.status === 'text' && !node.annotations.every(a => a.type === '新增')) || (!node.newRange && data.new.status === 'text' && !node.annotations.every(a => a.type === '删除')));
  const readableSides = [data.old.status, data.new.status].every(status => ['text', 'missing'].includes(status));
  const comparison = full ? readableSides ? 'file' : 'none' : node.relatedOnly ? 'none' : node.rangeKind === 'context' ? 'file' : matchingSides && !sameMethod && (before || after) ? 'method' : 'none';
  const actualRange = range || node.range;
  const view: SourceViewRequest = mode !== 'diff' || comparison === 'none'
    ? { kind: 'source', side, extent: full ? 'file' : 'range', range: actualRange }
    : comparison === 'file'
      ? { kind: 'diff', scope: 'file', display: full ? 'file' : 'hunks', focus: { side, line: actualRange[0] }, layout: split ? 'split' : 'unified' }
      : { kind: 'diff', scope: 'method', focusSide: side, oldRange: node.oldRange, newRange: node.newRange, fallbackRange: node.range, context: completeMethod ? 'complete' : 'compact', layout: split ? 'split' : 'unified' };
  return <SourceViewer document={sourceDocument!} view={view} theme={theme} annotations={annotations}
    onTokenClick={handleToken}
    fallbackHeader={<div className="rr-context-label">{node.rangeKind === 'context' ? '定位附近上下文（未识别为完整方法）' : node.relatedOnly ? '原有代码，本次没有修改' : sameMethod ? '两侧这段源码一致，请核对报告中的改动说明' : '没有唯一定位到两侧对应方法，先展示指定侧源码'} · 实际 L{actualRange[0]}–{actualRange[1]}；下方行号为片段内行号</div>}
    fallbackFooter={explain && <Explanation values={node.annotations} original={node.relatedOnly || node.changeStatus === 'unchanged'} />} />;
}

function AddedFileCard({ file, nodes, theme, mode, explain, split, onToken, onOpen, reading, onMark, peek, onClosePeek, onOpenCandidate }: {
  file: SourceFile; nodes: ReaderNode[]; theme: 'light' | 'dark'; mode: 'diff' | 'old' | 'new'; explain: boolean; split: boolean;
  onToken: CodeProps['onToken']; onOpen: (node: ReaderNode) => void; reading: ReadingState; onMark: (id: string, value: Partial<Mark>) => void;
  peek?: { owner: string; candidates: Candidate[] }; onClosePeek: () => void; onOpenCandidate: (candidate: Candidate) => void;
}) {
  const { data, error } = useSource(file.id);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>读取新增文件…</p>;
  const end = Math.max(1, normalized(data.new.text).split('\n').length);
  const combined: ReaderNode = { ...nodes[0], id: `addedfile-${file.id}`, title: file.path.split('/').at(-1)!, range: [1, end], newRange: [1, end], oldRange: null,
    rangeKind: 'file', relatedOnly: false,
    annotations: nodes.flatMap(n => n.annotations.map((a, i) => ({ ...a, func: n.title, readerNodeId: i === 0 ? n.id : undefined }))) };
  return <article className="rr-card rr-added-file" id={`filegroup-${file.id}`}>
    <header><div><strong>{combined.title}</strong><span className="rr-test-tag">新增文件 · 只展示一次</span>{isTestSource(file.path) && <span className="rr-test-tag">测试代码</span>}<div className="rr-path">{file.project} / {file.path}</div></div><button onClick={() => onOpen(combined)}>完整文件</button></header>
    <p className="rr-context-label">{nodes.length} 个关联节点的说明已放到对应代码行旁；源码只展示一份。节点标记互相独立。</p>
    <Code node={combined} file={file} theme={theme} mode={mode} full={false} explain={explain} completeMethod={false} onToken={onToken} split={split} />
    {peek?.owner === combined.id && <DefinitionPeek candidates={peek.candidates} onClose={onClosePeek} onOpen={onOpenCandidate} />}
    <details className="rr-node-progress"><summary>各方法与节点的阅读标记 / 疑问</summary>{nodes.map(n => <div key={n.id}><strong>{n.title}</strong><span className="rr-path">L{n.range[0]}–{n.range[1]}</span><button aria-pressed={!!reading.marks[n.id]?.read} onClick={() => onMark(n.id, { read: !reading.marks[n.id]?.read })}>{reading.marks[n.id]?.read ? '已看过' : '标为看过'}</button><button aria-pressed={!!reading.marks[n.id]?.question} onClick={() => onMark(n.id, { question: !reading.marks[n.id]?.question })}>{reading.marks[n.id]?.question ? '已记疑问' : '记个疑问'}</button>{reading.marks[n.id]?.question && <textarea aria-label={`关于 ${n.title} 的疑问`} defaultValue={reading.marks[n.id]?.note || ''} onBlur={e => onMark(n.id, { note: e.target.value })} />}</div>)}</details>
  </article>;
}

export function ReviewReader() {
  const theme = useTheme();
  const [manifest, setManifest] = useState<Manifest>(); const [error, setError] = useState('');
  const [businessStepId,setBusinessStepId]=useState('');
  const [boundary,setBoundary]=useState<{flow:string;kind:'entry'|'result';entryId?:string}>();
  const [showAllCode, setShowAllCode] = useState(false);
  const [moduleId, setModuleId] = useState('');
  const [flowId, setFlowId] = useState(''); const [nav, setNav] = useState<'flow' | 'file' | 'questions'>('flow');
  const [sequenceView,setSequenceView] = useState(true);
  const [chainReading,setChainReading] = useState(false);
  const [chainMode,setChainMode] = useState<'diff' | 'old' | 'new'>('diff');
  const [mode, setMode] = useState<'diff' | 'old' | 'new'>('diff'); const [split, setSplit] = useState(false);
  const [explain, setExplain] = useState(true); const [completeMethod, setCompleteMethod] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); const [selected, setSelected] = useState('');
  const [full, setFull] = useState<ReaderNode>(); const [peek, setPeek] = useState<{ owner: string; candidates: Candidate[] }>();
  const { reading, initializeReading, saveStatus, saveError, saveQueue, updateMark, savePosition, hasPending } = useReadingState();
  const [hideTests, setHideTests] = useState(false);
  const fileExplanations = useMemo(() => Object.fromEntries(Object.values(manifest?.files || {}).map(file => [file.id, file.nodeIds.flatMap(id => manifest!.nodes[id].annotations.map(a => ({ ...a, func: manifest!.nodes[id].title })))])), [manifest]);
  const includeNode = useCallback((id: string) => !hideTests || !!manifest && !isTestSource(manifest.files[manifest.nodes[id].fileId].path), [hideTests, manifest]);
  const [search, setSearch] = useState(''); const [notice, setNotice] = useState(''); const [stopped, setStopped] = useState(false);
  const main = useRef<HTMLElement>(null); const codePane = useRef<HTMLElement>(null);
  const sourceNavigation = useSourceNavigation(codePane, full?.id || '');
  useEffect(() => {
    let alive = true;
    Promise.all([api<Manifest>(`reports/${reportId}`), api<ReadingState>(`reports/${reportId}/state`)]).then(([m, state]) => {
      if (!alive) return; setManifest(m); initializeReading(state); setFlowId(m.flows.some(f => f.id === state.position?.flow) ? state.position!.flow! : m.flows[0]?.id || ''); setSelected(state.position?.node || '');
    }).catch(e => { if (alive) setError(e.message); });
    const timer = setInterval(() => api('heartbeat', {}).catch(() => { if (alive) setNotice('本地服务连接中断。重新运行启动命令即可恢复，已保存进度会保留。'); }), 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [initializeReading]);
  const flow = manifest?.flows.find(f => f.id === flowId);
  const flowNodes = unique(flow?.chains.flatMap(c => c.nodeIds) || []);
  const files = manifest ? Object.values(manifest.files).filter(f => !hideTests || !isTestSource(f.path)).filter(f => !search || `${f.project}/${f.path}`.toLowerCase().includes(search.toLowerCase())) : [];
  const navigate = useCallback((id: string) => {
    if (!manifest?.nodes[id]) return;
    setBoundary(undefined);
    setModuleId(manifest.nodes[id].fileId); setSelected(id); setExpanded(current => new Set([...current, id])); setFull(undefined);
    const belongs = manifest.flows.find(f => f.id === flowId && f.chains.some(c => c.nodeIds.includes(id))) || manifest.flows.find(f => f.chains.some(c => c.nodeIds.includes(id))); if (belongs) setFlowId(belongs.id);
    setTimeout(() => (document.getElementById(`node-${id}`) || document.getElementById(`filegroup-${manifest.nodes[id].fileId}`))?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
    savePosition({ flow: belongs?.id || flowId, node: id });
  }, [manifest, savePosition, flowId]);
  const onToken = useCallback((text: string, side: 'old' | 'new', owner: string) => {
    if (!manifest) return;
    const names: string[] = text.match(/[A-Za-z_$][\w$]*/g) || [];
    const candidates = Object.values(manifest.files).flatMap(file => file.indexes[side].symbols.filter(s => names.includes(s.name)).map(symbol => ({ file, symbol, side })));
    if (!candidates.length) { setNotice(`“${text.trim()}”在本快照已收集的定义中没有匹配。未把它猜成其他同名方法。`); setPeek(undefined); return; }
    setNotice(''); setPeek({ owner, candidates });
  }, [manifest]);
  const openFull = useCallback((node: ReaderNode) => { sourceNavigation.remember(node.id); setFull(node); if (manifest?.nodes[node.id]) setSelected(node.id); setPeek(undefined); codePane.current?.scrollTo({ top: 0 }); }, [sourceNavigation.remember, manifest]);
  const openCandidate = (candidate: Candidate) => {
    const node: ReaderNode = { id: candidate.symbol.id, fileId: candidate.file.id, title: candidate.symbol.name, side: candidate.side,
      range: [candidate.symbol.start, candidate.symbol.end], rangeKind: candidate.symbol.kind, oldRange: candidate.side === 'old' ? [candidate.symbol.start, candidate.symbol.end] : null,
      newRange: candidate.side === 'new' ? [candidate.symbol.start, candidate.symbol.end] : null, located: true, annotations: [], relatedOnly: true };
    sourceNavigation.remember(peek?.owner || selected); setMode(candidate.side); setFull(node); setPeek(undefined); codePane.current?.scrollTo({ top: 0 });
  };
  const selectMethod = useCallback((_fileId: string, nodeId: string, stepId?: string) => {
    const node = manifest?.nodes[nodeId]; if (!node) return;
    setBoundary(undefined);
    setBusinessStepId(stepId || ''); setModuleId(node.fileId); setSelected(nodeId); setShowAllCode(false); setFull(undefined); setPeek(undefined);
    setMode(node.relatedOnly || node.changeStatus === 'unchanged' ? node.side : 'diff'); setCompleteMethod(true);
    setExpanded(current => new Set([...current, nodeId]));
    if (node.rangeKind !== 'method') openFull(node);
    codePane.current?.scrollTo({ top: 0 }); savePosition({ flow: flowId, node: nodeId });
  }, [manifest, openFull, savePosition, flowId]);
  const selectModule = useCallback((id: string, nodeId?: string, stepId?: string) => {
    setBoundary(undefined);
    setBusinessStepId(stepId || ''); setModuleId(id); setSelected(nodeId || ''); setShowAllCode(!id); setFull(undefined); setPeek(undefined);
    codePane.current?.scrollTo({ top: 0 }); if (nodeId) savePosition({ flow: flowId, node: nodeId });
  }, [flowId, savePosition]);
  const goBack = () => sourceNavigation.restore(() => setFull(undefined));
  if (error || stopped) return <div className="rr-loading"><h1>{stopped ? '本地阅读器已停止' : '无法打开阅读报告'}</h1><p>{error || '再次运行启动命令即可继续阅读。'}</p></div>;
  if (!manifest) return <div className="rr-loading">正在打开功能链与固定源码快照…</div>;
  const marks = Object.values(reading.marks); const questionIds = Object.keys(reading.marks).filter(id => reading.marks[id].question && manifest.nodes[id]);
  const fileNode = selected && manifest.nodes[selected];
  const unfiltered = nav === 'questions' ? questionIds : nav === 'file' && fileNode ? manifest.files[fileNode.fileId].nodeIds : flowNodes;
  const isTestNode = (id: string) => isTestSource(manifest.files[manifest.nodes[id].fileId].path);
  const filtered = unfiltered.filter(id => !hideTests || !isTestNode(id));
  const activeModule = nav === 'flow' && !full && moduleId && filtered.some(id => manifest.nodes[id].fileId === moduleId) ? manifest.files[moduleId] : undefined;
  const activeStep = nav==='flow' ? flow?.journey?.steps.find(s=>s.id===businessStepId || (!businessStepId&&s.implementationIds.includes(selected))) : undefined;
  const selectedMethod = activeModule && manifest.nodes[selected]?.fileId === activeModule.id && manifest.nodes[selected].rangeKind === 'method' ? manifest.nodes[selected] : undefined;
  const visible = activeModule ? selectedMethod && sequenceView ? [selectedMethod.id] : filtered.filter(id => manifest.nodes[id].fileId === activeModule.id) : filtered;
  const hiddenCount = unfiltered.length - filtered.length;
  const testFileCount = Object.values(manifest.files).filter(f => isTestSource(f.path)).length;
  const detailStatus = selectedMethod?.changeStatus || (selectedMethod?.relatedOnly ? 'unchanged' : activeModule ? moduleStatus(activeModule) : 'unknown');
  const syntheticFile = nav === 'file' && selected.startsWith('file:') ? manifest.files[selected.slice(5)] : undefined;
  function mark(id: string, change: Partial<Mark>) { updateMark(id, change, { flow: flowId, node: id }); }
  function card(node: ReaderNode) {
    const file = manifest!.files[node.fileId], status = reading.marks[node.id] || {};
    const suggestions = unique(node.annotations.map(a => a.risk_detail).filter(Boolean));
    const compact = node.relatedOnly || node.changeStatus === 'unchanged' || node.rangeKind === 'class' || node.rangeKind === 'context';
    const show = !compact || expanded.has(node.id) || !!full;
    return <article className={`rr-card ${selected === node.id ? 'rr-selected' : ''}`} id={`node-${node.id}`} key={node.id}>
      <header><div><strong>{node.title}</strong>{isTestSource(file.path) && <span className="rr-test-tag">测试代码</span>}<span className="rr-tag">{node.relatedOnly || node.changeStatus === 'unchanged' ? '原有代码' : unique(node.annotations.map(a => plainType(a.type))).join(' / ')}</span><div className="rr-path">{file.project} / {file.path} · L{node.range[0]}–{node.range[1]}</div></div><div className="rr-actions">{compact && !full && <button onClick={() => setExpanded(current => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })}>{show ? '收起代码' : '展开代码'}</button>}<button onClick={() => full ? goBack() : openFull(node)}>{full ? '返回功能链原位置' : '完整文件'}</button></div></header>
      {suggestions.length > 0 && <details className="rr-attention"><summary>{node.relatedOnly ? '为什么关联到本次变化' : node.annotations.some(a => a.tier === '细看') ? '建议重点看 · 展开具体理由' : '阅读建议 · 展开依据'}</summary>{suggestions.map((s, i) => <p key={i}>{s}</p>)}</details>}
      {file.changeInfo && <p className="rr-context-label">文件级变化：{file.changeInfo}</p>}{!node.located && <p className="rr-warning">该定位未在本次指定侧源码中找到，不能据此认定没有变化。</p>}
      {!show && explain && <Explanation values={node.annotations} original={node.relatedOnly || node.changeStatus === 'unchanged'} />}
      {show && <Code node={node} file={file} theme={theme.resolved} mode={mode} full={!!full} explain={explain} completeMethod={completeMethod} onToken={onToken} split={split} fileAnnotations={full ? fileExplanations[file.id] : undefined} />}
      {peek?.owner === node.id && <DefinitionPeek candidates={peek.candidates} onClose={() => setPeek(undefined)} onOpen={openCandidate} />}
      <footer><span>{node.signature || node.annotations[0]?.role || '关联源码位置'}</span>{manifest!.nodes[node.id] && <div className="rr-actions"><button aria-pressed={!!status.read} onClick={() => mark(node.id, { read: !status.read })}>{status.read ? '已看过' : '标为看过'}</button><button aria-pressed={!!status.question} onClick={() => mark(node.id, { question: !status.question })}>{status.question ? '已记疑问' : '记个疑问'}</button></div>}</footer>
      {status.question && <textarea aria-label={`关于 ${node.title} 的疑问`} placeholder="记下需要核对的问题" defaultValue={status.note || ''} onBlur={e => mark(node.id, { note: e.target.value })} />}
    </article>;
  }
  const activeBoundary=nav==='flow'&&boundary?.flow===flowId?boundary.kind:undefined;
  const panelOpen = !!activeBoundary || !!full || !!businessStepId || nav !== 'flow' || !!activeModule || showAllCode;
  const chooseBusinessStep = (id:string) => {if(chainReading){document.getElementById(`stream-step-${id}`)?.scrollIntoView({block:'start',behavior:'smooth'});return;}setBoundary(undefined);const step=flow?.journey?.steps.find(s=>s.id===id);const node=step?.implementationIds.map(ref=>manifest.nodes[ref]).find(Boolean);setBusinessStepId(id);if(!node){setModuleId('');setSelected('');setFull(undefined);setPeek(undefined);return;}setModuleId(node.fileId);setSelected(node.id);setShowAllCode(false);setFull(undefined);setPeek(undefined);codePane.current?.scrollTo({top:0});};
  const sourceContent = <>{saveError && <div className="rr-warning" role="alert">{saveError}</div>}{activeStep&&!full&&<BusinessStepDetails step={activeStep} manifest={manifest} onMethod={id=>{const n=manifest.nodes[id];setModuleId(n.fileId);setSelected(id);setFull(undefined);}}/>}      {!full && nav === 'flow' && <section id="rr-module-detail" className="rr-module-detail"><details><summary>方法功能、路径及阅读说明</summary><div className="rr-actions"><h2>{selectedMethod ? `${selectedMethod.title} · ${activeModule!.path.split('/').at(-1)}` : activeModule ? activeModule.path.split('/').at(-1) : '源码与详细说明'}</h2>{activeModule && <><span className={`rr-status rr-status-${detailStatus}`}>{STATUS_LABELS[detailStatus]}</span><button onClick={() => { setModuleId(''); main.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>返回整条链路图</button>{selectedMethod && <button onClick={() => document.getElementById(`node-${selectedMethod.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>定位该方法源码</button>}</>}</div>{activeModule && <><p className="rr-path">{activeModule.project} / {activeModule.path}</p><p><b>{selectedMethod ? '方法功能：' : '模块功能：'}</b>{selectedMethod?.annotations[0]?.role || unique(visible.flatMap(id => { const n = manifest.nodes[id]; return n.annotations.map(a => a.role && a.role !== n.title ? a.role : a.why); }).filter(Boolean)).join('；') || '原报告未提供模块功能说明，请结合下方方法源码核对。'}</p><p className="rr-muted">{detailStatus === 'unchanged' ? '原有模块，以功能介绍为主，源码按需展开。' : '下方展示方法功能、处理分支与真实代码变化；新增文件仅展示一份源码。'}</p></>}</details></section>}
      {full && <div className="rr-breadcrumb"><button onClick={goBack}>返回功能链原位置</button><span>完整文件 · {mode === 'diff' ? '前后对比' : mode === 'old' ? '修改前' : '修改后'} · {manifest.files[full.fileId].path}</span></div>}
      <div className="rr-test-filter"><label><input type="checkbox" checked={hideTests} onChange={e => { setHideTests(e.target.checked); setFull(undefined); }} />隐藏测试代码（{testFileCount} 个文件）</label><small>按测试目录、文件名识别，含测试辅助文件；只影响展示，完整变更仍保留。</small>{hideTests && <button onClick={() => setHideTests(false)}>显示全部</button>}</div>
      <div className="rr-controls"><div className="rr-actions"><button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>前后对比</button><button aria-pressed={mode === 'new'} onClick={() => setMode('new')}>修改后源码</button><button aria-pressed={mode === 'old'} onClick={() => setMode('old')}>修改前源码</button><label><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} />左右对照</label></div><div className="rr-actions"><label><input type="checkbox" checked={explain} onChange={e => setExplain(e.target.checked)} />代码旁说明</label><label><input type="checkbox" checked={completeMethod} onChange={e => setCompleteMethod(e.target.checked)} />展开完整方法</label></div></div>
      {hideTests && hiddenCount > 0 && <p className="rr-context-label">当前列表已隐藏 {hiddenCount} 个测试阅读节点；可取消过滤查看。</p>}
      {!full && nav === 'flow' && !activeModule && !showAllCode ? <p className="rr-source-prompt">先在方法调用图中了解主要过程和变化，再点击感兴趣的方法节点查看源码。也可点击“查看整条链代码”。</p> : full ? card(full) : syntheticFile && (!hideTests || !isTestSource(syntheticFile.path)) ? <><h2>{syntheticFile.path}</h2><p className="rr-warning">这个文件没有关联到报告节点，下面展示真实文件变化，需人工核对归属。</p><Code node={{ id: `file:${syntheticFile.id}`, fileId: syntheticFile.id, title: syntheticFile.path, side: 'new', range: [1, 1], oldRange: null, newRange: null, located: true, relatedOnly: false, rangeKind: 'file', annotations: [] }} file={syntheticFile} theme={theme.resolved} mode={mode} full explain={false} completeMethod={false} onToken={onToken} split={split} /></> : visible.map((id, index) => {
        const node = manifest.nodes[id], file = manifest.files[node.fileId];
        if ((sequenceView && !!selectedMethod) || file.statuses.old !== 'missing' || file.statuses.new !== 'text') return card(node);
        if (visible.slice(0, index).some(other => manifest.nodes[other].fileId === file.id)) return null;
        return <AddedFileCard key={file.id} file={file} nodes={visible.filter(other => manifest.nodes[other].fileId === file.id).map(other => manifest.nodes[other])} theme={theme.resolved} mode={mode} explain={explain} split={split} onToken={onToken} onOpen={openFull} reading={reading} onMark={mark} peek={peek} onClosePeek={() => setPeek(undefined)} onOpenCandidate={openCandidate} />;
      })}
      {!full && !visible.length && <p>{hiddenCount || (hideTests && syntheticFile && isTestSource(syntheticFile.path)) ? '当前内容已被测试过滤器隐藏，点击“显示全部”恢复。' : nav === 'flow' ? '该功能尚未关联实现代码，请核对需求覆盖情况。' : '当前没有可展示的阅读节点。'}</p>}
      <footer className="rr-bottom"><span>{saveStatus || '看过不等于实现正确；验证结果为原报告提供的记录。'}</span><details><summary>尚待核对与行为验证建议</summary>{manifest.unknowns.map((u, i) => <p key={i}>{u.what}：{u.reason}；{u.how}</p>)}{manifest.verifyPlan.map((v, i) => <p key={i}>{v.target} · {v.strategy}：{v.how}</p>)}</details></footer></>;
  return <SourceViewerProvider><div className={`reader ${panelOpen ? 'rr-has-code' : ''} ${nav !== 'flow' ? 'rr-source-mode' : ''}`}>
    <header className="rr-top"><div><h1><span className="rr-brand">FlowReview</span>{manifest.title}</h1><small>固定源码快照 · {new Date(manifest.createdAt).toLocaleString()} · {Object.keys(manifest.files).length} 个文件 / {Object.keys(manifest.nodes).length} 个阅读节点</small></div><div className="rr-actions"><span>{marks.filter(m => m.read).length} 处看过 · {questionIds.length} 处疑问</span><button onClick={theme.cycleTheme}>主题：{{ auto: '跟随系统', light: '浅色', dark: '深色' }[theme.mode]}</button><button onClick={async () => { await saveQueue.current; if (hasPending()) { setNotice('还有未保存内容，请先保留疑问文本并处理保存错误，再停止服务。'); return; } try { await api('stop', {}); setStopped(true); } catch (e) { setNotice(String(e)); } }}>停止本地服务</button></div></header>
    <aside className="rr-sidebar"><div className="rr-navtabs"><button aria-pressed={nav === 'flow'} onClick={() => { setBoundary(undefined);setNav('flow'); setFull(undefined); }}>功能链</button><button aria-pressed={nav === 'file'} onClick={() => { setBoundary(undefined);setNav('file'); setFull(undefined); }}>文件</button><button aria-pressed={nav === 'questions'} onClick={() => { setBoundary(undefined);setNav('questions'); setFull(undefined); }}>我的疑问 {questionIds.length}</button></div>
      {nav === 'flow' ? manifest.flows.map(f => <button key={f.id} className={`rr-navitem ${f.id === flowId ? 'active' : ''}`} onClick={() => { setBoundary(undefined);setFlowId(f.id); setBusinessStepId(''); setModuleId(''); setShowAllCode(false); setSelected(''); setFull(undefined); main.current?.scrollTo({ top: 0 }); }}><b>{f.title}</b><small>{unique(f.chains.flatMap(c => c.nodeIds)).filter(id => !hideTests || !isTestNode(id)).length} / {unique(f.chains.flatMap(c => c.nodeIds)).length} 个阅读节点 · {f.status}</small></button>) : nav === 'file' ? <><input aria-label="查找文件" placeholder="查找文件或项目" value={search} onChange={e => setSearch(e.target.value)} />{files.map(file => <button className={`rr-navitem ${(fileNode && fileNode.fileId === file.id) || syntheticFile?.id === file.id ? 'active' : ''}`} key={file.id} onClick={() => { setSelected(file.nodeIds[0] || `file:${file.id}`); setFull(undefined); }}><b>{file.path}</b>{isTestSource(file.path) && <span className="rr-test-tag">测试代码</span>}<small>{file.project} · {file.changed ? '有文件变化' : '原有文件'} · {file.nodeIds.length ? '已关联说明' : '未归入功能链，仍需查看'}</small></button>)}</> : <>{questionIds.filter(id => !hideTests || !isTestNode(id)).map(id => <button key={id} className="rr-navitem" onClick={() => navigate(id)}>{manifest.nodes[id].title}<small>{reading.marks[id].note || '尚未填写问题内容'}</small></button>)}{!questionIds.length && <p>在代码旁点击“记个疑问”，可集中回顾。</p>}</>}
      <details className="rr-evidence"><summary>版本、范围与采集说明</summary><p>快照 {manifest.id}</p>{manifest.repositories.map(r => <p key={r.project}>{r.project}<br/>{r.mode}：{r.base.slice(0, 12)} → {r.head?.slice(0, 12) || '采集时的工作区'}<br/>源码指纹 {r.fingerprint.slice(0, 16)}</p>)}{manifest.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>
    </aside>
    <main className="rr-main" ref={main}>
      {saveError && <div className="rr-warning" role="alert">{saveError}</div>}
      {chainReading && saveStatus && <p className="rr-muted" role="status">{saveStatus}</p>}
      {notice && <div className="rr-warning" role="status">{notice}<button onClick={() => setNotice('')}>收起</button></div>}
      {manifest.warnings.length > 0 && <details className="rr-warning"><summary>源码已固定；有 {manifest.warnings.length} 项采集说明需要留意</summary>{manifest.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
      {nav === 'flow' && flow && <section className="rr-overview"><h2>{flow.title}</h2><details className="rr-flow-context" open={chainReading}><summary>链路功能与前后变化</summary><p><b>对应需求：</b>{flow.requirement || '原报告未提供需求原文'}</p>{(flow.before || flow.after) && <div className="rr-beforeafter"><p><b>原来：</b>{flow.before}</p><p><b>这次：</b>{flow.after}</p></div>}</details><>{flow.journey&&<BusinessOverview compact={!!activeModule || (!chainReading && sequenceView)} journey={flow.journey} onStep={chooseBusinessStep}/>}</><div className="rr-view-switch"><button aria-pressed={!chainReading&&sequenceView} onClick={()=>{setChainReading(false);setSequenceView(true);}}>全链路画布</button><button aria-pressed={chainReading} onClick={()=>setChainReading(true)}>沿链阅读</button><button aria-pressed={!chainReading&&!sequenceView} onClick={()=>{setChainReading(false);setSequenceView(false);}}>业务步骤图</button></div>{chainReading ? <ChainReader key={flow.id} flow={flow} manifest={manifest} include={includeNode} selected={selected} reading={reading} onMark={mark} onOpen={id=>selectMethod(manifest.nodes[id].fileId,id)} controls={<div className="rr-actions"><button aria-pressed={chainMode==='diff'} onClick={()=>setChainMode('diff')}>前后对比</button><button aria-pressed={chainMode==='new'} onClick={()=>setChainMode('new')}>修改后源码</button><button aria-pressed={chainMode==='old'} onClick={()=>setChainMode('old')}>修改前源码</button><label><input type="checkbox" checked={explain} onChange={e=>setExplain(e.target.checked)}/>代码旁说明</label><label><input type="checkbox" checked={hideTests} onChange={e=>setHideTests(e.target.checked)}/>隐藏测试代码</label></div>} renderSource={node=><><Code node={node} file={manifest.files[node.fileId]} theme={theme.resolved} mode={chainMode} full={false} explain={explain} completeMethod={true} onToken={onToken} split={false}/>{peek?.owner===node.id&&<DefinitionPeek candidates={peek.candidates} onClose={()=>setPeek(undefined)} onOpen={candidate=>{setModuleId(candidate.file.id);openCandidate(candidate);}}/>}</>}/> : sequenceView && isDependencyFlow(flow,manifest) ? <DependencyCanvas flow={flow} manifest={manifest} onOpen={id=>selectMethod(manifest.nodes[id].fileId,id)}/> : sequenceView ? <FunctionCanvas flow={flow} manifest={manifest} include={includeNode} selected={selected} onSelect={selectMethod} onStep={chooseBusinessStep} hideTests={hideTests} onHideTests={setHideTests} onBoundary={(kind,entryId)=>{setBoundary({flow:flowId,kind,entryId});setFull(undefined);setBusinessStepId('');setModuleId('');setSelected('');setShowAllCode(false);setPeek(undefined);codePane.current?.scrollTo({top:0});}}/> : <FlowGraph flow={flow} manifest={manifest} include={includeNode} selected={activeModule?.id || ''} selectedStep={activeStep?.id} selectedNode={manifest.nodes[selected]?.rangeKind === 'method' ? selected : ''} onSelect={selectModule} />}
      <details className="rr-route-details"><summary>功能路径与方法目录</summary>{flow.chains.map(chain => <div key={chain.id}><p><b>{chain.name}</b> → {chain.sideEffect || '原报告未说明最终影响'}</p><div className="rr-method-directory">{chain.nodeIds.filter(id => !hideTests || !isTestNode(id)).map(id => <button key={id} onClick={() => navigate(id)}>{manifest.nodes[id].title}</button>)}</div></div>)}</details></section>}
      {!panelOpen && !chainReading && <p className="rr-source-prompt">点击流程图中的方法，在右侧查看源码与变化；图的位置保持不动。</p>}

    </main>
    {panelOpen && <aside className="rr-code-panel" ref={codePane} aria-label="源码侧栏"><header className="rr-code-panel-header"><strong>{activeBoundary ? activeBoundary==='entry'?'入口参数示例':'最终结果示例' : full ? '完整文件' : selectedMethod ? selectedMethod.title + '()' : activeStep ? activeStep.title : '源码与变化'}</strong><button onClick={() => { setFull(undefined); setBusinessStepId(''); setModuleId(''); setSelected(''); setShowAllCode(false); setPeek(undefined); setNav('flow');setBoundary(undefined); }}>{activeBoundary?'关闭示例':'关闭源码'}</button></header>{activeBoundary&&flow?<BoundaryDetails entryId={boundary?.entryId} kind={activeBoundary} flow={flow} manifest={manifest} onMethod={id=>selectMethod(manifest.nodes[id].fileId,id)}/>:sourceContent}</aside>}
  </div></SourceViewerProvider>;
}
