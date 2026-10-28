import {useEffect,useState} from 'react';
import {useSource,loadSource} from './useSource';
import {responseType,buildDtoExample} from '../../../lib/review/contract-example.js';
import type {Manifest,ReaderNode,SourceFile} from './types';
function DtoShape({file,manifest,type}:{file:SourceFile;manifest:Manifest;type:string}){
 const [result,setResult]=useState<Awaited<ReturnType<typeof buildDtoExample>>>(),[error,setError]=useState('');
 useEffect(()=>{let live=true;setResult(undefined);setError('');
 const source=async(f:SourceFile)=>({id:f.id,name:f.path.split('/').at(-1)!.replace(/\.java$/,''),text:(await loadSource(f.id)).new.text});
 void source(file).then(async root=>buildDtoExample({...root,type},async(name,from)=>{
  const candidates=Object.values(manifest.files).filter(f=>f.path.split('/').at(-1)===name.split('.').at(-1)+'.java');
  const packageOf=(text:string)=>text.match(/\bpackage\s+([\w.]+)\s*;/)?.[1];
  const imports=[...from.text.matchAll(/\bimport\s+([\w.]+)\s*;/g)].map(m=>m[1]);
  const qualified=name.includes('.')?name:imports.find(i=>i.endsWith('.'+name));
  const matches=[];
  for(const candidate of candidates){const dto=await source(candidate);const full=packageOf(dto.text)+'.'+dto.name;if(qualified?full===qualified:packageOf(dto.text)===packageOf(from.text))matches.push(dto);}
  const local=matches.filter(d=>manifest.files[d.id].project===manifest.files[from.id].project);
  return local.length===1?local[0]:matches.length===1?matches[0]:undefined;
 })).then(value=>{if(live)setResult(value);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[file,manifest,type]);
 if(error)return <p>读取返回对象失败：{error}</p>;if(!result)return <p>正在递归读取返回对象…</p>;
 return <article><h3>按源码递归构造的 DTO 示意（非完整响应、非实测）</h3><pre><code>{JSON.stringify(result.value,null,2)}</code></pre><p>集合展示一个示意元素，值为类型占位值。最多展开 5 层、解析 24 个类型、生成 200 个字段；循环引用、未知类型和不支持的序列化规则以 null 截断。统一响应包装不推断。</p>{result.notes.length>0&&<details open><summary>未展开的字段与原因</summary>{result.notes.map((n,i)=><p key={i}>{n.path}：{n.reason}</p>)}</details>}<details><summary>源码依据（{result.sources.length} 个对象）</summary>{result.sources.map(id=><p key={id}>{manifest.files[id].project}/{manifest.files[id].path}</p>)}</details></article>;
}
export function SourceResultExample({node,manifest}:{node?:ReaderNode;manifest:Manifest}){const {data,error}=useSource(node?.fileId||'');if(!node)return <p>未定位当前接口方法，无法按源码构造结果。</p>;if(error)return <p>读取入口源码失败：{error}</p>;if(!data)return <p>正在读取入口返回类型…</p>;
 const range=node.newRange||node.range;const methodText=data.new.text.split('\n').slice(range[0]-1,range[1]).join('\n');const type=responseType(methodText,node.title);
 if(!type)return <p>未识别到明确的返回类型，需核对方法契约。</p>;
 if(type.void)return <article><h3>源码契约：无业务返回体（{type.declared}）</h3><pre><code>业务返回体：无（Void）</code></pre><p>{/\.execute\s*\(|\.submit\s*\(/.test(methodText)?'该方法向执行器提交任务；本次返回不包含后台任务完成统计。':'该接口未声明业务返回对象。'}统一响应外壳未核实，不构造 code/data/result 字段。</p><p>依据：{manifest.files[node.fileId].path}:{range.join('–')}</p></article>;
 let shapeType=type.payload;
 let candidates=Object.values(manifest.files).filter(f=>f.path.split('/').at(-1)===type.name+'.java');
 if(!candidates.length){const inner=type.payload.match(/<([^<>]+)>/);if(inner&&/^[\w.]+$/.test(inner[1])){shapeType=inner[1];candidates=Object.values(manifest.files).filter(f=>f.path.split('/').at(-1)===shapeType.split('.').at(-1)+'.java');}}
 const local=candidates.filter(f=>f.project===manifest.files[node.fileId].project);const file=local.length===1?local[0]:candidates.length===1?candidates[0]:undefined;
 return file?<><p>方法返回类型：{type.declared}。{shapeType!==type.payload&&`这里只展开内层 ${shapeType}，不构造外层容器。`}</p><DtoShape file={file} manifest={manifest} type={shapeType}/></>:<p>返回类型为 {type.declared}。当前快照未唯一定位其返回对象，不能将其他接口的对象作为结果。</p>;
}
