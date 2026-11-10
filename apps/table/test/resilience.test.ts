import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { type ReactElement, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';

describe('the root error boundary', () => {
  // No DOM here, and boundaries do not run during server rendering: drive it as React does.
  it('renders its children until a child throws, then a message with a Reload button instead of a blank screen', () => {
    const b = new ErrorBoundary({ children: createElement('span', null, 'fine') });
    expect(renderToStaticMarkup(b.render() as ReactElement)).toBe('<span>fine</span>');
    b.state = ErrorBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Something went wrong on this tablet');
    expect(html).toContain('Reload');
    // An action in flight when the render failed may still commit: the fallback must not claim otherwise.
    expect(html).toContain('check the state of the current hand');
    expect(html).not.toMatch(/nothing was sent|unchanged/i);
  });
});

describe('service worker: what a navigation may store as the app shell', () => {
  type Handler = (e: unknown) => void;
  /** Runs one navigation through the worker and returns what it stored under /index.html. */
  async function navigate(res: { ok: boolean; contentType: string | null }): Promise<string[]> {
    const handlers: Record<string, Handler> = {};
    const stored: string[] = [];
    const self = { location: { origin: 'https://table.preflop.app' }, addEventListener: (t: string, h: Handler) => { handlers[t] = h; } };
    const response = { ok: res.ok, headers: new Headers(res.contentType ? { 'content-type': res.contentType } : {}), clone: () => response };
    runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
      self, URL, Response,
      caches: { match: async () => undefined, open: async () => ({ put: async (key: string) => { stored.push(key); } }) },
      fetch: async () => response,
    });
    let answer: Promise<unknown> = Promise.resolve();
    handlers.fetch!({
      request: { url: 'https://table.preflop.app/', method: 'GET', mode: 'navigate', headers: new Headers() },
      respondWith: (p: Promise<unknown>) => { answer = p; },
    });
    await answer;
    await new Promise((r) => setTimeout(r, 0));
    return stored;
  }

  it('stores an HTML page', async () => {
    expect(await navigate({ ok: true, contentType: 'text/html; charset=utf-8' })).toEqual(['/index.html']);
  });

  it('never stores a non-HTML answer (a proxy error body, a JSON problem) as the shell', async () => {
    expect(await navigate({ ok: true, contentType: 'application/json' })).toEqual([]);
    expect(await navigate({ ok: true, contentType: null })).toEqual([]);
    expect(await navigate({ ok: false, contentType: 'text/html' })).toEqual([]);
  });
});
