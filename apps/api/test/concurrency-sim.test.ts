import { DECK, RoundExposure, formatCard, getSelection, isRed, statsFor } from '@preflop/odds-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hooks } from '../src/bets/service.ts';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { retryCount, tx } from '../src/lib/db.ts';
import { EventBatch } from '../src/lib/events.ts';
import { lockRound, voidRound } from '../src/rounds/service.ts';
import { type Harness, bet, harness, ledgerSums, walletOf } from './helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness('concurrency');
});
afterAll(async () => h?.close());

async function open(): Promise<number> {
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return n;
}

describe('concurrency and crash safety (docs/13 §8.2, §8.6, §8.10)', () => {
  it('no bet is accepted after the lock, even when racing Start hand', async () => {
    const players = await Promise.all(Array.from({ length: 8 }, () => h.register()));
    const n = await open();
    const rid = `sim-1:h${n}`;
    const bets = players.flatMap((p) => Array.from({ length: 5 }, () => bet(h, p.token, rid, 'colour:mixed', 10)));
    const start = h.sim.call('dealer', 'POST', `/v1/provider/tables/sim-1/hands/${n}/start`, {});
    const results = await Promise.all([...bets, start]);
    const lockedAt = (await h.db.query('select locked_at from rounds where id = $1', [rid])).rows[0].locked_at as Date;
    const accepted = (await h.db.query<{ placed_at: Date }>(`select placed_at from bets where round_id = $1`, [rid])).rows;
    for (const b of accepted) expect(b.placed_at.getTime()).toBeLessThanOrEqual(lockedAt.getTime());
    const statuses = results.slice(0, -1).map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(accepted.length).toBe(statuses.filter((s) => s === 201).length);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });

  it('dealer and floor entries submitted in parallel settle the round exactly once', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 100);
    const { cards } = await h.sim.procedure(n);
    const { signed, image } = h.sim.buildCapture(n, cards);
    await h.sim.sendCapture(n, signed, image);
    await Promise.all([h.sim.enter(n, 'dealer', cards), h.sim.enter(n, 'floor', cards)]);
    await Promise.all([h.work(), h.work(), h.work()]);
    const r = (await h.db.query('select state from rounds where id = $1', [`sim-1:h${n}`])).rows[0];
    expect(r.state).toBe('SETTLED');
    const payouts = (await h.db.query(`select count(*)::int as n from ledger_tx where kind = 'bet.payout' and ref in (select id from bets where round_id = $1)`, [`sim-1:h${n}`])).rows[0].n;
    expect(payouts).toBeLessThanOrEqual(1);
  });

  it('settlement racing a void ends in exactly one terminal state; no bet is both refunded and paid', async () => {
    const p = await h.register();
    const n = await open();
    const rid = `sim-1:h${n}`;
    await bet(h, p.token, rid, 'colour:mixed', 100);
    const { cards } = await h.sim.procedure(n);
    const { signed, image } = h.sim.buildCapture(n, cards);
    await h.sim.sendCapture(n, signed, image);
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    const ev = new EventBatch();
    await Promise.all([
      h.work(),
      tx(h.db, async (c) => voidRound(c, await lockRound(c, rid), 'race', 'test', ev)),
    ]);
    const st = (await h.db.query('select state from rounds where id = $1', [rid])).rows[0].state;
    expect(['SETTLED', 'VOID']).toContain(st);
    const both = (await h.db.query(
      `select b.id from bets b where b.round_id = $1
         and exists (select 1 from ledger_tx t where t.kind = 'bet.refund' and t.ref = b.id)
         and exists (select 1 from ledger_tx t where t.kind = 'bet.payout' and t.ref = b.id)`, [rid])).rowCount;
    expect(both).toBe(0);
  });

  it('bet placement on round N+1 and settlement of round N for the same wallet do not deadlock', async () => {
    const p = await h.register();
    const n = await open();
    await bet(h, p.token, `sim-1:h${n}`, 'colour:mixed', 100);
    const { cards } = await h.sim.procedure(n);
    const { signed, image } = h.sim.buildCapture(n, cards);
    await h.sim.sendCapture(n, signed, image); // opens N+1
    await h.sim.enter(n, 'dealer', cards);
    await h.sim.enter(n, 'floor', cards);
    const before = retryCount.value;
    const [res] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => bet(h, p.token, `sim-1:h${n + 1}`, 'colour:mixed', 10))),
      h.work(),
    ]);
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(retryCount.value - before).toBe(0); // the lock order holds: no deadlock retries needed
  });

  it('exposure survives a failure between commit and cache update', async () => {
    const p = await h.register();
    const n = await open();
    const rid = `sim-1:h${n}`;
    await bet(h, p.token, rid, 'colour:mixed', 10); // warm the cache for this round
    hooks.afterCommit = () => { throw new Error('injected crash after commit'); };
    const first = await bet(h, p.token, rid, 'colour:all-red', 250);
    hooks.afterCommit = undefined;
    expect(first.status).toBe(500);
    expect((await h.db.query(`select count(*)::int as n from bets where round_id = $1 and user_id = $2 and selection_id = 'colour:all-red'`, [rid, p.id])).rows[0].n).toBe(1); // it did commit
    // Set the limit to exactly the true worst case INCLUDING that bet: any further all-red stake must be refused.
    const ex = new RoundExposure(Number.MAX_SAFE_INTEGER);
    for (const b of (await h.db.query(`select selection_id, stake_minor, odds_centi from bets where round_id = $1 and status = 'accepted'`, [rid])).rows)
      ex.tryAdd(statsFor(getSelection(b.selection_id)), b.stake_minor, b.odds_centi);
    await h.db.query('update poker_tables set max_round_loss_minor = $2 where id = $1', ['sim-1', ex.worstCase().lossMinor + 1]);
    const next = await bet(h, p.token, rid, 'colour:all-red', 100);
    expect(next.status).toBe(422);
    expect(next.body.type).toBe('limit_exceeded');
    await h.db.query('update poker_tables set max_round_loss_minor = 5000000 where id = $1', ['sim-1']);
    await h.sim.call('floor_manager', 'POST', `/v1/provider/tables/sim-1/hands/${n}/void`, { reason: 'cleanup' });
  });
});

describe('simulated table (docs/13 §8.11, §8.12)', () => {
  it('200 simulated hands with random players: ledger reconciles, late bets are rejected, audit chain verifies', async () => {
    await h.work();
    const players = await Promise.all(Array.from({ length: 6 }, () => h.register()));
    const book = (await h.api('GET', '/v1/book')).body;
    const offered = book.markets.flatMap((m: any) => m.selections).filter((s: any) => s.offered).map((s: any) => s.id);
    let settled = 0, late = 0;
    for (let i = 0; i < 200; i++) {
      const n = await open();
      const rid = `sim-1:h${n}`;
      await Promise.all(players.map((p) => bet(h, p.token, rid, offered[Math.floor(Math.random() * offered.length)], 1 + Math.floor(Math.random() * 20))));
      const out = await h.sim.playHand(n);
      const lateRes = await bet(h, players[0]!.token, rid, offered[0], 5);
      if (lateRes.status === 409) late++;
      expect(out.captureStatus).toBe(200);
      await h.work();
      if ((await h.db.query('select state from rounds where id = $1', [rid])).rows[0].state === 'SETTLED') settled++;
      // play money: top players back up so the run never stalls on funds
      if (i % 50 === 49) for (const p of players) if ((await walletOf(h, p.token)) < 500) await h.api('POST', '/v1/me/play/reset', p.token, {});
    }
    expect(late).toBe(200);
    expect(settled).toBe(200);
    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
    const chain = await verifyAuditChain(h.db);
    expect(chain.ok).toBe(true);
  });

  it('a stacked "all red" deck trips the outcome monitor and pauses the table (F01)', async () => {
    const reds = new Set(DECK.filter(isRed).map(formatCard));
    // the simulated shuffler is compromised: it puts red cards in every flop position
    // F01 construction: the 25 deck positions any allowed cut can bring to the flop hold red cards.
    const flopPositions = new Set<number>();
    for (let c = 15; c <= 37; c++) for (let k = 19; k <= 21; k++) flopPositions.add((c + k) % 52);
    h.sim.stackDeck = (deck) => {
      const r = deck.filter((c) => reds.has(c));
      const rest = [...r.slice(25), ...deck.filter((c) => !reds.has(c))];
      return Array.from({ length: 52 }, (_, i) => (flopPositions.has(i) ? r.shift()! : rest.shift()!));
    };
    let hands = 0;
    for (; hands < 20; hands++) {
      const n = await open().catch(() => null);
      if (n === null) break;
      await h.sim.playHand(n);
      await h.work();
      const t = (await h.db.query('select status from poker_tables where id = $1', ['sim-1'])).rows[0];
      if (t.status === 'paused') break;
    }
    h.sim.stackDeck = undefined;
    const t = (await h.db.query('select status, pause_reason from poker_tables where id = $1', ['sim-1'])).rows[0];
    expect(t.status).toBe('paused');
    expect(t.pause_reason).toMatch(/outcome monitor/);
    expect(hands).toBeLessThan(12); // calibrated: caught in 9 hands
    const alert = (await h.db.query(`select details from alerts where kind = 'outcome_monitor_alarm'`)).rows[0];
    expect(alert.details.alarms.map((a: any) => a.selectionId)).toContain('colour:all-red');
    expect(await h.sim.openHand()).toBeNull();
  });
});
