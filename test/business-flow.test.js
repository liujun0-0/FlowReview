import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveBusinessFlow,buildBusinessGraph} from '../lib/review/business-flow.js';
const source={actor:'客户端',entry:'POST /import',purpose:'导入客户',input:'文件',outcome:'客户与结果'};
const step=(id,ref,status='unchanged')=>({id,title:`业务步骤 ${id}`,project:'api',layer:'业务层',purpose:'校验并处理输入',input:'数据',output:'结果',process:'解析并校验',branches:[],tables:[],downstreams:[],evidence:['A.java:10'],implementationIds:[ref],change:{status,before:'旧行为',after:'新行为',reason:'需求',impact:[]}});

test('business flow preserves unchanged backbone and maps multiple implementations without replacing business titles',()=>{
 const journey=resolveBusinessFlow({source,coverage:{status:'partial',boundaries:[]},steps:[step('entry','h1'),{...step('validate','h2','modified'),implementationIds:['h2','h3']}],links:[{from:'entry',to:'validate',label:'通过后处理',confidence:'确定',evidence:'源码'}]},new Map([['h1','n1'],['h2','n2'],['h3','n3']]));
 const nodes={n1:{fileId:'a',title:'controller'},n2:{fileId:'b',title:'check'},n3:{fileId:'b',title:'parse'}};
 const files={a:{id:'a',project:'api',path:'A.java'},b:{id:'b',project:'api',path:'B.java'}};
 const graph=buildBusinessGraph(journey,nodes,files);
 assert.equal(graph.modules.length,2);assert.equal(graph.modules[0].status,'unchanged');assert.equal(graph.modules[1].title,'业务步骤 validate');assert.deepEqual(graph.modules[1].nodeIds,['n2','n3']);assert.equal(graph.edges[0].confirmed,true);
 const filtered=buildBusinessGraph(journey,nodes,files,id=>id==='n1');assert.equal(filtered.modules.length,1);assert.equal(filtered.edges.length,0);
});

test('unknown implementations, duplicate step ids and broken business edges cannot silently form a complete flow',()=>{
 const base={source,steps:[step('entry','h1')],links:[]};
 assert.throws(()=>resolveBusinessFlow(base,new Map()),/未知实现/);
 assert.throws(()=>resolveBusinessFlow({...base,steps:[step('entry','h1'),step('entry','h1')]},new Map([['h1','n1']])),/重复/);
 assert.throws(()=>resolveBusinessFlow({...base,links:[{from:'entry',to:'missing'}]},new Map([['h1','n1']])),/未知步骤/);
 assert.throws(()=>resolveBusinessFlow({...base,steps:[{...step('entry','h1','modified'),change:{status:'modified'}}]},new Map([['h1','n1']])),/前后行为/);
});
