const STATUSES = new Set(['unchanged','modified','added','deleted','unknown']);
export function resolveBusinessFlow(journey, anchors) {
  if (!journey) return undefined;
  if (!journey.source || !Array.isArray(journey.steps) || !Array.isArray(journey.links)) throw new Error('业务流程需包含 source、steps、links');
  const validateExamples=source=>{for(const key of ['requestExamples','responseExamples']) {
    const examples=source[key];
    if(examples!==undefined&&(!Array.isArray(examples)||examples.some(example=>!example||typeof example.title!=='string'||!example.title.trim()||typeof example.content!=='string'||!example.content.trim()||typeof example.evidence!=='string'||!example.evidence.trim()||example.language!==undefined&&typeof example.language!=='string'||example.description!==undefined&&typeof example.description!=='string')))throw new Error(`入口/结果示例不完整或缺少依据：${key}`);
  }};
  validateExamples(journey.source);
  const entryIds=new Set();
  if(journey.entries!==undefined&&!Array.isArray(journey.entries))throw new Error('journey.entries 必须为数组');
  const entries=journey.entries?.map(entry=>{
    if(!entry||['id','title','entry','implementationId','evidence'].some(key=>typeof entry[key]!=='string'||!entry[key].trim())||entryIds.has(entry.id))throw new Error('接口入口不完整或 id 重复');
    if(['actor','input','purpose','outcome'].some(key=>entry[key]!==undefined&&typeof entry[key]!=='string'))throw new Error('接口入口说明必须为字符串');
    entryIds.add(entry.id);
    if(!anchors.has(entry.implementationId))throw new Error(`接口入口引用未知实现：${entry.implementationId}`);
    validateExamples(entry);
    return {...entry,implementationId:anchors.get(entry.implementationId)};
  });
  const ids = new Set();
  const steps = journey.steps.map(step => {
    if (!step.id || ids.has(step.id) || !step.title || !step.project || !step.layer || !Array.isArray(step.implementationIds) || !STATUSES.has(step.change?.status)) throw new Error(`业务步骤不完整或重复：${step.id}`);
    ids.add(step.id);
    if (step.change.status !== 'unchanged' && step.change.status !== 'unknown' && (!step.change.before || !step.change.after || !step.change.reason)) throw new Error(`变化步骤缺少前后行为或理由：${step.id}`);
    const implementationIds = step.implementationIds.map(id => {if(!anchors.has(id))throw new Error(`业务步骤引用未知实现：${id}`);return anchors.get(id);});
    return {...step,implementationIds:[...new Set(implementationIds)]};
  });
  for(const edge of journey.links)if(!ids.has(edge.from)||!ids.has(edge.to))throw new Error(`业务流程边引用未知步骤：${edge.from} → ${edge.to}`);
  return {...journey,...(entries?{entries}:{}),steps};
}

export function buildBusinessGraph(journey,nodes,files,include=()=>true) {
  const modules=journey.steps.flatMap(step=>{
    const refs=step.implementationIds.filter(id=>nodes[id]&&files[nodes[id].fileId]&&include(id));
    if(step.implementationIds.length&&!refs.length)return [];
    const primary=nodes[refs[0]],file=primary&&files[primary.fileId];
    return [{id:step.id,business:true,fileId:file?.id||'',project:step.project,group:`${step.phase||'业务流程'} · ${step.project}`,path:file?.path||'',title:step.title,status:step.change.status,nodeIds:refs,owner:refs.map(id=>`${files[nodes[id].fileId].path.split('/').at(-1)}.${nodes[id].title}`).join(' / '),endpoint:primary?.endpoint,role:step.purpose,process:step.process||step.output,change:step.change.status==='unchanged'?'':step.change.after,layer:step.layer,kind:step.kind,step}];
  });
  const ids=new Set(modules.map(n=>n.id));
  return {modules,edges:journey.links.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({...e,confirmed:e.confidence==='确定'&&!!e.evidence}))};
}
