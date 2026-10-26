// Layer methods left-to-right inside project containers. Condense local cycles
// before assigning ranks so recursive/back-reference edges cannot inflate layout.
export function layoutMethodGraph(graph, { nodeWidth = 300, nodeHeight = 220, columnGap = 110, rowGap = 65 } = {}) {
  const projects = [...new Set(graph.modules.map(n => n.group || n.project))];
  const positions = {}, groups = [];
  let offsetX = 20;
  for (const project of projects) {
    const methods = graph.modules.filter(n => (n.group || n.project) === project), ids = new Set(methods.map(n => n.id));
    const adjacency = new Map(methods.map(n => [n.id, []]));
    for (const e of graph.edges) if (ids.has(e.from) && ids.has(e.to)) adjacency.get(e.from).push(e.to);
    let index = 0; const indexes = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
    function visit(id) {
      indexes.set(id,index);low.set(id,index++);stack.push(id);onStack.add(id);
      for (const next of adjacency.get(id)) {
        if (!indexes.has(next)) {visit(next);low.set(id,Math.min(low.get(id),low.get(next)));}
        else if(onStack.has(next))low.set(id,Math.min(low.get(id),indexes.get(next)));
      }
      if(low.get(id)===indexes.get(id)){const group=[];let item;do{item=stack.pop();onStack.delete(item);group.push(item);}while(item!==id);components.push(group);}
    }
    for(const n of methods)if(!indexes.has(n.id))visit(n.id);
    const componentOf = new Map();components.forEach((c,i)=>c.forEach(id=>componentOf.set(id,i)));
    const ranks=components.map(()=>0), incoming=components.map(()=>0), outgoing=components.map(()=>new Set());
    for(const e of graph.edges)if(ids.has(e.from)&&ids.has(e.to)){const a=componentOf.get(e.from),b=componentOf.get(e.to);if(a!==b&&!outgoing[a].has(b)){outgoing[a].add(b);incoming[b]++;}}
    const ready=incoming.map((count,i)=>count===0?i:-1).filter(i=>i>=0);
    for(let at=0;at<ready.length;at++){const a=ready[at];for(const b of outgoing[a]){ranks[b]=Math.max(ranks[b],ranks[a]+1);if(--incoming[b]===0)ready.push(b);}}
    const incomingSources=graph.edges.filter(e=>ids.has(e.to)&&!ids.has(e.from)&&positions[e.from]).map(e=>positions[e.from].y);
    const baseY=incomingSources.length ? Math.max(75,Math.min(...incomingSources)) : 75;
    const rows = new Map(), assignedRows = new Map();
    for(let rank=0;rank<=Math.max(0,...ranks);rank++){
      const occupied=new Set();
      for(const n of methods.filter(n=>ranks[componentOf.get(n.id)]===rank)){
        const parentRows=graph.edges.filter(e=>e.to===n.id&&assignedRows.has(e.from)).map(e=>assignedRows.get(e.from));
        let row=parentRows.length ? Math.round(parentRows.reduce((a,b)=>a+b,0)/parentRows.length) : 0;
        while(occupied.has(row))row++;occupied.add(row);assignedRows.set(n.id,row);rows.set(rank,Math.max(rows.get(rank)||0,row+1));
        positions[n.id]={x:offsetX+25+rank*(nodeWidth+columnGap),y:baseY+row*(nodeHeight+rowGap),width:nodeWidth,height:nodeHeight};
      }
    }
    const width=(Math.max(0,...ranks)+1)*nodeWidth+Math.max(0,...ranks)*columnGap+50;
    const height=100+Math.max(1,...rows.values())*(nodeHeight+rowGap)-rowGap;
    groups.push({project,x:offsetX,y:baseY-55,width,height});offsetX+=width+95;
  }
  return {positions,groups,width:Math.max(360,offsetX-75),height:Math.max(300,...groups.map(g=>g.y+g.height+20))};
}
