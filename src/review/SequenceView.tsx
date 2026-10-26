import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider, BaseEdge, getSmoothStepPath, applyNodeChanges, Background, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useReactFlow, useNodesInitialized, useUpdateNodeInternals, useViewport, type Node, type NodeProps, type Edge, type NodeChange, type EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildSequence, type SequenceObject, type ProcessStep, type SequenceMethod } from '../../lib/review/sequence-model.js';
import { bindProcessCalls, splitProcessReferences } from '../../lib/review/sequence-canvas.js';
import { layoutReviewGraph } from '../../lib/review/elk-layout.js';
import { STATUS_LABELS } from './FlowGraph';
import type { Flow, Manifest } from './types';

type Props={flow:Flow;manifest:Manifest;include:(id:string)=>boolean;selected:string;onSelect:(fileId:string,nodeId:string,stepId?:string)=>void};
type Binding=ReturnType<typeof bindProcessCalls>;
type Data={flowKey:string;method?:SequenceMethod;object?:SequenceObject;binding?:Binding;expandOld:boolean;open:(id:string)=>void;project?:string};
type ReviewNode=Node<Data,'method'|'object'|'project'>;
function Output({id}:{id:string}) {return <Handle type="source" position={Position.Right} id={id} isConnectable={false} className="rr-rf-port"/>;}
function Target(){return <Handle type="target" position={Position.Left} id="in" isConnectable={false} style={{top:30}}/>;}
function ObjectContent({object:o,open}:{object:SequenceObject;open:(id:string)=>void}) {return <><span className={`rr-status rr-status-${o.status}`}>{({added:'新增对象',modified:'修改对象',deleted:'删除对象',unchanged:'原有对象'} as Record<string,string>)[o.status]||'对象待核对'}</span><button className="nodrag" onClick={()=>open(o.id)}><strong>{o.name}</strong> ↗</button><p>{o.reason}</p><small>项目：{o.project}</small><details className="nodrag"><summary>引用依据</summary><p>{o.line?`本链首次同名出现：L${o.line}`:'未定位到首次使用位置'}</p>{o.evidence}</details></>;}
const MethodNode=memo(function MethodNode({id,data,selected}:NodeProps<ReviewNode>){
 const m=data.method!,binding=data.binding!,update=useUpdateNodeInternals(),root=useRef<HTMLElement>(null);
 useEffect(()=>{const el=root.current;if(!el)return;const changed=()=>update(id);el.addEventListener('toggle',changed,true);return()=>el.removeEventListener('toggle',changed,true);},[id,update]);
 useLayoutEffect(()=>{update(id);},[id,data,update]);
 const processLabel=(step:ProcessStep,path:string):ReactNode=>{const indexes=binding.bindings[path]||[];
  if(indexes.length===1){const i=indexes[0],c=m.calls[i];return <div className="rr-rf-reference"><button data-call={`${m.id}-${i}`} className="rr-seq-step-target rr-canvas-step-anchor nodrag" onClick={()=>data.open(c.to)} title={`${c.label}：${c.evidence}`}>{step.text} ↗</button><Output id={`call:${i}`}/></div>;}
  return <div className="rr-seq-execution-label">{splitProcessReferences(step.text,indexes,m.calls).map((p,i)=>p.index===undefined?<span key={i}>{p.text}</span>:<span className="rr-rf-inline" key={i}><button className="rr-canvas-inline-ref nodrag" data-call={`${m.id}-${p.index}`} onClick={()=>data.open(m.calls[p.index!].to)} title={m.calls[p.index].evidence}>{p.text}</button><Output id={`call:${p.index}`}/></span>)}</div>;
 };
 const process=(steps:ProcessStep[],prefix=''):ReactNode=><ol className="rr-seq-execution">{steps.map((s,i)=>{const path=prefix?`${prefix}.${i}`:String(i);return <li key={path} className={s.children.length?'rr-seq-execution-group':''}>{processLabel(s,path)}{s.children.length>0&&process(s.children,path)}</li>;})}</ol>;
 return <article ref={root} data-canvas-id={id} data-method={id} className={`rr-canvas-node rr-seq-method rr-seq-${m.status} ${selected?'rr-seq-selected':''} nopan`}>
 <Target/><div className="rr-canvas-grip" aria-label={`拖动 ${m.title}`}>⠿ 拖动</div>
 <button className="rr-seq-methodhead nodrag" onClick={()=>data.open(m.id)}><span className={`rr-status rr-status-${m.status}`}>{STATUS_LABELS[m.status]}</span><strong>{m.owner.replace(/\.java$/,'')}.{m.title}()</strong><small>{m.project} · L{m.range?.join('–')||'未定位'} · 看完整方法 ↗</small></button>
 {m.objects.length>0&&<div className="rr-seq-object-refs">{m.objects.map(o=><div key={o.fileId} className="rr-rf-reference"><button className="nodrag" data-object-ref={`${m.id}-${o.fileId}`} onClick={()=>data.open(o.id)}>引用对象 → {o.name}<small>L{o.line} · 对象源码</small></button><Output id={`object:${o.fileId}`}/></div>)}</div>}
 {m.endpoint&&<div className="rr-endpoint">{m.endpoint.method} {m.endpoint.path}</div>}{m.step&&<p className="rr-seq-business">{m.step.title}</p>}<p><b>功能：</b>{m.role}</p>
 {m.status!=='unchanged'&&<details className="rr-canvas-change nodrag"><summary>变化：{m.change}</summary><p>{m.change}</p><p>{m.annotations[0]?.why||'报告未说明，需核对'}</p></details>}
 <section className="rr-seq-process" aria-label={`${m.title} 的执行流程`}><b>执行流程</b>{m.processSteps.length?process(m.processSteps):<p className="rr-warning">报告未描述执行流程，需核对源码。</p>}</section>
 {(m.status!=='unchanged'||data.expandOld)&&m.branches.length>0&&<details className="nodrag"><summary>分支 / 异常</summary>{[...new Set(m.branches)].map((b,i)=><p key={i}>{b}</p>)}</details>}
 {binding.unbound.length>0&&<details className="rr-canvas-unbound nodrag"><summary className="rr-rf-reference">未定位到执行步骤的关系（{binding.unbound.length}）{binding.unbound.map(i=><Output id={`call:${i}`} key={i}/>)}</summary>{binding.unbound.map(i=>{const c=m.calls[i];return <p key={i}><button onClick={()=>data.open(c.to)}>{c.target?.owner}.{c.target?.title}() ↗</button><small>{c.label} · 执行位置待核对</small></p>;})}</details>}
 </article>;
});
const ObjectNode=memo(function ObjectNode({id,data}:NodeProps<ReviewNode>){const o=data.object!,update=useUpdateNodeInternals(),root=useRef<HTMLElement>(null);useEffect(()=>{const el=root.current;if(!el)return;const changed=()=>update(id);el.addEventListener('toggle',changed,true);return()=>el.removeEventListener('toggle',changed,true);},[id,update]);return <aside ref={root} data-canvas-id={id} data-object-box={o.fileId} className={`rr-canvas-node rr-seq-object rr-seq-object-card rr-seq-object-${o.status} nopan`}><Target/><div className="rr-canvas-grip" aria-label={`拖动 ${o.name}`}>⠿ 拖动</div><ObjectContent object={o} open={data.open}/></aside>;});
const ProjectNode=memo(function ProjectNode({data}:NodeProps<ReviewNode>){return <div className="rr-rf-project"><strong>项目 · {data.project}</strong></div>;});
const nodeTypes={method:MethodNode,object:ObjectNode,project:ProjectNode};
function RoutedEdge(props:EdgeProps){const route=(props.data as {route?:{x:number;y:number}[]}|undefined)?.route;const path=route?.length?['M'+props.sourceX+','+props.sourceY,...route.map(p=>'L'+p.x+','+p.y),'L'+props.targetX+','+props.targetY].join(' '):getSmoothStepPath(props)[0];return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style}/>;}
const edgeTypes={elk:RoutedEdge};


function FlowCanvas({flow,manifest,include,selected,onSelect}:Props) {
 const model=useMemo(()=>buildSequence(flow,manifest.nodes,manifest.files,include),[flow,manifest,include]);
 const bindings=useMemo(()=>Object.fromEntries(model.methods.map(m=>[m.id,bindProcessCalls(m.processSteps,m.calls)])),[model]);
 const objects=useMemo(()=>model.methods.flatMap(m=>m.objects),[model]);
 const rawEdges=useMemo<Edge[]>(()=>[
  ...model.methods.flatMap(m=>m.calls.map((c,i)=>{const certain=c.confirmed&&!bindings[m.id].unbound.includes(i);return {id:`${m.id}:call:${i}`,source:m.id,target:c.to,sourceHandle:`call:${i}`,targetHandle:'in',type:'smoothstep',style:{stroke:'var(--rr-muted)',strokeWidth:1.4,strokeDasharray:certain?undefined:'5 4'},markerEnd:{type:MarkerType.ArrowClosed,color:'var(--rr-muted)'},ariaLabel:`${c.label}：${c.evidence}`,data:{kind:'call',certain},reconnectable:false};})),
  ...model.methods.flatMap(m=>m.objects.map(o=>({id:`object-edge:${o.fileId}`,source:m.id,target:`object:${o.fileId}`,sourceHandle:`object:${o.fileId}`,targetHandle:'in',type:'smoothstep',style:{stroke:'var(--rr-muted)',strokeDasharray:'5 4',strokeWidth:1.3},markerEnd:{type:MarkerType.ArrowClosed,color:'var(--rr-muted)'},data:{kind:'object'},ariaLabel:`引用对象 ${o.name}；${o.evidence}`,reconnectable:false})))
 ],[model,bindings]);
 const topology=JSON.stringify([flow.id,model.methods.map(m=>m.id),objects.map(o=>o.fileId),rawEdges.map(e=>[e.id,e.source,e.target,e.sourceHandle])]);
 const topologyRef=useRef(topology);topologyRef.current=topology;
 const [nodes,setNodes]=useNodesState<ReviewNode>([]);
 const nodesRef=useRef(nodes);nodesRef.current=nodes;
 const [routes,setRoutes]=useState<Record<string,{x:number;y:number}[]>>({});
 const selectedCanvasId=model.methods.some(m=>m.id===selected)?selected:objects.find(o=>o.id===selected)?`object:${objects.find(o=>o.id===selected)!.fileId}`:'';
 const shownEdges=useMemo(()=>rawEdges.map(e=>{const active=!!selectedCanvasId&&(e.source===selectedCanvasId||e.target===selectedCanvasId);return {...e,type:'elk',style:{...e.style,opacity:selectedCanvasId&&!active ? .24 : 1,stroke:active?'var(--rr-accent)':e.style?.stroke,strokeWidth:active?2.2:e.style?.strokeWidth},data:{...e.data,route:routes[e.id]}};}),[rawEdges,routes,selectedCanvasId]);
 const [expandOld,setExpandOld]=useState(false),[maximized,setMaximized]=useState(false),[busy,setBusy]=useState(false),[layoutError,setLayoutError]=useState('');
 const rf=useReactFlow<ReviewNode>(),initialized=useNodesInitialized(),viewport=useViewport();
 const arranged=useRef(''),request=useRef(0);
 const open=useCallback((id:string)=>{const n=manifest.nodes[id];if(n)onSelect(n.fileId,id,flow.journey?.steps.find(s=>s.implementationIds.includes(id))?.id);},[manifest,onSelect,flow]);
 useEffect(()=>{
  setNodes(old=>{const existing=new Map(old.map(n=>[n.id,n]));const base=(id:string,type:'method'|'object',data:Data,index:number):ReviewNode=>{const prior=existing.get(id);return {...prior,id,type,position:prior?.position||{x:(index%3)*560,y:Math.floor(index/3)*600},style:{width:type==='object'?285:400},dragHandle:'.rr-canvas-grip',data,selected:id===selectedCanvasId,connectable:false};};
   return [...model.methods.map((m,i)=>base(m.id,'method',{flowKey:topology,method:m,binding:bindings[m.id],expandOld,open,project:m.project},i)),...objects.map((o,i)=>base(`object:${o.fileId}`,'object',{flowKey:topology,object:o,expandOld,open,project:o.project},model.methods.length+i))];
  });
 },[model,objects,bindings,expandOld,open,selectedCanvasId,topology,setNodes]);
 const groups=useMemo<ReviewNode[]>(()=>[...new Set(nodes.map(n=>n.data.project!))].map(project=>{
  const items=nodes.filter(n=>n.data.project===project);const x=Math.min(...items.map(n=>n.position.x))-30,y=Math.min(...items.map(n=>n.position.y))-45;
  const width=Math.max(...items.map(n=>n.position.x+(n.measured?.width||Number(n.style?.width)||400)))-x+30;
  const height=Math.max(...items.map(n=>n.position.y+(n.measured?.height||260)))-y+30;
  return {id:`project:${project}`,type:'project',position:{x,y},width,height,measured:{width,height},handles:[],style:{width,height,pointerEvents:'none'},data:{flowKey:topology,project,expandOld:false,open},draggable:false,selectable:false,connectable:false,focusable:false,zIndex:-1};
 }),[nodes,topology,open]);
 const allNodes=useMemo(()=>[...groups,...nodes],[groups,nodes]);
 const focusSelected=()=>{const n=rf.getNode(selectedCanvasId);if(n){const z=Math.max(.8,rf.getZoom());void rf.setViewport({x:30-n.position.x*z,y:45-n.position.y*z,zoom:z},{duration:180});}};
 const focusMain=useCallback(()=>{const m=[...model.methods].sort((a,b)=>b.calls.length-a.calls.length)[0],n=m&&rf.getNode(m.id);if(n){const z=Math.max(.8,rf.getZoom());void rf.setViewport({x:30-n.position.x*z,y:45-n.position.y*z,zoom:z},{duration:180});}},[model,rf]);
 const arrange=useCallback(async()=>{
  const version=++request.current,key=topology;setBusy(true);setLayoutError('');
  try{
   const current=rf.getNodes().filter(n=>n.type!=='project');
   const layoutNodes=current.map(n=>{const internal=rf.getInternalNode(n.id);return {id:n.id,project:n.data.project!,width:n.measured?.width||Number(n.style?.width)||400,height:n.measured?.height||260,ports:(internal?.internals.handleBounds?.source||[]).filter(h=>h.id).map(h=>({id:h.id!,y:h.y+h.height/2}))};});
   const result=await layoutReviewGraph(layoutNodes,rawEdges.map(e=>({id:e.id,source:e.source,target:e.target,sourceHandle:e.sourceHandle!})));
   if(version!==request.current||key!==topologyRef.current)return;
   setRoutes(result.routes);const places=new Map(result.nodes.map(n=>[n.id,{x:n.x,y:n.y}]));setNodes(old=>old.map(n=>({...n,position:places.get(n.id)||n.position})));
   const main=[...model.methods].sort((a,b)=>b.calls.length-a.calls.length)[0],p=main&&places.get(main.id);
   if(p){const z=.8;void rf.setViewport({x:30-p.x*z,y:45-p.y*z,zoom:z},{duration:180});}
  }catch(e){if(version===request.current&&key===topologyRef.current)setLayoutError(`ELK 自动布局失败：${e instanceof Error?e.message:String(e)}。仍可手动拖动，或重试自动排列。`);}
  finally{if(version===request.current)setBusy(false);}
 },[rf,rawEdges,topology,model,setNodes]);
 useEffect(()=>{setRoutes({});request.current++;arranged.current='';},[topology]);
 useEffect(()=>{if(initialized&&nodes.length&&nodes.every(n=>n.data.flowKey===topology)&&arranged.current!==topology){const frame=requestAnimationFrame(()=>{arranged.current=topology;void arrange();});return()=>cancelAnimationFrame(frame);}},[initialized,nodes,topology,arrange]);
 useEffect(()=>()=>{request.current++;},[]);
 const onNodesChange=useCallback((changes:NodeChange<ReviewNode>[])=>{const real=changes.filter(c=>!('id' in c)||!c.id.startsWith('project:'));if(real.some(c=>c.type==='position'&&c.dragging||c.type==='dimensions'&&c.dimensions&&nodesRef.current.some(n=>n.id===c.id&&(n.measured?.height!==c.dimensions!.height||n.measured?.width!==c.dimensions!.width))))setRoutes({});if(real.length)setNodes(old=>applyNodeChanges(real,old));},[setNodes]);
 return <section className={`rr-sequence ${maximized?'rr-canvas-maximized':''}`} aria-label="方法执行流程画布" onKeyDown={e=>{if(e.key==='Escape')setMaximized(false);}}><header><div className="rr-canvas-heading"><h3>方法流程</h3><small>{model.methods.length} 个方法 · {objects.length} 个关联对象</small></div><div className="rr-actions"><button aria-pressed={maximized} onClick={()=>setMaximized(!maximized)}>{maximized?'退出专注':'展开画布'}</button><button disabled={busy||!initialized} onClick={()=>void arrange()}>{busy?'布局中…':'自动排列'}</button><button onClick={focusMain}>聚焦主方法</button><button disabled={!selectedCanvasId} onClick={focusSelected}>定位当前方法</button><button onClick={()=>void rf.fitView({padding:.12,duration:180})}>适应全图</button><label>缩放<select aria-label="画布缩放" value={viewport.zoom} onChange={e=>void rf.zoomTo(Number(e.target.value))}>{![.25,.5,.8,1,1.25].includes(viewport.zoom)&&<option value={viewport.zoom}>{Math.round(viewport.zoom*100)}%</option>}<option value={.25}>25%</option><option value={.5}>50%</option><option value={.8}>80%</option><option value={1}>100%</option><option value={1.25}>125%</option></select></label><label><input type="checkbox" checked={expandOld} onChange={e=>setExpandOld(e.target.checked)}/>原有方法详细分支</label></div></header>
 <details className="rr-seq-caption rr-canvas-help"><summary>操作提示与连线说明</summary><p>拖动空白平移，拖动框角调整位置；点击方法标题或流程中的引用，在右侧查看源码。选中节点的直接关联线会高亮，其余线条淡化。</p><p>虚线表示待核对的调用位置、关系或对象名称匹配。自动排列只调整位置，不代表执行耗时或新增调用。</p></details>
 {layoutError&&<p className="rr-warning" role="alert">{layoutError}</p>}
 {flow.journey&&<details className="rr-seq-unattached"><summary>业务步骤（{flow.journey.steps.length} 步）</summary>{flow.journey.steps.map((s,i)=><p key={s.id}><button onClick={()=>{const id=s.implementationIds.find(include);if(id)open(id);}}>{i+1}. {s.title}</button> · {s.purpose}</p>)}</details>}
 {model.contextIds.length>0&&<details className="rr-seq-unattached"><summary>类、字段和未精确定位方法（{model.contextIds.length} 处）</summary>{model.contextIds.map(id=><p key={id}><button onClick={()=>open(id)}>{manifest.nodes[id].title.split('/').at(-1)}</button> · 方法定位缺失时不补造流程</p>)}</details>}
 <div className="rr-seq-legend">{Object.entries(STATUS_LABELS).map(([s,label])=><span key={s} className={`rr-status rr-status-${s}`}>{label}</span>)}<small>目标方法新增不代表调用边新增</small></div>
 <div className="rr-seq-viewport rr-react-flow" aria-label="React Flow 方法画布"><ReactFlow<ReviewNode> nodes={allNodes} edges={shownEdges} edgeTypes={edgeTypes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} nodesConnectable={false} edgesReconnectable={false} nodesDraggable={!busy} deleteKeyCode={null} minZoom={.08} maxZoom={1.6} defaultViewport={{x:30,y:30,zoom:.8}} onlyRenderVisibleElements={false} colorMode="system"><Background gap={20} size={1} color="var(--rr-border)"/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={n=>n.type==='project'?'transparent':((n.data as Data).method?.status||(n.data as Data).object?.status)==='added'?'#24965d':((n.data as Data).method?.status||(n.data as Data).object?.status)==='modified'?'#3574da':'#8391a0'} maskColor="color-mix(in srgb,var(--rr-bg) 80%,transparent)"/></ReactFlow></div>
 {model.unattached.length>0&&<details className="rr-seq-unattached"><summary>对象：{model.unattached.length} 个未定位首次使用</summary>{model.unattached.map(o=><aside className={`rr-seq-object rr-seq-object-card rr-seq-object-${o.status}`} key={o.fileId}><ObjectContent object={o} open={open}/></aside>)}</details>}
 {!model.methods.length&&<p>当前功能没有可定位的方法节点，可切回业务图或取消测试过滤。</p>}
 </section>;
}
export function SequenceView(props:Props){return <ReactFlowProvider><FlowCanvas {...props}/></ReactFlowProvider>;}
