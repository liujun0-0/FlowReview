import { getFunctionEntries, buildEntryCanvas } from './entry-canvas.js';
export { getFunctionEntries } from './entry-canvas.js';
import { buildSequence } from './sequence-model.js';
import { bindProcessCalls } from './sequence-canvas.js';

export function objectReferenceColor(status) {
 return ({added:'#24965d',modified:'#3574da',deleted:'#ce4857',unchanged:'#8391a0',unknown:'#b48a22'})[status] || '#b48a22';
}

// Entry state comes from the actual HTTP endpoint, never an added downstream step.
export function entryChangeStatus(entry, methods, steps = []) {
 const match=(entry||'').trim().match(/^(?:(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+)?(\/[^\s]+)$/i);
 const clean=path=>path.split(/[?#]/)[0].replace(/\/$/,'')||'/';
 let candidates=methods.filter(m=>m.endpoint && (!entry || match && clean(m.endpoint.path)===clean(match[2]) && (!match[1] || m.endpoint.method.toUpperCase()===match[1].toUpperCase())));
 const primary=steps[0]?.project;
 if(primary&&candidates.some(m=>m.project===primary))candidates=candidates.filter(m=>m.project===primary);
 if(!entry&&candidates.length!==1)return 'unknown';
 const statuses=[...new Set(candidates.map(m=>m.status))];
 return statuses.length===1?statuses[0]:'unknown';
}

// Keep the business backbone independent of project expansion and source filtering.
export function buildFunctionCanvas(flow, nodes, files, expanded = new Set(), include = () => true, selectedEntry = '') {
 const entries=getFunctionEntries(flow,nodes,files);
 if(entries.length>0)return buildEntryCanvas(flow,nodes,files,expanded,include,entries,selectedEntry);
 const sequence = buildSequence(flow, nodes, files, include);
 if(flow.journey?.steps?.length===0&&sequence.methods.length)return buildEntryCanvas(flow,nodes,files,expanded,include,[],selectedEntry);
 const steps = flow.journey?.steps || [];
 const projects = [...new Set([...steps.map(s => s.project || '未标明项目'), ...sequence.projects,
  ...sequence.contextIds.map(id => files[nodes[id].fileId].project)])];
 const projectId = name => `summary:${name}`;
 const methodById = new Map(sequence.methods.map(m => [m.id, m]));
 const projectOfStep = new Map(steps.map(s => [s.id, s.project || '未标明项目']));
 const businessLinks=flow.journey?.links||[];
 const businessPairs=new Set(businessLinks.map(link=>JSON.stringify([projectOfStep.get(link.from),projectOfStep.get(link.to)])));
 const projectCalls=sequence.methods.flatMap(m=>m.calls.filter(c=>c.confirmed&&methodById.has(c.to)&&methodById.get(c.to).project!==m.project).map(c=>({from:m.project,to:methodById.get(c.to).project})));
 const callPairs=new Set(projectCalls.map(c=>JSON.stringify([c.from,c.to])));
 const firstChange = steps.find(s => ['added', 'modified', 'deleted'].includes(s.change.status));
 const items = projects.map(project => {
  const projectSteps = steps.filter(s => (s.project || '未标明项目') === project);
  const methods = sequence.methods.filter(m => m.project === project);
  const contextStatuses=sequence.contextIds.filter(id=>files[nodes[id].fileId].project===project).map(id=>nodes[id].changeStatus||(files[nodes[id].fileId].changed?'modified':'unchanged'));
  const statuses = [...projectSteps.map(s => s.change.status), ...methods.map(m => m.status),...contextStatuses];
  const status = statuses.some(s => s === 'modified') ? 'modified' : statuses.some(s => s === 'added') ? 'added' : statuses.some(s => s === 'deleted') ? 'deleted' : statuses.every(s => s === 'unchanged') ? 'unchanged' : 'unknown';
  return {id:projectId(project),kind:'summary',project,steps:projectSteps,methods,expanded:expanded.has(project),status,
   firstChange:firstChange && (firstChange.project || '未标明项目') === project ? firstChange.id : undefined,
   contextIds:sequence.contextIds.filter(id => files[nodes[id].fileId].project === project)};
 });
 const edges = [];
 const add = (id,source,target,sourceHandle,label,kind,confirmed,evidence='') => {
  if(source!==target)edges.push({id,source,target,sourceHandle,label,kind,confirmed,evidence});
 };
 const edgeIds = new Set(), collapsedCalls = new Map();
 for (const m of sequence.methods) {
  if (expanded.has(m.project)) {
   items.push({id:m.id,kind:'method',project:m.project,method:m});
   for(const o of m.objects) {
    items.push({id:`object:${o.fileId}`,kind:'object',project:m.project,object:o});
    add(`object:${o.fileId}`,m.id,`object:${o.fileId}`,`object:${o.fileId}`,'对象引用','object',false,o.evidence);
    edges.at(-1).changeStatus=o.status;
   }
  }
  const binding=bindProcessCalls(m.processSteps,m.calls);
  m.calls.forEach((call,i)=>{
   const target=methodById.get(call.to);if(!target)return;
   const sourceId=expanded.has(m.project)?m.id:projectId(m.project);
   const targetId=expanded.has(target.project)?target.id:projectId(target.project);
   const collapsed=!expanded.has(m.project)&&!expanded.has(target.project);
   if(collapsed&&businessPairs.has(JSON.stringify([m.project,target.project])))return;
   const key=JSON.stringify([sourceId,targetId,collapsed?'overview':call.label,collapsed?'':i]);
   if(collapsed&&collapsedCalls.has(key)) {
    const edge=collapsedCalls.get(key);edge.count++;edge.label=`方法调用（${edge.count}处）`;
    edge.confirmed=edge.confirmed&&call.confirmed&&!binding.unbound.includes(i);
    edge.evidence+='；'+call.label+'：'+call.evidence;return;
   }
   if(edgeIds.has(key))return;edgeIds.add(key);
   add(`call:${m.id}:${i}`,sourceId,targetId,expanded.has(m.project)?`call:${i}`:'out',collapsed?'方法调用':call.label,'call',call.confirmed&&!binding.unbound.includes(i),call.label+'：'+call.evidence);
   if(collapsed&&sourceId!==targetId){const edge=edges.at(-1);edge.count=1;collapsedCalls.set(key,edge);}
  });
 }
 // Project frames already show membership; do not draw containment as execution.
 for(const [i,link] of (flow.journey?.links || []).entries()) {
  const from=projectOfStep.get(link.from),to=projectOfStep.get(link.to);if(!from||!to)continue;
  if((expanded.has(from)||expanded.has(to))&&callPairs.has(JSON.stringify([from,to])))continue;
  add(`business:${i}`,projectId(from),projectId(to),`step:${link.from}`,link.label||'业务流转','business',link.confidence==='确定'&&!!link.evidence,link.evidence);
 }
 const source=flow.journey?.source;
 const endpoints=sequence.methods.filter(m=>m.endpoint);
 items.unshift({id:'boundary:entry',kind:'boundary',project:'入口',title:'功能入口',status:entryChangeStatus(source?.entry,sequence.methods,steps),description:source?.actor||'报告已采集的接口入口',endpoint:source?.entry||endpoints.map(m=>`${m.endpoint.method} ${m.endpoint.path}`).join('；')||'未定位入口，请补充报告',detail:source?.input||'输入未说明'});
 items.push({id:'boundary:result',kind:'boundary',project:'结果',title:'最终结果',description:source?.outcome||'报告未说明最终结果，请补充链路',detail:flow.journey?.coverage.status||'当前仅展示已采集方法，不能认定完整'});
 if(businessLinks.length) {
  const connected=new Set(businessLinks.flatMap(link=>[link.from,link.to]));
  const roots=steps.filter(s=>connected.has(s.id)&&!businessLinks.some(e=>e.to===s.id));
  const ends=steps.filter(s=>connected.has(s.id)&&!businessLinks.some(e=>e.from===s.id));
  for(const project of new Set(roots.map(s=>projectOfStep.get(s.id))))add(`entry:${project}`,'boundary:entry',projectId(project),'out','入口','boundary',false,'报告入口与已连接业务主干的起点关联，不代表直接方法调用');
  for(const project of new Set(ends.map(s=>projectOfStep.get(s.id))))add(`result:${project}`,projectId(project),'boundary:result','out','结果','boundary',false,'报告业务主干末端与最终结果关联，不代表同步返回');
 } else {
  // Missing business links must not turn every listed step into an entry/exit.
  const active=new Set(projectCalls.flatMap(c=>[c.from,c.to]));
  const callRoots=[...active].filter(project=>!projectCalls.some(c=>c.to===project));
  const entry=(source?.entry||'').trim().match(/^(?:(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+)?(\/[^\s]+)$/i);
  const endpointProjects=[...new Set(endpoints.filter(m=>entry&&m.endpoint.path===entry[2]&&(!entry[1]||m.endpoint.method.toUpperCase()===entry[1].toUpperCase())).map(m=>m.project))];
  let roots=endpointProjects.length===1?endpointProjects:callRoots.length===1?callRoots:projects.length===1&&(source||endpoints.length)?projects:[];
  if(!source&&!endpoints.length)roots=[];
  for(const project of roots)add(`entry:${project}`,'boundary:entry',projectId(project),'out','入口','boundary',false,'依据接口定位或已核对项目调用的唯一主干起点关联，业务连线仍待补充');
  const reachable=new Set(roots),queue=[...roots];
  while(queue.length){const from=queue.shift();for(const call of projectCalls)if(call.from===from&&!reachable.has(call.to)){reachable.add(call.to);queue.push(call.to);}}
  if(source?.outcome&&(projectCalls.length||projects.length===1))for(const project of reachable)if(!projectCalls.some(c=>c.from===project))add(`result:${project}`,projectId(project),'boundary:result','out','结果','boundary',false,'已采集主干末端与报告结果关联；业务连线未补全，不代表同步返回');
 }

 return {items,edges,sequence};
}
