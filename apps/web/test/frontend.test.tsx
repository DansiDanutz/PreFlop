import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generated } from '../../../deploy/gen-security-headers.mjs';
import { cspFor, headersFor, metaCsp, vercelHeaders } from '../../../deploy/security-headers.mjs';
import { LiveBanner } from '../src/components/table/LiveBanner.tsx';
import { accentVars, embedToken, marketAllowed, parseEmbedParams } from '../src/lib/embed.ts';
import { streamGate } from '../src/lib/live.ts';

const root = join(__dirname, '../../..');

describe('offline banner and bet gate', () => {
  it('pauses bets unless the stream is open', () => {
    expect(streamGate('open')).toEqual({ paused: false, message: null });
    expect(streamGate('closed')).toEqual({ paused: true, message: 'Reconnecting… bets paused' });
    expect(streamGate('connecting').paused).toBe(true);
  });

  it('shows "Reconnecting… bets paused" when the socket drops, nothing when connected', () => {
    const closed = renderToStaticMarkup(<LiveBanner ws="closed" />);
    expect(closed).toContain('Reconnecting… bets paused');
    expect(closed).toContain('role="status"');
    expect(renderToStaticMarkup(<LiveBanner ws="open" />)).toBe('');
    // The first connection gets a grace period (no flash on a normal page load)…
    expect(renderToStaticMarkup(<LiveBanner ws="connecting" />)).toBe('');
    // …unless there is none.
    expect(renderToStaticMarkup(<LiveBanner ws="connecting" graceMs={0} />)).toContain('bets paused');
  });
});

describe('partner widget options', () => {
  const p = (q: string) => parseEmbedParams(new URLSearchParams(q));

  it('reads accent, markets, stakes and table', () => {
    expect(p('accent=%23FF8800&markets=hand-class,colour&stakes=200,10,50&table=sim-1')).toEqual({
      accent: '#ff8800', markets: ['hand-class', 'colour'], stakes: [10, 50, 200], table: 'sim-1',
    });
    expect(p('')).toEqual({ accent: null, markets: null, stakes: null, table: null });
  });

  it('drops anything invalid', () => {
    expect(p('accent=red').accent).toBeNull();
    expect(p('accent=%23ff88').accent).toBeNull();
    expect(p('accent=%23ff8800;background:url(x)').accent).toBeNull();
    expect(p('markets=<script>,hand-class,,../x').markets).toEqual(['hand-class']);
    expect(p('stakes=0,-5,1.5,abc,2000000,25,25').stakes).toEqual([25]);
    expect(p('stakes=1,2,3,4,5,6,7').stakes).toEqual([1, 2, 3, 4, 5]);
    expect(p('table=a%20b').table).toBeNull();
  });

  it('takes the session from the fragment first, then the query', () => {
    expect(embedToken(new URLSearchParams(''), '#token=abc')).toBe('abc');
    expect(embedToken(new URLSearchParams('token=old'), '#token=new')).toBe('new');
    expect(embedToken(new URLSearchParams('token=old'), '')).toBe('old');
    expect(embedToken(new URLSearchParams(''), '')).toBeNull();
  });

  it('derives readable accent variables', () => {
    const light = accentVars('#ffdd00');
    expect(light['--color-accent']).toBe('#ffdd00');
    expect(light['--color-accent-ink']).toBe('#06170f');
    expect(light['--color-accent-soft']).toBe('rgba(255, 221, 0, 0.12)');
    expect(accentVars('#1a237e')['--color-accent-ink']).toBe('#ffffff');
    for (const v of Object.values(accentVars('#123456'))) expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\([\d, .]+\))$/);
  });

  it('filters markets', () => {
    expect(marketAllowed(null, 'colour')).toBe(true);
    expect(marketAllowed(['colour'], 'colour')).toBe(true);
    expect(marketAllowed(['colour'], 'hand-class')).toBe(false);
    expect(marketAllowed(['colour'], undefined)).toBe(false);
  });
});

describe('security headers', () => {
  it('generated vercel.json and nginx files match deploy/security-headers.mjs (run node deploy/gen-security-headers.mjs)', () => {
    for (const [path, text] of Object.entries(generated())) expect(readFileSync(join(root, path), 'utf8'), path).toBe(text);
  });

  it('only the web /embed route can be framed, and only by https sites', () => {
    expect(cspFor('web')).toContain("frame-ancestors 'none'");
    expect(cspFor('console')).toContain("frame-ancestors 'none'");
    expect(cspFor('table')).toContain("frame-ancestors 'none'");
    expect(cspFor('web', { embed: true, target: 'vercel' })).toContain('frame-ancestors https:;');
    expect(headersFor('web').map((h) => h.key)).toContain('X-Frame-Options');
    expect(headersFor('web', { embed: true }).map((h) => h.key)).not.toContain('X-Frame-Options');
    const [main, embed] = vercelHeaders('web');
    expect(main!.source).toBe('/((?!embed).*)');
    expect(embed!.source).toBe('/embed/:path*');
  });

  it('allows no inline script or style, no eval, and only self-hosted fonts', () => {
    for (const app of ['web', 'console', 'table'] as const) {
      const c = cspFor(app);
      expect(c).not.toMatch(/unsafe-inline|unsafe-eval|fonts\.g/);
      expect(c).toContain("script-src 'self'");
      expect(c).toContain("img-src 'self' data:");
      expect(c).toContain("worker-src 'self'");
      for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
        expect(headersFor(app).map((x) => x.key)).toContain(h);
      }
    }
  });

  it('narrows connect-src to the API origin at build time', () => {
    expect(metaCsp('web', { apiUrl: 'https://preflop-staging-api.fly.dev' })).toBe("connect-src 'self' https://preflop-staging-api.fly.dev wss://preflop-staging-api.fly.dev");
    expect(metaCsp('console', { apiUrl: 'https://api.example', webUrl: 'https://web.example/x' })).toBe("connect-src 'self' https://api.example; frame-src https://web.example");
    expect(metaCsp('table', { apiUrl: 'https://api.example' })).toBeNull();
  });
});

describe('service worker', () => {
  type Handler = (e: unknown) => void;
  function load() {
    const handlers: Record<string, Handler> = {};
    const self = { location: { origin: 'https://preflop.app' }, addEventListener: (t: string, h: Handler) => { handlers[t] = h; } };
    runInNewContext(readFileSync(join(__dirname, '../public/sw.js'), 'utf8'), { self, URL, caches: { match: async () => undefined, open: async () => ({ put: async () => {} }) }, fetch: () => new Promise(() => {}), Response });
    const handled = (url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) => {
      let responded = false;
      handlers.fetch!({
        request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: new Headers(init.headers ?? {}) },
        respondWith: () => { responded = true; },
      });
      return responded;
    };
    return handled;
  }

  it('never answers API calls, the partner widget, writes or authenticated requests', () => {
    const handled = load();
    expect(handled('https://api.preflop.app/v1/me/wallets')).toBe(false);
    expect(handled('https://preflop.app/v1/me')).toBe(false);
    expect(handled('https://preflop.app/embed/table/sim-1', { mode: 'navigate' })).toBe(false);
    expect(handled('https://preflop.app/embed', { mode: 'navigate' })).toBe(false);
    expect(handled('https://preflop.app/assets/index-abc.js', { method: 'POST' })).toBe(false);
    expect(handled('https://preflop.app/assets/index-abc.js', { headers: { authorization: 'Bearer x' } })).toBe(false);
    expect(handled('https://fonts.example/x.woff2')).toBe(false);
  });

  it('serves the app shell: navigations (network first) and built assets', () => {
    const handled = load();
    expect(handled('https://preflop.app/app/table/sim-1', { mode: 'navigate' })).toBe(true);
    expect(handled('https://preflop.app/assets/index-abc.js')).toBe(true);
    expect(handled('https://preflop.app/manifest.webmanifest')).toBe(true);
    expect(handled('https://preflop.app/some-other-file.txt')).toBe(false);
  });

  it('is linked from index.html with a valid manifest', () => {
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline scripts (CSP script-src 'self')
    const m = JSON.parse(readFileSync(join(__dirname, '../public/manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: expect.any(String), short_name: 'PreFlop', start_url: '/app', display: 'standalone' });
    expect(m.icons.some((i: { purpose: string; sizes: string }) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(m.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
  });
});
