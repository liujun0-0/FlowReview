import type {ProcessStep,SequenceCall} from './sequence-model';
export function bindProcessCalls(steps:ProcessStep[],calls:SequenceCall[]):{bindings:Record<string,number[]>;unbound:number[]};
export function splitProcessReferences(text:string,indexes:number[],calls:SequenceCall[]):{text:string;index?:number}[];
