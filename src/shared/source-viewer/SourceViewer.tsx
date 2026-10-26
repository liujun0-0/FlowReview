import { Component, createContext, useContext, type PropsWithChildren } from 'react';
import { defaultAdapter } from './adapters/default';
import { PlainTextRenderer } from './PlainTextRenderer';
import type { SourceRendererAdapter, SourceViewerProps } from './types';
import './source-viewer.css';

const AdapterContext = createContext<SourceRendererAdapter>(defaultAdapter);

export function SourceViewerProvider({ children, adapter = defaultAdapter }: PropsWithChildren<{ adapter?: SourceRendererAdapter }>) {
  const Provider = adapter.Provider;
  return <AdapterContext.Provider value={adapter}>{Provider ? <Provider>{children}</Provider> : children}</AdapterContext.Provider>;
}

class RenderBoundary extends Component<PropsWithChildren<{ viewer: SourceViewerProps }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.viewer.onRenderError?.(error); }
  render() {
    return this.state.failed ? <><p role="alert">代码渲染失败，已切换为纯文本。</p><PlainTextRenderer {...this.props.viewer} /></> : this.props.children;
  }
}

export function SourceViewer(props: SourceViewerProps) {
  const { Renderer } = useContext(AdapterContext);
  const identity = [props.document.id, props.mode, props.extent, props.comparison, props.completeMethod, props.split].join(':');
  return <div className="fr-source-viewer"><RenderBoundary key={identity} viewer={props}><Renderer {...props} /></RenderBoundary></div>;
}
