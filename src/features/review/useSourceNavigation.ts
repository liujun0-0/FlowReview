import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

export function useSourceNavigation(pane: RefObject<HTMLElement | null>, viewKey: string) {
  const origin = useRef<{ node: string; top: number } | undefined>(undefined);
  const restoring = useRef(false);
  const remember = useCallback((node: string) => { origin.current = { node, top: pane.current?.scrollTop || 0 }; }, [pane]);
  const restore = useCallback((close: () => void) => { restoring.current = true; close(); }, []);
  useLayoutEffect(() => {
    if (!restoring.current) return;
    const frame = requestAnimationFrame(() => { if (pane.current) pane.current.scrollTop = origin.current?.top || 0; restoring.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [viewKey, pane]);
  return { origin, remember, restore };
}
