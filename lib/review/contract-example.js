/** A conservative source-only DTO shape, not an HTTP response or runtime sample. */
export function responseType(text,method){
 const clean=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const escaped=method.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const match=clean.match(new RegExp('(?:public|protected)\\s+(?:final\\s+)?([\\w.<>,? \\[\\]]+)\\s+'+escaped+'\\s*\\('));
 if(!match)return undefined;
 const declared=match[1].trim(),payload=declared.match(/^RestResponseVO<(.+)>$/)?.[1]||declared;
 return {declared,payload,void:payload==='Void'||payload==='void',name:payload.replace(/<.*>/,'').split('.').at(-1)};
}
export function dtoExample(text){
 if(/@(JsonProperty|JsonIgnore|JsonSerialize|JsonValue|JsonUnwrapped|JsonNaming)\b/.test(text))return undefined;
 const clean=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const fields=[...clean.matchAll(/\bprivate\s+(?!static\b)([\w.<>?, \[\]]+?)\s+(\w+)\s*(?:=[^;]*)?;/g)];
 const value=type=>/^(List|Set|Collection)<|\[\]$/.test(type)?[]:/^Map</.test(type)?{}:/^(String|CharSequence|char|Character)$/.test(type)?'示例值':/^(Boolean|boolean)$/.test(type)?false:/^(Long|Integer|Double|Float|Short|Byte|BigDecimal|BigInteger|int|long|double|float|short|byte)$/.test(type)?1:null;
 return fields.length?{value:Object.fromEntries(fields.map(([,type,name])=>[name,value(type.trim())])),partial:true}:undefined;
}

/** Bounded recursive contract shape; active-path identities detect self and mutual cycles. */
export async function buildDtoExample(root,resolve,options={}){
 const maxDepth=options.maxDepth??5,maxTypes=options.maxTypes??24,maxFields=options.maxFields??200;
 const notes=[],sources=new Set(),cache=new Map();let fields=0;
 const clean=text=>text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const split=text=>{let depth=0,start=0,result=[];for(let i=0;i<text.length;i++){if(text[i]==='<')depth++;if(text[i]==='>')depth--;if(text[i]===','&&depth===0){result.push(text.slice(start,i).trim());start=i+1;}}result.push(text.slice(start).trim());return result;};
 const stop=(path,reason)=>{notes.push({path,reason});return null;};
 async function expand(type,from,path,depth,active,bindings={}){
  type=type.trim();if(bindings[type])type=bindings[type];
  if(depth>maxDepth)return stop(path,'达到最大展开深度');
  if(type.endsWith('[]'))return [await expand(type.slice(0,-2),from,path+'[0]',depth+1,active,bindings)];
  const match=type.match(/^([\w.]+)(?:<([\s\S]+)>)?$/);if(!match)return stop(path,'未支持的泛型或通配符');
  const base=match[1].split('.').at(-1),args=match[2]?split(match[2]).map(a=>bindings[a]||a):[];
  if(/^(String|CharSequence|char|Character)$/.test(base))return '示例值';
  if(/^(Boolean|boolean)$/.test(base))return false;
  if(/^(Long|Integer|Double|Float|Short|Byte|BigDecimal|BigInteger|int|long|double|float|short|byte)$/.test(base))return 1;
  if(/^(List|Set|Collection|Iterable)$/.test(base))return args.length?[await expand(args[0],from,path+'[0]',depth+1,active,bindings)]:stop(path,'集合缺少元素类型');
  if(base==='Map')return args[0]==='String'&&args[1]?{'示例键':await expand(args[1],from,path+'[示例键]',depth+1,active,bindings)}:stop(path,'Map 键类型或值类型未支持');
  const key=from.id+':'+match[1];
  if(!cache.has(key)){if(cache.size>=maxTypes)return stop(path,'达到类型解析数量上限');cache.set(key,path==='$'?Promise.resolve(root):resolve(match[1],from));}
  const source=await cache.get(key);if(!source)return stop(path,'快照中未唯一定位该类型');
  if(active.has(source.id))return stop(path,'循环引用：'+base);
  const text=clean(source.text);if(/@(JsonProperty|JsonIgnore|JsonSerialize|JsonValue|JsonUnwrapped|JsonNaming)\b/.test(text))return stop(path,'存在未支持的序列化规则');
  if((text.match(/\b(?:class|record|enum)\s+\w+/g)||[]).length!==1||!new RegExp('\\bclass\\s+'+base+'\\b').test(text))return stop(path,'内部类、枚举或非普通 DTO 需人工核对');
  sources.add(source.id);const next=new Set(active);next.add(source.id);
  const declaration=text.match(new RegExp('class\\s+'+base+'(?:<([^>]+)>)?(?:\\s+extends\\s+([\\w.]+(?:<[^>]+>)?))?'));
  const local={};(declaration?.[1]?split(declaration[1]):[]).forEach((parameter,i)=>{if(args[i])local[parameter]=args[i];});
  let result={};
  if(declaration?.[2]){const parent=await expand(declaration[2],source,path+'.<父类>',depth+1,next,local);if(parent&&typeof parent==='object'&&!Array.isArray(parent))result={...parent};}
  const matches=[...text.matchAll(/\b(?:private|protected|public)\s+(?!static\b)([\w.<>?, \[\]]+?)\s+(\w+)\s*(?:=[^;]*)?;/g)];
  for(const [,fieldType,name] of matches){if(++fields>maxFields){stop(path,'达到字段总数上限');break;}result[name]=await expand(fieldType,source,path+'.'+name,depth+1,next,local);}
  if(!matches.length&&!declaration?.[2])stop(path,'未识别到实例字段');
  return result;
 }
 const value=await expand(root.type||root.name,root,'$',0,new Set());
 return {value,notes,sources:[...sources],partial:true};
}
