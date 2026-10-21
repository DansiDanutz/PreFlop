import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await harness('seedadmin'); });
afterAll(async () => h?.close());

describe('seedAdmin', () => {
  it('re-seeding follows the email but keeps the first password (the simulator re-seeds on every fresh machine)', async () => {
    await tx(h.db, (c) => seedAdmin(c, 'first-admin@test.dev', 'First-Pass-2026!'));
    await tx(h.db, (c) => seedAdmin(c, 'second-admin@test.dev', 'Second-Pass-2026!'));
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: 'second-admin@test.dev', password: 'First-Pass-2026!' })).status).toBe(200);
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: 'second-admin@test.dev', password: 'Second-Pass-2026!' })).status).not.toBe(200);
    expect((await h.api('POST', '/v1/auth/login', undefined, { email: 'first-admin@test.dev', password: 'First-Pass-2026!' })).status).not.toBe(200);
  });
});
