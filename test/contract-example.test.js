import test from 'node:test';import assert from 'node:assert/strict';import {responseType,dtoExample,buildDtoExample} from '../lib/review/contract-example.js';
test('Void and explicit payload types remain distinct',()=>{assert.equal(responseType('public RestResponseVO<Void> sync() {return null;}','sync').void,true);assert.equal(responseType('public RestResponseVO<MyResult> read() {}','read').name,'MyResult');assert.equal(responseType('// public RestResponseVO<Wrong> read() {}','read'),undefined);});
test('DTO shape is limited to direct fields and excludes static and unsupported serialization',()=>{assert.deepEqual(dtoExample('class Result {private static final long serialVersionUID=1L;private Long id;private List<String> names;private Nested nested;}').value,{id:1,names:[],nested:null});assert.equal(dtoExample('@JsonProperty("other") private String name;'),undefined);});

const source=(name,text)=>({id:name,name,text});
const resolver=types=>async name=>types[name];
test('recursive DTO shapes expand nested lists, maps, arrays and repeated sibling types',async()=>{
 const child=source('Child','class Child {private String name;}');
 const root=source('Root','class Root {private Child first;private Child second;private List<Child> items;private Map<String, Child> mapping;private Child[] array;}');
 const r=await buildDtoExample(root,resolver({Child:child}));
 assert.deepEqual(r.value,{first:{name:'示例值'},second:{name:'示例值'},items:[{name:'示例值'}],mapping:{'示例键':{name:'示例值'}},array:[{name:'示例值'}]});assert.equal(r.notes.length,0);
});
test('self and mutual cycles terminate on the active path, with a field-specific explanation',async()=>{
 const a=source('A','class A {private A self;private List<B> children;}'),b=source('B','class B {private A parent;}');
 const r=await buildDtoExample(a,resolver({A:a,B:b}));
 assert.deepEqual(r.value,{self:null,children:[{parent:null}]});assert.equal(r.notes.length,2);assert.ok(r.notes.every(n=>n.reason.includes('循环引用')));
});
test('depth, resolver and field budgets are independently bounded',async()=>{
 const a=source('A','class A {private B child;private String name;}'),b=source('B','class B {private C child;}'),c=source('C','class C {private String value;}');
 const deep=await buildDtoExample(a,resolver({B:b,C:c}),{maxDepth:1});assert.ok(deep.notes.some(n=>n.reason.includes('深度')));
 const types=await buildDtoExample(a,resolver({B:b,C:c}),{maxTypes:1});assert.ok(types.notes.some(n=>n.reason.includes('类型解析')));
 const fields=await buildDtoExample(a,resolver({B:b,C:c}),{maxFields:1});assert.ok(fields.notes.some(n=>n.reason.includes('字段总数')));
});
test('generic inherited fields bind to actual nested types; ambiguous and custom serialized types stop safely',async()=>{
 const root={...source('Child','class Child extends Base<Item> {private String label;}'),type:'Child'};
 const base=source('Base','class Base<T> {protected List<T> rows;}'),item=source('Item','class Item {private Long id;}');
 const result=await buildDtoExample(root,resolver({Base:base,Item:item}));assert.deepEqual(result.value,{rows:[{id:1}],label:'示例值'});
 const custom=await buildDtoExample(source('Custom','@JsonNaming(My.class) class Custom {private String name;}'),resolver({}));assert.equal(custom.value,null);assert.match(custom.notes[0].reason,/序列化/);
});
