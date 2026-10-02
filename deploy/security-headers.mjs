/**
 * Security headers for the three static SPAs: ONE source of truth for
 *   - apps/{web,console,table}/vercel.json  `headers`   (Vercel, the staging/production hosts)
 *   - deploy/nginx/*.headers.conf                       (Docker images, included by deploy/nginx-spa.conf)
 *   - the build-time <meta> CSP the Vite configs inject (cspMetaPlugin below).
 *
 * Regenerate after changing anything here:   node deploy/gen-security-headers.mjs
 * apps/web/src/lib/securityHeaders.test.ts fails when the generated files are out of date.
 *
 * Why connect-src is `https: wss:` in the header: the API origin is only known when the app is
 * BUILT (VITE_API_URL), while vercel.json and the nginx config are static and shared by every
 * environment (staging, previews, production, local Docker). So the header allows any TLS origin,
 * and the build injects a second, exact policy as <meta http-equiv="Content-Security-Policy">
 * naming only the API origin it was built for. Browsers enforce BOTH policies, so the effective
 * connect-src is the exact API origin. (frame-ancestors cannot be set from <meta>: it stays in the
 * header.) The club tablet is the exception: its API URL is typed in at setup, so it keeps the
 * header's `https:` only.
 */

/** Directives every app shares. No inline script or style, no eval, no plugins, no <base>. */
const BASE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-src': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/** Local Docker (deploy/nginx-spa.conf) serves over http with the API on http://localhost:4000. */
const LOCAL = ['http://localhost:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'ws://127.0.0.1:*'];

/**
 * @param {'web' | 'console' | 'table'} app
 * @param {{ embed?: boolean, target?: 'vercel' | 'nginx' }} [o]
 */
export function cspFor(app, o = {}) {
  const d = structuredClone(BASE);
  const local = o.target === 'nginx' ? LOCAL : [];
  if (app === 'web') {
    d['connect-src'] = ["'self'", 'https:', 'wss:', ...local];
    // The partner widget (/embed/…) is framed by partner sites; only over TLS.
    if (o.embed) d['frame-ancestors'] = ['https:', ...(o.target === 'nginx' ? ['http://localhost:*'] : [])];
  } else if (app === 'console') {
    d['connect-src'] = ["'self'", 'https:', ...local.filter((s) => s.startsWith('http'))];
    // The partner portal previews the widget in an iframe from the web app.
    d['frame-src'] = ['https:', ...local.filter((s) => s.startsWith('http'))];
  } else {
    d['connect-src'] = ["'self'", 'https:', ...local.filter((s) => s.startsWith('http'))];
  }
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

const PERMISSIONS = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()';

/**
 * @param {'web' | 'console' | 'table'} app
 * @param {{ embed?: boolean, target?: 'vercel' | 'nginx' }} [o]
 * @returns {{ key: string, value: string }[]}
 */
export function headersFor(app, o = {}) {
  const h = [
    { key: 'Content-Security-Policy', value: cspFor(app, o) },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS },
  ];
  if (!o.embed) {
    h.push({ key: 'X-Frame-Options', value: 'DENY' });
    h.push({ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' });
  }
  return h;
}

/** The vercel.json `headers` block: /embed gets its own rule, every other path the strict one. */
export function vercelHeaders(app) {
  if (app !== 'web') return [{ source: '/(.*)', headers: headersFor(app, { target: 'vercel' }) }];
  return [
    { source: '/((?!embed).*)', headers: headersFor(app, { target: 'vercel' }) },
    { source: '/embed/:path*', headers: headersFor(app, { embed: true, target: 'vercel' }) },
  ];
}

/** An nginx include file with one `add_header … always;` per header. */
export function nginxHeaders(app, embed = false) {
  return headersFor(app, { embed, target: 'nginx' }).map((x) => `add_header ${x.key} "${x.value}" always;`).join('\n') + '\n';
}

/**
 * The exact, build-time policy injected as <meta>: only the API origin (and, for the console, the
 * web app it previews). Returns null when nothing can be narrowed (the tablet).
 * @param {'web' | 'console' | 'table'} app
 * @param {{ apiUrl?: string, webUrl?: string }} env
 */
export function metaCsp(app, env) {
  if (app === 'table' || !env.apiUrl) return null;
  const api = new URL(env.apiUrl);
  const ws = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`;
  const parts = [`connect-src 'self' ${api.origin}${app === 'web' ? ` ${ws}` : ''}`];
  if (app === 'console' && env.webUrl) parts.push(`frame-src ${new URL(env.webUrl).origin}`);
  return parts.join('; ');
}

/**
 * Vite plugin: adds the metaCsp() policy to index.html in production builds only (the dev server
 * needs inline scripts and its own websocket for hot reload).
 * @param {'web' | 'console' | 'table'} app
 */
export function cspMetaPlugin(app) {
  /** @type {Record<string, string | undefined>} */
  let env = {};
  return {
    name: 'preflop-csp-meta',
    apply: 'build',
    /** @param {{ env: Record<string, string | undefined> }} config */
    configResolved(config) { env = config.env; },
    transformIndexHtml() {
      const policy = metaCsp(app, { apiUrl: env.VITE_API_URL ?? 'http://localhost:4000', webUrl: env.VITE_WEB_URL ?? 'http://localhost:5173' });
      return policy ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }] : [];
    },
  };
}
