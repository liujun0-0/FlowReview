export function moduleStatus(file) {
  if (file.statuses.old === 'missing' && file.statuses.new === 'text') return 'added';
  if (file.statuses.new === 'missing' && file.statuses.old === 'text') return 'deleted';
  if (![file.statuses.old, file.statuses.new].every(s => ['text', 'missing'].includes(s))) return 'unknown';
  return file.changed ? 'modified' : 'unchanged';
}

export function buildFlowGraph(flow, nodes, files, include = () => true) {
  const modules = new Map(), edges = [], seenEdges = new Set();
  const addEdge = (from, to, label, confirmed, evidence) => {
    if (!modules.has(from) || !modules.has(to) || from === to) return;
    const key = `${from}:${to}:${label}:${confirmed}`;
    if (!seenEdges.has(key)) { seenEdges.add(key); edges.push({ from, to, label, confirmed, evidence }); }
  };
  for (const chain of flow.chains) {
    const ids = chain.nodeIds.filter(id => nodes[id] && files[nodes[id].fileId] && include(id));
    for (const id of ids) {
      const n = nodes[id], f = files[n.fileId];
      if (!modules.has(f.id)) modules.set(f.id, { id: f.id, project: f.project, title: f.path.split('/').at(-1), path: f.path, status: moduleStatus(f), nodeIds: [] });
      if (!modules.get(f.id).nodeIds.includes(id)) modules.get(f.id).nodeIds.push(id);
    }
    if (chain.links?.length) {
      for (const link of chain.links) {
        if (!ids.includes(link.from) || !ids.includes(link.to)) continue;
        addEdge(nodes[link.from].fileId, nodes[link.to].fileId, link.label || '调用关系', link.confidence === '确定' && !!link.evidence, link.evidence || '关系尚待核对');
      }
    } else {
      for (let i = 1; i < ids.length; i++) addEdge(nodes[ids[i - 1]].fileId, nodes[ids[i]].fileId, '关联顺序', false, '原报告未提供独立的调用边证据，连线仅表示报告阅读顺序');
    }
  }
  return { modules: [...modules.values()], edges };
}


export function buildMethodGraph(flow, nodes, files, include = () => true) {
  const modules = new Map(), edges = [], seen = new Set();
  for (const chain of flow.chains) {
    const ids = chain.nodeIds.filter(id => nodes[id]?.rangeKind === 'method' && files[nodes[id].fileId] && include(id));
    for (const id of ids) {
      const n = nodes[id], f = files[n.fileId], a = n.annotations?.[0] || {};
      const status = n.changeStatus || (n.relatedOnly ? 'unchanged' : f.statuses.old === 'missing' ? 'added' : f.statuses.new === 'missing' ? 'deleted' : 'modified');
      modules.set(id, { id, fileId:f.id, project:f.project, path:f.path, title:n.title, status, nodeIds:[id], owner:f.path.split('/').at(-1), endpoint:n.endpoint || a.endpoint,
        role:a.role && a.role !== n.title ? a.role : a.why || '原报告未说明方法功能', process:a.process || a.branches?.join('；') || '', change:status === 'unchanged' ? '' : a.behavior || a.why || '查看真实差异核对' });
    }
    const links = chain.links?.length ? chain.links : ids.slice(1).map((id,i)=>({from:ids[i],to:id,label:'关联顺序',confidence:'猜',evidence:'旧报告未提供方法间调用证据'}));
    for (const link of links) {
      if (!ids.includes(link.from) || !ids.includes(link.to)) continue;
      const key=JSON.stringify([link.from,link.to,link.label]); if(seen.has(key))continue;seen.add(key);
      edges.push({ from:link.from,to:link.to,label:link.label || '调用', confirmed:link.confidence==='确定' && !!link.evidence,evidence:link.evidence || '待核对' });
    }
  }
  return {modules:[...modules.values()],edges};
}
