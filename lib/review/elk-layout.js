let enginePromise;
async function engine() {
  enginePromise ||= import('elkjs/lib/elk.bundled.js').then(({default:ELK})=>new ELK());
  return enginePromise;
}

export function createElkGraph(nodes,edges) {
 const ids=new Set(nodes.map(n=>n.id));
 const isEntry=n=>n.id==='boundary:entry'||n.id.startsWith('boundary:entry:');
 const isResult=n=>n.id==='boundary:result'||n.id.startsWith('boundary:result:');
 const projects=[...new Set(nodes.filter(n=>!isEntry(n)&&!isResult(n)).map(n=>n.project))];
 const children=nodes.map(n=>{
  const width=n.width||400,height=n.height||260;
  const ports=[{id:`${n.id}::in`,width:1,height:1,x:0,y:Math.min(30,height),layoutOptions:{'elk.port.side':'WEST'}}];
  for(const p of n.ports||[])ports.push({id:`${n.id}::${p.id}`,width:1,height:1,x:width,y:Math.max(1,Math.min(height-1,p.y)),layoutOptions:{'elk.port.side':'EAST'}});
  return {id:n.id,width,height,ports,layoutOptions:{'elk.portConstraints':'FIXED_POS','elk.partitioning.partition':String(isEntry(n)?0:isResult(n)?projects.length+1:projects.indexOf(n.project)+1),...(isEntry(n)?{'elk.layered.layering.layerConstraint':'FIRST_SEPARATE'}:isResult(n)?{'elk.layered.layering.layerConstraint':'LAST_SEPARATE'}:{})}};
 });
 const ports=new Set(children.flatMap(n=>n.ports.map(p=>p.id)));
 const elkEdges=edges.map(e=>{
  if(!ids.has(e.source)||!ids.has(e.target)||!ports.has(`${e.source}::${e.sourceHandle}`))throw new Error(`布局引用缺少节点或连接点：${e.id}`);
  return {id:e.id,sources:[`${e.source}::${e.sourceHandle}`],targets:[`${e.target}::in`]};
 });
 return {id:'review',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'65','elk.layered.spacing.nodeNodeBetweenLayers':'150','elk.padding':'[top=60,left=50,bottom=50,right=50]','elk.partitioning.activate':'true','elk.layered.considerModelOrder.strategy':'NONE','elk.layered.nodePlacement.bk.fixedAlignment':'LEFTUP','elk.randomSeed':'7'},children,edges:elkEdges};
}

export async function layoutReviewGraph(nodes,edges) {
 if(!nodes.length)return {nodes:[],routes:{}};
 const result=await (await engine()).layout(createElkGraph(nodes,edges));
 const positions=(result.children||[]).map(n=>{
  if(!Number.isFinite(n.x)||!Number.isFinite(n.y))throw new Error(`ELK 没有返回有效坐标：${n.id}`);
  return {id:n.id,x:n.x,y:n.y,width:n.width,height:n.height};
 });
 const routes=Object.fromEntries((result.edges||[]).filter(e=>e.sections?.length).map(e=>[e.id,e.sections.flatMap(s=>[s.startPoint,...(s.bendPoints||[]),s.endPoint])]));
 return {nodes:positions,routes};
}

/** Locate labels halfway along the rendered polyline, never at its final vertex. */
export function routeMidpoint(points) {
 if(!points?.length)return undefined;
 const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));
 let remaining=lengths.reduce((sum,length)=>sum+length,0)/2;
 for(let i=0;i<lengths.length;i++){
  const length=lengths[i];
  if(length>0&&remaining<=length){const ratio=remaining/length;return {x:points[i].x+(points[i+1].x-points[i].x)*ratio,y:points[i].y+(points[i+1].y-points[i].y)*ratio};}
  remaining-=length;
 }
 return points[0];
}
