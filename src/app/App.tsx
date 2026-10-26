import { lazy, Suspense } from 'react';
import { Home } from './Home';

const ReviewReader = lazy(() => import('../features/review/ReviewReader').then(m => ({ default: m.ReviewReader })));
const LegacyViewer = lazy(() => import('../legacy/yadiff/App').then(m => ({ default: m.App })));

export function App() {
  const path = window.location.pathname;
  return <Suspense fallback={<div className="fr-home">正在打开 FlowReview…</div>}>
    {path.startsWith('/review/') ? <ReviewReader /> : path === '/legacy' || path.startsWith('/legacy/') ? <LegacyViewer /> : <Home />}
  </Suspense>;
}
