export function sourcePosition(id, lineNumber, side) {
  return { type: 'line', id, lineNumber, side: side === 'old' ? 'deletions' : 'additions', align: 'center' };
}
