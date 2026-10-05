import { describe, expect, it } from 'vitest';
import { ConfigError, corsOrigin, isPrivateDbHost, loadConfig, passwordWeakness } from '../src/config.ts';

const STRONG_DB = `postgres://preflop:${'k'.repeat(20)}Q7-${'z'.repeat(12)}@db.internal:5432/preflop`;
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: STRONG_DB,
  CORS_ORIGINS: 'https://preflop.example.com,https://console.preflop.example.com',
};

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe('validated config', () => {
  it('development defaults parse as before', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ nodeEnv: 'development', port: 4000, runWorker: true, playStartMinor: 10_000, corsOrigins: ['*'], trustProxy: false, log: false });
    expect(c.resultSlaMs).toBe(300_000);
    expect(loadConfig({ RUN_WORKER: 'false', PORT: '8080', LOG: '1', CORS_ORIGINS: 'http://a.dev, http://b.dev' })).toMatchObject({ runWorker: false, port: 8080, log: true, corsOrigins: ['http://a.dev', 'http://b.dev'] });
  });

  it('TRUST_PROXY is false, true, a hop count or the proxies\' CIDRs; production refuses a bare true', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '10.0.0.0/8, fdaa::/16, uniquelocal' }).trustProxy).toEqual(['10.0.0.0/8', 'fdaa::/16', 'uniquelocal']);
    expect(problemsOf({ TRUST_PROXY: 'yes please' })[0]).toMatch(/^TRUST_PROXY:/);
    expect(problemsOf({ TRUST_PROXY: '10.0.0.0/8, evil' })[0]).toMatch(/^TRUST_PROXY:/);
    expect(problemsOf({ TRUST_PROXY: '10.0.0.0/64' })[0]).toMatch(/^TRUST_PROXY:/);
    expect(problemsOf({ TRUST_PROXY: 'fdaa::/129' })[0]).toMatch(/^TRUST_PROXY:/);
    expect(loadConfig({ TRUST_PROXY: '10.0.0.0/32, fdaa::/128' }).trustProxy).toEqual(['10.0.0.0/32', 'fdaa::/128']);
    expect(problemsOf({ ...PROD, TRUST_PROXY: 'true' }).join(' ')).toMatch(/TRUST_PROXY=true trusts every X-Forwarded-For hop/);
    expect(problemsOf({ ...PROD, TRUST_PROXY: '1' })).toEqual([]);
  });

  it('malformed values are refused in every environment, naming the variable', () => {
    expect(problemsOf({ PORT: 'eighty' })[0]).toMatch(/^PORT:/);
    expect(problemsOf({ RESULT_SLA_MS: '-5' })[0]).toMatch(/^RESULT_SLA_MS:/);
    expect(problemsOf({ RUN_WORKER: 'maybe' })[0]).toMatch(/^RUN_WORKER:/);
    expect(problemsOf({ DATABASE_URL: 'not a url' })[0]).toMatch(/^DATABASE_URL:/);
    expect(() => loadConfig({ PORT: 'x' })).toThrow(/invalid configuration \(NODE_ENV=development\):\n {2}- PORT/);
  });

  it('production requires TLS to a remote database and accepts a managed 16-character password', () => {
    const neon = (q: string) => ({ ...PROD, DATABASE_URL: `postgres://neondb_owner:npg_A1b2C3d4E5f6@ep-cool-1.eu-central-1.aws.neon.tech/neondb${q}` });
    expect(problemsOf(neon('?sslmode=verify-full'))).toEqual([]);
    expect(problemsOf(neon(''))).toEqual([expect.stringMatching(/without TLS/)]);
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://preflop:shortpw1@ep-x.neon.tech/db?sslmode=verify-full' })[0]).toMatch(/at least 16/);
    // Private hosts (Docker, Fly private network) need no TLS.
    for (const host of ['postgres', 'db.internal', 'preflop-db.flycast', 'localhost']) {
      expect(problemsOf({ ...PROD, DATABASE_URL: `postgres://preflop:${'k'.repeat(20)}Q7@${host}:5432/preflop` })).toEqual([]);
    }
    // IP literals other than loopback are public: a public IPv6 address still needs TLS.
    expect(problemsOf({ ...PROD, DATABASE_URL: `postgres://preflop:${'k'.repeat(20)}Q7@[2001:db8::10]:5432/preflop` })).toEqual([expect.stringMatching(/without TLS/)]);
    expect(problemsOf({ ...PROD, DATABASE_URL: `postgres://preflop:${'k'.repeat(20)}Q7@[2001:db8::10]:5432/preflop?sslmode=verify-full` })).toEqual([]);
    expect(isPrivateDbHost('[::1]')).toBe(true);
    expect(isPrivateDbHost('[fd00::1]')).toBe(false);
    expect(isPrivateDbHost('203.0.113.7')).toBe(false);
  });

  it('CORS_ORIGINS may hold a narrow per-deployment wildcard for preview URLs', () => {
    const preview = 'https://preflop-staging-web-*-irises-projects-ce549f63.vercel.app';
    expect(problemsOf({ ...PROD, CORS_ORIGINS: `https://preflop-staging-web.vercel.app,${preview}` })).toEqual([]);
    const [exact, pattern] = corsOrigin(['https://preflop-staging-web.vercel.app', preview]) as [string, RegExp];
    expect(exact).toBe('https://preflop-staging-web.vercel.app');
    expect(pattern.test('https://preflop-staging-web-a1b2c3d4e-irises-projects-ce549f63.vercel.app')).toBe(true);
    // The * never spans a dash or a dot: another account's names or hosts don't match.
    expect(pattern.test('https://preflop-staging-web-x-evil-irises-projects-ce549f63.vercel.app')).toBe(false);
    expect(pattern.test('https://preflop-staging-web-a.evil.com-irises-projects-ce549f63.vercel.app')).toBe(false);
    expect(pattern.test('https://preflop-staging-web-abc-irises-projects-ce549f63.vercel.app.evil.com')).toBe(false);
    expect(pattern.test('http://preflop-staging-web-abc-irises-projects-ce549f63.vercel.app')).toBe(false);
    expect(corsOrigin(['*'])).toBe(true);
    // Broad wildcards are refused in production.
    for (const broad of ['https://*.vercel.app', 'https://*-x.vercel.app', 'http://web-*-x.vercel.app', 'https://web-*-x-*-y.vercel.app']) {
      expect(problemsOf({ ...PROD, CORS_ORIGINS: broad })).toEqual([expect.stringMatching(/too broad/)]);
    }
  });

  it('production accepts the native apps\' origins (capacitor://localhost on iOS, https://localhost on Android)', () => {
    const env = { ...PROD, CORS_ORIGINS: `capacitor://localhost,https://localhost,${PROD.CORS_ORIGINS}` };
    expect(problemsOf(env)).toEqual([]);
    expect(corsOrigin(loadConfig(env).corsOrigins)).toEqual(['capacitor://localhost', 'https://localhost', 'https://preflop.example.com', 'https://console.preflop.example.com']);
  });

  it('a safe production environment starts', () => {
    expect(problemsOf(PROD)).toEqual([]);
    expect(loadConfig(PROD).nodeEnv).toBe('production');
  });

  it('production refuses CORS_ORIGINS "*" or empty', () => {
    expect(problemsOf({ ...PROD, CORS_ORIGINS: '*' })).toEqual([expect.stringMatching(/CORS_ORIGINS must not be "\*"/)]);
    expect(problemsOf({ ...PROD, CORS_ORIGINS: 'https://a.example.com,*' })).toEqual([expect.stringMatching(/CORS_ORIGINS must not be "\*"/)]);
    expect(problemsOf({ ...PROD, CORS_ORIGINS: '' })).toEqual([expect.stringMatching(/CORS_ORIGINS must list/)]);
    const { CORS_ORIGINS: _, ...noCors } = PROD;
    expect(problemsOf(noCors)).toEqual([expect.stringMatching(/CORS_ORIGINS must list/)]);
  });

  it('production refuses demo or short secrets', () => {
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://postgres:postgres@db:5432/preflop' })).toEqual([expect.stringMatching(/DATABASE_URL password is a known demo\/default value/)]);
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://u:changeme-please-0123456789012345678901@db/preflop' })).toEqual([expect.stringMatching(/known demo/)]);
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://u:Rnd-9xQ2zL7@db/preflop' })).toEqual([expect.stringMatching(/DATABASE_URL password is 11 characters; it must be at least 16/)]);
    // no password (peer / IAM auth) is not a secret to check
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://preflop@db.internal/preflop' })).toEqual([]);
    const { DATABASE_URL: _, ...noDb } = PROD;
    expect(problemsOf(noDb)).toEqual([expect.stringMatching(/DATABASE_URL must be set in production/)]);
  });

  it('production refuses a weak ADMIN_PASSWORD but accepts a strong one', () => {
    expect(problemsOf({ ...PROD, ADMIN_PASSWORD: 'admin-pass-1' })).toEqual([expect.stringMatching(/ADMIN_PASSWORD is a known demo/)]);
    expect(problemsOf({ ...PROD, ADMIN_PASSWORD: 'Sh0rt!' })).toEqual([expect.stringMatching(/ADMIN_PASSWORD is shorter than 12/)]);
    expect(problemsOf({ ...PROD, ADMIN_PASSWORD: 'MyPreflopIsGreat1!' })).toEqual([expect.stringMatching(/contains the common word "preflop"/)]);
    expect(problemsOf({ ...PROD, ADMIN_PASSWORD: 'alllowercaseletters' })).toEqual([expect.stringMatching(/at least 3 of/)]);
    expect(problemsOf({ ...PROD, ADMIN_PASSWORD: 'Tr0ub4dor&3-Horse-Staple' })).toEqual([]);
    expect(passwordWeakness('Tr0ub4dor&3-Horse-Staple')).toBeNull();
  });

  it('production refuses WEBHOOK_ALLOW_PRIVATE=true', () => {
    expect(problemsOf({ ...PROD, WEBHOOK_ALLOW_PRIVATE: 'true' })).toEqual([expect.stringMatching(/WEBHOOK_ALLOW_PRIVATE=true is for local tests only/)]);
    expect(problemsOf({ ...PROD, WEBHOOK_ALLOW_PRIVATE: 'false' })).toEqual([]);
  });

  it('production refuses RATE_LIMIT_ENABLED=false; limits are configurable', () => {
    expect(problemsOf({ ...PROD, RATE_LIMIT_ENABLED: 'false' })).toEqual([expect.stringMatching(/RATE_LIMIT_ENABLED=false is for tests/)]);
    expect(loadConfig({ RATE_LIMIT_BETS_PER_MIN: '30' }).rateLimit).toEqual({ enabled: true, authPerMinute: 20, partnerTokenPerMinute: 30, betsPerMinute: 30 });
  });

  it('lists every production problem at once', () => {
    const p = problemsOf({ NODE_ENV: 'production', CORS_ORIGINS: '*', WEBHOOK_ALLOW_PRIVATE: 'true', ADMIN_PASSWORD: 'x' });
    expect(p).toHaveLength(4); // CORS, DATABASE_URL unset, ADMIN_PASSWORD, WEBHOOK_ALLOW_PRIVATE
  });

  it('the same unsafe settings are allowed outside production', () => {
    expect(problemsOf({ NODE_ENV: 'test', CORS_ORIGINS: '*', WEBHOOK_ALLOW_PRIVATE: 'true', ADMIN_PASSWORD: 'x' })).toEqual([]);
  });
});
