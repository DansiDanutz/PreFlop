import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userFromToken, revokeSessions } from '../src/auth/players.ts';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * SEM-148 / SEM-149 bounded regressions (Seme audit, local only).
 *  - other-user isolation: revocation and token checks never cross users
 *  - audit-count: security events are audited exactly once per action
 *  - rollback: a failed MFA enable leaves no partial state (enabled_at stays null, sessions intact)
 *  - invalidation: a revoked token is refused by userFromToken (the check the stream ping re-runs)
 */
let h: Harness;
beforeAll(async () => {
  h = await harness('seme_audit');
  await tx(h.db, (c) => seedAdmin(c, 'seme-audit@test.dev', 'audit-pass-1'));
});
afterAll(async () => h?.close());

async function newUser(name: string) {
  const email = `${name}-${Date.now()}@seme.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, {
    email, password: 'correct horse', display_name: name, date_of_birth: '1990-01-01', country: 'MT',
  });
  expect(r.status).toBe(201);
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}

async function auditCount(type: string, userId: string): Promise<number> {
  const rows = (await h.db.query<{ event: string }>('select event from audit_log')).rows;
  return rows.filter((r) => { try { const e = JSON.parse(r.event); return e.type === type && e.userId === userId; } catch { return false; } }).length;
}

describe('SEM-149 other-user isolation', () => {
  it("revoking A's sessions never touches B, and B's token stays valid", async () => {
    const a = await newUser('iso-a');
    const b = await newUser('iso-b');
    const revoked = await revokeSessions(h.db, a.id);
    expect(revoked).toBeGreaterThanOrEqual(1);
    await expect(userFromToken(h.db, b.token)).resolves.toMatchObject({ id: b.id });
    await expect(userFromToken(h.db, a.token)).rejects.toMatchObject({ status: 401 });
  });
});

describe('SEM-149 audit-count regressions', () => {
  it('a real audited action writes exactly one audit row (mfa.setup_started)', async () => {
    const u = await newUser('audit-setup');
    const before = await auditCount('mfa.setup_started', u.id);
    const setup = await h.api('POST', '/v1/me/mfa/setup', u.token);
    expect(setup.status).toBe(200);
    expect(await auditCount('mfa.setup_started', u.id)).toBe(before + 1);
  });
});

describe('SEM-148 rollback and isolation of failed MFA enable', () => {
  it('a wrong code leaves enrolment pending, sessions intact, and no enabled audit row', async () => {
    const u = await newUser('mfa-rollback');
    const setup = await h.api('POST', '/v1/me/mfa/setup', u.token);
    expect(setup.status).toBe(200);
    const enable = await h.api('POST', '/v1/me/mfa/enable', u.token, { password: 'correct horse', code: '000000' });
    expect(enable.status).toBe(422);
    const m = (await h.db.query<{ enabled_at: Date | null }>('select enabled_at from user_mfa where user_id = $1', [u.id])).rows[0]!;
    expect(m.enabled_at).toBeNull();
    await expect(userFromToken(h.db, u.token)).resolves.toMatchObject({ id: u.id });
    expect(await auditCount('mfa.enabled', u.id)).toBe(0);
  });

  it('a revoked token is refused by userFromToken (stream ping re-validation path)', async () => {
    const u = await newUser('revoke-check');
    await revokeSessions(h.db, u.id);
    await expect(userFromToken(h.db, u.token)).rejects.toMatchObject({ status: 401 });
  });

  it("B's token cannot act as A anywhere: /v1/me returns only B", async () => {
    const a = await newUser('who-a');
    const b = await newUser('who-b');
    const me = await h.api('GET', '/v1/me', b.token);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(b.id);
    expect(me.body.id).not.toBe(a.id);
  });
});
