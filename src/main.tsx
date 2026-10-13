import { Button } from './ui';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { lazy, Suspense } from 'react';
import { isDemoPath } from './routes';
const DemoApp = lazy(() => import('./demo/DemoApp'));
import '@samarinara/polli-ui/styles.css';
import './styles.css';
import './polli.css';

const storedTheme = localStorage.getItem('brownbag-theme');
const initialTheme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
document.documentElement.dataset.theme = initialTheme;
document.documentElement.dataset.resolvedTheme =
  initialTheme === 'dark' ||
  (initialTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark'
    : 'light';

document.documentElement.classList.toggle(
  'dark',
  document.documentElement.dataset.resolvedTheme === 'dark',
);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Something went wrong.</h1>
        <p>Your saved recipes are safe. Reload to try again.</p>
        <Button onClick={() => location.reload()}>Reload brownbag</Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isDemoPath(location.pathname) ? (
        <Suspense fallback={null}>
          <DemoApp />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
