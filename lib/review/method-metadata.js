export function methodChangeStatus(node, file, sources) {
  if (sources.old.status === 'missing') return 'added';
  if (sources.new.status === 'missing') return 'deleted';
  const text = (side, range) => range ? sources[side].text.replace(/\r\n/g, '\n').split('\n').slice(range[0]-1,range[1]).join('\n') : null;
  const before=text('old',node.oldRange),after=text('new',node.newRange);
  if(before!==null && after!==null)return before===after?'unchanged':'modified';
  if(node.annotations.every(a=>a.type==='新增') && node.newRange)return 'added';
  if(node.annotations.every(a=>a.type==='删除') && node.oldRange)return 'deleted';
  return node.relatedOnly ? 'unchanged' : file.changed ? 'modified' : 'unknown';
}

// Only resolve literal Spring mapping paths; never guess constants or gateway prefixes.
export function literalEndpoint(text, symbol, symbols) {
  if(!symbol || symbol.kind!=='method')return undefined;
  const lines=text.split('\n');
  const owner=symbols.filter(s=>s.kind==='class' && s.start<=symbol.start && s.end>=symbol.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(!owner)return undefined;
  const classPrefix=lines.slice(0,owner.start-1).join('\n');
  const classMap=[...classPrefix.matchAll(/@RequestMapping\s*\(\s*(?:(?:value|path)\s*=\s*)?"([^"\n]*)"[^)]*\)/g)].at(-1)?.[1] || classPrefix.match(/@FeignClient\s*\([\s\S]*?\bpath\s*=\s*"([^"\n]*)"/)?.[1] || '';
  const declaration=lines.slice(symbol.start-1,symbol.end).join('\n').split('{')[0];
  const mapping=declaration.match(/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:(?:value|path)\s*=\s*)?"([^"\n]*)"([^)]*)\)/);
  if(!mapping || /[+{}]/.test(mapping[3]) || /\$\{/.test(classMap + mapping[2]))return undefined;
  const method=mapping[1]==='Request' ? mapping[3].match(/RequestMethod\.(GET|POST|PUT|PATCH|DELETE)/)?.[1] || 'HTTP' : mapping[1].toUpperCase();
  return {method,path:('/'+classMap+'/'+mapping[2]).replace(/\/+/g,'/'),evidence:`Spring 字面量映射，L${symbol.start}；应用内路径，未包含网关或 context-path 前缀`};
}
