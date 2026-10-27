import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { sourcePosition } from '../lib/source-viewer/pierre/position.js';
import { toGlobalLine, sourceCacheKey } from '../lib/source-viewer/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('clipped token positions retain original snapshot line numbers', () => {
  assert.equal(toGlobalLine(1, 251), 251);
  assert.equal(toGlobalLine(17, 251), 267);
  assert.equal(toGlobalLine(42), 42);
  for (const invalid of [0, -1, NaN, 1.5]) assert.throws(() => toGlobalLine(invalid, 10), RangeError);
});

test('complete files and clipped methods cannot reuse each other’s rendered contents', () => {
  const full = sourceCacheKey('snapshot:file', 'new');
  assert.notEqual(full, sourceCacheKey('snapshot:file', 'new', [55, 193]));
  assert.notEqual(full, sourceCacheKey('snapshot:file', 'old'));
  assert.notEqual(sourceCacheKey('snapshot:file', 'new', [55, 193]), sourceCacheKey('snapshot:file', 'new', [195, 199]));
  assert.equal(full, sourceCacheKey('snapshot:file', 'new'));
});

test('review modules and the public source-viewer contract do not import renderer internals', () => {
  function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
  }
  for (const path of [...files(join(root, 'src/features/review')), ...files(join(root, 'lib/review')), join(root, 'src/shared/source-viewer/types.ts')]) {
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(text, /(?:from\s*|import\s*\()['"]@pierre\//, path);
    assert.doesNotMatch(text, /from\s*['"][^'"]*source-viewer\/pierre\//, path);
  }
});

test('a different renderer can display the same source contract without changing review code', async t => {
  const vite = await createServer({ configFile: false, root, plugins: [react()], optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { SourceViewer, SourceViewerProvider } = await vite.ssrLoadModule('/src/shared/source-viewer/SourceViewer.tsx');
  const { PlainTextRenderer } = await vite.ssrLoadModule('/src/shared/source-viewer/PlainTextRenderer.tsx');
  const props = {
    document: { id: 'snapshot:method', path: 'Example.java', before: { text: '', status: 'missing' }, after: { text: 'one\ntwo\nthree\nfour', status: 'text' } },
    view: { kind: 'source', side: 'new', extent: 'range', range: [2, 3] }, theme: 'light',
    annotations: [{ id: 'inside', side: 'new', line: 2, content: createElement('p', null, 'inside explanation') }, { id: 'outside', side: 'new', line: 4, content: createElement('p', null, 'outside explanation') }],
  };
  const render = value => renderToStaticMarkup(createElement(SourceViewerProvider, { adapter: { Renderer: PlainTextRenderer } }, createElement(SourceViewer, value)));
  const clipped = render(props);
  assert.match(clipped, /2  two/);
  assert.match(clipped, /3  three/);
  assert.doesNotMatch(clipped, /4  four|outside explanation/);
  assert.match(clipped, /inside explanation/);
  const compared = render({ ...props, view: { kind: 'diff', scope: 'file', display: 'file', focus: { side: 'new', line: 2 }, layout: 'unified' } });
  assert.match(compared, /missing/);
  assert.match(compared, /4  four/);
  assert.match(compared, /outside explanation/);
});


test('full-file comparison targets explicitly identify the old or new coordinate system', () => {
  assert.equal(sourcePosition('file', 180, 'old').side, 'deletions');
  assert.equal(sourcePosition('file', 20, 'new').side, 'additions');
  assert.equal(sourcePosition('file', 180, 'old').lineNumber, 180);
});

test('full source and full diff forward inline explanations to the engine', async t => {
  const vite = await createServer({ configFile: false, root, plugins: [react()], resolve: { alias: { '@pierre/diffs/react': join(root, 'test/fixtures/pierre-react.jsx') } }, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { SourceViewer, SourceViewerProvider } = await vite.ssrLoadModule('/src/shared/source-viewer/SourceViewer.tsx');
  const props = {
    document: { id: 'fixed-file', path: 'A.java', before: { text: 'one\nold\nthree', status: 'text' }, after: { text: 'one\nnew\nthree', status: 'text' } }, theme: 'light',
    annotations: [{ id: 'old', side: 'old', line: 2, content: createElement('b', null, 'old explanation') }, { id: 'new', side: 'new', line: 2, content: createElement('b', null, 'new explanation') }],
  };
  const render = value => renderToStaticMarkup(createElement(SourceViewerProvider, null, createElement(SourceViewer, value)));
  const file = render({ ...props, view: { kind: 'source', side: 'new', extent: 'file', range: [2, 2] } });
  assert.match(file, /new explanation/); assert.doesNotMatch(file, /old explanation/);
  const view = { kind: 'diff', scope: 'file', display: 'file', focus: { side: 'old', line: 2 }, layout: 'split' };
  const diff = render({ ...props, view });
  assert.match(diff, /old explanation/); assert.match(diff, /new explanation/);
  const hidden = render({ ...props, annotations: [], view });
  assert.doesNotMatch(hidden, /old explanation|new explanation/);
});

test('continuous reading retains unchanged bridges, unimplemented steps and inline evidenced calls', async t => {
 const vite=await createServer({configFile:false,root,plugins:[react()],optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 t.after(()=>vite.close());
 const {ChainReader}=await vite.ssrLoadModule('/src/features/review/ChainReader.tsx');
 const file={id:'f',project:'api',path:'Service.java',changed:true,statuses:{old:'text',new:'text'},indexes:{new:{symbols:[],references:[{name:'save',line:3}]}}};
 const nodes={run:{id:'run',fileId:'f',title:'run',side:'new',range:[1,5],oldRange:[1,5],newRange:[1,5],rangeKind:'method',changeStatus:'modified',annotations:[{process:'检查输入 → Service.save() → 返回结果',role:'运行任务',behavior:'增加检查'}]},save:{id:'save',fileId:'f',title:'save',side:'new',range:[6,8],oldRange:[6,8],newRange:[6,8],rangeKind:'method',changeStatus:'unchanged',annotations:[{role:'保存数据'}]}};
 const step=(id,refs)=>({id,title:id,project:'api',layer:'业务',purpose:'处理任务',input:'请求',output:'结果',branches:[],tables:[],downstreams:[],implementationIds:refs,change:{status:'unchanged'}});
 const flow={id:'flow',chains:[{nodeIds:['run','save'],links:[{from:'run',to:'save',label:'调用',confidence:'确定',evidence:'Service.java:3'}]}],journey:{steps:[step('入口',['run']),step('原有保存',['save']),step('共享执行',['run']),step('未采集下游',[])],links:[]}};
 const props={flow,manifest:{nodes,files:{f:file}},include:()=>true,selected:'',reading:{marks:{}},onMark:()=>{},onOpen:()=>{},renderSource:()=>createElement('pre',null,'source'),controls:null};
 const html=renderToStaticMarkup(createElement(ChainReader,props));
 assert.match(html,/原有保存/);assert.match(html,/保存数据/);assert.match(html,/对应实现 \/ 共享方法/);assert.match(html,/展开原有源码/);assert.match(html,/此步骤没有可展示的方法/);
 assert.match(html,/class="rr-stream-inline"/);assert.match(html,/Service.java:3/);assert.doesNotMatch(html,/执行位置未定位的引用/);
 assert.equal((html.match(/id="stream-run"/g)||[]).length,1);
 const filtered=renderToStaticMarkup(createElement(ChainReader,{...props,include:id=>id!=='save'}));
 assert.doesNotMatch(filtered,/id="stream-save"/);assert.match(filtered,/原有保存/);
});

test('boundary details show evidence-backed examples and honestly handle missing result samples',async t=>{
 const vite=await createServer({configFile:false,root,plugins:[react()],optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
 t.after(()=>vite.close());
 const {BoundaryDetails}=await vite.ssrLoadModule('/src/features/review/BoundaryDetails.tsx');
 const props={flow:{title:'提交任务',chains:[],journey:{source:{entry:'POST /sync',input:'无请求体',outcome:'提交任务'},steps:[]}},manifest:{nodes:{},files:{}},onMethod:()=>{}};
 const request=renderToStaticMarkup(createElement(BoundaryDetails,{...props,kind:'entry'}));
 assert.match(request,/POST \/sync/);assert.match(request,/无请求体的接口调用/);assert.match(request,/本报告 journey/);
 const result=renderToStaticMarkup(createElement(BoundaryDetails,{...props,kind:'result'}));
 assert.match(result,/本报告未收集返回结果示例/);assert.doesNotMatch(result,/"code":200|"success":true/);
 props.flow.journey.source.responseExamples=[{title:'异步提交响应',content:'{"accepted":true}',evidence:'ControllerTest.java:20',description:'仅任务已接收'}];
 const documented=renderToStaticMarkup(createElement(BoundaryDetails,{...props,kind:'result'}));
 assert.match(documented,/ControllerTest.java:20/);assert.match(documented,/仅任务已接收/);assert.match(documented,/accepted/);
 props.flow.journey.entries=[{id:'one',title:'第一接口',implementationId:'a',entry:'GET /one',input:'id',outcome:'独立结果',evidence:'A.java:1',responseExamples:[{title:'第一返回',content:'firstResult',evidence:'A.java:2'}]},{id:'two',title:'第二接口',implementationId:'b',entry:'POST /two',input:'body',evidence:'B.java:1'}];
 const first=renderToStaticMarkup(createElement(BoundaryDetails,{...props,kind:'result',entryId:'one'}));
 assert.match(first,/独立结果/);assert.match(first,/firstResult/);assert.doesNotMatch(first,/accepted/);
 const second=renderToStaticMarkup(createElement(BoundaryDetails,{...props,kind:'result',entryId:'two'}));
 assert.match(second,/本报告未收集返回结果示例/);assert.doesNotMatch(second,/firstResult|accepted|独立结果/);

});
