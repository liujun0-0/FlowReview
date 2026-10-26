import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutMethodGraph} from '../lib/review/flow-layout.js';

test('forks flow left-to-right, branches stay parallel and cross-project continuation aligns',()=>{
 const graph={modules:[{id:'a',project:'A'},{id:'c',project:'A'},{id:'b',project:'A'},{id:'d',project:'A'},{id:'e',project:'B'}],edges:[{from:'a',to:'c'},{from:'a',to:'b'},{from:'b',to:'d'},{from:'d',to:'e'}]};
 const {positions:p,groups}=layoutMethodGraph(graph);
 assert.ok(p.a.x<p.b.x);assert.equal(p.b.x,p.c.x);assert.notEqual(p.b.y,p.c.y);
 assert.ok(p.d.x>p.b.x);assert.equal(p.d.y,p.b.y);assert.ok(p.e.x>p.d.x);assert.equal(p.e.y,p.d.y);
 for(const node of graph.modules){const group=groups.find(g=>g.project===node.project),pos=p[node.id];assert.ok(pos.x>=group.x&&pos.x+pos.width<=group.x+group.width);assert.ok(pos.y>=group.y&&pos.y+pos.height<=group.y+group.height);}
});

test('cycles, disconnected methods and single nodes have finite non-overlapping layout',()=>{
 const graph={modules:['a','b','c','d'].map(id=>({id,project:'A'})),edges:[{from:'a',to:'b'},{from:'b',to:'a'},{from:'b',to:'c'}]};
 const layout=layoutMethodGraph(graph);assert.ok(Number.isFinite(layout.width)&&Number.isFinite(layout.height));
 const positions=Object.values(layout.positions);
 for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){const a=positions[i],b=positions[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
 assert.ok(layoutMethodGraph({modules:[],edges:[]}).width>0);
});
