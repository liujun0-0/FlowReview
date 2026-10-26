
// Bind an edge once to an explicit method occurrence. Ambiguous simple names stay unbound.
export function bindProcessCalls(steps,calls) {
 const bindings={},remaining=new Set(calls.map((_,i)=>i));
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const mentions=(text,name)=>new RegExp(`(?:^|[^\\w$])${escape(name)}\\s*\\(`).test(text)||text.includes(`::${name}`);
 function walk(items,prefix='') {items.forEach((step,i)=>{const path=prefix?`${prefix}.${i}`:String(i);for(const index of [...remaining]){
  const target=calls[index].target;if(!target)continue;
  const owner=target.owner.replace(/\.java$/,'');
  const qualified=mentions(step.text,`${owner}.${target.title}`);
  const sameName=calls.filter(c=>c.target?.title===target.title);
  if(qualified || (sameName.length===1&&mentions(step.text,target.title))){(bindings[path]||=[]).push(index);remaining.delete(index);}
 }walk(step.children||[],path);});}
 walk(steps);return {bindings,unbound:[...remaining]};
}

export function splitProcessReferences(text,indexes,calls) {
 const matches=[];
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const index of indexes){const t=calls[index].target;if(!t)continue;let found;
  for(const name of [`${t.owner.replace(/\.java$/,'')}.${t.title}`,t.title]){
   const m=new RegExp(`(?:^|[^\\w$])(${escape(name)})\\s*\\(`).exec(text);
   if(m){found={start:m.index+m[0].indexOf(name),end:m.index+m[0].indexOf(name)+name.length,index};break;}
  }
  if(!found){const at=text.indexOf(`::${t.title}`);if(at>=0)found={start:at+2,end:at+2+t.title.length,index};}
  if(found)matches.push(found);
 }
 matches.sort((a,b)=>a.start-b.start);const result=[];let at=0;
 for(const m of matches){if(m.start<at)continue;if(m.start>at)result.push({text:text.slice(at,m.start)});result.push({text:text.slice(m.start,m.end),index:m.index});at=m.end;}
 if(at<text.length)result.push({text:text.slice(at)});return result;
}

