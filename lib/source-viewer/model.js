// Adapter events for clipped source must use original snapshot coordinates.
export function toGlobalLine(localLine, startLine = 1) {
  if (!Number.isSafeInteger(localLine) || localLine < 1 || !Number.isSafeInteger(startLine) || startLine < 1) {
    throw new RangeError('Source line numbers must be positive integers');
  }
  return startLine + localLine - 1;
}

// A clipped method and a complete file must never share a renderer cache entry.
export function sourceCacheKey(documentId, side, range = null) {
  return JSON.stringify([documentId, side, range]);
}
