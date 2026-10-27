import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildSequence, type SequenceMethod, type ProcessStep } from '../../../lib/review/sequence-model.js';
import { bindProcessCalls, splitProcessReferences } from '../../../lib/review/sequence-canvas.js';
import { STATUS_LABELS } from './FlowGraph';
import type { Flow, Manifest, Mark, ReaderNode, ReadingState, BusinessStep } from './types';

interface Props {
 flow: Flow; manifest: Manifest; include: (id: string) => boolean; selected: string;
 reading: ReadingState; onMark: (id: string, change: Partial<Mark>) => void;
 onOpen: (id: string) => void; renderSource: (node: ReaderNode) => ReactNode;
 controls: ReactNode;
}
function Process({steps,method,onFollow,prefix=''}: {steps: ProcessStep[];method:SequenceMethod;onFollow:(id:string)=>void;prefix?:string}) {
 const binding=bindProcessCalls(method.processSteps,method.calls);
 return <ol>{steps.map((s,i)=>{const path=prefix?`${prefix}.${i}`:String(i);return <li key={path}>{splitProcessReferences(s.text,binding.bindings[path]||[],method.calls).map((part,j)=>part.index===undefined?<span key={j}>{part.text}</span>:<button className="rr-stream-inline" key={j} title={method.calls[part.index].evidence} onClick={()=>onFollow(method.calls[part.index!].to)}>{part.text} ↗</button>)}{s.children.length>0&&<Process steps={s.children} method={method} onFollow={onFollow} prefix={path}/>}</li>;})}</ol>;
}
/** Mount source viewers near the viewport, avoiding eager parsing of every changed method. */
function DeferredSource({children}:{children:ReactNode}) {
 const root=useRef<HTMLDivElement>(null);const [ready,setReady]=useState(false);
 useEffect(()=>{const element=root.current;if(!element)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setReady(true);observer.disconnect();}},{rootMargin:'600px'});observer.observe(element);return()=>observer.disconnect();},[]);
 return <div ref={root} className="rr-stream-source">{ready?children:<p className="rr-muted">滚动到此处读取方法源码…</p>}</div>;
}
/** Read report steps in order while retaining unchanged bridges and explicit relationship evidence. */
export function ChainReader({flow,manifest,include,selected,reading,onMark,onOpen,renderSource,controls}:Props) {
 const sequence=useMemo(()=>buildSequence(flow,manifest.nodes,manifest.files,include),[flow,manifest,include]);
 const [expanded,setExpanded]=useState<Set<string>>(new Set());
 const [allOriginal,setAllOriginal]=useState(false);
 const [focused,setFocused]=useState('');
 const [history,setHistory]=useState<string[]>([]);
 const groups=useMemo(()=>{
  const assigned=new Set<string>();
  const steps: {id:string;title:string;step?:BusinessStep;methods:SequenceMethod[]}[]=(flow.journey?.steps||[]).map(step=>{
   const methods=sequence.methods.filter(m=>step.implementationIds.includes(m.id)&&!assigned.has(m.id));
   methods.forEach(m=>assigned.add(m.id));
   return {id:step.id,title:step.title,step,methods};
  });
  const rest=sequence.methods.filter(m=>!assigned.has(m.id));
  if(rest.length)steps.push({id:'other-methods',title:steps.length?'其他关联方法（未归入业务步骤）':'报告中的方法路径',step:undefined,methods:rest});
  return steps;
 },[flow,sequence]);
 const toggle=(id:string)=>setExpanded(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});
 const reveal=(id:string)=>{setFocused(id);setExpanded(current=>new Set([...current,id]));requestAnimationFrame(()=>document.getElementById(`stream-${id}`)?.scrollIntoView({block:'start',behavior:'smooth'}));};
 const method=(m:SequenceMethod)=>{
  const node=manifest.nodes[m.id],mark=reading.marks[m.id]||{},original=m.status==='unchanged';
  const unbound=bindProcessCalls(m.processSteps,m.calls).unbound;
  const show=expanded.has(m.id)||!original||allOriginal;
  return <article id={`stream-${m.id}`} key={m.id} className={`rr-stream-method rr-stream-${m.status} ${focused===m.id||selected===m.id?'rr-stream-current':''}`}>
   <header><div><span className={`rr-status rr-status-${m.status}`}>{STATUS_LABELS[m.status]}</span> <strong>{m.owner.replace(/\.java$/, '')}.{m.title}()</strong><div className="rr-path">{m.project} / {m.path} · L{node.range.join('–')}</div></div><button onClick={()=>onOpen(m.id)}>侧栏查看完整方法 ↗</button></header>
   {m.endpoint&&<div className="rr-endpoint">{m.endpoint.method} {m.endpoint.path}</div>}
   <div className="rr-stream-description"><p><b>主要功能：</b>{m.role||'报告未说明，请核对源码。'}</p>
    {m.processSteps.length>0&&<details open={!original}><summary>执行过程</summary><Process steps={m.processSteps} method={m} onFollow={id=>{setHistory(h=>[...h,m.id]);reveal(id);}}/></details>}
    {!original&&<p className="rr-stream-change"><b>本次变化：</b>{m.change||'报告未说明'}{m.annotations[0]?.why&&<><br/><b>修改原因：</b>{m.annotations[0].why}</>}</p>}
    {!!m.branches.length&&<details><summary>分支与异常（{m.branches.length}）</summary>{m.branches.map((b,i)=><p key={i}>{b}</p>)}</details>}
   </div>
   {original&&<button className="rr-stream-expand" aria-expanded={show} onClick={()=>toggle(m.id)} disabled={allOriginal}>{show?'收起原有源码':'展开原有源码，核对衔接逻辑'}</button>}
   {show&&<DeferredSource>{renderSource(node)}</DeferredSource>}
   {!!unbound.length&&<div className="rr-stream-relations"><b>执行位置未定位的引用：</b>{unbound.map(i=>{const c=m.calls[i];return <button key={`${c.to}-${i}`} title={c.evidence} onClick={()=>{setHistory(h=>[...h,m.id]);reveal(c.to);}}>{c.line?`L${c.line} · `:''}{c.target?.owner.replace(/\.java$/, '')}.{c.target?.title}() → {c.confirmed?'查看链上方法':'关系待核对'}</button>;})}</div>}
   {!!m.objects.length&&<div className="rr-stream-relations"><b>首次同名引用对象：</b>{m.objects.map(o=><button key={o.fileId} title={o.evidence} onClick={()=>onOpen(o.id)}>{STATUS_LABELS[o.status as keyof typeof STATUS_LABELS]||'待核对'} · {o.name} ↗</button>)}</div>}
   <footer><span>{original?'原有逻辑，保留用于理解完整链路':'真实快照差异；说明来自评审报告'}</span><div className="rr-actions"><button aria-pressed={!!mark.read} onClick={()=>onMark(m.id,{read:!mark.read})}>{mark.read?'已看过':'标为看过'}</button><button aria-pressed={!!mark.question} onClick={()=>onMark(m.id,{question:!mark.question})}>{mark.question?'已记疑问':'记个疑问'}</button></div></footer>
   {mark.question&&<textarea aria-label={`关于 ${m.title} 的疑问`} defaultValue={mark.note||''} onBlur={e=>onMark(m.id,{note:e.target.value})}/>}
  </article>;
 };
 return <section className="rr-stream" aria-label="沿链连续阅读">
  <div className="rr-stream-toolbar">{controls}<button disabled={!history.length} onClick={()=>{const id=history.at(-1)!;setHistory(h=>h.slice(0,-1));setFocused(id);document.getElementById(`stream-${id}`)?.scrollIntoView({block:'start',behavior:'smooth'});}}>返回上个阅读位置</button><label><input type="checkbox" checked={allOriginal} onChange={e=>setAllOriginal(e.target.checked)}/>展开原有方法源码</label></div>
  <p className="rr-muted">按报告业务步骤连续阅读；分支及异步关系以关系说明为准，排列顺序不代表运行时调用顺序。</p>
  <nav className="rr-stream-path" aria-label="链路步骤导航">{groups.map((g,i)=><button key={g.id} onClick={()=>document.getElementById(`stream-step-${g.id}`)?.scrollIntoView({block:'start',behavior:'smooth'})}>{i+1}. {g.title}{g.step&&<span className={`rr-status rr-status-${g.step.change.status}`}>{STATUS_LABELS[g.step.change.status]}</span>}</button>)}</nav>
  {groups.map((g,i)=><section className="rr-stream-step" id={`stream-step-${g.id}`} key={g.id}><h3><span>{i+1}</span>{g.title}<small>{g.step?.project} {g.step?.layer}</small></h3>
   {g.step&&<div className="rr-stream-description"><p>{g.step.purpose}</p><p className="rr-muted">输入：{g.step.input||'未说明'} → 结果：{g.step.output||'未说明'}</p>{g.step.change.status!=='unchanged'&&<div className="rr-beforeafter"><p><b>原来：</b>{g.step.change.before||'未说明'}</p><p><b>这次：</b>{g.step.change.after||'未说明'}</p></div>}{!!g.step.branches.length&&<details><summary>步骤分支与异常</summary>{g.step.branches.map((b,j)=><p key={j}>{b}</p>)}</details>}{!!(g.step.tables.length||g.step.downstreams.length)&&<p className="rr-muted">涉及表 / 下游：{[...g.step.tables,...g.step.downstreams].join('；')}</p>}</div>}
   {g.methods.map(method)}
   {g.step&&g.step.implementationIds.filter(id=>manifest.nodes[id]&&include(id)&&!g.methods.some(m=>m.id===id)).map(id=><div className="rr-stream-relations" key={id}><b>对应实现 / 共享方法：</b><button onClick={()=>sequence.methods.some(m=>m.id===id)?reveal(id):onOpen(id)}>{manifest.files[manifest.nodes[id].fileId].project} · {manifest.nodes[id].title} ↗</button><small>同一实现只展示一份源码，点击查看。</small></div>)}
   {!g.methods.length&&!g.step?.implementationIds.some(id=>manifest.nodes[id]&&include(id))&&<p className="rr-stream-empty">此步骤没有可展示的方法，可能未采集或被过滤；请核对报告范围。</p>}
   {flow.journey?.links.filter(l=>l.from===g.id).map((l,j)=><p className="rr-stream-link" key={j} title={l.evidence}>→ {flow.journey?.steps.find(s=>s.id===l.to)?.title||l.to} · {l.label} {l.kind&&` · ${({normal:'继续处理',branch:'条件分支',async:'异步处理',failure:'异常路径',return:'返回结果'} as Record<string,string>)[l.kind]||l.kind}`} {l.confidence!=='确定'&&' · 关系待核对'}</p>)}
  </section>)}
  {!!sequence.contextIds.length&&<details className="rr-stream-context"><summary>对象与其他关联代码（{sequence.contextIds.length}）</summary>{sequence.contextIds.map(id=><button key={id} onClick={()=>onOpen(id)}>{manifest.files[manifest.nodes[id].fileId].project} · {manifest.nodes[id].title} ↗</button>)}</details>}
  {!groups.length&&<p>当前链路没有可展示的方法或业务步骤，可取消测试过滤或补充报告。</p>}
 </section>;
}
