import { DEFAULT_COST_MODEL, turnoverCostRate } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { orgStatements, platformStatements, pruneBetChanges } from '../src/lib/statements.ts';
import { seedAdmin, upsertClub } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * Revenue-sharing statements (docs/09): joint cap over overlapping club + partner entitlements,
 * turnover tiers in one unit, and losses carried forward per (org, currency, policy).
 */
let h: Harness;
let admin = '';
beforeAll(async () => {
  h = await harness('statements');
  await tx(h.db, (c) => seedAdmin(c, 'stmt-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'stmt-admin@test.dev', password: 'admin-pass-1' })).body.token;
});
afterAll(async () => h?.close());

async function club(id: string, name: string): Promise<{ id: string; kind: string; name: string }> {
  await tx(h.db, (c) => upsertClub(c, id, name));
  await h.db.query(`insert into poker_tables (id, club_id, name) values ($1, $2, $3)`, [`${id}-t`, id, `${name} table`]);
  await h.db.query(`insert into rounds (id, table_id, hand_no, mode, currency, state) values ($1, $2, 1, 'real-fiat', 'EUR', 'SETTLED')`, [`${id}-r`, `${id}-t`]);
  return { id, kind: 'club', name };
}
async function partner(id: string, name: string): Promise<{ id: string; kind: string; name: string }> {
  await h.db.query(`insert into organizations (id, kind, name) values ($1, 'partner', $2)`, [id, name]);
  return { id, kind: 'partner', name };
}

let bn = 0;
/** A settled PreFlop-house bet at a club's table, placed in a given month. Returns its id. */
async function settled(o: { clubId: string; user: string; currency?: string; stake: number; payout: number; at: string; partnerId?: string }): Promise<string> {
  const id = `stmt-bet-${++bn}`;
  const currency = o.currency ?? 'EUR';
  await h.db.query(
    `insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, payout_minor, placed_at, settled_at, partner_id)
     values ($1, $1, $2, $3, 'colour:mixed', $4, 200, $5, $6, $7, $8, $9, $9, $10)`,
    [id, o.user, `${o.clubId}-r`, o.stake, currency === 'EUR' ? 'real-fiat' : 'real-crypto', currency, o.payout > 0 ? 'won' : 'lost', o.payout, o.at, o.partnerId ?? null]);
  return id;
}

const line = (s: { lines: { label: string }[] }, re: RegExp) => s.lines.find((l) => re.test(l.label)) as any;
const reconciles = (s: { lines: { amount_minor: number }[]; total_minor: number }) => s.lines.reduce((a, l) => a + l.amount_minor, 0) === s.total_minor;

describe('F10: club and partner shares on the same GGR are capped jointly', () => {
  it('direct + partner traffic at one club never takes PreFlop below its net-margin floor', async () => {
    const c = await club('club-joint', 'Joint Club');
    const p = await partner('partner-joint', 'JointBet');
    const at = '2024-01-15T12:00:00Z';
    // Direct traffic: turnover 100,000, GGR 10,000.
    await settled({ clubId: c.id, user: 'u-direct-1', stake: 50_000, payout: 0, at });
    await settled({ clubId: c.id, user: 'u-direct-2', stake: 50_000, payout: 90_000, at });
    // Partner-acquired traffic at the same tables: turnover 1,000,000, GGR 25,000 (thin edge).
    await settled({ clubId: c.id, user: 'u-partner-1', stake: 500_000, payout: 0, at, partnerId: p.id });
    await settled({ clubId: c.id, user: 'u-partner-2', stake: 500_000, payout: 975_000, at, partnerId: p.id });

    const [cs] = await orgStatements(h.db, c, '2024-01');
    const [ps] = await orgStatements(h.db, p, '2024-01');
    expect(cs && ps).toBeTruthy();
    // The club earns its club policy on its direct players and only the provider policy on the partner's.
    expect(line(cs!, /club policy \(direct players\)/)).toBeTruthy();
    expect(line(cs!, /provider policy \(partner traffic\)/)).toBeTruthy();
    expect(line(cs!, /House GGR at your tables: direct players/).base_minor).toBe(10_000);
    expect(line(cs!, /House GGR at your tables: partner-acquired/).base_minor).toBe(25_000);
    expect(line(cs!, /distribution \(activePlayers/).metric).toBe(2); // partner players are not the club's distribution
    expect(line(ps!, /House GGR from your players/).base_minor).toBe(25_000);
    expect(reconciles(cs!) && reconciles(ps!)).toBe(true);

    // PreFlop's net after shares and costs ≥ T · turnover on the combined buckets.
    const ch = DEFAULT_COST_MODEL.channels, T = DEFAULT_COST_MODEL.netTargetMargin;
    const costs = 10_000 * ch.club.promotionsShareOfGGR + 100_000 * turnoverCostRate(ch.club) + 1_000_000 * turnoverCostRate(ch.partner);
    const paid = cs!.total_minor + ps!.total_minor;
    expect(35_000 - paid - costs).toBeGreaterThanOrEqual(T * 1_100_000);
    expect(paid).toBeGreaterThan(0);
    expect(line(ps!, /^Revenue share/).label).toMatch(/capped by the joint profit guardrail/);

    // The platform view adds the same amounts once.
    const all = await platformStatements(h.db, '2024-01');
    const pf = all.find((s) => s.party === 'PreFlop' && s.currency === 'EUR')!;
    expect(line(pf, /Revenue shares owed/).amount_minor).toBe(-paid);
    expect(pf.total_minor).toBe(35_000 - paid);
    expect(all.filter((s) => s.party !== 'PreFlop').reduce((a, s) => a + s.total_minor, 0)).toBe(paid);
  });

  it('the admin statements route serves the joint result', async () => {
    const r = await h.api('GET', '/v1/admin/statements?period=2024-01', admin);
    expect(r.status).toBe(200);
    expect(r.body.statements.some((s: any) => s.party === 'JointBet')).toBe(true);
  });
});

describe('F11: partner tiers compare one unit (EUR cents)', () => {
  it('equivalent EUR and USDT turnover reach the same tier; settlement stays in its currency', async () => {
    const c = await club('club-tier', 'Tier Club');
    const eurP = await partner('partner-eur', 'EuroBet');
    const usdtP = await partner('partner-usdt', 'TetherBet');
    const at = '2024-02-10T12:00:00Z';
    // €1.5M of turnover vs 1.5M USDT (6-digit micro-units), both at 5% GGR.
    await settled({ clubId: c.id, user: 'u-e1', stake: 150_000_000, payout: 142_500_000, at, partnerId: eurP.id });
    await settled({ clubId: c.id, user: 'u-t1', currency: 'USDT', stake: 1_500_000_000_000, payout: 1_425_000_000_000, at, partnerId: usdtP.id });
    const [e] = await orgStatements(h.db, eurP, '2024-02');
    const [t] = await orgStatements(h.db, usdtP, '2024-02');
    expect(e!.currency).toBe('EUR');
    expect(t!.currency).toBe('USDT');
    const ce = line(e!, /^distribution/), ct = line(t!, /^distribution/);
    expect(ce.metric).toBe(150_000_000);
    expect(ct.metric).toBe(150_000_000);
    expect(ct.rate_bps).toBe(ce.rate_bps);
    expect(ct.tier).toBe(ce.tier);
    expect(ce.rate_bps).toBe(2167); // progressive: €1M @20% + €0.5M @25%
    // Amounts are in each statement's own currency (micro-USDT vs euro cents), same proportion of GGR.
    expect(t!.total_minor / 75_000_000_000).toBeCloseTo(e!.total_minor / 7_500_000, 6);
  });
});

describe('F11: tier turnover is converted once per partner and currency', () => {
  it('two clubs supplying 15,000 micro-USDT each count as 3 EUR cents, not 1 + 1', async () => {
    const c1 = await club('club-round-1', 'Round One');
    const c2 = await club('club-round-2', 'Round Two');
    const p = await partner('partner-round', 'RoundBet');
    const at = '2023-05-10T12:00:00Z';
    await settled({ clubId: c1.id, user: 'u-r1', currency: 'USDT', stake: 15_000, payout: 0, at, partnerId: p.id });
    await settled({ clubId: c2.id, user: 'u-r2', currency: 'USDT', stake: 15_000, payout: 0, at, partnerId: p.id });
    const [st] = await orgStatements(h.db, p, '2023-05');
    expect(line(st!, /^distribution/).metric).toBe(3);
  });
});

describe('Statements cache', () => {
  it('a period is computed once and recomputed as soon as a bet changes', async () => {
    const c = await club('club-cache', 'Cache Club');
    const at = '2023-06-10T12:00:00Z';
    const id = await settled({ clubId: c.id, user: 'u-k1', stake: 10_000, payout: 0, at });
    const a = await orgStatements(h.db, c, '2023-06');
    const calls: string[] = [];
    const q = h.db.query.bind(h.db);
    (h.db as { query: unknown }).query = (sql: string, ...rest: unknown[]) => { calls.push(String(sql)); return (q as (...x: unknown[]) => unknown)(sql, ...rest); };
    try {
      expect(await orgStatements(h.db, c, '2023-06')).toEqual(a);
      expect(calls.some((sql) => sql.includes('group by 1, 2, 3, 4'))).toBe(false); // served from the cache
    } finally {
      (h.db as { query: unknown }).query = q;
    }
    // a backdated correction: a committed change not visible to the cached snapshot, the next read recomputes
    await h.db.query(`update bets set payout_minor = 20_000, status = 'won' where id = $1`, [id]);
    const b = await orgStatements(h.db, c, '2023-06');
    expect(b).not.toEqual(a);
  });
});

describe('Statements cache: a bet committing during a computation', () => {
  it('a bet written before the computation but committed after it is in the next statement', async () => {
    const c = await club('club-race', 'Race Club');
    const at = '2023-08-10T12:00:00Z';
    await settled({ clubId: c.id, user: 'u-q1', stake: 10_000, payout: 0, at });
    const conn = await h.db.connect();
    try {
      await conn.query('begin');
      // the bet transaction has written (and recorded its change) but not committed yet
      await conn.query(
        `insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, payout_minor, placed_at, settled_at)
         values ('stmt-race', 'stmt-race', 'u-q2', $1, 'colour:mixed', 30000, 200, 'real-fiat', 'EUR', 'lost', 0, $2, $2)`, [`${c.id}-r`, at]);
      const [during] = await orgStatements(h.db, c, '2023-08'); // computed and cached without it
      const xid = (await conn.query<{ x: string }>('select pg_current_xact_id()::text as x')).rows[0]!.x;
      await conn.query('commit');
      // a long-running transaction: its row carries its START time, already older than the prune window
      await h.db.query(`update bets_changes set at = now() - interval '1 hour' where xid = $1::xid8`, [xid]);
      await pruneBetChanges(h.db); // just finished: marked, never deleted at once
      expect((await h.db.query('select finished_at from bets_changes where xid = $1::xid8', [xid])).rows[0]?.finished_at).toBeTruthy();
      const [after] = await orgStatements(h.db, c, '2023-08');
      expect(after).not.toEqual(during);
      expect(line(after!, /club policy/).base_minor).toBe(40_000);
    } finally {
      conn.release();
    }
  });
});

describe('F12: losses carry forward per (org, currency, policy)', () => {
  const months = ['2024-03', '2024-04', '2024-05'];
  let c: { id: string; kind: string; name: string };
  let marchBet = '';

  it('loss, then partial recovery, then profit', async () => {
    c = await club('club-carry', 'Carry Club');
    marchBet = await settled({ clubId: c.id, user: 'u-c1', stake: 10_000, payout: 20_000, at: '2024-03-10T12:00:00Z' }); // GGR −10,000
    await settled({ clubId: c.id, user: 'u-c1', stake: 4_000, payout: 0, at: '2024-04-10T12:00:00Z' }); // GGR +4,000
    await settled({ clubId: c.id, user: 'u-c1', stake: 100_000, payout: 0, at: '2024-05-10T12:00:00Z' });
    await settled({ clubId: c.id, user: 'u-c2', stake: 100_000, payout: 180_000, at: '2024-05-11T12:00:00Z' }); // GGR +20,000

    const [mar] = await orgStatements(h.db, c, months[0]);
    expect(mar!.total_minor).toBe(0);
    expect(line(mar!, /carried forward/).base_minor).toBe(-10_000);

    const [apr] = await orgStatements(h.db, c, months[1]);
    expect(line(apr!, /carried in/).base_minor).toBe(-10_000);
    expect(apr!.total_minor).toBe(0);
    expect(line(apr!, /carried forward/).base_minor).toBe(-6_000);

    const [may] = await orgStatements(h.db, c, months[2]);
    expect(line(may!, /carried in/).base_minor).toBe(-6_000);
    expect(line(may!, /club policy/).base_minor).toBe(14_000);
    expect(may!.total_minor).toBe(700); // 5% content floor on 14,000
    expect(line(may!, /carried forward/)).toBeUndefined();
    for (const s of [mar!, apr!, may!]) expect(reconciles(s)).toBe(true);
  });

  it('a rerun gives the same statements', async () => {
    for (const m of months) expect(await orgStatements(h.db, c, m)).toEqual(await orgStatements(h.db, c, m));
    expect(await platformStatements(h.db, '2024-05')).toEqual(await platformStatements(h.db, '2024-05'));
  });

  it('a backdated correction to an earlier month flows through every later statement', async () => {
    // March's winning bet is re-settled with a larger payout: March GGR −13,000.
    await h.db.query('update bets set payout_minor = 23000 where id = $1', [marchBet]);
    const [apr] = await orgStatements(h.db, c, '2024-04');
    expect(line(apr!, /carried in/).base_minor).toBe(-13_000);
    expect(line(apr!, /carried forward/).base_minor).toBe(-9_000);
    const [may] = await orgStatements(h.db, c, '2024-05');
    expect(line(may!, /carried in/).base_minor).toBe(-9_000);
    expect(may!.total_minor).toBe(550); // 5% of 11,000

    // A late bet booked into April (backdated) reduces the carry again.
    await settled({ clubId: c.id, user: 'u-c3', stake: 9_000, payout: 0, at: '2024-04-20T12:00:00Z' });
    const [may2] = await orgStatements(h.db, c, '2024-05');
    expect(line(may2!, /carried in/)).toBeUndefined();
    expect(may2!.total_minor).toBe(1_000); // 5% of 20,000
  });

  it('carry is kept per policy: a loss on partner traffic does not reduce the club policy', async () => {
    const k = await club('club-split', 'Split Club');
    const p = await partner('partner-split', 'SplitBet');
    await settled({ clubId: k.id, user: 'u-s1', stake: 10_000, payout: 30_000, at: '2024-06-10T12:00:00Z', partnerId: p.id }); // partner bucket −20,000
    await settled({ clubId: k.id, user: 'u-s2', stake: 100_000, payout: 0, at: '2024-07-10T12:00:00Z' });
    await settled({ clubId: k.id, user: 'u-s3', stake: 100_000, payout: 180_000, at: '2024-07-11T12:00:00Z' }); // direct +20,000
    await settled({ clubId: k.id, user: 'u-s1', stake: 10_000, payout: 0, at: '2024-07-12T12:00:00Z', partnerId: p.id }); // partner +10,000
    const [jul] = await orgStatements(h.db, k, '2024-07');
    expect(line(jul!, /club policy/).base_minor).toBe(20_000);
    const provider = jul!.lines.slice(jul!.lines.findIndex((l) => /partner-acquired/.test(l.label)));
    expect(line({ lines: provider }, /carried in/).base_minor).toBe(-20_000);
    expect(line({ lines: provider }, /carried forward/).base_minor).toBe(-10_000);
    const [pj] = await orgStatements(h.db, p, '2024-07');
    expect(line(pj!, /carried in/).base_minor).toBe(-20_000);
    expect(pj!.total_minor).toBe(0);
  });
});
