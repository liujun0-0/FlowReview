import type { SourceViewRequest } from '../../src/shared/source-viewer';

const source: SourceViewRequest = { kind: 'source', side: 'old', extent: 'file', range: [10, 20] };
const compared: SourceViewRequest = { kind: 'diff', scope: 'file', display: 'file', focus: { side: 'old', line: 10 }, layout: 'split' };
// @ts-expect-error source-only requests cannot also select a diff layout.
const contradictory: SourceViewRequest = { kind: 'source', side: 'new', extent: 'range', range: [1, 2], layout: 'split' };
// @ts-expect-error diff requests need an explicit scope and focus; an independent side is invalid.
const incomplete: SourceViewRequest = { kind: 'diff', side: 'new', extent: 'file' };
void [source, compared, contradictory, incomplete];
