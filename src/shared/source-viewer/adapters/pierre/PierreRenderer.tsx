import { useCallback, useLayoutEffect, useMemo, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { CodeView, File, FileDiff, WorkerPoolContextProvider, type CodeViewHandle } from '@pierre/diffs/react';
import { parseDiffFromFile, type LineAnnotation, type DiffLineAnnotation } from '@pierre/diffs';
import { sourcePosition } from '../../../../../lib/source-viewer/pierre/position.js';
import { methodDiff } from '../../../../../lib/source-viewer/pierre/method-diff.js';
import { toGlobalLine, sourceCacheKey } from '../../../../../lib/source-viewer/model.js';
import { DIFF_HIGHLIGHTER_OPTIONS, DIFF_WORKER_POOL_OPTIONS } from './config';
import './pierre.css';
import { resolveView } from '../../view-state';
import type { SourceRendererAdapter, SourceViewerProps } from '../../types';

const normalize = (text: string) => text.replace(/\r\n/g, '\n');
const highlighterOptions = { ...DIFF_HIGHLIGHTER_OPTIONS, useTokenTransformer: true };
function PierreProvider({ children }: PropsWithChildren) {
  return <WorkerPoolContextProvider poolOptions={DIFF_WORKER_POOL_OPTIONS} highlighterOptions={highlighterOptions}>{children}</WorkerPoolContextProvider>;
}

function PierreRenderer(props: SourceViewerProps) {
  const { document: doc, theme } = props;
  const { side, mode, extent, comparison, completeMethod, split, oldRange, newRange, fallbackRange } = resolveView(props.view);
  const oldStart = oldRange?.[0], oldEnd = oldRange?.[1], newStart = newRange?.[0], newEnd = newRange?.[1];
  const full = extent === 'file';
  const range = (side === 'old' ? oldRange : newRange) || fallbackRange;
  const rangeStart = range[0];
  const source = side === 'old' ? doc.before : doc.after;
  const view = useRef<CodeViewHandle<ReactNode>>(null);
  const diff = useMemo(() => {
    if (mode !== 'diff') return null;
    if (normalize(doc.before.text) === normalize(doc.after.text)) return null;
    if (full || comparison === 'file') return parseDiffFromFile({ name: doc.path, contents: normalize(doc.before.text), cacheKey: sourceCacheKey(doc.id, 'old') }, { name: doc.path, contents: normalize(doc.after.text), cacheKey: sourceCacheKey(doc.id, 'new') });
    return methodDiff(doc.path, doc.before.text, doc.after.text, oldRange, newRange, completeMethod, JSON.stringify([doc.id, oldRange, newRange, completeMethod]));
  }, [doc.id, doc.path, doc.before.text, doc.after.text, mode, comparison, full, oldStart, oldEnd, newStart, newEnd, completeMethod]);
  // CodeView ignores changed item payloads until the explicit version changes.
  const payload = useRef({ diff, notes: props.annotations, version: 0 });
  if (payload.current.diff !== diff || payload.current.notes !== props.annotations) payload.current = { diff, notes: props.annotations, version: payload.current.version + 1 };
  const itemVersion = payload.current.version;
  const annotations = useMemo<DiffLineAnnotation<ReactNode>[]>(() => {
    if (!diff) return [];
    return (props.annotations || []).filter(a => diff.hunks.some(h => {
      const start = a.side === 'old' ? h.deletionStart : h.additionStart;
      const count = a.side === 'old' ? h.deletionCount : h.additionCount;
      return a.line >= start && a.line < start + count;
    })).map(a => ({ side: a.side === 'old' ? 'deletions' : 'additions', lineNumber: a.line, metadata: a.content }));
  }, [diff, props.annotations]);
  const options = useMemo(() => ({ theme: DIFF_HIGHLIGHTER_OPTIONS.theme, themeType: theme, disableFileHeader: true, overflow: 'wrap' as const, useTokenTransformer: true,
    onTokenClick: (event: { tokenText: string; side?: string; lineNumber: number }) => {
      if (!Number.isSafeInteger(event.lineNumber) || event.lineNumber < 1) return;
      const eventSide = event.side === 'deletions' ? 'old' : event.side === 'additions' ? 'new' : side;
      props.onTokenClick?.({ text: event.tokenText, side: eventSide, line: toGlobalLine(event.lineNumber, diff || full ? 1 : rangeStart) });
    },
  }), [theme, props.onTokenClick, side, diff, full, rangeStart]);
  const positioned = useRef('');
  const targetLine = range[0];
  const positioningKey = JSON.stringify([doc.id, mode, side, targetLine]);
  const position = useCallback(() => {
    if (!full || !view.current || positioned.current === positioningKey) return;
    positioned.current = positioningKey;
    view.current?.scrollTo(sourcePosition(doc.id, targetLine, side));
  }, [full, positioningKey, doc.id, targetLine, side]);
  useLayoutEffect(() => {
    if (!full) return;
    const frame = requestAnimationFrame(position);
    return () => cancelAnimationFrame(frame);
  }, [full, position]);
  const fileAnnotations = useMemo<LineAnnotation<ReactNode>[]>(() => (props.annotations || []).filter(a => a.side === side).map(a => ({ lineNumber: a.line, metadata: a.content })), [props.annotations, side]);
  if (full) {
    if (diff) return <CodeView className="fr-source-full" ref={view} key={`${doc.id}:diff`} items={[{ id: doc.id, version: itemVersion, type: 'diff', fileDiff: diff, annotations }]} renderAnnotation={a => a.metadata} options={{ ...options, diffStyle: split ? 'split' : 'unified', onPostRender: position, layout: { paddingTop: 4, paddingBottom: 12, gap: 0 } }} />;
    return <CodeView className="fr-source-full" ref={view} key={`${doc.id}:${side}`} items={[{ id: doc.id, version: itemVersion, type: 'file', file: { name: doc.path, contents: source.text, cacheKey: sourceCacheKey(doc.id, side) }, annotations: fileAnnotations }]} renderAnnotation={a => a.metadata} options={{ ...options, onPostRender: position, layout: { paddingTop: 4, paddingBottom: 12, gap: 0 } }} />;
  }
  if (diff) return <FileDiff fileDiff={diff} options={{ ...options, diffStyle: split ? 'split' : 'unified', hunkSeparators: 'line-info' }} lineAnnotations={annotations} renderAnnotation={a => a.metadata} />;
  const clipped = source.text.split('\n').slice(Math.max(0, range[0] - 1), range[1]).join('\n');
  return <>{props.fallbackHeader}<File file={{ name: doc.path, contents: clipped, cacheKey: sourceCacheKey(doc.id, side, range) }} options={options} />{props.fallbackFooter}</>;
}

export const pierreAdapter: SourceRendererAdapter = { Renderer: PierreRenderer, Provider: PierreProvider };
