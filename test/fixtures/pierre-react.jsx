import React from 'react';
export const WorkerPoolContextProvider = ({ children }) => children;
export const CodeView = React.forwardRef(function StubView(props, _ref) {
  return <div data-test-renderer="full-file">{props.items.flatMap(item => (item.annotations || []).map((annotation, index) => <div key={index}>{props.renderAnnotation?.(annotation, item)}</div>))}</div>;
});
export const File = () => <div data-test-renderer="file" />;
export const FileDiff = props => <div data-test-renderer="hunks">{props.lineAnnotations.map((annotation, i) => <div key={i}>{props.renderAnnotation(annotation)}</div>)}</div>;
