import {useEffect,useState,useRef} from 'react';
import {ReactFlow,ReactFlowProvider,Background,Controls,MarkerType,Position,type Node,type Edge} from '@xyflow/react';
import {api,reportId} from './api';
import {buildDependencyGraph} from '../../../lib/review/dependency-graph.js';
import {layoutReviewGraph} from '../../../lib/review/elk-layout.js';
import type {Flow,Manifest,Sources} from './types';
export function isDependencyFlow(flow:Flow,manifest:Manifest){const ids=flow.chains.flatMap(c=>c.nodeIds);return ids.length>0&&ids.every(id=>manifest.files[manifest.nodes[id]?.fileId]?.path.match(/(?:^|\/)pom\.xml$/i));}
export function DependencyCanvas({flow,manifest,onOpen}:{flow:Flow;manifest:Manifest;onOpen:(id:string)=>void}){
 const open=useRef(onOpen);open.current=onOpen;
 const [graph,setGraph]=useState<{nodes:Node[];edges:Edge[]}>(),[error,setError]=useState('');
 useEffect(()=>{let live=true;setGraph(undefined);setError('');
 const ids=[...new Set(flow.chains.flatMap(c=>c.nodeIds).map(id=>manifest.nodes[id].fileId))];
 void Promise.all(ids.map(async id=>{const f=manifest.files[id],s=await api<Sources>(`reports/${reportId}/source/${id}`);return {id,project:f.project,path:f.path,nodeId:flow.chains.flatMap(c=>c.nodeIds).find(n=>manifest.nodes[n].fileId===id)!,old:s.old.text,new:s.new.text};})).then(async records=>{
 const model=buildDependencyGraph(records);
 const layout=await layoutReviewGraph(model.nodes.map(n=>({id:n.id,project:n.project,width:400,height:300,ports:[{id:'out',y:85}]})),model.edges.map(e=>({...e,sourceHandle:'out'})));
 if(!live)return;
 setGraph({nodes:model.nodes.map(n=>({id:n.id,position:layout.nodes.find(p=>p.id===n.id)!,sourcePosition:Position.Right,targetPosition:Position.Left,style:{width:400,minHeight:250,textAlign:'left'},data:{label:<div><strong>{n.project} · {n.after.artifact||'坐标未识别'}</strong><p>{n.path}</p><p>发布版本：{n.before.version||'未声明'} → {n.after.version||'未声明'}</p>{Object.entries(n.after.properties).filter(([key,value])=>/version/i.test(key)&&n.before.properties[key]!==value).map(([key,value])=><p key={key}>{key}：{n.before.properties[key]||'未声明'} → {value}</p>)}{model.edges.filter(e=>e.source===n.id).map(e=><p key={e.id}>{e.kind==='parent'?'父模块版本':e.kind==='management'?'管理依赖版本':'依赖版本'}：{e.before} → {e.after}</p>)}<button className="nodrag" onClick={()=>open.current(n.nodeId)}>查看 POM 源码与差异 ↗</button></div>}})),edges:model.edges.map(e=>({id:e.id,source:e.source,target:e.target,label:e.kind==='parent'?'继承父模块':e.kind==='management'?'管理依赖版本':'依赖',type:'smoothstep',style:{strokeDasharray:e.kind==='dependency'?undefined:'5 4'},markerEnd:{type:MarkerType.ArrowClosed},labelStyle:{fontSize:11},labelBgPadding:[6,4] as [number,number]}))});
 }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[flow,manifest]);
 return <section className="rr-sequence" aria-label="依赖与版本关系"><h3>依赖与版本关系</h3><p>箭头从使用方指向依赖方。虚线区分父模块继承和 dependencyManagement 的版本管理；管理版本不代表模块已实际引入该依赖。</p><p>版本来自固定 POM 源码；仅解析直接声明及本 POM 属性，不解析激活 profile、远程父 POM 或最终构建依赖。缺失关系不会猜测补线。</p>{error?<p role="alert">{error}</p>:graph?<div className="rr-react-flow"><ReactFlowProvider><ReactFlow nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{padding:.25,maxZoom:.85}} nodesConnectable={false} deleteKeyCode={null}><Background/><Controls showInteractive={false}/></ReactFlow></ReactFlowProvider></div>:<p>正在读取 POM 版本与依赖声明…</p>}</section>;
}
