// Literal POM structure only: no effective-POM, profile activation or external resolution.
export function parsePom(text) {
 const root={name:'',text:'',children:[]},stack=[root];
 for(const token of text.replace(/<!--[\s\S]*?-->/g,'').match(/<[^>]*>|[^<]+/g)||[]){
  if(token.startsWith('<?')||token.startsWith('<!'))continue;
  if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}
  if(token.startsWith('<')){const name=token.match(/^<([^\s/>]+)/)?.[1].split(':').at(-1);const child={name,text:'',children:[]};stack.at(-1).children.push(child);if(!token.endsWith('/>'))stack.push(child);}
  else stack.at(-1).text+=token;
 }
 const project=root.children.find(n=>n.name==='project');if(!project)throw new Error('不是可识别的 POM');
 const child=(n,key)=>n?.children.find(c=>c.name===key),value=(n,key)=>child(n,key)?.text.trim()||'';
 const parent=child(project,'parent'),properties=Object.fromEntries((child(project,'properties')?.children||[]).map(n=>[n.name,n.text.trim()]));
 const group=value(project,'groupId')||value(parent,'groupId'),artifact=value(project,'artifactId'),version=value(project,'version')||value(parent,'version');
 const vars={...properties,'project.version':version,'pom.version':version,'project.groupId':group};
 const resolve=(v,depth=0)=>depth>8?v:v.replace(/\$\{([^}]+)\}/g,(all,key)=>vars[key]&&vars[key]!==all?resolve(vars[key],depth+1):all);
 const coordinate=n=>({group:resolve(value(n,'groupId')),artifact:value(n,'artifactId'),version:resolve(value(n,'version'))});
 const dependencies=(n,kind)=>(child(n,'dependencies')?.children||[]).filter(n=>n.name==='dependency').map(n=>({...coordinate(n),kind}));
 return {group:resolve(group),artifact,version:resolve(version),properties,parent:parent?coordinate(parent):undefined,dependencies:[...dependencies(project,'dependency'),...dependencies(child(project,'dependencyManagement'),'management')]};
}
export function buildDependencyGraph(records){
 const parsed=records.map(r=>({...r,before:parsePom(r.old||'<project/>'),after:parsePom(r.new||'<project/>')}));
 const edges=[];
 for(const record of parsed){
  for(const [kind,deps] of [['parent',record.after.parent?[record.after.parent]:[]],['dependency',record.after.dependencies]])for(const d of deps){
   const targets=parsed.filter(t=>t.id!==record.id&&t.after.artifact===d.artifact&&t.after.group===d.group);
   if(targets.length!==1)continue;
   const before=(kind==='parent'?[record.before.parent]:record.before.dependencies).find(p=>p&&p.group===d.group&&p.artifact===d.artifact&&(kind==='parent'||p.kind===d.kind));
   edges.push({id:`${record.id}:${targets[0].id}:${kind}:${d.kind||''}`,source:record.id,target:targets[0].id,kind:kind==='parent'?'parent':d.kind,before:before?.version||'未声明',after:d.version||'版本由外部管理'});
  }
 }
 return {nodes:parsed,edges};
}
