import {test} from 'node:test';
import assert from 'node:assert/strict';
import {literalEndpoint,methodChangeStatus} from '../lib/review/method-metadata.js';
import {indexJava} from '../lib/review/snapshot.js';

test('literal endpoints combine class and method paths without borrowing another method mapping',()=>{
 const code='@RequestMapping("/customer")\nclass CustomerController {\n @PostMapping("/import/new")\n public void create() {}\n @GetMapping("/status")\n public void status() {}\n public void helper() {}\n}';
 const {symbols}=indexJava(code,'f','new');
 assert.equal(literalEndpoint(code,symbols.find(s=>s.name==='create'),symbols).path,'/customer/import/new');
 assert.equal(literalEndpoint(code,symbols.find(s=>s.name==='status'),symbols).method,'GET');
 assert.equal(literalEndpoint(code,symbols.find(s=>s.name==='helper'),symbols),undefined);
});

test('unchanged methods in changed files remain unchanged, CRLF does not create a modification',()=>{
 const node={oldRange:[1,2],newRange:[1,2],annotations:[{type:'改实现'}],relatedOnly:false};
 assert.equal(methodChangeStatus(node,{changed:true},{old:{status:'text',text:'void a() {\n}\n'},new:{status:'text',text:'void a() {\r\n}\r\n'}}),'unchanged');
 assert.equal(methodChangeStatus(node,{changed:true},{old:{status:'text',text:'old\n}'},new:{status:'text',text:'new\n}'}}),'modified');
});
