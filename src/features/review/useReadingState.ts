import { useCallback, useEffect, useRef, useState } from 'react';
import { api, reportId } from './api';
import type { Mark, ReadingState } from './types';

type Update = { changes: Record<string, Partial<Mark>>; expected: Record<string, Partial<Mark>>; position?: ReadingState['position'] };
const defaults = { read: false, question: false, note: '' };
export function useReadingState() {
  const [reading, setReading] = useState<ReadingState>({ marks: {} });
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const current = useRef(reading), pending = useRef<Update[]>([]), blocked = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const publish = useCallback((state: ReadingState) => { current.current = state; setReading(state); }, []);
  const initializeReading = useCallback((state: ReadingState) => { publish(state); }, [publish]);
  const enqueue = useCallback((update: Update) => {
    pending.current.push(update);
    const optimistic = { ...current.current, marks: { ...current.current.marks }, position: update.position || current.current.position };
    for (const [id, patch] of Object.entries(update.changes)) optimistic.marks[id] = { ...optimistic.marks[id], ...patch };
    publish(optimistic); setSaveStatus(blocked.current ? '存在未保存内容' : '保存中…');
    saveQueue.current = saveQueue.current.then(async () => {
      if (blocked.current) return;
      try {
        const saved = await api<ReadingState>(`reports/${reportId}/state`, update, 'PATCH');
        pending.current.shift();
        const next = { ...saved, marks: { ...saved.marks } };
        for (const queued of pending.current) {
          for (const [id, patch] of Object.entries(queued.changes)) next.marks[id] = { ...next.marks[id], ...patch };
          if (queued.position) next.position = queued.position;
        }
        publish(next); setSaveStatus(pending.current.length ? '保存中…' : '进度已保存');
      } catch (error) {
        blocked.current = true;
        const message = `${error instanceof Error ? error.message : String(error)}。本页未保存内容仍保留，请复制疑问内容后刷新核对。`;
        setSaveStatus('存在未保存内容'); setSaveError(message);
      }
    });
  }, [publish]);
  const updateMark = useCallback((id: string, patch: Partial<Mark>, position?: ReadingState['position']) => {
    const old = { ...defaults, ...current.current.marks[id] };
    const expected = Object.fromEntries(Object.keys(patch).map(field => [field, old[field as keyof Mark]]));
    enqueue({ changes: { [id]: patch }, expected: { [id]: expected }, position });
  }, [enqueue]);
  const savePosition = useCallback((position: ReadingState['position']) => enqueue({ changes: {}, expected: {}, position }), [enqueue]);
  const hasPending = useCallback(() => pending.current.length > 0, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pending.current.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return { reading, initializeReading, saveStatus, saveError, saveQueue, updateMark, savePosition, hasPending };
}
