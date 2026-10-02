import { migrate } from '@preflop/db';
import pg from 'pg';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { modeEnabled } from '../growth/leaderboards.ts';
import { growthTick } from '../growth/worker.ts';
import { verifyAuditChain } from '../lib/audit.ts';
import { createPool, tx } from '../lib/db.ts';
import { seedAdmin, seedSimTable, upsertClub } from '../seed.ts';
import { runOutboxOnce, sweepOnce } from '../worker.ts';
import { SimTable, type Send, keysToFile } from './tableSim.ts';
import { SETTLE_GRACE_MS } from '../growth/leaderboards.ts';

/**
 * Soak test for the phase-1 exit criterion (docs/06): N simulated rounds on a fresh database with
 * random players and bets; a late bet after every lock must be refused; at the end the ledger
 * must sum to zero per currency, the audit chain must verify and every round must be terminal.
 * Growth runs alongside: a sponsored free-chip leaderboard with a margin share accrues every
 * GROWTH_EVERY rounds and settles at the end with an empty pool; a free-chip promotion is claimed
 * once per player (a concurrent second claim must fail) and credited exactly once.
 *   ROUNDS=10000 BASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @preflop/api soak
 */
const N = Number(process.env.ROUNDS ?? 10_000);
const GROWTH_EVERY = Number(process.env.GROWTH_EVERY ?? 250);
const base = process.env.BASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query('drop database if exists preflop_soak with (force)');
await admin.query('create database preflop_soak');
await admin.end();
const u = new URL(base);
u.pathname = '/preflop_soak';
const db = createPool(u.toString(), 20);
await migrate(db);
const baseConfig = loadConfig({});
const config = { ...baseConfig, runWorker: false, rateLimit: { ...baseConfig.rateLimit, enabled: false } }; // the soak bets far faster than a person
const app = await buildApp(db, config);
const send: Send = async (r) => {
  const res = await app.inject({ method: r.method as 'GET', url: r.url, headers: r.headers, ...(r.body !== undefined ? { payload: r.body } : {}) });
  return { status: res.statusCode, json: () => (res.body ? JSON.parse(res.body) : null) };
};
const keys = await tx(db, async (c) => {
  await upsertClub(c, 'soak', 'Soak Club');
  return seedSimTable(c, { clubId: 'soak', tableId: 'soak-1', name: 'Soak' });
});
const sim = new SimTable(send, keysToFile(keys));
const timing = { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs };
const api = async (method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: method as 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
};
const players: string[] = [], playerIds: string[] = [];
for (let i = 0; i < 8; i++) {
  const r = (await api('POST', '/v1/auth/register', undefined, { email: `soak${i}@x.dev`, password: 'correct horse', display_name: `S${i}` })).body;
  players.push(r.token);
  playerIds.push(r.user.id);
}

// Growth: a sponsored free-chip board and a free-chip promotion over the soak window. The window
// opens just before the first round and stays open well past the last (the soak's length is not
// known up front); the board is settled at the end with an explicit `now` after its end.
await tx(db, (c) => seedAdmin(c, 'soak-admin@x.dev', 'soak-admin-pass'));
const adminToken = (await api('POST', '/v1/auth/login', undefined, { email: 'soak-admin@x.dev', password: 'soak-admin-pass' })).body.token;
const growthFail: string[] = [];
const check = (cond: boolean, what: string) => { if (!cond) growthFail.push(what); };
check(!(await modeEnabled(db, 'real-fiat')) && !(await modeEnabled(db, 'real-crypto')), 'real money must stay off');
const windowStart = new Date(Date.now() - 1_000), windowEnd = new Date(Date.now() + 12 * 3_600_000);
// Settlement waits SETTLE_GRACE_MS after the end for late-committing bets.
const settleAt = new Date(windowEnd.getTime() + SETTLE_GRACE_MS + 60_000);
const realBoard = await api('POST', '/v1/admin/leaderboards', adminToken, {
  name: 'Soak real', mode: 'real-fiat', currency: 'EUR', metric: 'net', prize_split_bps: [10_000], starts_at: windowStart, ends_at: windowEnd,
});
check(realBoard.status === 403, `a real-money board must be refused while real money is off (got ${realBoard.status})`);
const FUND = 50_000;
const boardRes = await api('POST', '/v1/admin/leaderboards', adminToken, {
  name: 'Soak free-chip board', mode: 'play', currency: 'PLAY', metric: 'net', min_rounds: 1, prize_split_bps: [6000, 3000, 1000],
  fund_minor: FUND, margin_bps: 1000, starts_at: windowStart, ends_at: windowEnd,
});
if (boardRes.status !== 201) throw new Error(`could not create the soak leaderboard: ${JSON.stringify(boardRes.body)}`);
const boardId: string = boardRes.body.id;
check(boardRes.body.status === 'active' && boardRes.body.pool_minor === FUND, 'the board opens active with its sponsored fund');
const PROMO_AMOUNT = 2_500;
const promoRes = await api('POST', '/v1/admin/promotions', adminToken, {
  kind: 'free-chips', title: 'Soak free chips', amount_minor: PROMO_AMOUNT, starts_at: windowStart, ends_at: windowEnd,
});
if (promoRes.status !== 201) throw new Error(`could not create the soak promotion: ${JSON.stringify(promoRes.body)}`);
const promoId: string = promoRes.body.id;
const claimers = players.slice(0, 4), claimerIds = playerIds.slice(0, 4);
const claimAt = Math.max(1, Math.min(100, Math.floor(N / 2)));
let claimsOk = 0, claimsRefused = 0, ticks = 0, accruedByTicks = 0;
const tick = async (now?: Date) => {
  const r = await growthTick(db, now);
  ticks++;
  accruedByTicks += r.accrued;
  return r;
};
const book = (await api('GET', '/v1/book')).body;
const offered = book.markets.flatMap((m: any) => m.selections).filter((s: any) => s.offered);
let late = 0, settled = 0, bets = 0, staked = 0, k = 0;
const t0 = Date.now();
for (let i = 1; i <= N; i++) {
  await sim.heartbeat();
  await sweepOnce(db, timing);
  const n = await sim.openHand();
  if (n === null) throw new Error(`no open round at iteration ${i}`);
  const rid = `soak-1:h${n}`;
  await Promise.all(players.map(async (t) => {
    const s = offered[Math.floor(Math.random() * offered.length)];
    const stake = 1 + Math.floor(Math.random() * 25);
    const r = await api('POST', '/v1/bets', t, { round_id: rid, selection_id: s.id, stake_minor: stake, odds_centi: s.odds_centi }, { 'idempotency-key': `soak-bet-${++k}` });
    if (r.status === 201) { bets++; staked += stake; }
    else if (r.body?.type === 'insufficient_funds') await api('POST', '/v1/me/play/reset', t, {});
  }));
  await sim.playHand(n);
  const lateRes = await api("POST", "/v1/bets", players[0], { round_id: rid, selection_id: offered[0].id, stake_minor: 1, odds_centi: offered[0].odds_centi }, { "idempotency-key": `late-bet-${i}` });
  if (lateRes.status === 409) late++;
  await runOutboxOnce(db, timing);
  if (i === claimAt) {
    // Each claimer fires two claims at once: exactly one is credited, the other is refused.
    for (const t of claimers) {
      const rs = await Promise.all([0, 1].map(() => api('POST', `/v1/promotions/${promoId}/claim`, t)));
      const ok = rs.filter((r) => r.status === 200).length;
      const refused = rs.filter((r) => r.status === 409 && r.body?.type === 'already_claimed').length;
      claimsOk += ok;
      claimsRefused += refused;
      check(ok === 1 && refused === 1, `concurrent claims must give one credit and one refusal (got ${rs.map((r) => r.status).join(',')})`);
    }
  }
  if (i % GROWTH_EVERY === 0) await tick();
  if (i % 500 === 0) console.log(`${i}/${N} rounds, ${bets} bets, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
// Growth: settle the board after its end, then check the pool closed out exactly. This runs before
// the ledger and audit checks below, so those cover every growth posting too.
const final = await tick(settleAt);
check(final.settled === 1, `the board must settle once after its end (settled ${final.settled})`);
check((await tick(settleAt)).settled === 0, 'settling again does nothing');
const board = (await db.query<{ status: string }>('select status from leaderboards where id = $1', [boardId])).rows[0]!;
const poolAcct = `${boardId}:pool:play:PLAY`;
const flows: Record<string, number> = Object.fromEntries((await db.query<{ kind: string; total: string }>(
  `select t.kind, sum(e.amount_minor)::text as total from ledger_entries e join ledger_tx t on t.id = e.tx_id
    where e.account_id = $1 group by t.kind`, [poolAcct])).rows.map((r) => [r.kind, Number(r.total)]));
const funded = flows['pool.fund.sponsor'] ?? 0, accrued = flows['pool.accrue.margin'] ?? 0;
const paid = -(flows['pool.payout'] ?? 0), returned = -(flows['pool.return'] ?? 0);
const poolLeft = Object.values(flows).reduce((a, b) => a + b, 0);
const fundingBy: Record<string, number> = Object.fromEntries((await db.query<{ source: string; total: string }>(
  'select source, sum(amount_minor)::text as total from leaderboard_funding where leaderboard_id = $1 group by source', [boardId])).rows.map((r) => [r.source, Number(r.total)]));
const prizes = (await db.query<{ prize_minor: string }>('select prize_minor::text as prize_minor from leaderboard_results where leaderboard_id = $1 order by rank', [boardId]))
  .rows.map((r) => Number(r.prize_minor));
const paidOut = prizes.filter((p) => p > 0);
const poolAtSettle = funded + accrued;
const expectPrizes = [6000, 3000, 1000].slice(0, Math.min(3, prizes.length)).map((bps) => Math.floor((poolAtSettle * bps) / 10_000));
check(board.status === 'settled', `board status ${board.status}`);
check(poolLeft === 0, `pool balance after settlement ${poolLeft}`);
check(paid === funded + accrued - returned, `payouts ${paid} != funded ${funded} + accrued ${accrued} - returned ${returned}`);
check(Object.keys(flows).every((k) => ['pool.fund.sponsor', 'pool.accrue.margin', 'pool.payout', 'pool.return'].includes(k)), `unexpected pool postings ${Object.keys(flows)}`);
check(funded === FUND && fundingBy.sponsor === funded && (fundingBy.margin ?? 0) === accrued, 'leaderboard_funding must match the ledger');
// Ticks report accruals on live boards only; settlement's final accrual (which, with the settle grace,
// can be all of it on a short run) is in the ledger and leaderboard_funding, checked above.
check(accruedByTicks <= accrued, `accrual reported by the worker ${accruedByTicks} > ledger ${accrued}`);
check(paidOut.reduce((a, b) => a + b, 0) === paid, `recorded prizes ${paidOut} != paid ${paid}`);
check(JSON.stringify(prizes.slice(0, 3)) === JSON.stringify(expectPrizes), `prizes ${prizes.slice(0, 3)} != split of pool ${poolAtSettle} (${expectPrizes})`);
const promoClaims = (await db.query<{ user_id: string; amount_minor: string }>('select user_id, amount_minor::text as amount_minor from promotion_claims where promotion_id = $1', [promoId])).rows;
const promoTx = (await db.query<{ ref: string; credited: string }>(
  `select t.ref, (sum(e.amount_minor) filter (where e.amount_minor > 0))::text as credited from ledger_tx t join ledger_entries e on e.tx_id = t.id
    where t.kind = 'promo.claim' and t.ref like $1 group by t.ref`, [`${promoId}:%`])).rows;
const promoRow = (await db.query<{ claimed_minor: string; status: string }>('select claimed_minor::text as claimed_minor, status from promotions where id = $1', [promoId])).rows[0]!;
check(claimsOk === claimers.length && claimsRefused === claimers.length, `claims ok ${claimsOk}, refused ${claimsRefused}`);
check(promoClaims.length === claimers.length && promoClaims.every((r) => claimerIds.includes(r.user_id) && Number(r.amount_minor) === PROMO_AMOUNT), 'one claim row per claimer');
check(promoTx.length === claimers.length && promoTx.every((r) => claimerIds.some((id) => r.ref === `${promoId}:${id}`) && Number(r.credited) === PROMO_AMOUNT),
  'each claim credited exactly once in the ledger');
check(Number(promoRow.claimed_minor) === claimers.length * PROMO_AMOUNT, `promotion claimed_minor ${promoRow.claimed_minor}`);
check(promoRow.status === 'ended', `promotion status after its window ${promoRow.status}`);
const growth = {
  board_status: board.status, ticks, funded, accrued, paid, returned, pool_left: poolLeft, prizes: paidOut,
  promo_claims: promoClaims.length, promo_duplicates_refused: claimsRefused, promo_status: promoRow.status, failures: growthFail,
};

settled = Number((await db.query(`select count(*)::int as n from rounds where state = 'SETTLED'`)).rows[0].n);
const nonTerminal = Number((await db.query(`select count(*)::int as n from rounds where state not in ('SETTLED','VOID','OPEN')`)).rows[0].n);
const sums = (await db.query('select currency, sum(amount_minor)::bigint as total from ledger_entries group by currency')).rows;
const chain = await verifyAuditChain(db);
const house = (await db.query(`select coalesce(sum(stake_minor - payout_minor), 0)::bigint as ggr, coalesce(sum(stake_minor), 0)::bigint as turnover from bets where status in ('won','lost')`)).rows[0];
const result = { rounds: N, settled, late_bets_refused: late, bets, staked, house_ggr: Number(house.ggr), realised_edge: Number(house.ggr) / Number(house.turnover), ledger: sums, non_terminal: nonTerminal, audit_chain: chain, growth };
console.log(JSON.stringify(result, null, 2));
console.log(`growth: board ${board.status} after ${ticks} worker ticks; pool funded ${funded} + accrued ${accrued} = paid ${paid} + returned ${returned}, left ${poolLeft}; `
  + `promo ${promoClaims.length} claims credited once, ${claimsRefused} concurrent duplicates refused; ${growthFail.length ? `FAILURES: ${growthFail.join('; ')}` : 'ok'}`);
const ok = late === N && settled === N && nonTerminal === 0 && sums.every((s) => Number(s.total) === 0) && chain.ok && growthFail.length === 0;
await app.close();
await db.end();
console.log(ok ? 'SOAK PASSED' : 'SOAK FAILED');
process.exit(ok ? 0 : 1);
