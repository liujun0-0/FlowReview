import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ReviewReader } from './review/ReviewReader';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.startsWith('/review/') ? <ReviewReader /> : <App />}
  </React.StrictMode>
);
