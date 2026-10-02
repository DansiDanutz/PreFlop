import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { type Harness, bet, harness, ledgerSums, walletOf } from './helpers.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness('lifecycle');
});
afterAll(async () => h?.close());

async function openRound(): Promise<{ id: string; handNo: number }> {
  await h.sim.heartbeat();
  const n = await h.sim.openHand();
  if (n === null) throw new Error('no open round');
  return { id: `sim-1:h${n}`, handNo: n };
}

describe('round lifecycle on the simulated table (docs/13 §4, §8)', () => {
  it('registering grants free play money', async () => {
    const p = await h.register();
    expect(await walletOf(h, p.token)).toBe(10_000);
  });

  it('a heartbeat on a certified simulated table opens betting', async () => {
    const r = await openRound();
    expect(r.handNo).toBe(1);
    const lobby = (await h.api('GET', '/v1/lobby')).body;
    expect(lobby.tables[0]).toMatchObject({ id: 'sim-1', kind: 'simulated', ready: true, open_round_id: 'sim-1:h1' });
  });

  it('plays a full hand: bets settle against the verified flop, the ledger balances, the next round opens', async () => {
    const p = await h.register();
    const r = await openRound();
    const book = (await h.api('GET', '/v1/book')).body;
    const sels = book.markets.flatMap((m: any) => m.selections).filter((s: any) => s.offered);
    const pair = sels.find((s: any) => s.id === 'rank-pattern:pair');
    const noPair = sels.find((s: any) => s.id === 'rank-pattern:no-pair');
    expect((await bet(h, p.token, r.id, pair.id, 100)).status).toBe(201);
    expect((await bet(h, p.token, r.id, noPair.id, 100)).status).toBe(201);
    expect(await walletOf(h, p.token)).toBe(9_800);

    const out = await h.sim.playHand(r.handNo);
    expect(out.captureStatus).toBe(200);
    await h.work();

    const round = (await h.api('GET', `/v1/rounds/${r.id}`)).body;
    expect(round.state).toBe('SETTLED');
    expect(round.flop).toEqual(out.cards);
    const bets = (await h.api('GET', `/v1/me/bets?round_id=${encodeURIComponent(r.id)}`, p.token)).body.bets;
    expect(bets.map((b: any) => b.status).sort()).toEqual(['lost', 'won'].sort());
    const won = bets.find((b: any) => b.status === 'won');
    expect(await walletOf(h, p.token)).toBe(9_800 + won.payout_minor);

    for (const s of await ledgerSums(h.db)) expect(s.total).toBe(0);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
    // Round N+1 opened as soon as flop N was captured.
    expect(await h.sim.openHand()).toBe(r.handNo + 1);
  });

  it('refuses a bet after Start hand (round_locked)', async () => {
    const p = await h.register();
    const r = await openRound();
    const res = await h.sim.call('dealer', 'POST', `/v1/provider/tables/sim-1/hands/${r.handNo}/start`, {});
    expect(res.status).toBe(200);
    expect(res.body.shuffle_command.nonce).toBeTruthy();
    const late = await bet(h, p.token, r.id, 'rank-pattern:pair', 100);
    expect(late.status).toBe(409);
    expect(late.body.type).toBe('round_locked');
    // finish the hand properly so later tests start clean
    const base = `/v1/provider/tables/sim-1/hands/${r.handNo}`;
    await h.sim.call('floor_manager', 'POST', `${base}/void`, { reason: 'test cleanup' });
    await h.work();
  });

  it('the price check refuses stale odds unless the player accepts the change', async () => {
    const p = await h.register();
    const r = await openRound();
    const res = await h.api('POST', '/v1/bets', p.token, { round_id: r.id, selection_id: 'rank-pattern:pair', stake_minor: 10, odds_centi: 999 }, { 'idempotency-key': 'stale-odds-1' });
    expect(res.status).toBe(409);
    expect(res.body.type).toBe('price_changed');
    const ok = await h.api('POST', '/v1/bets', p.token, { round_id: r.id, selection_id: 'rank-pattern:pair', stake_minor: 10, odds_centi: 999, accept_price_change: true }, { 'idempotency-key': 'stale-odds-2' });
    expect(ok.status).toBe(201);
    expect(ok.body.odds_centi).toBe(res.body.odds_centi);
  });

  it('a bet retried with the same Idempotency-Key is accepted once', async () => {
    const p = await h.register();
    const r = await openRound();
    const body = { round_id: r.id, selection_id: 'colour:all-red', stake_minor: 50, odds_centi: (await h.api('GET', '/v1/book')).body.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === 'colour:all-red').odds_centi };
    const a = await h.api('POST', '/v1/bets', p.token, body, { 'idempotency-key': 'same-key-123' });
    const b = await h.api('POST', '/v1/bets', p.token, body, { 'idempotency-key': 'same-key-123' });
    expect(a.body.bet_id).toBe(b.body.bet_id);
    expect(await walletOf(h, p.token)).toBe(9_950);
  });

  it('insufficient funds is refused, and play money resets at any time', async () => {
    const p = await h.register();
    const r = await openRound();
    const big = await bet(h, p.token, r.id, 'rank-pattern:no-pair', 20_000);
    expect(big.body.type).toBe('insufficient_funds');
    await bet(h, p.token, r.id, 'rank-pattern:no-pair', 3_000);
    expect((await h.api('POST', '/v1/me/play/reset', p.token, {})).body.balance_minor).toBe(10_000);
    expect(await walletOf(h, p.token)).toBe(10_000);
  });
});
