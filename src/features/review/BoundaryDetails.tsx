import { buildSequence } from '../../../lib/review/sequence-model.js';
import { entryChangeStatus, getFunctionEntries } from '../../../lib/review/function-canvas.js';
import { STATUS_LABELS } from './FlowGraph';
import type { Flow, Manifest, BoundaryExample } from './types';

/** Examples are report evidence, never executable requests or inferred JSON values. */
export function BoundaryDetails({kind,flow,manifest,onMethod,entryId}:{entryId?:string;kind:'entry'|'result';flow:Flow;manifest:Manifest;onMethod:(id:string)=>void}) {
 const entry=entryId?getFunctionEntries(flow,manifest.nodes,manifest.files).find(e=>e.id===entryId):undefined;
 const source=entryId?entry:flow.journey?.source;
 const methods=buildSequence(flow,manifest.nodes,manifest.files).methods;
 const status=entryChangeStatus(source?.entry,methods,flow.journey?.steps);
 let examples:BoundaryExample[]=kind==='entry'?source?.requestExamples||[]:source?.responseExamples||[];
 const noBody=kind==='entry'&&source?.entry&&/^(?:无请求体|没有请求体|不需要请求体)(?:[，,；;。]|$)/.test((source.input||'').trim());
 if(!examples.length&&noBody)examples=[{title:'无请求体的接口调用',content:source.entry,evidence:'本报告 journey.source.entry / input',description:'依据报告整理的接口调用说明；仅展示，不发送请求。'}];
 return <section className="rr-boundary-details" aria-label={kind==='entry'?'入口参数示例':'最终结果示例'}><h2>{kind==='entry'?'入口与参数示例':'最终结果与返回示例'}</h2><p>{flow.title}</p>
 {kind==='entry'&&<><span className={`rr-status rr-status-${status}`}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS]||'待核对'}</span><code className="rr-endpoint">{source?.entry||'入口尚未定位'}</code></>}
 <p><b>{kind==='entry'?'输入说明：':'结果说明：'}</b>{(kind==='entry'?source?.input:source?.outcome)||'报告未提供'}</p>
 {examples.length?examples.map((example,i)=><article key={i}><h3>{example.title}</h3>{example.description&&<p>{example.description}</p>}<pre><code>{example.content}</code></pre><p className="rr-muted"><b>示例依据：</b>{example.evidence}</p></article>):<p className="rr-warning">本报告未收集{kind==='entry'?'参数':'返回结果'}示例。不会根据方法名或字段类型拼造 JSON；需核对 DTO、接口契约或测试样例后补充。</p>}
 <p className="rr-muted">示例用于理解数据格式，不代表接口已经运行通过；异步任务的提交响应与最终处理结果应分别说明。</p>
 <details open><summary>查看相关实现</summary>{methods.filter(m=>entryId?m.id===entry?.implementationId:kind==='entry'?!!m.endpoint:true).map(m=><p key={m.id}><button onClick={()=>onMethod(m.id)}>{m.project} · {m.owner.replace(/\.java$/,'')}.{m.title}() ↗</button></p>)}</details>
 </section>;
}
