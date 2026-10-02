import { type ChildProcess, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoundExposure, getSelection, payoutMinor, statsFor } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, harness, testDbName } from './helpers.ts';

/**
 * Two API processes on one database (docs/13 §5): the exposure cap must hold although each process
 * has its own in-process mutex. Bets race on both instances at once.
 */
const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
let h: Harness;
const instances: { proc: ChildProcess; url: string }[] = [];

function startInstance(databaseUrl: string): Promise<{ proc: ChildProcess; url: string }> {
  const proc = spawn(join(API_DIR, 'node_modules', '.bin', 'tsx'), ['--conditions=preflop-source', 'test/fixtures/apiInstance.ts'], {
    cwd: API_DIR, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`instance did not start: ${out}`)), 60_000);
    proc.stdout!.on('data', (b: Buffer) => {
      out += b.toString();
      const m = /READY (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve({ proc, url: `http://127.0.0.1:${m[1]}` }); }
    });
    proc.on('exit', (code) => reject(new Error(`instance exited with ${code}: ${out}`)));
  });
}

async function call(base: string, method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  h = await harness('multi_instance');
  const u = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres');
  u.pathname = `/${testDbName('multi_instance')}`;
  instances.push(...(await Promise.all([startInstance(u.toString()), startInstance(u.toString())])));
});
afterAll(async () => {
  for (const i of instances) i.proc.kill('SIGTERM');
  await h?.close();
});

describe('exposure cap across API instances', () => {
  it('concurrent bets on two processes never push a round past max_round_loss_minor', async () => {
    const [a, b] = [instances[0]!, instances[1]!];
    // 24 players, registered half on each instance
    const players = await Promise.all(Array.from({ length: 24 }, async (_, k) => {
      const r = await call((k % 2 ? b : a).url, 'POST', '/v1/auth/register', undefined, { email: `mi${k}-${Date.now()}@test.dev`, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: `MI${k}`});
      expect(r.status).toBe(201);
      return r.body.token as string;
    }));
    const sel = 'colour:all-red';
    const odds = (await call(a.url, 'GET', '/v1/book')).body.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === sel).odds_centi as number;
    const stake = 100;
    const lossPerBet = payoutMinor(stake, odds) - stake; // every bet is on the same selection: losses add up
    const fits = 5;
    await h.db.query('update poker_tables set max_round_loss_minor = $2 where id = $1', ['sim-1', fits * lossPerBet + Math.floor(lossPerBet / 2)]);

    await h.sim.heartbeat();
    await h.work();
    const n = await h.sim.openHand();
    const rid = `sim-1:h${n}`;
    const res = await Promise.all(players.map((t, k) =>
      call((k % 2 ? b : a).url, 'POST', '/v1/bets', t, { round_id: rid, selection_id: sel, stake_minor: stake, odds_centi: odds }, { 'idempotency-key': `mi-bet-${k}-${Date.now()}` })));

    const codes = res.map((r) => r.status);
    expect(codes.every((c) => c === 201 || c === 422), JSON.stringify(res.filter((r) => r.status !== 201 && r.status !== 422))).toBe(true);
    expect(res.filter((r) => r.status === 422).every((r) => r.body.type === 'limit_exceeded')).toBe(true);
    expect(codes.filter((c) => c === 201)).toHaveLength(fits);
    // both instances took part in accepting and refusing
    expect(new Set(res.map((r, k) => `${k % 2}:${r.status}`)).size).toBeGreaterThanOrEqual(3);

    // the book in the database is within the cap
    const max = (await h.db.query('select max_round_loss_minor from poker_tables where id = $1', ['sim-1'])).rows[0].max_round_loss_minor;
    const ex = new RoundExposure(Number.MAX_SAFE_INTEGER);
    const accepted = (await h.db.query(`select selection_id, stake_minor, odds_centi from bets where round_id = $1 and status = 'accepted'`, [rid])).rows;
    for (const x of accepted) ex.tryAdd(statsFor(getSelection(x.selection_id)), x.stake_minor, x.odds_centi);
    expect(accepted).toHaveLength(fits);
    expect(ex.worstCase().lossMinor).toBeLessThanOrEqual(max);
    expect(ex.worstCase().lossMinor).toBe(fits * lossPerBet);

    await h.db.query('update poker_tables set max_round_loss_minor = 5000000 where id = $1', ['sim-1']);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });

  it('mixed selections racing on both instances: the exact worst case stays within the cap', async () => {
    const [a, b] = [instances[0]!, instances[1]!];
    const players = await Promise.all(Array.from({ length: 16 }, async (_, k) => (await call((k % 2 ? b : a).url, 'POST', '/v1/auth/register', undefined, { email: `mx${k}-${Date.now()}@test.dev`, password: 'correct horse', date_of_birth: '1990-01-01', country: 'MT', display_name: `MX${k}` })).body.token as string));
    const book = (await call(a.url, 'GET', '/v1/book')).body.markets.flatMap((m: any) => m.selections).filter((s: any) => s.offered);
    const picks = ['colour:all-red', 'colour:all-black', 'hand-class:pair', 'colour:mixed'].map((id) => book.find((s: any) => s.id === id)).filter(Boolean);
    const cap = 4_000;
    // Each player places three bets; lift the per-player payout cap (docs/04 §3) so only the round's exposure limits them.
    await h.db.query('update poker_tables set max_round_loss_minor = $2, max_user_round_payout_minor = 1000000 where id = $1', ['sim-1', cap]);
    await h.sim.heartbeat();
    await h.work();
    const n = await h.sim.openHand();
    const rid = `sim-1:h${n}`;
    const res = await Promise.all(players.flatMap((t, k) => [0, 1, 2].map((j) => {
      const s = picks[(k + j) % picks.length];
      return call((k + j) % 2 ? b.url : a.url, 'POST', '/v1/bets', t, { round_id: rid, selection_id: s.id, stake_minor: 150 + 25 * j, odds_centi: s.odds_centi }, { 'idempotency-key': `mx-${k}-${j}-${Date.now()}` });
    })));
    expect(res.every((r) => r.status === 201 || (r.status === 422 && r.body.type === 'limit_exceeded'))).toBe(true);
    expect(res.some((r) => r.status === 422)).toBe(true);
    const ex = new RoundExposure(Number.MAX_SAFE_INTEGER);
    for (const x of (await h.db.query(`select selection_id, stake_minor, odds_centi from bets where round_id = $1 and status = 'accepted'`, [rid])).rows)
      ex.tryAdd(statsFor(getSelection(x.selection_id)), x.stake_minor, x.odds_centi);
    expect(ex.worstCase().lossMinor).toBeLessThanOrEqual(cap);
    await h.db.query('update poker_tables set max_round_loss_minor = 5000000, max_user_round_payout_minor = null where id = $1', ['sim-1']);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });
});
