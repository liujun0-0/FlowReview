export interface Pom {group:string;artifact:string;version:string;properties:Record<string,string>;parent?:{group:string;artifact:string;version:string};dependencies:{group:string;artifact:string;version:string;kind:string}[]}
export function parsePom(text:string):Pom;
export function buildDependencyGraph(records:{id:string;project:string;path:string;nodeId:string;old:string;new:string}[]):{nodes:({id:string;project:string;path:string;nodeId:string;before:Pom;after:Pom})[];edges:{id:string;source:string;target:string;kind:string;before:string;after:string}[]};
