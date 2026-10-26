import { buildMethodGraph } from './flow-graph.js';

// Explicit separators only; never infer execution order from natural-language prose.
export function parseProcess(text) {
  if (!text?.trim()) return [];
  const root = [], stack = [root]; let buffer = '';
  const flush = () => { if(buffer.trim()) stack.at(-1).push({text:buffer.trim(),children:[]}); buffer=''; };
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='【') { const label=buffer.trim();buffer='';const node={text:label||'处理块',children:[]};stack.at(-1).push(node);stack.push(node.children); }
    else if(c==='】') {if(stack.length===1)return [{text:text.trim(),children:[]}];flush();stack.pop();}
    else if(c==='→'||c==='⇒'||c==='；'||c==='\n'||(c==='-'&&text[i+1]==='>')) {flush();if(c==='-')i++;}
    else buffer+=c;
  }
  if(stack.length!==1)return [{text:text.trim(),children:[]}];flush();return root;
}

// Report edges establish relationships; token matches only locate their possible call sites.
export function buildSequence(flow, nodes, files, include = () => true) {
  const graph = buildMethodGraph(flow, nodes, files, include);
  const methods = graph.modules.map((method, order) => {
    const node = nodes[method.id], file = files[node.fileId];
    const side = node.side === 'old' || node.changeStatus === 'deleted' ? 'old' : 'new';
    const range = side === 'old' ? node.oldRange : node.newRange;
    const refs = (file.indexes?.[side]?.references || []).filter(r => range && r.line >= range[0] && r.line <= range[1]);
    const declaration = file.indexes?.[side]?.symbols.find(s => s.kind === 'method' && s.start === range?.[0]);
    const calls = graph.edges.filter(e => e.from === method.id && e.label !== '关联顺序').map(edge => {
      const target = graph.modules.find(m => m.id === edge.to);
      const sites = refs.filter(r => r.name === target?.title && !(r.line === declaration?.nameLine && r.name === node.title));
      return { ...edge, line: sites[0]?.line, siteCount: sites.length, target, newTarget: target?.status === 'added' };
    }).sort((a,b) => (a.line ?? Infinity) - (b.line ?? Infinity));
    const step = flow.journey?.steps.find(s => s.implementationIds.includes(node.id));
    const process=node.annotations.find(a=>a.process?.trim())?.process || '';
    return { ...method, process, processSteps:parseProcess(process), order, step, calls, refs, side, range, branches: node.annotations.flatMap(a => a.branches || []), annotations: node.annotations, objects: [] };
  });
  const unattached = [];
  const ids = [...new Set(flow.chains.flatMap(c => c.nodeIds))];
  for (const id of ids) {
    const n = nodes[id], f = n && files[n.fileId];
    if (!f || !include(id) || n.rangeKind === 'method' || !f.changed) continue;
    const symbols = f.indexes?.[n.side === 'old' ? 'old' : 'new']?.symbols || [];
    const dataObject = /(?:DTO|DO|VO|BO|Request|Response|Detail|Item|Config|Result|Query|Input)\.java$/i.test(f.path) || (symbols.some(s => s.kind === 'field') && !symbols.some(s => s.kind === 'method'));
    if (!dataObject) continue;
    const name = f.path.split('/').at(-1).replace(/\.java$/,'');
    const matches = methods.flatMap(m => m.refs.filter(r => r.name === name).map(r => ({ method:m,line:r.line })));
    // A simple name is not proof of type binding; attach only an unambiguous project-local candidate.
    const ambiguous = Object.values(files).filter(other => other.project === f.project && other.path.split('/').at(-1) === `${name}.java`).length > 1;
    const sameProject = matches.filter(hit => hit.method.project === f.project).sort((a,b) => a.method.order-b.method.order || a.line-b.line);
    const first = !ambiguous && sameProject[0];
    const object = { id, fileId:f.id, name, project:f.project, line:first?.line, reason:n.annotations[0]?.behavior || n.annotations[0]?.why || '查看字段差异', status:n.changeStatus || (f.statuses.new === 'missing' ? 'deleted' : f.statuses.old === 'missing' ? 'added' : 'modified'), evidence:'快照内首次同名类型出现；词法匹配，非语义绑定，非运行时首次使用' };
    if (first) {
      if (!first.method.objects.some(o => o.fileId === f.id)) first.method.objects.push(object);
    } else if (!unattached.some(o => o.fileId === f.id)) unattached.push(object);
  }
  const contextIds=ids.filter(id=>nodes[id] && include(id) && nodes[id].rangeKind!=='method');
  return { methods, projects:[...new Set(methods.map(m=>m.project))], edges:graph.edges, unattached, contextIds };
}
