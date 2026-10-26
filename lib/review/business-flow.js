const STATUSES = new Set(['unchanged','modified','added','deleted','unknown']);
export function resolveBusinessFlow(journey, anchors) {
  if (!journey) return undefined;
  if (!journey.source || !Array.isArray(journey.steps) || !Array.isArray(journey.links)) throw new Error('业务流程需包含 source、steps、links');
  const ids = new Set();
  const steps = journey.steps.map(step => {
    if (!step.id || ids.has(step.id) || !step.title || !step.project || !step.layer || !Array.isArray(step.implementationIds) || !STATUSES.has(step.change?.status)) throw new Error(`业务步骤不完整或重复：${step.id}`);
    ids.add(step.id);
    if (step.change.status !== 'unchanged' && step.change.status !== 'unknown' && (!step.change.before || !step.change.after || !step.change.reason)) throw new Error(`变化步骤缺少前后行为或理由：${step.id}`);
    const implementationIds = step.implementationIds.map(id => {if(!anchors.has(id))throw new Error(`业务步骤引用未知实现：${id}`);return anchors.get(id);});
    return {...step,implementationIds:[...new Set(implementationIds)]};
  });
  for(const edge of journey.links)if(!ids.has(edge.from)||!ids.has(edge.to))throw new Error(`业务流程边引用未知步骤：${edge.from} → ${edge.to}`);
  return {...journey,steps};
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
