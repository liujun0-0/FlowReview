import test from 'node:test';
import assert from 'node:assert/strict';
import {bindProcessCalls,splitProcessReferences} from '../lib/review/sequence-canvas.js';
test('process binding covers nested calls and method references once without a duplicate list',()=>{const calls=[{target:{title:'sync',owner:'Service.java'}},{target:{title:'fetchPage',owner:'Meta.java'}}];const r=bindProcessCalls([{text:'提交 service::sync',children:[]},{text:'循环',children:[{text:'调用 Meta.fetchPage(lang)',children:[]},{text:'再调用 fetchPage(lang)',children:[]}]}],calls);assert.deepEqual(r.bindings,{'0':[0],'1.0':[1]});assert.deepEqual(r.unbound,[]);});
test('ambiguous names remain unresolved unless the owner is explicit',()=>{const calls=[{target:{title:'save',owner:'A.java'}},{target:{title:'save',owner:'B.java'}}];const r=bindProcessCalls([{text:'save(x)',children:[]},{text:'A.save(x)',children:[]}],calls);assert.deepEqual(r.bindings,{'1':[0]});assert.deepEqual(r.unbound,[1]);});
test('multiple references replace their original names without repeating or losing process text',()=>{const text='按开关调用 A.filter(x)、B.check(x)，命中则跳过';const calls=[{target:{title:'filter',owner:'A.java'}},{target:{title:'check',owner:'B.java'}}];const r=splitProcessReferences(text,[0,1],calls);assert.equal(r.map(p=>p.text).join(''),text);assert.deepEqual(r.filter(p=>p.index!==undefined).map(p=>p.text),['A.filter','B.check']);});


async function functionFixture() {
 const {buildFunctionCanvas}=await import('../lib/review/function-canvas.js');
 const file=(id,project)=>({id,project,path:`${id}.java`,changed:id==='a',statuses:{old:'text',new:'text'},indexes:{new:{symbols:[],references:[]}}});
 const files={a:file('a','api'),b:file('b','core'),outside:file('outside','other')};
 const node=(id,status)=>({id,fileId:id,title:id,rangeKind:'method',range:[1,5],newRange:[1,5],oldRange:[1,5],side:'new',changeStatus:status,annotations:[{process:id==='a'?'执行 b()':'返回结果',role:'读取数据'}]});
 const nodes={a:node('a','modified'),b:node('b','unchanged'),outside:node('outside','added')};
 const step=(id,project,implementationIds,status)=>({id,title:id,project,implementationIds,branches:['失败：停止处理'],tables:project==='core'?['records']:[],downstreams:[],change:{status,after:'增加校验'}});
 const flow={id:'feature',chains:[{nodeIds:['a','b'],links:[{from:'a',to:'b',label:'HTTP',confidence:'确定',evidence:'Api.java:3'}]}],journey:{source:{actor:'用户',entry:'POST /read',input:'id',outcome:'返回数据'},coverage:{status:'静态核对'},steps:[step('receive','api',['a'],'modified'),step('save','core',['b'],'unchanged')],links:[{from:'receive',to:'save',label:'校验成功',confidence:'确定',evidence:'Api.java:3'}]}};
 return {buildFunctionCanvas,flow,nodes,files};
}
test('functional canvas defaults to this function’s project summaries, entrance and outcome',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();
 const model=buildFunctionCanvas(flow,nodes,files);
 assert.equal(model.items.filter(n=>n.kind==='method').length,0);
 assert.deepEqual(model.items.filter(n=>n.kind==='summary').map(n=>n.project),['api','core']);
 assert.equal(model.items.find(n=>n.id==='boundary:entry').endpoint,'POST /read');
 assert.equal(model.items.find(n=>n.id==='boundary:result').description,'返回数据');
 assert.equal(model.items.find(n=>n.project==='api').firstChange,'receive');
 assert.ok(!model.items.some(n=>n.project==='other'));
 assert.ok(model.edges.some(e=>e.source==='summary:api'&&e.target==='summary:core'&&e.kind==='business'));
});
test('project expansion connects method-step ports to collapsed or expanded downstreams without inventing calls',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();
 const one=buildFunctionCanvas(flow,nodes,files,new Set(['api']));
 const edge=one.edges.find(e=>e.kind==='call');
 assert.equal(edge.source,'a');assert.equal(edge.sourceHandle,'call:0');assert.equal(edge.target,'summary:core');
 assert.equal(one.edges.filter(e=>e.kind==='implementation').length,0);
 const both=buildFunctionCanvas(flow,nodes,files,new Set(['api','core']));
 assert.equal(both.edges.find(e=>e.kind==='call').target,'b');
 assert.ok(both.items.find(n=>n.id==='b').method.status==='unchanged');
 const filtered=buildFunctionCanvas(flow,nodes,files,new Set(['api','core']),id=>id!=='b');
 assert.ok(!filtered.items.some(n=>n.id==='b'));assert.ok(filtered.items.some(n=>n.id==='summary:core'));
 assert.ok(!filtered.edges.some(e=>e.kind==='call'));
});
test('incomplete legacy reports do not fabricate entry-to-result execution edges',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();delete flow.journey;flow.chains[0].links=[];
 const model=buildFunctionCanvas(flow,nodes,files,new Set(['api','core']));
 assert.equal(model.items.find(n=>n.id==='boundary:entry').endpoint,'未定位入口，请补充报告');
 assert.ok(!model.edges.some(e=>e.kind==='call'||e.kind==='boundary'||e.kind==='business'));
});


test('object reference colors describe the object change while candidate edges remain uncertain', async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();
 const {objectReferenceColor}=await import('../lib/review/function-canvas.js');
 files.dto={...files.a,id:'dto',path:'ItemDTO.java',indexes:{new:{symbols:[],references:[]}}};
 files.a.indexes.new.references.push({name:'ItemDTO',line:2});
 nodes.dto={id:'dto',fileId:'dto',title:'ItemDTO',rangeKind:'class',side:'new',range:[1,3],changeStatus:'added',annotations:[]};
 flow.chains[0].nodeIds.push('dto');
 for(const status of ['added','modified','deleted']){
  nodes.dto.changeStatus=status;
  const edge=buildFunctionCanvas(flow,nodes,files,new Set(['api'])).edges.find(e=>e.kind==='object');
  assert.equal(edge.changeStatus,status);assert.equal(edge.confirmed,false);
 }
 assert.equal(new Set(['added','modified','deleted'].map(objectReferenceColor)).size,3);
});
test('entry status uses the matching HTTP method instead of changed downstream steps',async()=>{
 const {entryChangeStatus}=await import('../lib/review/function-canvas.js');
 const methods=[{project:'api',status:'unchanged',endpoint:{method:'POST',path:'/read'}},{project:'core',status:'added',endpoint:{method:'POST',path:'/save'}}];
 assert.equal(entryChangeStatus('POST /read',methods,[{project:'api',change:{status:'added'}}]),'unchanged');
 assert.equal(entryChangeStatus('POST /save',methods),'added');
 assert.equal(entryChangeStatus('DELETE /read',methods),'unknown');
 assert.equal(entryChangeStatus('POST /missing',methods),'unknown');
 assert.equal(entryChangeStatus(undefined,methods),'unknown');
 methods[0].status='deleted';assert.equal(entryChangeStatus('POST /read',methods),'deleted');
});

test('overview uses one relationship layer and expands into precise calls without containment arrows',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();
 const overview=buildFunctionCanvas(flow,nodes,files);
 assert.equal(overview.edges.filter(e=>e.source==='summary:api'&&e.target==='summary:core').length,1);
 assert.equal(overview.edges.find(e=>e.source==='summary:api'&&e.target==='summary:core').kind,'business');
 const expanded=buildFunctionCanvas(flow,nodes,files,new Set(['api','core']));
 assert.equal(expanded.edges.filter(e=>e.kind==='implementation'||e.kind==='business').length,0);
 assert.ok(expanded.edges.some(e=>e.kind==='call'&&e.source==='a'&&e.target==='b'));
});
test('legacy steps without links do not create a direct entry and exit for every project',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();flow.journey.links=[];
 const graph=buildFunctionCanvas(flow,nodes,files);
 const entryEdges=graph.edges.filter(e=>e.source==='boundary:entry');
 assert.deepEqual(entryEdges.map(e=>e.target),['summary:api']);
 assert.deepEqual(graph.edges.filter(e=>e.target==='boundary:result').map(e=>e.source),['summary:core']);
 assert.ok(!graph.edges.some(e=>e.source==='boundary:entry'&&e.target==='summary:core'));
});
test('independent unconnected steps stay unconnected and real branch conditions remain separate',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await functionFixture();
 flow.journey.steps.push({...flow.journey.steps[1],id:'unknown',project:'unverified',implementationIds:[]});
 flow.journey.links.push({...flow.journey.links[0],label:'校验失败的另一条路径'});
 const model=buildFunctionCanvas(flow,nodes,files);
 assert.ok(!model.edges.some(e=>e.source==='boundary:entry'&&e.target==='summary:unverified'));
 assert.equal(model.edges.filter(e=>e.kind==='business').length,2);
});

async function multiFixture(){
 const f=await functionFixture();
 f.nodes.c={...f.nodes.a,id:'c',title:'c'};
 f.nodes.a.endpoint={method:'GET',path:'/one',evidence:'A.java:1'};
 f.nodes.c.endpoint={method:'POST',path:'/two',evidence:'A.java:2'};
 f.flow.chains[0].nodeIds.push('c');
 f.flow.chains[0].links.push({from:'c',to:'b',label:'调用 b',confidence:'确定',evidence:'A.java:3'});
 f.flow.journey.entries=[{id:'one',title:'读取',implementationId:'a',entry:'GET /one',purpose:'读取信息',input:'id',outcome:'第一接口结果',evidence:'A.java:1'},{id:'two',title:'创建',implementationId:'c',entry:'POST /two',purpose:'创建信息',input:'body',outcome:'第二接口结果',evidence:'A.java:2'}];
 return f;
}
test('multiple entry chains share downstream once and keep independent boundaries',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await multiFixture();
 const graph=buildFunctionCanvas(flow,nodes,files);
 assert.equal(graph.items.filter(n=>n.kind==='boundary').length,4);
 assert.equal(graph.items.filter(n=>n.id==='method-summary:b').length,1);
 assert.equal(graph.edges.filter(e=>e.target==='method-summary:b').length,2);
 assert.match(graph.items.find(n=>n.id==='method-summary:b').detail,/公共下游/);
 assert.equal(graph.items.find(n=>n.id==='boundary:result:two').description,'第二接口结果');
 assert.equal(flow.chains.length,1);
});
test('entry filtering excludes sibling path but retains shared methods and exact expanded ports',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await multiFixture();
 const graph=buildFunctionCanvas(flow,nodes,files,new Set(['api','core']),()=>true,'one');
 assert.deepEqual(graph.sequence.methods.map(m=>m.id),['a','b']);
 assert.ok(!graph.items.some(n=>n.entryId==='two'));
 assert.equal(graph.edges.find(e=>e.source==='a'&&e.target==='b').sourceHandle,'call:0');
 assert.ok(graph.edges.some(e=>e.source==='a'&&e.target==='boundary:result:one'&&e.sourceHandle==='out'));
});
test('legacy endpoints split by actual method anchors without inventing results or unverified reachability',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await multiFixture();delete flow.journey.entries;
 flow.chains[0].links[1].confidence='猜';
 const graph=buildFunctionCanvas(flow,nodes,files,new Set(),()=>true,'c');
 assert.deepEqual(graph.sequence.methods.map(m=>m.id),['c']);
 assert.ok(graph.items.some(n=>n.id==='unlinked:b'));
 assert.ok(!graph.edges.some(e=>e.target.startsWith('unlinked:')));
 assert.ok(!graph.edges.some(e=>e.target.startsWith('boundary:result:')));
 assert.match(graph.items.find(n=>n.id==='boundary:result:c').description,/尚未/);
});
test('cycles remain finite and hidden entry methods do not create dangling edges',async()=>{
 const {buildFunctionCanvas,flow,nodes,files}=await multiFixture();
 flow.chains[0].links.push({from:'b',to:'a',label:'回调',confidence:'确定',evidence:'B.java:3'});
 const graph=buildFunctionCanvas(flow,nodes,files,new Set(),id=>id!=='c');
 assert.equal(graph.sequence.methods.length,2);
 const ids=new Set(graph.items.map(n=>n.id));
 assert.ok(graph.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
});
