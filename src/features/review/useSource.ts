import { useEffect, useState } from 'react';
import { api, reportId } from './api';
import type { Sources } from './types';

const cache = new Map<string, Promise<Sources>>();
const MAX_FILES = 24;
export function loadSource(fileId: string) {
  const key = `${reportId}:${fileId}`;
  let source = cache.get(key);
  if (source) { cache.delete(key); cache.set(key, source); return source; }
  source = api<Sources>(`reports/${reportId}/source/${fileId}`);
  cache.set(key, source);
  source.catch(() => { if (cache.get(key) === source) cache.delete(key); });
  while (cache.size > MAX_FILES) cache.delete(cache.keys().next().value!);
  return source;
}
export function useSource(fileId: string) {
  const [state, setState] = useState<{ id: string; data?: Sources; error?: string }>({ id: '' });
  useEffect(() => {
    let live = true;
    if (fileId) loadSource(fileId).then(data => { if (live) setState({ id: fileId, data }); }, error => { if (live) setState({ id: fileId, error: error.message }); });
    return () => { live = false; };
  }, [fileId]);
  return state.id === fileId ? state : { id: fileId };
}
