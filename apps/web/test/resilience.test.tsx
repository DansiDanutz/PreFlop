import { ApiError } from '@preflop/client';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { getToken, setToken, setUnauthorizedHandler } from '../src/lib/api.ts';
import { CHUNK_RELOAD_KEY, loadChunk } from '../src/lib/lazy.ts';
import { betProblem, errorText } from '../src/lib/problems.ts';
import { authRejected, dispatchFrame } from '../src/lib/stream.ts';

/** A window with storage and a reload spy (the tests run in node). */
function fakeWindow() {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  const reload = vi.fn();
  vi.stubGlobal('window', { sessionStorage: mem(), localStorage: mem(), location: { reload, pathname: '/app' } });
  return { reload };
}

afterEach(() => vi.unstubAllGlobals());

describe('F1: a route chunk missing after a deploy reloads the tab once', () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => { ({ reload } = fakeWindow()); });

  it('the first failed import reloads (and the promise never settles: the spinner stays until the reload)', async () => {
    const err = new TypeError('Failed to fetch dynamically imported module');
    let settled = false;
    void loadChunk(() => Promise.reject(err)).then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(reload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
  });

  it('a second failure in the same tab is rethrown, not reloaded again (a real outage never loops)', async () => {
    const err = new TypeError('Failed to fetch dynamically imported module');
    void loadChunk(() => Promise.reject(err));
    await new Promise((r) => setTimeout(r, 0));
    await expect(loadChunk(() => Promise.reject(err))).rejects.toBe(err);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a successful load clears the flag, so a later deploy gets its one reload too', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    await expect(loadChunk(() => Promise.resolve({ Page: 1 }))).resolves.toEqual({ Page: 1 });
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
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
  it('errorText quotes the reference, other errors stay as they were', () => {
    expect(errorText(new ApiError(500, { type: 'internal', title: 'internal error', status: 500, request_id: 'r1' }))).toBe('internal error (ref r1)');
    expect(errorText(new ApiError(500, { type: 'internal', title: 'internal error', status: 500 }))).toBe('internal error');
    expect(errorText(new ApiError(400, { type: 'bad_request', title: 'bad', status: 400, request_id: 'r2' }))).toBe('Please check the form and try again.');
  });
});

describe('F5: stake limit refusals in the player\'s words', () => {
  const p = (type: string, extra: Record<string, unknown> = {}) => betProblem(new ApiError(422, { type, title: type, status: 422, ...extra }));

  it('invalid_stake: above the currency maximum', () => {
    const r = p('invalid_stake');
    expect(r.kind).toBe('limit_exceeded');
    expect(r.message).toBe('This stake is above the maximum for this currency. Try a smaller amount.');
  });

  it('house_limit: the house cannot cover the payout, with the maximum when the API gives one', () => {
    expect(p('house_limit').message).toBe('The house cannot cover a payout this large. Try a smaller amount.');
    expect(p('house_limit', { max_payout_minor: 250000, currency: 'EUR' }).message).toBe('The house cannot cover a payout this large (max €2,500.00). Try a smaller amount.');
    expect(p('house_limit', { max_payout_minor: 1000 }).message).toContain('(max 1,000)');
  });

  it('user_round_limit: the player\'s own bets on the round', () => {
    const r = p('user_round_limit', { max_payout_minor: 5000, currency: 'PLAY' });
    expect(r.kind).toBe('limit_exceeded');
    expect(r.message).toBe('Your predictions on this round would pay out more than allowed (max 5,000 free chips). Try a smaller amount.');
  });
});

describe('F9: the stream\'s refused auth frame signs the session out like a REST 401', () => {
  beforeEach(() => fakeWindow());
  afterEach(() => setUnauthorizedHandler(null));

  it('recognises only {type:"auth", ok:false}', () => {
    expect(authRejected({ type: 'auth', ok: false, data: {}, at: 1 } as never)).toBe(true);
    expect(authRejected({ type: 'auth', ok: true, data: {}, at: 1 } as never)).toBe(false);
    expect(authRejected({ type: 'round.locked', data: {}, at: 1 })).toBe(false);
  });

  it('clears the token through the shared unauthorized handler and passes every other frame on', () => {
    setToken('sess-1');
    expect(getToken()).toBe('sess-1');
    setUnauthorizedHandler(() => { if (getToken()) setToken(null); }); // what useSessionGuard installs
    const onEvent = vi.fn();
    dispatchFrame({ type: 'round.locked', data: {}, at: 1 }, onEvent);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(getToken()).toBe('sess-1');
    dispatchFrame({ type: 'auth', ok: false, data: {}, at: 2 } as never, onEvent);
    expect(getToken()).toBeNull();
    expect(onEvent).toHaveBeenCalledOnce();
  });
});
