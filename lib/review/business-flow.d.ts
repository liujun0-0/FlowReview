import type { BusinessJourney, ReaderNode, SourceFile } from '../../src/review/types';
import type { MethodGraphNode } from './flow-graph';
export function resolveBusinessFlow(journey: BusinessJourney|undefined, anchors: Map<string,string>): BusinessJourney|undefined;
export interface BusinessGraphNode extends MethodGraphNode {business:true;group:string;layer:string;kind?:string;step:BusinessJourney['steps'][number]}
export function buildBusinessGraph(journey:BusinessJourney,nodes:Record<string,ReaderNode>,files:Record<string,SourceFile>,include?:(id:string)=>boolean): {modules:BusinessGraphNode[];edges:{from:string;to:string;label:string;kind?:string;confidence?:string;evidence:string;confirmed:boolean}[]};
