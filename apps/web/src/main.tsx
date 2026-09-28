import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { initTheme } from './theme.ts';

initTheme();

// Offline use of active Runs (8.5): the service worker keeps the app shell. Production builds only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
