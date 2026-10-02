import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, passwordWeakness } from '../src/config.ts';

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

  it('malformed values are refused in every environment, naming the variable', () => {
    expect(problemsOf({ PORT: 'eighty' })[0]).toMatch(/^PORT:/);
    expect(problemsOf({ RESULT_SLA_MS: '-5' })[0]).toMatch(/^RESULT_SLA_MS:/);
    expect(problemsOf({ RUN_WORKER: 'maybe' })[0]).toMatch(/^RUN_WORKER:/);
    expect(problemsOf({ DATABASE_URL: 'not a url' })[0]).toMatch(/^DATABASE_URL:/);
    expect(() => loadConfig({ PORT: 'x' })).toThrow(/invalid configuration \(NODE_ENV=development\):\n {2}- PORT/);
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
    expect(problemsOf({ ...PROD, DATABASE_URL: 'postgres://u:Short-But-Random-9@db/preflop' })).toEqual([expect.stringMatching(/DATABASE_URL password is 18 characters; secrets must be at least 32/)]);
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

  it('lists every production problem at once', () => {
    const p = problemsOf({ NODE_ENV: 'production', CORS_ORIGINS: '*', WEBHOOK_ALLOW_PRIVATE: 'true', ADMIN_PASSWORD: 'x' });
    expect(p).toHaveLength(4); // CORS, DATABASE_URL unset, ADMIN_PASSWORD, WEBHOOK_ALLOW_PRIVATE
  });

  it('the same unsafe settings are allowed outside production', () => {
    expect(problemsOf({ NODE_ENV: 'test', CORS_ORIGINS: '*', WEBHOOK_ALLOW_PRIVATE: 'true', ADMIN_PASSWORD: 'x' })).toEqual([]);
  });
});
