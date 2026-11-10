import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_IDLE_DAYS, STAFF_IDLE_MINUTES, tokenHash } from '../src/auth/players.ts';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * Production-readiness review, 2026-11-10: a session left unused is refused after its account's idle
 * limit (14 days; 30 minutes for PreFlop team accounts), whatever its 30-day expiry says.
 */
let h: Harness;
beforeAll(async () => {
  h = await harness('session_idle');
  await tx(h.db, (c) => seedAdmin(c, 'idle-admin@test.dev', 'admin-pass-1'));
});
afterAll(async () => h?.close());

const staffToken = async () => (await h.api('POST', '/v1/auth/login', undefined, { email: 'idle-admin@test.dev', password: 'admin-pass-1' })).body.token as string;
const lastSeen = (token: string, sqlInterval: string) => h.db.query(`update sessions set last_seen_at = now() - interval '${sqlInterval}' where token_sha256 = $1`, [tokenHash(token)]);
const me = (token: string) => h.api('GET', '/v1/me', token);
const seenAgoS = async (token: string) => Number((await h.db.query(`select extract(epoch from now() - last_seen_at) as s from sessions where token_sha256 = $1`, [tokenHash(token)])).rows[0].s);

describe('session idle timeout', () => {
  it('a player session works until it has been unused for the idle limit', async () => {
    const p = await h.register('Idle');
    await lastSeen(p.token, `${SESSION_IDLE_DAYS - 1} days`);
    expect((await me(p.token)).status).toBe(200);
    await lastSeen(p.token, `${SESSION_IDLE_DAYS} days 1 minute`);
    const refused = await me(p.token);
    expect(refused.status).toBe(401);
    expect(refused.body.type).toBe('unauthorized');
  });

  it('a PreFlop team session is refused after 30 unused minutes, a player session is not', async () => {
    const staff = await staffToken();
    const p = await h.register('Player');
    await lastSeen(staff, `${STAFF_IDLE_MINUTES - 1} minutes`);
    expect((await me(staff)).status).toBe(200);
    await lastSeen(staff, `${STAFF_IDLE_MINUTES + 1} minutes`);
    await lastSeen(p.token, `${STAFF_IDLE_MINUTES + 1} minutes`);
    expect((await me(staff)).status).toBe(401);
    expect((await me(p.token)).status).toBe(200);
  });

  it('a session never used since it was opened counts from its creation', async () => {
    const staff = await staffToken();
    await h.db.query(`update sessions set last_seen_at = null, created_at = now() - interval '2 hours' where token_sha256 = $1`, [tokenHash(staff)]);
    expect((await me(staff)).status).toBe(401);
  });

  it('using a session records it, at most once a minute', async () => {
    const p = await h.register('Seen');
    await lastSeen(p.token, '10 minutes');
    expect((await me(p.token)).status).toBe(200);
    expect(await seenAgoS(p.token)).toBeLessThan(5);
    await lastSeen(p.token, '20 seconds');
    expect((await me(p.token)).status).toBe(200);
    expect(await seenAgoS(p.token)).toBeGreaterThan(15);
  });
});
