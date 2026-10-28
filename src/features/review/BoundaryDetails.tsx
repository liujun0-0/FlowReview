import {useEffect,useState} from 'react';
import { SourceResultExample } from './SourceResultExample';
import { buildSequence } from '../../../lib/review/sequence-model.js';
import { entryChangeStatus, getFunctionEntries } from '../../../lib/review/function-canvas.js';
import { STATUS_LABELS } from './FlowGraph';
import type { Flow, Manifest, BoundaryExample } from './types';

/** Examples are report evidence, never executable requests or inferred JSON values. */
export function BoundaryDetails({kind,flow,manifest,onMethod,entryId}:{entryId?:string;kind:'entry'|'result';flow:Flow;manifest:Manifest;onMethod:(id:string)=>void}) {
 const [inspectSource,setInspectSource]=useState(false);
 useEffect(()=>setInspectSource(false),[entryId,kind,flow.id]);
 const entry=entryId?getFunctionEntries(flow,manifest.nodes,manifest.files).find(e=>e.id===entryId):undefined;
 const source=entryId?entry:flow.journey?.source;
 const methods=buildSequence(flow,manifest.nodes,manifest.files).methods;
 const status=entry?manifest.nodes[entry.implementationId]?.changeStatus||'unknown':entryChangeStatus(source?.entry,methods,flow.journey?.steps);
 const gap=source?.exampleGaps?.[kind==='entry'?'request':'response'];
 let examples:BoundaryExample[]=kind==='entry'?source?.requestExamples||[]:source?.responseExamples||[];
 const noBody=kind==='entry'&&source?.entry&&/^(?:无请求体|没有请求体|不需要请求体)(?:[，,；;。]|$)/.test((source.input||'').trim());
 if(!examples.length&&noBody)examples=[{title:'无请求体的接口调用',content:source.entry,evidence:entryId?`本报告 journey.entries[${entryId}].entry / input`:'本报告 journey.source.entry / input',description:'依据报告整理的接口调用说明；仅展示，不发送请求。'}];
 return <section className="rr-boundary-details" aria-label={kind==='entry'?'入口参数示例':'最终结果示例'}><h2>{kind==='entry'?'入口与参数示例':'最终结果与返回示例'}</h2><p>{flow.title}</p>
 {entryId&&!entry&&<p role="alert">接口关联已失效，请重新选择入口或结果节点。</p>}{entry&&<h3>{entry.title}</h3>}<><span className={`rr-status rr-status-${status}`}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS]||'待核对'}</span><code className="rr-endpoint">{source?.entry||'入口尚未定位'}</code></>
 <p><b>{kind==='entry'?'输入说明：':!examples.length?'原报告结果描述（待核对）：':'结果说明：'}</b>{(kind==='entry'?source?.input:source?.outcome)||'报告未提供'}</p>
 {examples.length?examples.map((example,i)=><article key={i}><h3>{example.title}</h3>{example.description&&<p>{example.description}</p>}<pre><code>{example.content}</code></pre><p className="rr-muted"><b>示例依据：</b>{example.evidence}</p></article>):<p className="rr-warning">本报告未收集{kind==='entry'?'参数':'返回结果'}示例。{gap&&<span> 缺失原因：{gap}。</span>}以下尝试从固定源码展示返回契约或 DTO 字段形状；仅作示意，不代表真实接口响应。</p>}
 {kind==='result'&&examples.length>0&&<button onClick={()=>setInspectSource(!inspectSource)}>{inspectSource?'收起源码对象示意':'按源码展开返回对象'}</button>}
 {kind==='result'&&(!examples.length||inspectSource)&&<SourceResultExample node={entry?manifest.nodes[entry.implementationId]:methods.filter(m=>m.endpoint).length===1?manifest.nodes[methods.find(m=>m.endpoint)!.id]:undefined} manifest={manifest}/>}
 <p className="rr-muted">示例用于理解数据格式，不代表接口已经运行通过；异步任务的提交响应与最终处理结果应分别说明。</p>
 <details open><summary>查看相关实现</summary>{methods.filter(m=>entryId?m.id===entry?.implementationId:kind==='entry'?!!m.endpoint:true).map(m=><p key={m.id}><button onClick={()=>onMethod(m.id)}>{m.project} · {m.owner.replace(/\.java$/,'')}.{m.title}() ↗</button></p>)}</details>
 </section>;
}
