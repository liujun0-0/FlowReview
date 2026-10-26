export interface Annotation {
  id?: string; readerNodeId?: string; line: number; side?: 'old' | 'new'; type?: string; tier?: string; func?: string;
  process?: string; endpoint?: {method: string; path: string; evidence?: string}; branches?: string[]; why?: string; behavior?: string; role?: string; verdict?: string; assessmentReason?: string;
  risk_detail?: string; evidence?: string; counterfactual?: string; confidence?: string;
  verify?: string; verifyStatus?: string; verifyResult?: string; verifyEvidence?: string;
}
export interface SymbolInfo { id: string; name: string; owner: string; kind: string; start: number; end: number; nameLine: number; signature: string; pairKey: string }
export interface SourceVersion { text: string; status: string; hash: string }
export interface Sources { old: SourceVersion; new: SourceVersion }
export interface SourceFile {
  id: string; project: string; path: string; changed: boolean; nodeIds: string[]; changeInfo?: string;
  statuses: { old: string; new: string }; hashes: { old: string; new: string };
  indexes: Record<'old' | 'new', { symbols: SymbolInfo[]; references: { name: string; line: number; column: number }[]; error: string | null }>;
}
export interface ReaderNode {
  id: string; fileId: string; title: string; signature?: string; side: 'old' | 'new';
  range: [number, number]; oldRange: [number, number] | null; newRange: [number, number] | null;
  changeStatus?: 'added' | 'deleted' | 'modified' | 'unchanged' | 'unknown'; endpoint?: {method:string;path:string;evidence?:string}; rangeKind: string; located: boolean; relatedOnly: boolean; annotations: Annotation[];
}
export interface Chain { id: string; name: string; sideEffect: string; nodeIds: string[]; links?: { from: string; to: string; label?: string; confidence?: string; evidence?: string }[] }
export interface Flow { id: string; title: string; requirement: string; before: string; after: string; status: string; chains: Chain[]; journey?: BusinessJourney }
export interface Manifest {
  version: number; id: string; title: string; createdAt: string; reportHash: string;
  repositories: { project: string; path: string; mode: string; base: string; head: string | null; fingerprint: string }[];
  warnings: string[]; flows: Flow[]; nodes: Record<string, ReaderNode>; files: Record<string, SourceFile>;
  unknowns: { what: string; reason: string; how: string }[]; verifyPlan: { strategy: string; target: string; how: string; why: string }[];
}
export interface Mark { read?: boolean; question?: boolean; note?: string }
export interface ReadingState { marks: Record<string, Mark>; position?: { flow?: string; node?: string }; updatedAt?: string }

export interface BusinessStep {
 id:string;title:string;project:string;layer:string;phase?:string;kind?:'start'|'process'|'decision'|'storage'|'external'|'end'|'failure';purpose:string;input:string;output:string;process:string;
 branches:string[];tables:string[];downstreams:string[];implementationIds:string[];evidence:string[];
 change:{status:'unchanged'|'modified'|'added'|'deleted'|'unknown';kind?:'behavior'|'implementation';before:string;after:string;reason:string;impact:string[]};
}
export interface BusinessJourney {source:{actor:string;entry:string;input:string;purpose:string;outcome:string};coverage:{status:string;boundaries:string[]};steps:BusinessStep[];links:{from:string;to:string;label:string;kind?:string;confidence?:string;evidence:string}[]}
