import type { FileDiffMetadata } from '@pierre/diffs';
export function methodDiff(path: string, oldText: string, newText: string, oldRange: [number, number] | null, newRange: [number, number] | null, complete: boolean, cacheKey: string): FileDiffMetadata | null;
