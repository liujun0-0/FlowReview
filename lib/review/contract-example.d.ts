export function responseType(text:string,method:string):{declared:string;payload:string;void:boolean;name:string}|undefined;
export function dtoExample(text:string):{value:Record<string,unknown>;partial:boolean}|undefined;

export interface DtoSource {id:string;name:string;text:string;type?:string}
export function buildDtoExample(root:DtoSource,resolve:(type:string,from:DtoSource)=>Promise<DtoSource|undefined>,options?:{maxDepth?:number;maxTypes?:number;maxFields?:number}):Promise<{value:unknown;notes:{path:string;reason:string}[];sources:string[];partial:boolean}>;
