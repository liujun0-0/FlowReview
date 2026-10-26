import type { SourceViewRequest } from './types';

// Private normalized state for renderer implementations, not the business API.
export function resolveView(view: SourceViewRequest) {
  if (view.kind === 'source') return {
    mode: view.side, side: view.side, extent: view.extent, comparison: 'none' as const, completeMethod: false, split: false,
    oldRange: view.side === 'old' ? view.range : null, newRange: view.side === 'new' ? view.range : null, fallbackRange: view.range,
  };
  if (view.scope === 'file') return {
    mode: 'diff' as const, side: view.focus.side, extent: view.display === 'file' ? 'file' as const : 'range' as const,
    comparison: 'file' as const, completeMethod: true, split: view.layout === 'split',
    oldRange: null, newRange: null, fallbackRange: [view.focus.line, view.focus.line] as [number, number],
  };
  return {
    mode: 'diff' as const, side: view.focusSide, extent: 'range' as const, comparison: 'method' as const,
    completeMethod: view.context === 'complete', split: view.layout === 'split', oldRange: view.oldRange, newRange: view.newRange, fallbackRange: view.fallbackRange,
  };
}
