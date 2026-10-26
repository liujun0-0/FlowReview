import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowGraph, moduleStatus } from '../lib/review/flow-graph.js';
const file = (id, project = 'api', changed = true) => ({ id, project, path: `${id}.java`, changed, statuses: { old: 'text', new: 'text' } });
const files = { a: file('a'), b: file('b', 'core', false), c: { ...file('c'), statuses: { old: 'missing', new: 'text' } } };
const nodes = { a1: { fileId: 'a' }, a2: { fileId: 'a' }, b1: { fileId: 'b' }, c1: { fileId: 'c' } };

test('graph merges methods into modules, preserves app boundaries and marks inferred links uncertain', () => {
 const graph = buildFlowGraph({ chains: [{ nodeIds: ['a1','a2','b1','a1','c1'] }] }, nodes, files);
 assert.equal(graph.modules.length, 3); assert.deepEqual(graph.modules[0].nodeIds, ['a1','a2']);
 assert.equal(graph.modules[1].project, 'core'); assert.equal(graph.modules[1].status, 'unchanged');
 assert.ok(graph.edges.every(e => !e.confirmed && e.from !== e.to));
 assert.ok(graph.edges.some(e => e.from === 'b' && e.to === 'a'));
});

test('evidence is required for solid edges; filtering removes modules and relation endpoints', () => {
 const flow = { chains: [{ nodeIds: ['a1','b1','c1'], links: [{ from:'a1',to:'b1',confidence:'确定' },{ from:'b1',to:'c1',confidence:'确定',evidence:'verified source' }] }] };
 const graph=buildFlowGraph(flow,nodes,files);
 assert.equal(graph.edges[0].confirmed,false); assert.equal(graph.edges[1].confirmed,true);
 const filtered=buildFlowGraph(flow,nodes,files,id=>id!=='c1');
 assert.equal(filtered.modules.length,2); assert.equal(filtered.edges.length,1);
});

test('added, deleted and unreadable files retain distinct graph statuses', () => {
 assert.equal(moduleStatus(files.c),'added');
 assert.equal(moduleStatus({...files.a,statuses:{old:'text',new:'missing'}}),'deleted');
 assert.equal(moduleStatus({...files.a,statuses:{old:'binary',new:'text'}}),'unknown');
});


test('method graph keeps same-class functions distinct and retains their reference edges', async () => {
 const {buildMethodGraph}=await import('../lib/review/flow-graph.js');
 const methodNodes={entry:{fileId:'a',title:'entry',rangeKind:'method',annotations:[{role:'API入口',process:'校验后调用新方法',behavior:'委派处理'}],endpoint:{method:'POST',path:'/customer/import/new'},changeStatus:'modified'},helper:{fileId:'a',title:'helper',rangeKind:'method',annotations:[{role:'新校验方法'}],changeStatus:'added'},field:{fileId:'a',title:'field',rangeKind:'field',annotations:[]}};
 const graph=buildMethodGraph({chains:[{nodeIds:['entry','helper','field'],links:[{from:'entry',to:'helper',confidence:'确定',evidence:'A.java:42 调用 helper'}]}]},methodNodes,files);
 assert.equal(graph.modules.length,2); assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].from,'entry');assert.equal(graph.edges[0].to,'helper');
 assert.equal(graph.modules[0].endpoint.path,'/customer/import/new');assert.equal(graph.modules[1].status,'added');
});
