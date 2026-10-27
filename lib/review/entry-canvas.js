import { buildSequence } from './sequence-model.js';
import { bindProcessCalls } from './sequence-canvas.js';

/** Explicit entry anchors take priority; legacy endpoints retain only verified facts. */
export function getFunctionEntries(flow,nodes,files) {
 if(flow.journey?.entries?.length)return flow.journey.entries;
 const methods=buildSequence(flow,nodes,files).methods;
 const endpoints=methods.filter(m=>m.endpoint);
 return endpoints.map(m=>({id:m.id,title:m.title,implementationId:m.id,entry:`${m.endpoint.method} ${m.endpoint.path}`,actor:'接口调用方',input:'旧报告未分别采集参数说明',purpose:m.role||m.title,evidence:m.endpoint.evidence||'固定源码快照中的接口映射',inferred:true}));
}

function reachable(root,byId) {
 const ids=new Set(),queue=[root];
 while(queue.length){const id=queue.shift();if(ids.has(id)||!byId.has(id))continue;ids.add(id);for(const call of byId.get(id).calls)if(call.confirmed)queue.push(call.to);}
 return ids;
}

/** Multiple entry chains share downstream methods without duplicating functional navigation. */
export function buildEntryCanvas(flow,nodes,files,expanded,include,entries,selectedEntry='') {
 const sequence=buildSequence(flow,nodes,files,include),byId=new Map(sequence.methods.map(m=>[m.id,m]));
 const visible=entries.filter(e=>!selectedEntry||e.id===selectedEntry),paths=new Map(visible.map(e=>[e.id,reachable(e.implementationId,byId)]));
 const ids=new Set([...paths.values()].flatMap(set=>[...set]));
 const methods=sequence.methods.filter(m=>ids.has(m.id)),items=[],edges=[];
 const nodeId=m=>expanded.has(m.project)?m.id:`method-summary:${m.id}`;
 for(const m of methods){
  const steps=(flow.journey?.steps||[]).filter(s=>s.implementationIds.includes(m.id));
  const memberOf=visible.filter(e=>paths.get(e.id).has(m.id));
  items.push(expanded.has(m.project)?{id:m.id,kind:'method',project:m.project,method:m}:{id:nodeId(m),kind:'summary',project:m.project,title:`${m.owner.replace(/\.java$/,'')}.${m.title}()`,endpoint:m.endpoint&&`${m.endpoint.method} ${m.endpoint.path}`,methods:[m],steps,status:m.status,contextIds:[],detail:[memberOf.length>1?`公共下游 · ${memberOf.length} 个入口共用`:m.role,m.process].filter(Boolean).join('；')});
  if(expanded.has(m.project))for(const o of m.objects){
   const id=`object:${o.fileId}`;if(!items.some(n=>n.id===id))items.push({id,kind:'object',project:m.project,object:o});
   edges.push({id:`object:${m.id}:${o.fileId}`,source:m.id,target:id,sourceHandle:`object:${o.fileId}`,label:'对象引用',kind:'object',confirmed:false,evidence:o.evidence,changeStatus:o.status});
  }
  const binding=bindProcessCalls(m.processSteps,m.calls);
  m.calls.forEach((c,i)=>{const target=byId.get(c.to);if(!ids.has(c.to)||!target)return;edges.push({id:`entry-call:${m.id}:${i}`,source:nodeId(m),target:nodeId(target),sourceHandle:expanded.has(m.project)?`call:${i}`:'out',label:c.label||'方法调用',kind:'call',confirmed:c.confirmed&&!binding.unbound.includes(i),evidence:c.evidence});});
 }
 for(const e of visible){
  const root=byId.get(e.implementationId);
  items.push({id:`boundary:entry:${e.id}`,kind:'boundary',project:'入口',title:e.title||'接口入口',status:root?.status||'unknown',description:e.purpose||e.actor,endpoint:e.entry,detail:e.input,entryId:e.id,boundaryKind:'entry'});
  if(root)edges.push({id:`entry:${e.id}`,source:`boundary:entry:${e.id}`,target:nodeId(root),sourceHandle:'out',label:'入口方法',kind:'boundary',confirmed:!e.inferred,evidence:e.evidence});
  items.push({id:`boundary:result:${e.id}`,kind:'boundary',project:'结果',title:`${e.title||e.entry} · 结果`,description:e.outcome||'本接口结果尚未分别采集',detail:'结果归属当前接口；不表示后台处理已完成',entryId:e.id,boundaryKind:'result'});
  // Returning from an API is separate from its downstream side effects.
  if(root&&e.outcome)edges.push({id:`result:${e.id}`,source:nodeId(root),target:`boundary:result:${e.id}`,sourceHandle:'out',label:'接口结果',kind:'boundary',confirmed:false,evidence:e.evidence+'；结果关联不代表最后一次下游调用或同步执行顺序'});
 }
 const untracked=sequence.methods.filter(m=>!ids.has(m.id));
 // Retain missing-chain implementations as explicit isolated context, never fabricate calls.
 for(const m of untracked)items.push({id:`unlinked:${m.id}`,kind:'summary',project:m.project,title:`${m.owner.replace(/\.java$/,'')}.${m.title}()`,methods:[m],steps:(flow.journey?.steps||[]).filter(s=>s.implementationIds.includes(m.id)),status:m.status,contextIds:[],detail:'未关联当前入口：报告缺少对应调用关系；点击查看已采集源码'});

 return {items,edges,sequence:{...sequence,methods,projects:[...new Set(methods.map(m=>m.project))]},entries,untrackedCount:untracked.length};
}
