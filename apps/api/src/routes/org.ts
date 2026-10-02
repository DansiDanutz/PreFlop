import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { MODES, type PlayMode, dilution } from '@preflop/odds-engine';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { ROOM_CURRENCY, type RoomRules, orgCollateralReserved, validateRoomRules } from '../bets/rooms.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { ApiError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, balance, lockAccount, post, walletPurpose } from '../lib/ledger.ts';
import { orgStatements } from '../lib/statements.ts';
import { buyChips, buyDiamonds, diamondPacks } from '../payments/sandbox.ts';
import { CERT_FLAGS, type CertItem } from '../rounds/readiness.ts';
import { roomSelect, roomView } from './account.ts';
import { tableSummaries } from './public.ts';

type Kind = 'club' | 'partner' | 'organizer';

/** Membership check: org members by role, or the PreFlop team (read: any platform role; write: admin/ops). */
export async function requireOrg(ctx: AppContext, req: FastifyRequest, orgId: string, opts: { kinds?: Kind[]; write?: boolean } = {}) {
  const u = await ctx.user(req);
  const org = (await ctx.db.query<{ id: string; kind: Kind; name: string; status: string; settings: Record<string, unknown> }>('select * from organizations where id = $1', [orgId])).rows[0];
  if (!org) throw notFound('organization');
  if (opts.kinds && !opts.kinds.includes(org.kind)) throw forbidden('wrong_org_kind', `this is a ${org.kind} organization`);
  const m = (await ctx.db.query<{ role: string }>('select role from memberships where user_id = $1 and org_id = $2', [u.id, orgId])).rows[0];
  const team = u.platform_role !== null;
  if (!m && !team) throw forbidden('not_a_member', 'you are not a member of this organization');
  if (opts.write) {
    const canWrite = m ? m.role !== 'viewer' : u.platform_role === 'admin' || u.platform_role === 'ops';
    if (!canWrite) throw forbidden('read_only', 'your role is read-only');
    if (org.status !== 'active' && !team) throw forbidden('org_suspended', `organization is ${org.status}`);
  }
  return { user: u, org, role: m?.role ?? `platform:${u.platform_role}` };
}

export const RESERVED_SETTINGS = new Set(['owner_email', 'application_id', 'demo', 'widget']);
const PER_SHIFT = new Set(['shufflerSealsVerifiedThisShift', 'boardCameraCalibrated', 'privacyMasksVerified']);

const RoomBody = z.object({
  name: z.string().min(2).max(60),
  table_id: z.string(),
  mode: z.enum(['virtual-chips', 'diamonds']),
  house: z.enum(['organizer', 'pool']),
  rules: z.object({ margin_bps: z.number().int(), min_stake_minor: z.number().int(), rake_bps: z.number().int().optional(), provider_share_bps: z.number().int().optional() }),
  visibility: z.enum(['public', 'invite']),
});

const inviteCode = () => randomBytes(5).toString('base64url').replace(/[-_]/g, 'X').toUpperCase().slice(0, 7);

export async function orgRoutes(app: FastifyInstance, ctx: AppContext) {
  const P = '/v1/org/:orgId';
  const oid = (req: FastifyRequest) => (req.params as { orgId: string }).orgId;

  // ---------------------------------------------------------------- common
  app.get(`${P}/overview`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    const where = org.kind === 'club' ? `r.table_id in (select id from poker_tables where club_id = $1)`
      : org.kind === 'partner' ? `b.partner_id = $1` : `b.house_owner = $1`;
    const series = (await ctx.db.query<{ day: string; currency: string; turnover_minor: number; ggr_minor: number; bets: number }>(
      `select to_char(date_trunc('day', b.placed_at), 'YYYY-MM-DD') as day, b.currency, coalesce(sum(b.stake_minor), 0)::bigint as turnover_minor,
              coalesce(sum(b.stake_minor - coalesce(b.payout_minor, 0)) filter (where b.status in ('won','lost')), 0)::bigint as ggr_minor, count(*)::int as bets
         from bets b join rounds r on r.id = b.round_id
        where ${where} and b.placed_at > now() - interval '30 days' group by 1, 2 order by 1, 2`, [org.id])).rows;
    const kpis: { label: string; value: number; currency?: string; hint?: string }[] = [];
    const sum = (k: 'turnover_minor' | 'ggr_minor' | 'bets', cur?: string) => series.filter((x) => !cur || x.currency === cur).reduce((a, x) => a + Number(x[k]), 0);
    kpis.push({ label: 'Bets (30 days)', value: sum('bets') });
    for (const cur of [...new Set(series.map((x) => x.currency))].sort())
      kpis.push({ label: 'Turnover (30 days)', value: sum('turnover_minor', cur), currency: cur }, { label: 'House result (30 days)', value: sum('ggr_minor', cur), currency: cur });
    if (org.kind === 'club') {
      const h = (await ctx.db.query<{ n: number; t: number }>(`select count(*) filter (where r.state = 'SETTLED')::int as n, (select count(*)::int from poker_tables where club_id = $1) as t from rounds r where r.table_id in (select id from poker_tables where club_id = $1) and r.opened_at > now() - interval '30 days'`, [org.id])).rows[0]!;
      kpis.unshift({ label: 'Tables', value: h.t }, { label: 'Hands dealt (30 days)', value: h.n });
    }
    if (org.kind === 'organizer') {
      const rooms = (await ctx.db.query<{ n: number }>(`select count(*)::int as n from rooms where org_id = $1 and status = 'active'`, [org.id])).rows[0]!.n;
      const players = (await ctx.db.query<{ n: number }>(`select count(distinct user_id)::int as n from room_members m join rooms r on r.id = m.room_id where r.org_id = $1`, [org.id])).rows[0]!.n;
      kpis.unshift({ label: 'Active rooms', value: rooms }, { label: 'Players', value: players });
    }
    return { org, kpis, series };
  });

  app.put(`${P}`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { write: true });
    const b = z.object({ name: z.string().min(2).max(120).optional(), settings: z.record(z.unknown()).optional() }).parse(req.body);
    // Ownership and provenance keys are set only by the PreFlop team (admin org creation / applications).
    const reserved = Object.keys(b.settings ?? {}).filter((k) => RESERVED_SETTINGS.has(k));
    if (reserved.length) throw forbidden('reserved_setting', `these settings cannot be changed here: ${reserved.join(', ')}`);
    await tx(ctx.db, async (c) => {
      if (b.name) await c.query('update organizations set name = $2 where id = $1', [org.id, b.name]);
      if (b.settings) await c.query('update organizations set settings = settings || $2::jsonb where id = $1', [org.id, JSON.stringify(b.settings)]);
      if (org.kind === 'club' && b.name) await c.query('update clubs set name = $2 where id = $1', [org.id, b.name]);
      await audit(c, { type: 'org.updated', orgId: org.id, by: user.id });
    });
    return { ok: true };
  });

  app.get(`${P}/members`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    return { members: (await ctx.db.query('select m.user_id, u.email, u.display_name, m.role from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at', [org.id])).rows };
  });
  app.post(`${P}/members`, async (req) => {
    const { org, user, role } = await requireOrg(ctx, req, oid(req), { write: true });
    const b = z.object({ email: z.string().email(), role: z.enum(['owner', 'admin', 'viewer']) }).parse(req.body);
    if (b.role === 'owner' && role !== 'owner' && !role.startsWith('platform:')) throw forbidden('read_only', 'only an owner can add owners');
    const target = (await ctx.db.query<{ id: string }>('select id from users where email = $1', [b.email.toLowerCase()])).rows[0];
    if (!target) throw notFound('user with that email (they must register first)');
    await tx(ctx.db, async (c) => {
      const owners = (await c.query<{ user_id: string }>(`select user_id from memberships where org_id = $1 and role = 'owner' for update`, [org.id])).rows;
      const isOwner = owners.some((o) => o.user_id === target.id);
      if (isOwner && b.role !== 'owner') {
        // Only an owner (or the PreFlop team) changes an owner's role, and an organization always keeps one.
        if (role !== 'owner' && !role.startsWith('platform:')) throw forbidden('read_only', 'only an owner can change an owner’s role');
        if (owners.length === 1) throw conflict('last_owner', 'an organization needs at least one owner; add another owner first');
      }
      await c.query('insert into memberships (user_id, org_id, role) values ($1, $2, $3) on conflict (user_id, org_id) do update set role = excluded.role', [target.id, org.id, b.role]);
      await audit(c, { type: 'org.member', orgId: org.id, userId: target.id, role: b.role, by: user.id });
    });
    return { ok: true };
  });

  app.get(`${P}/statements`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    const period = (req.query as { period?: string }).period;
    return { statements: await orgStatements(ctx.db, org, period) };
  });

  app.get(`${P}/rounds`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    const q = req.query as { table_id?: string; state?: string; limit?: string };
    const scope = org.kind === 'club' ? 'r.table_id in (select id from poker_tables where club_id = $1)'
      : 'r.id in (select round_id from bets where house_owner = $1 or partner_id = $1)';
    const rows = (await ctx.db.query(
      `select r.id, r.table_id, r.hand_no, r.state, r.procedure_step as step, r.mode, r.currency, r.opened_at, r.locked_at, r.settled_at, r.voided_at, r.void_reason, r.flop,
              count(b.id)::int as bets, coalesce(sum(b.stake_minor), 0)::bigint as staked_minor, coalesce(sum(b.payout_minor) filter (where b.status = 'won'), 0)::bigint as paid_minor
         from rounds r left join bets b on b.round_id = r.id
        where ${scope} and ($2::text is null or r.table_id = $2) and ($3::text is null or r.state = $3)
        group by r.id order by r.opened_at desc limit $4`,
      [org.id, q.table_id ?? null, q.state ?? null, Math.min(500, Number(q.limit ?? 100))])).rows;
    return { rounds: rows };
  });

  app.get(`${P}/players`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    const rows = (await ctx.db.query(
      `with p as (
         select user_id from bets where house_owner = $1 or partner_id = $1
         union select user_id from transfers where org_id = $1
         union select m.user_id from room_members m join rooms r on r.id = m.room_id where r.org_id = $1
         union select b.user_id from bets b join rounds r on r.id = b.round_id join poker_tables t on t.id = r.table_id where t.club_id = $1)
       -- Email only for the org's own customers (its rooms, transfers, house or partner bets); players who
       -- merely bet at a club's tables belong to PreFlop or another operator.
       select u.id as user_id,
              case when exists (select 1 from bets x where x.user_id = u.id and (x.house_owner = $1 or x.partner_id = $1))
                     or exists (select 1 from transfers x where x.user_id = u.id and x.org_id = $1)
                     or exists (select 1 from room_members m join rooms r on r.id = m.room_id where m.user_id = u.id and r.org_id = $1)
                   then u.email end as email,
              u.display_name,
              (select count(*)::int from bets b where b.user_id = u.id) as bets
         from p join users u on u.id = p.user_id order by u.display_name limit 500`, [org.id])).rows;
    const bal = (await ctx.db.query<{ account_id: string; b: number }>(
      `select e.account_id, sum(e.amount_minor)::bigint as b from ledger_entries e where e.account_id like $1 group by e.account_id`, [`%:${walletPurpose(org.id)}:%`])).rows;
    return {
      players: rows.map((p) => {
        const w = bal.filter((x) => x.account_id.startsWith(`${p.user_id}:`));
        return { ...p, balance_minor: w.reduce((a, x) => a + Number(x.b), 0), currency: w[0]?.account_id.split(':')[3] ?? '' };
      }),
    };
  });

  // ---------------------------------------------------------------- club: tables, certification, staff
  app.get(`${P}/tables`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['club'] });
    const summaries = await tableSummaries(ctx, 't.club_id = $1', [org.id]);
    const raw = new Map((await ctx.db.query('select id, certification, max_round_loss_minor, link, link_at from poker_tables where club_id = $1', [org.id])).rows.map((r) => [r.id, r]));
    return { tables: summaries.map((t) => ({ ...t, ...raw.get(t.id) })) };
  });
  app.post(`${P}/tables`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['club'], write: true });
    const b = z.object({ name: z.string().min(1).max(60), kind: z.enum(['physical', 'simulated']), mode: z.enum(['real-fiat', 'real-crypto', 'play', 'virtual-chips', 'diamonds']), currency: z.string() }).parse(req.body);
    if (!MODES[b.mode].currencies.includes(b.currency)) throw unprocessable('invalid_currency', `${b.currency} is not valid in ${b.mode}`);
    if (b.mode === 'diamonds') throw unprocessable('invalid_mode', 'diamond play happens in organizer rooms; tables deal for every mode');
    const id = `${org.id}-${newId('t').slice(2, 8).toLowerCase()}`;
    await tx(ctx.db, async (c) => {
      await c.query('insert into poker_tables (id, club_id, name, mode, currency, kind) values ($1, $2, $3, $4, $5, $6)', [id, org.id, b.name, b.mode, b.currency, b.kind]);
      await audit(c, { type: 'table.created', tableId: id, orgId: org.id, by: user.id });
    });
    return reply.code(201).send({ id });
  });
  app.put(`${P}/tables/:tableId/certification`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['club'], write: true });
    const { tableId } = req.params as { tableId: string };
    const items = z.object({ items: z.record(z.boolean()) }).parse(req.body).items;
    return tx(ctx.db, async (c) => {
      const t = (await c.query<{ certification: Record<string, CertItem> }>('select certification from poker_tables where id = $1 and club_id = $2 for update', [tableId, org.id])).rows[0];
      if (!t) throw notFound('table');
      const cert = { ...t.certification };
      const now = Date.now();
      for (const [k, ok] of Object.entries(items)) {
        if (!(CERT_FLAGS as readonly string[]).includes(k)) throw unprocessable('unknown_item', `unknown certification item ${k}`);
        cert[k] = { ok, by: user.id, at: new Date(now).toISOString(), expires_at: new Date(now + (PER_SHIFT.has(k) ? 12 * 3600_000 : 365 * 86_400_000)).toISOString() };
      }
      await c.query('update poker_tables set certification = $2 where id = $1', [tableId, JSON.stringify(cert)]);
      await audit(c, { type: 'table.certification', tableId, items, by: user.id });
      return { certification: cert };
    });
  });
  app.get(`${P}/staff`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['club'] });
    const credentials = (await ctx.db.query('select s.id, s.table_id, s.person_id, s.role, s.revoked, s.created_at from staff_credentials s join poker_tables t on t.id = s.table_id where t.club_id = $1 order by s.created_at desc', [org.id])).rows;
    const devices = (await ctx.db.query('select d.id, d.table_id, d.revoked, d.last_seq, d.created_at from devices d join poker_tables t on t.id = d.table_id where t.club_id = $1 order by d.created_at desc', [org.id])).rows;
    return { credentials, devices };
  });
  app.post(`${P}/staff`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['club'], write: true });
    const b = z.object({ table_id: z.string(), person_id: z.string().min(1).max(80), role: z.enum(['dealer', 'floor', 'floor_manager']), public_key_pem: z.string().min(40).max(2000) }).parse(req.body);
    const t = (await ctx.db.query('select 1 from poker_tables where id = $1 and club_id = $2', [b.table_id, org.id])).rowCount;
    if (!t) throw notFound('table');
    try {
      const k = createPublicKey(b.public_key_pem);
      if (k.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    } catch { throw unprocessable('invalid_key', 'public_key_pem must be an Ed25519 SPKI public key in PEM format'); }
    const id = `cred_${createHash('sha256').update(b.public_key_pem).digest('hex').slice(0, 12)}`;
    const row = await tx(ctx.db, async (c) => {
      const r = await c.query(
        `insert into staff_credentials (id, table_id, person_id, role, public_key_pem) values ($1, $2, $3, $4, $5)
         on conflict do nothing returning id, table_id, person_id, role, revoked, created_at`, [id, b.table_id, b.person_id, b.role, b.public_key_pem]);
      if (!r.rowCount) throw conflict('credential_exists', 'this key or this person/role is already enrolled at the table');
      await audit(c, { type: 'staff.enrolled', credentialId: id, tableId: b.table_id, personId: b.person_id, role: b.role, by: user.id });
      return r.rows[0];
    });
    return reply.code(201).send(row);
  });
  app.post(`${P}/staff/:credId/revoke`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['club'], write: true });
    const { credId } = req.params as { credId: string };
    await tx(ctx.db, async (c) => {
      const r = await c.query('update staff_credentials s set revoked = true from poker_tables t where s.id = $1 and t.id = s.table_id and t.club_id = $2', [credId, org.id]);
      if (!r.rowCount) throw notFound('credential');
      await audit(c, { type: 'staff.revoked', credentialId: credId, by: user.id });
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- rooms (organizers and clubs)
  app.get(`${P}/rooms`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'] });
    return { rooms: (await ctx.db.query(`${roomSelect} where r.org_id = $1 order by r.created_at desc`, [org.id])).rows.map((r) => roomView(r, true)) };
  });
  app.post(`${P}/rooms/validate`, async (req) => {
    await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'] });
    const b = z.object({ mode: z.enum(['virtual-chips', 'diamonds']), house: z.enum(['organizer', 'pool']), rules: RoomBody.shape.rules }).parse(req.body);
    return validateRoomRules(b.mode, b.house, b.rules as RoomRules);
  });
  app.post(`${P}/rooms`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'], write: true });
    const b = RoomBody.parse(req.body);
    const v = validateRoomRules(b.mode, b.house, b.rules as RoomRules);
    if (!v.ok) throw unprocessable('invalid_rules', v.problems.join('; '), { problems: v.problems });
    const t = (await ctx.db.query('select status from poker_tables where id = $1', [b.table_id])).rows[0];
    if (!t || t.status === 'retired') throw notFound('table');
    const id = newId('room');
    const code = b.visibility === 'invite' ? inviteCode() : null;
    await tx(ctx.db, async (c) => {
      await c.query('insert into rooms (id, org_id, name, table_id, mode, currency, house, rules, visibility, invite_code) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [id, org.id, b.name, b.table_id, b.mode, ROOM_CURRENCY[b.mode], b.house, JSON.stringify(b.rules), b.visibility, code]);
      await audit(c, { type: 'room.created', roomId: id, orgId: org.id, rules: b.rules, by: user.id });
    });
    const r = (await ctx.db.query(`${roomSelect} where r.id = $1`, [id])).rows[0];
    return reply.code(201).send(roomView(r, true));
  });
  app.put(`${P}/rooms/:roomId`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'], write: true });
    const { roomId } = req.params as { roomId: string };
    const b = z.object({ name: z.string().min(2).max(60).optional(), rules: RoomBody.shape.rules.optional(), status: z.enum(['active', 'paused', 'closed']).optional(), visibility: z.enum(['public', 'invite']).optional() }).parse(req.body);
    const cur = (await ctx.db.query('select * from rooms where id = $1 and org_id = $2', [roomId, org.id])).rows[0];
    if (!cur) throw notFound('room');
    if (b.rules) {
      const v = validateRoomRules(cur.mode, cur.house, b.rules as RoomRules);
      if (!v.ok) throw unprocessable('invalid_rules', v.problems.join('; '), { problems: v.problems });
    }
    await tx(ctx.db, async (c) => {
      await c.query(`update rooms set name = coalesce($3, name), rules = coalesce($4, rules), status = coalesce($5, status), visibility = coalesce($6, visibility),
                     invite_code = case when coalesce($6, visibility) = 'invite' then coalesce(invite_code, $7) else null end where id = $1 and org_id = $2`,
        [roomId, org.id, b.name ?? null, b.rules ? JSON.stringify(b.rules) : null, b.status ?? null, b.visibility ?? null, inviteCode()]);
      await audit(c, { type: 'room.updated', roomId, change: b as never, by: user.id });
    });
    return roomView((await ctx.db.query(`${roomSelect} where r.id = $1`, [roomId])).rows[0], true);
  });

  // ---------------------------------------------------------------- treasury, collateral, purchases, transfers
  app.get(`${P}/treasury`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    const rows = (await ctx.db.query<{ id: string; b: number }>(
      `select a.id, coalesce(sum(e.amount_minor), 0)::bigint as b from ledger_accounts a left join ledger_entries e on e.account_id = a.id
        where a.id like $1 group by a.id order by a.id`, [`${org.id}:%`])).rows;
    const accounts = [];
    for (const r of rows) {
      const [, purpose, mode, currency] = r.id.split(':');
      accounts.push({ purpose: purpose!, mode: mode as PlayMode, currency: currency!, balance_minor: Number(r.b),
        ...(purpose === 'collateral' ? { reserved_minor: await orgCollateralReserved(ctx.db, org.id, currency!) } : {}) });
    }
    return { accounts };
  });
  app.post(`${P}/collateral/deposits`, async (req) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'], write: true });
    const b = z.object({ mode: z.enum(['virtual-chips', 'diamonds']), currency: z.string(), amount_minor: z.number().int().positive() }).parse(req.body);
    await tx(ctx.db, async (c) => {
      const from = acct(org.id, 'treasury', b.mode, b.currency);
      await lockAccount(c, from);
      if ((await balance(c, from)) < b.amount_minor) throw unprocessable('insufficient_funds', 'treasury balance too low — buy chips or diamonds first');
      await post(c, 'collateral.deposit', newId('col'), [{ from, to: acct(org.id, 'collateral', b.mode, b.currency), amountMinor: b.amount_minor }]);
      await audit(c, { type: 'collateral.deposit', orgId: org.id, ...b, by: user.id });
    });
    return { ok: true };
  });
  app.get(`${P}/diamonds/packs`, async (req) => {
    await requireOrg(ctx, req, oid(req));
    return { packs: diamondPacks() };
  });
  app.post(`${P}/diamonds/purchases`, async (req, reply) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'], write: true });
    const b = z.object({ diamonds: z.number().int().positive(), pay_with: z.enum(['EUR', 'USDT', 'USDC']) }).parse(req.body);
    if (!(await ctx.modeEnabled('diamonds'))) throw conflict('mode_disabled', 'diamonds are not enabled');
    return reply.code(201).send(await tx(ctx.db, (c) => buyDiamonds(c, org.id, b.diamonds, b.pay_with)));
  });
  app.post(`${P}/chips/purchases`, async (req, reply) => {
    // Partners buy chips too: their treasury funds transfer-wallet deposits to their players.
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club', 'partner'], write: true });
    const b = z.object({ chips: z.number().int().positive(), pay_with: z.enum(['EUR', 'USDT', 'USDC']) }).parse(req.body);
    if (!(await ctx.modeEnabled('virtual-chips'))) throw conflict('mode_disabled', 'virtual chips are not enabled');
    return reply.code(201).send(await tx(ctx.db, (c) => buyChips(c, { orgId: org.id }, b.chips, b.pay_with)));
  });
  app.get(`${P}/transfers`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req));
    return { transfers: (await ctx.db.query('select t.id, t.org_id, u.email as user_email, t.mode, t.currency, t.amount_minor, t.created_at from transfers t join users u on u.id = t.user_id where t.org_id = $1 order by t.created_at desc limit 200', [org.id])).rows };
  });
  /** Clubs and organizers give chips or diamonds to players online (docs/08): treasury → the player's wallet in this org's economy. */
  app.post(`${P}/transfers`, async (req, reply) => {
    const { org, user } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'], write: true });
    const b = z.object({ email: z.string().email(), mode: z.enum(['virtual-chips', 'diamonds']), amount_minor: z.number().int().positive() }).parse(req.body);
    const target = (await ctx.db.query<{ id: string; status: string }>('select id, status from users where email = $1', [b.email.toLowerCase()])).rows[0];
    if (!target) throw notFound('player with that email');
    if (target.status !== 'active') throw new ApiError(403, 'player_unavailable', 'this player cannot receive transfers');
    const currency = ROOM_CURRENCY[b.mode];
    const id = newId('trf');
    await tx(ctx.db, async (c) => {
      const from = acct(org.id, 'treasury', b.mode, currency);
      await lockAccount(c, from);
      if ((await balance(c, from)) < b.amount_minor) throw unprocessable('insufficient_funds', 'treasury balance too low');
      await post(c, 'transfer.player', id, [{ from, to: acct(target.id, walletPurpose(org.id), b.mode, currency), amountMinor: b.amount_minor }]);
      await c.query('insert into transfers (id, org_id, user_id, mode, currency, amount_minor, by_user) values ($1, $2, $3, $4, $5, $6, $7)', [id, org.id, target.id, b.mode, currency, b.amount_minor, user.id]);
      await audit(c, { type: 'transfer.player', transferId: id, orgId: org.id, userId: target.id, mode: b.mode, amountMinor: b.amount_minor, by: user.id });
    });
    return reply.code(201).send({ id, org_id: org.id, user_email: b.email.toLowerCase(), mode: b.mode, currency, amount_minor: b.amount_minor, created_at: new Date().toISOString() });
  });

  /** Diamond dilution (docs/08): how fast this organizer's diamond economy is consumed. */
  app.get(`${P}/dilution`, async (req) => {
    const { org } = await requireOrg(ctx, req, oid(req), { kinds: ['organizer', 'club'] });
    const period = (req.query as { period?: string }).period ?? new Date().toISOString().slice(0, 7);
    const q1 = async (sql: string) => Number((await ctx.db.query<{ n: number }>(sql, [org.id, period])).rows[0]?.n ?? 0);
    const bought = await q1(`select coalesce(sum((details->>'diamonds')::bigint), 0)::bigint as n from payments where org_id = $1 and details->>'product' = 'diamonds' and to_char(created_at, 'YYYY-MM') = $2`);
    const bets = await q1(`select count(*)::int as n from bets where house_owner = $1 and mode = 'diamonds' and to_char(placed_at, 'YYYY-MM') = $2 and status <> 'void'`);
    const stakes = await q1(`select coalesce(sum(stake_minor), 0)::bigint as n from bets where house_owner = $1 and mode = 'diamonds' and to_char(placed_at, 'YYYY-MM') = $2 and status <> 'void'`);
    const fees = await q1(`select coalesce(sum(fee_minor), 0)::bigint as n from bets where house_owner = $1 and mode = 'diamonds' and to_char(placed_at, 'YYYY-MM') = $2 and status <> 'void'`);
    const rake = await q1(`select coalesce(sum(stake_minor - fee_minor - coalesce(at_risk_minor, stake_minor)), 0)::bigint as n from bets where house_owner = $1 and mode = 'diamonds' and to_char(placed_at, 'YYYY-MM') = $2 and status <> 'void'`);
    const houseNet = await q1(`select coalesce(sum(coalesce(at_risk_minor, stake_minor) - coalesce(payout_minor, 0)), 0)::bigint as n from bets where house_owner = $1 and mode = 'diamonds' and house_kind = 'organizer' and status in ('won','lost') and to_char(placed_at, 'YYYY-MM') = $2`);
    const transferred = await q1(`select coalesce(sum(amount_minor), 0)::bigint as n from transfers where org_id = $1 and mode = 'diamonds' and to_char(created_at, 'YYYY-MM') = $2`);
    const d = dilution({ bought, bets, stakes, preflopFees: fees, rakeToOrganizer: rake, rakeToOthers: 0, houseNet });
    return { period, bought, sunk_preflop_fee: fees, rake, house_net: houseNet, transferred, circulating: d.circulating, bets_until_empty: Number.isFinite(d.betsUntilEmpty) ? d.betsUntilEmpty : null };
  });
}
