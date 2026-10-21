import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness('seedadmin'); });
afterAll(async () => h?.close());

const login = async (email: string, password: string) => (await h.api('POST', '/v1/auth/login', undefined, { email, password })).status;

describe('seedAdmin', () => {
  it('with keepPassword (the simulator, re-seeding on every fresh machine) follows the email but keeps the first password', async () => {
    await tx(h.db, (c) => seedAdmin(c, 'first-admin@test.dev', 'First-Pass-2026!', { keepPassword: true }));
    await tx(h.db, (c) => seedAdmin(c, 'second-admin@test.dev', 'Second-Pass-2026!', { keepPassword: true }));
    expect(await login('second-admin@test.dev', 'First-Pass-2026!')).toBe(200);
    expect(await login('second-admin@test.dev', 'Second-Pass-2026!')).not.toBe(200);
    expect(await login('first-admin@test.dev', 'First-Pass-2026!')).not.toBe(200);
  });

  it('by default (the demo seeder, which prints the password it used) a re-run sets the new password', async () => {
    await tx(h.db, (c) => seedAdmin(c, 'demo-admin@test.dev', 'Demo-Pass-One-1!'));
    await tx(h.db, (c) => seedAdmin(c, 'demo-admin@test.dev', 'Demo-Pass-Two-2!'));
    expect(await login('demo-admin@test.dev', 'Demo-Pass-Two-2!')).toBe(200);
    expect(await login('demo-admin@test.dev', 'Demo-Pass-One-1!')).not.toBe(200);
  });
});
