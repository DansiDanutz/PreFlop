import { ApiError } from '@preflop/client';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { SessionError } from '../components/ui.tsx';
import { errorMessage } from './format.ts';
import { CHUNK_RELOAD_KEY, loadChunk } from './lazy.ts';

afterEach(() => vi.unstubAllGlobals());

describe('F1: a portal chunk missing after a deploy reloads the tab once', () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
    reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
  });

  it('the first failed import reloads (and the promise never settles: the spinner stays until the reload)', async () => {
    const err = new TypeError('Failed to fetch dynamically imported module');
    let settled = false;
    void loadChunk(() => Promise.reject(err)).then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(reload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
  });

  it('a second failure in the same tab is rethrown, not reloaded again', async () => {
    const err = new TypeError('Failed to fetch dynamically imported module');
    void loadChunk(() => Promise.reject(err));
    await new Promise((r) => setTimeout(r, 0));
    await expect(loadChunk(() => Promise.reject(err))).rejects.toBe(err);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('storage that refuses the flag: the import error goes to the boundary, never a reload (no loop on every boot)', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new DOMException('blocked', 'SecurityError'); }, removeItem: () => {} });
    const err = new TypeError('Failed to fetch dynamically imported module');
    await expect(loadChunk(() => Promise.reject(err))).rejects.toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a successful load clears the flag', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    await expect(loadChunk(() => Promise.resolve({ Page: 1 }))).resolves.toEqual({ Page: 1 });
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('F1: the root error boundary', () => {
  // Error boundaries do not run during server rendering and there is no DOM in this environment,
  // so the boundary is driven the way React drives it: getDerivedStateFromError, then render.
  it('renders its children until a child throws, then the new-version message with a Reload button', () => {
    const b = new ErrorBoundary({ children: <span>fine</span> });
    expect(renderToStaticMarkup(b.render() as ReactElement)).toBe('<span>fine</span>');
    b.state = ErrorBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain('A new version of PreFlop is available.');
    expect(html).toContain('Reload');
    expect(html).toContain('role="alert"');
  });
});

describe('F4: a 500 shows the API request id', () => {
  it('errorMessage quotes the reference', () => {
    expect(errorMessage(new ApiError(500, { type: 'internal', title: 'internal error', status: 500, request_id: 'r1' }))).toBe('internal error (500) (ref r1)');
    expect(errorMessage(new ApiError(500, { type: 'internal', title: 'internal error', status: 500 }))).toBe('internal error (500)');
  });
});

describe('F10: RequireAuth when GET /v1/me fails', () => {
  it('offers a Retry button and a sign-out link', () => {
    const html = renderToStaticMarkup(<SessionError error={new ApiError(500, { type: 'internal', title: 'internal error', status: 500 })} onRetry={() => {}} onSignOut={() => {}} />);
    expect(html).toContain('internal error (500)');
    expect(html).toMatch(/<button[^>]*>.*Retry.*<\/button>/);
    expect(html).toContain('Sign out');
  });
});
