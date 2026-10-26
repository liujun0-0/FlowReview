import type { Flow, ReaderNode, SourceFile, BusinessStep } from '../../src/review/types';
export type ModuleStatus = 'added' | 'deleted' | 'modified' | 'unchanged' | 'unknown';
export interface GraphModule { id: string; project: string; title: string; path: string; status: ModuleStatus; nodeIds: string[] }
export function moduleStatus(file: SourceFile): ModuleStatus;
export function buildFlowGraph(flow: Flow, nodes: Record<string, ReaderNode>, files: Record<string, SourceFile>, include?: (id: string) => boolean): { modules: GraphModule[]; edges: { from: string; to: string; label: string; confirmed: boolean; evidence: string }[] };

export interface MethodGraphNode extends GraphModule { step?: BusinessStep; group?: string; fileId: string; owner: string; endpoint?: {method:string;path:string;evidence?:string}; role:string;process:string;change:string }
export function buildMethodGraph(flow: Flow, nodes: Record<string, ReaderNode>, files: Record<string, SourceFile>, include?: (id:string)=>boolean): { modules: MethodGraphNode[]; edges: {from:string;to:string;label:string;confirmed:boolean;evidence:string}[] };
