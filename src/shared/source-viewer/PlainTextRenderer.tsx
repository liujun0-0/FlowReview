import { resolveView } from './view-state';
import type { SourceViewerProps } from './types';

export function PlainTextRenderer(props: SourceViewerProps) {
  const view = resolveView(props.view);
  const sides = view.mode === 'diff' ? ['old', 'new'] as const : [view.mode];
  return <div className="fr-source-plain"><p>纯文本模式：不提供语法高亮、精确差异或标识符跳转。</p>{sides.map(side => {
    const source = side === 'old' ? props.document.before : props.document.after;
    const range = (side === 'old' ? view.oldRange : view.newRange) || view.fallbackRange;
    const lines = source.text.replace(/\r\n/g, '\n').split('\n');
    const start = view.extent === 'file' ? 1 : range[0];
    const end = view.extent === 'file' ? lines.length : range[1];
    return <section key={side}><strong>{side === 'old' ? '修改前' : '修改后'} · {props.document.path}</strong>
      {source.status !== 'text' ? <p>该版本：{source.status}</p> : <pre>{lines.slice(start - 1, end).map((line, i) => `${start + i}  ${line}`).join('\n')}</pre>}
      {props.annotations?.filter(a => a.side === side && (view.extent === 'file' || a.line >= start && a.line <= end)).map(a => <div key={a.id}>L{a.line}{a.content}</div>)}
    </section>;
  })}</div>;
}
