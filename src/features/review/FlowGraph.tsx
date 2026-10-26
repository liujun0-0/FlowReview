import { buildBusinessGraph } from '../../../lib/review/business-flow.js';
import { layoutMethodGraph } from '../../../lib/review/flow-layout.js';
import { useEffect, useId, useRef, useState } from 'react';
import { buildMethodGraph, type ModuleStatus } from '../../../lib/review/flow-graph.js';
import type { Flow, Manifest } from './types';

export const STATUS_LABELS: Record<ModuleStatus, string> = { unchanged: '未修改', modified: '修改', added: '新增', deleted: '删除', unknown: '待核对' };
export function FlowGraph({ flow, manifest, include, selected, selectedNode, selectedStep, onSelect }: { flow: Flow; manifest: Manifest; include: (id: string) => boolean; selected: string; selectedNode: string; selectedStep?: string; onSelect: (id: string, nodeId?: string, stepId?: string) => void }) {
  const [methodView,setMethodView] = useState(false);
  const businessView = !!flow.journey && !methodView;
  const graph = businessView ? buildBusinessGraph(flow.journey!,manifest.nodes,manifest.files,include) : buildMethodGraph(flow, manifest.nodes, manifest.files, include);
  const graphSelection=graph.modules.find(m=>m.id===selectedStep)?.id || graph.modules.find(m=>m.nodeIds.includes(selectedNode))?.id || ''; 
  const [zoom, setZoom] = useState(1);
  const graphScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { const view=graphScroll.current, pos=layout.positions[graphSelection]; if(view) view.scrollTo({ top: pos ? Math.max(0,(pos.y+pos.height/2)*zoom-view.clientHeight/2) : 0, left: pos ? Math.max(0,(pos.x+pos.width/2)*zoom-view.clientWidth/2) : 0 }); }, [flow.id, zoom, methodView]);
  const drag = useRef<{x:number;y:number;left:number;top:number} | null>(null);
  const marker = useId().replace(/:/g, '');
  const layout = layoutMethodGraph(graph, businessView ? {nodeWidth:320,nodeHeight:265} : {});
  const positions = new Map(Object.entries(layout.positions));
  const { width, height } = layout;
  return <section className="rr-graph-section" aria-label="方法调用链图">
    <div className="rr-graph-title"><h3>{businessView ? '业务流程 · 变化嵌入原有链路' : '方法调用图 · 实现位置与引用关系'}</h3>{flow.journey && <button onClick={()=>setMethodView(v=>!v)}>{businessView?'切换方法调用图':'返回业务流程图'}</button>}<button aria-pressed={!selected} onClick={() => onSelect('')}>查看整条链代码</button></div>
    <div className="rr-graph-legend"><button onClick={() => { const view=graphScroll.current; if(view) setZoom(Math.max(0.1, Math.min(1,(view.clientWidth-20)/width,(view.clientHeight-20)/height))); }}>适应全图</button><small>空白处可拖动</small><label>缩放<select aria-label="链路图缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{![1,0.75,0.5,0.25].includes(zoom) && <option value={zoom}>{Math.round(zoom*100)}%</option>}<option value={1}>100%</option><option value={0.75}>75%</option><option value={0.5}>50%</option><option value={0.25}>25% 总览</option></select></label>{Object.entries(STATUS_LABELS).map(([kind, label]) => <span className={`rr-status rr-status-${kind}`} key={kind}>{label}</span>)}<small>实线：报告提供关系证据 · 虚线：关联顺序或待核对；{businessView?'颜色表示业务步骤变化；原有步骤始终保留':'颜色对应方法变化'}，接口 URL 为应用内路径</small></div>
    <div className="rr-graph-scroll" ref={graphScroll} onPointerDown={e => { if((e.target as HTMLElement).closest('button,select'))return; const view=e.currentTarget; drag.current={x:e.clientX,y:e.clientY,left:view.scrollLeft,top:view.scrollTop};view.setPointerCapture(e.pointerId); }} onPointerMove={e => {if(!drag.current)return;e.currentTarget.scrollLeft=drag.current.left-e.clientX+drag.current.x;e.currentTarget.scrollTop=drag.current.top-e.clientY+drag.current.y;e.preventDefault();}} onPointerUp={e => {drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}}><div className="rr-graph-canvas" style={{ width: width * zoom, height: height * zoom }}><div className="rr-graph-scaled" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      {layout.groups.map(group => <div className="rr-app-lane rr-project-box" key={group.project} style={{ left: group.x, top: group.y, width: group.width, height: group.height }}><strong>{group.project}</strong></div>)}
      <svg width={width} height={height} className="rr-graph-edges" aria-label="模块关系"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>{graph.edges.map((edge, i) => {
        const a = positions.get(edge.from)!, b = positions.get(edge.to)!;
        const forward = b.x >= a.x + a.width;
        const startX = a.x + a.width, startY = a.y + a.height / 2;
        const endX = forward ? b.x : b.x + b.width, endY = b.y + b.height / 2;
        const bend = forward ? (startX + endX) / 2 : Math.max(startX, endX) + 35;
        const curve = forward && Math.abs(endY - startY) < 1 ? `M${startX},${startY} L${endX},${endY}` : `M${startX},${startY} L${bend - 12},${startY} Q${bend},${startY} ${bend},${startY + (endY >= startY ? 12 : -12)} L${bend},${endY - (endY >= startY ? 12 : -12)} Q${bend},${endY} ${bend + (forward ? 12 : -12)},${endY} L${endX},${endY}`;
        return <g key={i}><path d={curve} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={edge.confirmed ? undefined : '5 4'} markerEnd={`url(#${marker})`}><title>{edge.label}：{edge.evidence}</title></path>{edge.label !== '关联顺序' && <text x={(startX + endX) / 2 + 6} y={(startY + endY) / 2 - 6} fill="currentColor" fontSize="10"><title>{edge.label}：{edge.evidence}</title>{edge.label.length > 20 ? edge.label.slice(0, 20) + '…' : edge.label}</text>}</g>;
      })}</svg>
      {graph.modules.map(m => { const p = positions.get(m.id)!; return <button key={m.id} className={`rr-graph-module rr-method-graph-node ${!!m.step ? `rr-business-node rr-node-kind-${m.step.kind || 'process'}` : ''} rr-module-${m.status} ${graphSelection === m.id ? 'rr-module-selected' : ''}`} style={{ left: p.x, top: p.y, width: p.width, height: p.height }} aria-pressed={graphSelection === m.id} disabled={!m.nodeIds.length} onClick={() => onSelect(m.fileId, m.nodeIds[0], !!m.step ? m.id : undefined)} title={`${m.project} / ${m.path}\n功能：${m.role}\n主要过程：${m.process}\n本次变化：${m.change}`}><span className={`rr-status rr-status-${m.status}`}>{STATUS_LABELS[m.status]}</span>{!!m.step && <span className="rr-step-layer">{m.step.layer}{m.step.kind==='decision'?' · 条件分支':m.step.kind==='failure'?' · 失败出口':m.step.kind==='end'?' · 结果':''}</span>}<strong>{m.title}</strong><small className="rr-method-owner" title={m.owner}>实现：{m.owner}</small>{m.endpoint && <span className="rr-endpoint">{m.endpoint.method} {m.endpoint.path}</span>}<span className="rr-node-prose"><b>功能：</b>{m.role}</span>{!!m.step && m.status === 'unchanged' && <span className="rr-node-prose"><b>结果：</b>{m.step.output}</span>}{m.status !== 'unchanged' && <><span className="rr-node-prose"><b>主要过程：</b>{m.process || '旧报告未描述，需补充核对'}</span><span className="rr-node-prose rr-node-change"><b>{!!m.step && m.step.change.kind==='implementation'?'实现调整：':'改了什么：'}</b>{m.change}</span></>}<span className="rr-module-count">{graph.edges.filter(e=>e.to===m.id).length} 处引用 · 点击查看源码与详细说明</span></button>; })}
    </div></div></div>
    {graphSelection && <details className="rr-reference-list" open><summary>{businessView?'当前步骤的上下游与分支':'当前方法的引用与调用'}</summary>{graph.edges.filter(e=>e.from===graphSelection || e.to===graphSelection).map((edge,i)=>{const target=graph.modules.find(n=>n.id===(edge.from===graphSelection?edge.to:edge.from))!; return <p key={i}><span>{edge.from===graphSelection?'调用 →':'被引用 ←'}</span> <button onClick={()=>onSelect(target.fileId,target.nodeIds[0], !!target.step?target.id:undefined)}>{target.title}</button> <span className={`rr-status rr-status-${target.status}`}>{STATUS_LABELS[target.status]}</span> · {edge.label} <small>{edge.confirmed?'报告提供源码证据':'待核实'}</small></p>;})}</details>}
    {!graph.modules.length && <p>当前过滤条件下没有方法节点，可取消测试过滤后查看。</p>}
  </section>;
}
