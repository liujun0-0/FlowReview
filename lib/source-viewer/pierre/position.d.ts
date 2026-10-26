export function sourcePosition(id: string, lineNumber: number, side: 'old' | 'new'): { type: 'line'; id: string; lineNumber: number; side: 'deletions' | 'additions'; align: 'center' };
