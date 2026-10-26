import type { Flow, ReaderNode, SourceFile, Annotation, BusinessStep } from '../../src/review/types';
import type { MethodGraphNode } from './flow-graph';
export interface SequenceObject {id:string;fileId:string;name:string;project:string;line?:number;reason:string;status:string;evidence:string}
export interface SequenceCall {from:string;to:string;label:string;confirmed:boolean;evidence:string;line?:number;siteCount:number;target?:MethodGraphNode;newTarget:boolean}
export interface ProcessStep {text:string;children:ProcessStep[]}
export function parseProcess(text?:string):ProcessStep[];
export interface SequenceMethod extends MethodGraphNode {processSteps:ProcessStep[];order:number;step?:BusinessStep;side:string;range:[number,number]|null;calls:SequenceCall[];refs:{name:string;line:number;column:number}[];branches:string[];annotations:Annotation[];objects:SequenceObject[]}
export function buildSequence(flow:Flow,nodes:Record<string,ReaderNode>,files:Record<string,SourceFile>,include?:(id:string)=>boolean):{methods:SequenceMethod[];projects:string[];edges:{from:string;to:string;label:string;confirmed:boolean;evidence:string}[];unattached:SequenceObject[];contextIds:string[]};
