import type { ComponentType, PropsWithChildren, ReactNode } from 'react';

export type SourceSide = 'old' | 'new';
export type SourceRange = [number, number];
export interface SourceText { text: string; status: string }
// id identifies immutable before/after contents, such as a fixed snapshot file revision.
export interface SourceDocument { id: string; path: string; before: SourceText; after: SourceText }
export interface SourceAnnotation { id: string; line: number; side: SourceSide; content: ReactNode }
export interface SourceTokenEvent { text: string; side: SourceSide; line: number }
export type SourceViewRequest =
  | { kind: 'source'; side: SourceSide; extent: 'file' | 'range'; range: SourceRange }
  | { kind: 'diff'; scope: 'file'; display: 'file' | 'hunks'; focus: { side: SourceSide; line: number }; layout: 'split' | 'unified' }
  | { kind: 'diff'; scope: 'method'; focusSide: SourceSide; oldRange: SourceRange | null; newRange: SourceRange | null; fallbackRange: SourceRange; context: 'compact' | 'complete'; layout: 'split' | 'unified' };
export interface SourceViewerProps {
  document: SourceDocument;
  view: SourceViewRequest;
  theme: 'light' | 'dark';
  annotations?: SourceAnnotation[];
  fallbackHeader?: ReactNode;
  fallbackFooter?: ReactNode;
  onTokenClick?: (event: SourceTokenEvent) => void;
  onRenderError?: (error: Error) => void;
}
export interface SourceRendererAdapter {
  Renderer: ComponentType<SourceViewerProps>;
  Provider?: ComponentType<PropsWithChildren>;
}
