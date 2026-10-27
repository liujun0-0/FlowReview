import type { Flow, ReaderNode, SourceFile, BusinessStep, JourneyEntry } from '../../src/features/review/types';
import type { SequenceMethod, SequenceObject } from './sequence-model';
export interface FunctionCanvasItem {id:string;kind:string;project:string;steps?:BusinessStep[];methods?:SequenceMethod[];expanded?:boolean;status?:string;firstChange?:string;contextIds?:string[];method?:SequenceMethod;object?:SequenceObject;title?:string;description?:string;endpoint?:string;detail?:string;entryId?:string;boundaryKind?:'entry'|'result'}
export interface FunctionCanvasEdge {id:string;source:string;target:string;sourceHandle:string;label:string;kind:string;confirmed:boolean;evidence:string;changeStatus?:string}
export function buildFunctionCanvas(flow:Flow,nodes:Record<string,ReaderNode>,files:Record<string,SourceFile>,expanded?:Set<string>,include?:(id:string)=>boolean,selectedEntry?:string):{items:FunctionCanvasItem[];edges:FunctionCanvasEdge[];sequence:ReturnType<typeof import('./sequence-model').buildSequence>;entries?:JourneyEntry[];untrackedCount?:number};

export function objectReferenceColor(status?:string):string;
export function entryChangeStatus(entry:string|undefined,methods:SequenceMethod[],steps?:BusinessStep[]):string;

export function getFunctionEntries(flow:Flow,nodes:Record<string,ReaderNode>,files:Record<string,SourceFile>):JourneyEntry[];
