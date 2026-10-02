import { ApiError } from '@preflop/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { isEmbed } from './lib/api.ts';
// Fonts are self-hosted (bundled from @fontsource): no third-party request, and the CSP stays 'self'.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Do not hammer endpoints that are not built yet, or requests we are not allowed to make.
      retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>,
);

// Installable PWA: app-shell caching only; the service worker never stores API responses or the
// partner widget (see public/sw.js). Not registered inside partner iframes (/embed).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isEmbed()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
