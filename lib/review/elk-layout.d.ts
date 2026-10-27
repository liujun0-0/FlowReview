export interface LayoutNode {id:string;project:string;width:number;height:number;ports:{id:string;y:number}[]}
export interface LayoutEdge {id:string;source:string;target:string;sourceHandle:string}
export function createElkGraph(nodes:LayoutNode[],edges:LayoutEdge[]):{id:string;layoutOptions:Record<string,string>;children:{id:string;width:number;height:number;ports:{id:string;width:number;height:number;x:number;y:number;layoutOptions:Record<string,string>}[];layoutOptions:Record<string,string>}[];edges:{id:string;sources:string[];targets:string[]}[]};
export function layoutReviewGraph(nodes:LayoutNode[],edges:LayoutEdge[]):Promise<{nodes:{id:string;x:number;y:number;width:number;height:number}[];routes:Record<string,{x:number;y:number}[]>}>;

export function routeMidpoint(points:{x:number;y:number}[]):{x:number;y:number}|undefined;
