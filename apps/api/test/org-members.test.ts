import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ownedOrg } from './helpers.ts';

/** PUT/DELETE /v1/org/:orgId/members/:userId: change a member's role, remove a member. */
let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await harness('org_members');
  await tx(h.db, (c) => seedAdmin(c, 'om-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'om-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

let n = 0;
async function user(name: string) {
  const email = `${name}-${++n}-${Date.now()}@om.dev`;
  const r = await h.api('POST', '/v1/auth/register', undefined, { email, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: name });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { token: r.body.token as string, id: r.body.user.id as string, email };
}
async function org(name: string) {
  const owner = await user('owner');
  const id = await ownedOrg(h, admin, { kind: 'organizer', name }, owner);
  const add = async (u: { email: string }, role: 'owner' | 'admin' | 'viewer') =>
    expect((await h.api('POST', `/v1/org/${id}/members`, owner.token, { email: u.email, role })).status).toBe(200);
  const roles = async () => Object.fromEntries((await h.api('GET', `/v1/org/${id}/members`, owner.token)).body.members.map((m: any) => [m.user_id, m.role]));
  return { id, owner, add, roles };
}
const auditEvents = async (orgId: string) =>
  (await h.db.query<{ event: any }>(`select event::jsonb as event from audit_log where event::jsonb->>'orgId' = $1 order by seq`, [orgId])).rows.map((r) => r.event);

describe('org members: change role and remove', () => {
  it('an owner changes roles and removes members, and both are audited', async () => {
    const o = await org('Roles Club');
    const a = await user('adm');
    await o.add(a, 'viewer');
    const put = await h.api('PUT', `/v1/org/${o.id}/members/${a.id}`, o.owner.token, { role: 'admin' });
    expect(put.status).toBe(200);
    expect((await o.roles())[a.id]).toBe('admin');

    const del = await h.api('DELETE', `/v1/org/${o.id}/members/${a.id}`, o.owner.token);
    expect(del.status).toBe(200);
    expect((await o.roles())[a.id]).toBeUndefined();
    // The removed member loses access to the portal at once.
    expect((await h.api('GET', `/v1/org/${o.id}/members`, a.token)).status).toBe(403);

    const ev = await auditEvents(o.id);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'org.member', userId: a.id, role: 'admin', previousRole: 'viewer', by: o.owner.id }));
    expect(ev).toContainEqual(expect.objectContaining({ type: 'org.member.removed', userId: a.id, previousRole: 'admin', by: o.owner.id }));
  });

  it('viewers cannot change anything; admins manage non-owners only', async () => {
    const o = await org('Viewer Club');
    const v = await user('viewer');
    const a = await user('admin');
    const x = await user('other');
    await o.add(v, 'viewer');
    await o.add(a, 'admin');
    await o.add(x, 'viewer');

    expect((await h.api('PUT', `/v1/org/${o.id}/members/${x.id}`, v.token, { role: 'admin' })).body.type).toBe('read_only');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${x.id}`, v.token)).body.type).toBe('read_only');

    expect((await h.api('PUT', `/v1/org/${o.id}/members/${x.id}`, a.token, { role: 'admin' })).status).toBe(200);
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${x.id}`, a.token, { role: 'owner' })).body.type).toBe('read_only');
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${o.owner.id}`, a.token, { role: 'viewer' })).body.type).toBe('read_only');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${o.owner.id}`, a.token)).body.type).toBe('read_only');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${x.id}`, a.token)).status).toBe(200);
    expect((await o.roles())[o.owner.id]).toBe('owner');

    // Outsiders and unknown members.
    const stranger = await user('stranger');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${v.id}`, stranger.token)).status).toBe(403);
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${stranger.id}`, o.owner.token)).status).toBe(404);
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${v.id}`, o.owner.token, { role: 'superuser' })).status).toBe(400);
  });

  it('the last owner can be neither demoted nor removed; with two owners one can go', async () => {
    const o = await org('Owners Club');
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${o.owner.id}`, o.owner.token, { role: 'admin' })).body.type).toBe('last_owner');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${o.owner.id}`, o.owner.token)).body.type).toBe('last_owner');
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${o.owner.id}`, admin)).body.type).toBe('last_owner');

    const second = await user('second');
    await o.add(second, 'viewer');
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${second.id}`, o.owner.token, { role: 'owner' })).status).toBe(200);
    expect((await h.api('DELETE', `/v1/org/${o.id}/members/${o.owner.id}`, second.token)).status).toBe(200);
    expect((await h.api('GET', `/v1/org/${o.id}/members`, o.owner.token)).status).toBe(403); // the old owner is out
    const left = (await h.api('GET', `/v1/org/${o.id}/members`, second.token)).body.members;
    expect(left.map((m: any) => [m.user_id, m.role])).toEqual([[second.id, 'owner']]);
    expect((await h.api('PUT', `/v1/org/${o.id}/members/${second.id}`, second.token, { role: 'viewer' })).body.type).toBe('last_owner');
  });
});
