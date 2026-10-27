import test from 'node:test';
import assert from 'node:assert/strict';
import {createElkGraph,layoutReviewGraph,routeMidpoint} from '../lib/review/elk-layout.js';
test('ELK receives distinct fixed ports for process references and preserves measured heights',()=>{const g=createElkGraph([{id:'m',project:'api',width:400,height:1400,ports:[{id:'call:0',y:300},{id:'call:1',y:1050}]}],[]);assert.equal(g.children[0].height,1400);assert.equal(g.children[0].ports[2].y,1050);assert.equal(g.children[0].layoutOptions['elk.portConstraints'],'FIXED_POS');});
test('missing ports or targets cannot silently produce a plausible graph',()=>{assert.throws(()=>createElkGraph([{id:'a',project:'api',width:400,height:300,ports:[]}],[{id:'e',source:'a',target:'a',sourceHandle:'missing'}]),/连接点/);});
test('real ELK lays out cycles, branches, objects and projects without overlapping nodes',async()=>{const nodes=[{id:'a',project:'api',width:400,height:1200,ports:[{id:'b',y:300},{id:'c',y:950},{id:'o',y:80}]},{id:'b',project:'api',width:400,height:260,ports:[{id:'a',y:100}]},{id:'c',project:'core',width:400,height:400,ports:[]},{id:'o',project:'api',width:285,height:240,ports:[]}];const edges=[['a','b','b'],['a','c','c'],['a','o','o'],['b','a','a']].map(([source,target,sourceHandle],i)=>({id:String(i),source,target,sourceHandle}));const result=await layoutReviewGraph(nodes,edges),r=result.nodes;assert.equal(r.length,4);for(const a of r)for(const b of r){if(a.id===b.id)continue;assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id}/${b.id}`);}assert.equal(Object.keys(result.routes).length,4);assert.ok(Object.values(result.routes).every(points=>points.length>=2&&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));assert.deepEqual(await layoutReviewGraph([],[]),{nodes:[],routes:{}});});

test('edge labels use distance midpoint for straight, bent and degenerate routes',()=>{
 assert.deepEqual(routeMidpoint([{x:0,y:0},{x:150,y:0}]),{x:75,y:0});
 assert.deepEqual(routeMidpoint([{x:0,y:0},{x:20,y:0},{x:20,y:100},{x:40,y:100}]),{x:20,y:50});
 assert.deepEqual(routeMidpoint([{x:10,y:10},{x:10,y:10}]),{x:10,y:10});
 assert.equal(routeMidpoint([]),undefined);
});
