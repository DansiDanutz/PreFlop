import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { RateLimiter } from '../src/lib/rateLimit.ts';
import { ApiError } from '../src/lib/errors.ts';
import { type Harness, bet, harness } from './helpers.ts';

let h: Harness;
let other: FastifyInstance; // a second API instance on the same database, rate limits off
beforeAll(async () => {
  const base = (await import('../src/config.ts')).loadConfig({});
  h = await harness('ratelimit', { rateLimit: { enabled: true, authPerMinute: 3, partnerTokenPerMinute: 2, betsPerMinute: 3 } });
  other = await buildApp(h.db, { ...h.config, rateLimit: { ...base.rateLimit, enabled: false } });
});
afterAll(async () => {
  await other?.close();
  await h?.close();
});

const call = (app: FastifyInstance, url: string, body: unknown, ip = '203.0.113.1', headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, remoteAddress: ip, headers: { 'content-type': 'application/json', ...headers }, payload: JSON.stringify(body) });

let n = 0;
const email = () => `rl${++n}-${Date.now()}@test.dev`;

describe('in-process rate limiter', () => {
  it('counts per key in a fixed window and reports Retry-After', () => {
    let now = 1_000_000;
    const l = new RateLimiter('t', 2, 60_000, () => now);
    l.consume('a');
    l.consume('a');
    l.consume('b');
    const err = (() => { try { l.consume('a'); } catch (e) { return e; } })() as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.type).toBe('rate_limited');
    expect(err.extra.retry_after_s).toBe(60);
    now += 30_000;
    expect(((() => { try { l.consume('a'); } catch (e) { return e; } })() as ApiError).extra.retry_after_s).toBe(30);
    now += 30_000; // window over
    expect(() => l.consume('a')).not.toThrow();
  });
});

describe('rate limits (problem+json, 429, Retry-After)', () => {
  it('register is limited per IP', async () => {
    const res = [];
    for (let i = 0; i < 4; i++) res.push(await call(h.app, '/v1/auth/register', { email: email(), password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'R' }, '203.0.113.10'));
    expect(res.slice(0, 3).map((r) => r.statusCode)).toEqual([201, 201, 201]);
    const r = res[3]!;
    expect(r.statusCode).toBe(429);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(r.json()).toMatchObject({ type: 'rate_limited', status: 429 });
    // another client address is not affected
    expect((await call(h.app, '/v1/auth/register', { email: email(), password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'R' }, '203.0.113.11')).statusCode).toBe(201);
  });

  it('login is limited per IP, before any password check', async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call(h.app, '/v1/auth/login', { email: email(), password: 'whatever' }, '203.0.113.20')).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('partner token issuance is limited per IP', async () => {
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await call(h.app, '/v1/partner/oauth/token', { grant_type: 'client_credentials', client_id: 'cli_x', client_secret: 'nope' }, '203.0.113.30')).statusCode);
    expect(codes).toEqual([401, 401, 429]);
  });

  it('POST /v1/bets is limited per user, not per IP', async () => {
    const a = (await call(h.app, '/v1/auth/register', { email: email(), password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'A' }, '203.0.113.40')).json().token as string;
    const b = (await call(h.app, '/v1/auth/register', { email: email(), password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'B' }, '203.0.113.41')).json().token as string;
    await h.sim.heartbeat();
    await h.work();
    const hand = await h.sim.openHand();
    const rid = `sim-1:h${hand}`;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await bet(h, a, rid, 'colour:mixed', 10)).status);
    expect(codes).toEqual([201, 201, 201, 429]);
    const limited = await bet(h, a, rid, 'colour:mixed', 10);
    expect(limited.body).toMatchObject({ type: 'rate_limited', status: 429 });
    expect((await bet(h, b, rid, 'colour:mixed', 10)).status).toBe(201);
  });
});

describe('login lockout (Postgres, across instances)', () => {
  it('5 failures for an email lock it for 15 minutes on every instance; a later success clears the count', async () => {
    const e = email();
    expect((await call(other, '/v1/auth/register', { email: e, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'L' })).statusCode).toBe(201);
    for (let i = 0; i < 5; i++) {
      const r = await call(other, '/v1/auth/login', { email: e, password: `wrong-${i}` }, `198.51.100.${i}`);
      expect(r.statusCode).toBe(401);
      expect(r.json().type).toBe('invalid_credentials');
    }
    // the right password is refused too while locked, without being checked
    const locked = await call(other, '/v1/auth/login', { email: e, password: 'correct horse' }, '198.51.100.99');
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(locked.json()).toMatchObject({ type: 'login_locked', status: 429 });
    const retry = Number(locked.headers['retry-after']);
    expect(retry).toBeGreaterThan(14 * 60);
    expect(retry).toBeLessThanOrEqual(15 * 60);
    // the other API instance (same database) sees the same lock
    const viaH = await call(h.app, '/v1/auth/login', { email: e, password: 'correct horse' }, '198.51.100.100');
    expect(viaH.statusCode).toBe(429);
    expect(viaH.json().type).toBe('login_locked');
    // other accounts are unaffected
    const e2 = email();
    await call(other, '/v1/auth/register', { email: e2, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'M' });
    expect((await call(other, '/v1/auth/login', { email: e2, password: 'correct horse' })).statusCode).toBe(200);

    // 15 minutes later the lock has lifted; a success clears the failures
    await h.db.query(`update login_failures set at = at - interval '15 minutes 1 second' where email = $1`, [e]);
    expect((await call(other, '/v1/auth/login', { email: e, password: 'correct horse' })).statusCode).toBe(200);
    expect((await h.db.query('select count(*)::int as n from login_failures where email = $1', [e])).rows[0].n).toBe(0);
  });

  it('the window slides: 4 old failures plus 1 new one do not lock', async () => {
    const e = email();
    await call(other, '/v1/auth/register', { email: e, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'S' });
    for (let i = 0; i < 4; i++) await call(other, '/v1/auth/login', { email: e, password: 'wrong' });
    await h.db.query(`update login_failures set at = at - interval '16 minutes' where email = $1`, [e]);
    expect((await call(other, '/v1/auth/login', { email: e, password: 'wrong' })).statusCode).toBe(401);
    expect((await call(other, '/v1/auth/login', { email: e, password: 'correct horse' })).statusCode).toBe(200);
  });

  it('concurrent guesses cannot slip past the limit', async () => {
    const e = email();
    await call(other, '/v1/auth/register', { email: e, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: 'C' });
    const res = await Promise.all(Array.from({ length: 12 }, (_, i) => call(other, '/v1/auth/login', { email: e, password: `guess-${i}` })));
    const codes = res.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(7);
  });

  it('unknown emails are locked the same way (no account enumeration)', async () => {
    const e = email();
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await call(other, '/v1/auth/login', { email: e, password: 'x' })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
