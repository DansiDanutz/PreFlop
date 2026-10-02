import { migrate } from '@preflop/db';
import pg from 'pg';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { verifyAuditChain } from '../lib/audit.ts';
import { createPool, tx } from '../lib/db.ts';
import { seedSimTable, upsertClub } from '../seed.ts';
import { runOutboxOnce, sweepOnce } from '../worker.ts';
import { SimTable, type Send, keysToFile } from './tableSim.ts';

/**
 * Soak test for the phase-1 exit criterion (docs/06): N simulated rounds on a fresh database with
 * random players and bets; a late bet after every lock must be refused; at the end the ledger
 * must sum to zero per currency, the audit chain must verify and every round must be terminal.
 *   ROUNDS=10000 BASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @preflop/api soak
 */
const N = Number(process.env.ROUNDS ?? 10_000);
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
const players: string[] = [];
for (let i = 0; i < 8; i++) players.push((await api('POST', '/v1/auth/register', undefined, { email: `soak${i}@x.dev`, password: 'correct horse', display_name: `S${i}` })).body.token);
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
  if (i % 500 === 0) console.log(`${i}/${N} rounds, ${bets} bets, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
settled = Number((await db.query(`select count(*)::int as n from rounds where state = 'SETTLED'`)).rows[0].n);
const nonTerminal = Number((await db.query(`select count(*)::int as n from rounds where state not in ('SETTLED','VOID','OPEN')`)).rows[0].n);
const sums = (await db.query('select currency, sum(amount_minor)::bigint as total from ledger_entries group by currency')).rows;
const chain = await verifyAuditChain(db);
const house = (await db.query(`select coalesce(sum(stake_minor - payout_minor), 0)::bigint as ggr, coalesce(sum(stake_minor), 0)::bigint as turnover from bets where status in ('won','lost')`)).rows[0];
const result = { rounds: N, settled, late_bets_refused: late, bets, staked, house_ggr: Number(house.ggr), realised_edge: Number(house.ggr) / Number(house.turnover), ledger: sums, non_terminal: nonTerminal, audit_chain: chain };
console.log(JSON.stringify(result, null, 2));
const ok = late === N && settled === N && nonTerminal === 0 && sums.every((s) => Number(s.total) === 0) && chain.ok;
await app.close();
await db.end();
console.log(ok ? 'SOAK PASSED' : 'SOAK FAILED');
process.exit(ok ? 0 : 1);
