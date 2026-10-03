import { type MyBet, createClient } from '@preflop/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StakeConfirmSheet } from '../src/components/table/StakeConfirmSheet.tsx';
import { type InertNode, Sheet, applyModalStack } from '../src/components/ui.tsx';
import { ACTIVITY_PAGE, ALL_WALLETS, activityQuery, nextCursor, walletFilters } from '../src/lib/activity.ts';
import {
  type BetIntent, type IntentInputs, intentBody, intentStore, isDefinitiveRefusal, newIntent, priceOfferFor,
  reconcileIntent, submitIntent, withAcceptedPrice,
} from '../src/lib/betIntent.ts';
import { betQuote, quoteLines } from '../src/lib/quote.ts';
import { groupByRound, summarizeRound, summarizeRounds } from '../src/lib/rounds.ts';
import { amountLabel } from '../src/lib/rooms.ts';

// ------------------------------------------------------------------ a tiny fake of POST /v1/bets

interface FakeBet { bet_id: string; key: string; body: Record<string, unknown> }

/**
 * Behaves like the API: a key that was used replays the stored bet; a new key debits and stores
 * one. `drop` makes the network lose the response AFTER the server committed.
 */
function fakeApi(o: { drop?: number; fail5xxAfterCommit?: number; price?: number } = {}) {
  const bets: FakeBet[] = [];
  const round = { state: 'OPEN' };
  let drops = o.drop ?? 0;
  let fails = o.fail5xxAfterCommit ?? 0;
  const posts: { key: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (init?.method === 'POST' && u.pathname === '/v1/bets') {
      const key = new Headers(init.headers).get('idempotency-key')!;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push({ key, body });
      let bet = bets.find((b) => b.key === key);
      if (!bet) {
        if (o.price !== undefined) {
          const ok = body.accept_price_change === true ? o.price >= (body.odds_centi as number) : o.price === body.odds_centi;
          if (!ok) return new Response(JSON.stringify({ type: 'price_changed', title: 'the price changed', status: 409, odds_centi: o.price }), { status: 409 });
        }
        bet = { bet_id: `bet_${bets.length + 1}`, key, body };
        bets.push(bet);
      }
      if (drops > 0) { drops--; throw new TypeError('Failed to fetch'); }
      if (fails > 0) { fails--; return new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }); }
      return new Response(JSON.stringify(view(bet)), { status: 201 });
    }
    if (init?.method === 'GET' || !init?.method) {
      if (u.pathname.startsWith('/v1/rounds/')) return new Response(JSON.stringify({ id: u.pathname.split('/').pop(), state: round.state }), { status: 200 });
      if (u.pathname === '/v1/me/bets') {
        const round = u.searchParams.get('round_id');
        return new Response(JSON.stringify({ bets: bets.filter((b) => !round || b.body.round_id === round).map(myBet), next_before: null }), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { bets, posts, round, fetchMock, api: createClient({ baseUrl: 'https://api.test' }) };
}
const view = (b: FakeBet) => ({
  bet_id: b.bet_id, round_id: b.body.round_id, selection_id: b.body.selection_id, stake_minor: b.body.stake_minor, odds_centi: b.body.odds_centi,
  potential_payout_minor: Math.floor(((b.body.stake_minor as number) * (b.body.odds_centi as number)) / 100), mode: 'play', currency: 'PLAY', status: 'accepted',
});
const myBet = (b: FakeBet) => ({
  ...view(b), payout_minor: null, placed_at: '2026-10-03T10:00:00Z', settled_at: null, hand_no: 7, table_id: 'sim-1', table_name: 'Sim', flop: null, room_id: null, idempotency_key: b.key,
});

const inputs: IntentInputs = { tableId: 'sim-1', roundId: 'sim-1:h7', selectionId: 'hand-class:pair', stakeMinor: 400, oddsCenti: 550, roomId: null, currency: 'PLAY' };
const noWait = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe('F07: an uncertain bet is retried with the same key and never debited twice', () => {
  it('server commits, the response is dropped, the retry replays: one bet, one key', async () => {
    const f = fakeApi({ drop: 1 });
    const intent = newIntent(inputs);
    const out = await submitIntent(f.api, intent, { wait: noWait });
    expect(out.kind).toBe('placed');
    expect(f.bets).toHaveLength(1);
    expect(f.posts).toHaveLength(2);
    expect(new Set(f.posts.map((p) => p.key))).toEqual(new Set([intent.key]));
    expect(f.posts[0]!.body).toEqual(f.posts[1]!.body);
    if (out.kind === 'placed') expect(out.bet.bet_id).toBe(f.bets[0]!.bet_id);
  });

  it('a 502 after the commit is retried the same way', async () => {
    const f = fakeApi({ fail5xxAfterCommit: 2 });
    const out = await submitIntent(f.api, newIntent(inputs), { wait: noWait });
    expect(out.kind).toBe('placed');
    expect(f.bets).toHaveLength(1);
    expect(f.posts).toHaveLength(3);
  });

  it('every POST lost: reconciles through GET /v1/me/bets by the key, still one bet', async () => {
    const f = fakeApi({ drop: 99 });
    const intent = newIntent(inputs);
    const out = await submitIntent(f.api, intent, { wait: noWait, attempts: 3 });
    expect(out.kind).toBe('placed');
    expect(f.bets).toHaveLength(1);
    expect(f.fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/me/bets?round_id=sim-1%3Ah7'))).toBe(true);
  });

  it('a definitive refusal (4xx) is not retried', async () => {
    const f = fakeApi({ price: 600 });
    const out = await submitIntent(f.api, newIntent(inputs), { wait: noWait });
    expect(out.kind).toBe('refused');
    expect(f.posts).toHaveLength(1);
    expect(f.bets).toHaveLength(0);
  });

  it('only 4xx answers are definitive; 5xx, 408, network errors and unreadable 2xx are not', async () => {
    const { ApiError } = await import('@preflop/client');
    expect(isDefinitiveRefusal(new ApiError(409, { type: 'round_locked', title: '', status: 409 }))).toBe(true);
    expect(isDefinitiveRefusal(new ApiError(422, { type: 'insufficient_funds', title: '', status: 422 }))).toBe(true);
    expect(isDefinitiveRefusal(new ApiError(502, { type: 'http_error', title: '', status: 502 }))).toBe(false);
    expect(isDefinitiveRefusal(new ApiError(408, { type: 'http_error', title: '', status: 408 }))).toBe(false);
    expect(isDefinitiveRefusal(new ApiError(201, { type: 'invalid_response', title: '', status: 201 }))).toBe(false);
    expect(isDefinitiveRefusal(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('the intent is frozen: its body cannot drift from what the player confirmed', () => {
    const i = newIntent(inputs);
    expect(Object.isFrozen(i)).toBe(true);
    expect(() => { (i as { stakeMinor: number }).stakeMinor = 9_999; }).toThrow();
    expect(intentBody(i)).toEqual({ round_id: 'sim-1:h7', selection_id: 'hand-class:pair', stake_minor: 400, odds_centi: 550 });
    expect(intentBody(newIntent({ ...inputs, roomId: 'room_1', currency: 'DIAMOND' })).room_id).toBe('room_1');
  });
});

describe('F07: a pending intent survives a reload and is reconciled before another bet', () => {
  let store: Map<string, string>;
  const g = globalThis as unknown as { window?: unknown };
  let prev: unknown;
  beforeEach(() => {
    store = new Map();
    prev = g.window;
    g.window = { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } };
  });
  afterEach(() => { g.window = prev; });

  it('reload with a pending intent whose request committed: found by its key, nothing re-sent', async () => {
    const f = fakeApi({ drop: 99 });
    const intent = newIntent(inputs);
    await f.api.placeBet(intentBody(intent), intent.key).catch(() => {}); // committed, response lost
    intentStore.save({ ...intent, sentAt: Date.now() });
    // --- reload
    const pending = intentStore.load();
    expect(pending?.key).toBe(intent.key);
    const out = await reconcileIntent(f.api, pending!);
    expect(out.kind).toBe('placed');
    expect(f.posts).toHaveLength(1); // the reload never sends the bet again
    expect(f.bets).toHaveLength(1);
  });

  it('a missing bet stays unknown however long ago it was sent, until the round stops taking bets', async () => {
    const f = fakeApi();
    const intent: BetIntent = { ...newIntent(inputs, 1_000), sentAt: 1_000 };
    intentStore.save(intent);
    const pending = intentStore.load()!;
    // Minutes later and still missing: the original request may be waiting on a lock, so no verdict.
    expect((await reconcileIntent(f.api, pending)).kind).toBe('unknown');
    // That request commits late, while the round is still open: found, not reported as failed.
    await f.api.placeBet(intentBody(intent), intent.key);
    expect((await reconcileIntent(f.api, pending)).kind).toBe('placed');
    expect(f.bets).toHaveLength(1);
  });

  it('missing after the round has stopped taking bets: definitively not placed', async () => {
    const f = fakeApi();
    const pending: BetIntent = { ...newIntent(inputs), sentAt: Date.now() };
    f.round.state = 'LOCKED';
    expect((await reconcileIntent(f.api, pending)).kind).toBe('not_placed');
    expect(f.posts).toHaveLength(0);
  });

  it('the API unreachable during reconciliation keeps the intent pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const api = createClient({ baseUrl: 'https://api.test' });
    expect((await reconcileIntent(api, { ...newIntent(inputs), sentAt: 0 })).kind).toBe('unknown');
  });

  it('stores in sessionStorage, ignores junk, and never throws when storage is blocked', () => {
    const i = newIntent(inputs);
    intentStore.save(i);
    expect(JSON.parse(store.get('pf.betIntent')!).key).toBe(i.key);
    intentStore.clear();
    expect(store.has('pf.betIntent')).toBe(false);
    store.set('pf.betIntent', '{"v":1,"key":"x"}');
    expect(intentStore.load()).toBeNull();
    store.set('pf.betIntent', 'not json');
    expect(intentStore.load()).toBeNull();
    g.window = { get sessionStorage(): Storage { throw new Error('blocked'); } };
    expect(() => intentStore.save(i)).not.toThrow();
    expect(intentStore.load()).toBeNull();
    expect(() => intentStore.clear()).not.toThrow();
  });
});

describe('F08: a price change is accepted for the original bet only', () => {
  const intent = newIntent(inputs);
  const offer = { intent, oddsCenti: 520 };

  it('the offer stays while the slip shows the same bet, and goes on any change', () => {
    expect(priceOfferFor(offer, inputs)).toBe(offer);
    expect(priceOfferFor(offer, { ...inputs, stakeMinor: 401 })).toBeNull();
    expect(priceOfferFor(offer, { ...inputs, selectionId: 'colour:all-red' })).toBeNull();
    expect(priceOfferFor(offer, { ...inputs, roundId: 'sim-1:h8' })).toBeNull(); // round advanced
    expect(priceOfferFor(offer, { ...inputs, roomId: 'room_1' })).toBeNull(); // another wallet
    expect(priceOfferFor(offer, { ...inputs, tableId: 'sim-2' })).toBeNull();
    expect(priceOfferFor(offer, null)).toBeNull(); // round locked
  });

  it('accepting sends the original bet, same key, at exactly the new price it was shown', () => {
    const accepted = withAcceptedPrice(intent, 520);
    expect(accepted.key).toBe(intent.key);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(intentBody(accepted)).toEqual({ round_id: 'sim-1:h7', selection_id: 'hand-class:pair', stake_minor: 400, odds_centi: 520, accept_price_change: true });
  });

  it('a second price change needs fresh consent', async () => {
    // Shown 550, the API now offers 520; accepted 520, but it moved again to 500 before placement.
    const f = fakeApi({ price: 500 });
    const first = await submitIntent(f.api, intent, { wait: noWait });
    expect(first.kind).toBe('refused');
    const second = await submitIntent(f.api, withAcceptedPrice(intent, 520), { wait: noWait });
    expect(second.kind).toBe('refused');
    expect(f.bets).toHaveLength(0);
    // Only an acceptance of 500 itself places it.
    const third = await submitIntent(f.api, withAcceptedPrice(intent, 500), { wait: noWait });
    expect(third.kind).toBe('placed');
    expect(f.bets).toHaveLength(1);
  });
});

describe('F09: the slip shows what the API will pay (engine fee arithmetic)', () => {
  const diamondHouse = { mode: 'diamonds' as const, house: 'organizer' as const, rules: { margin_bps: 800, min_stake_minor: 20, rake_bps: 500 } };
  const diamondPool = { mode: 'diamonds' as const, house: 'pool' as const, rules: { margin_bps: 0, min_stake_minor: 20, rake_bps: 500 } };
  const chipsHouse = { mode: 'virtual-chips' as const, house: 'organizer' as const, rules: { margin_bps: 800, min_stake_minor: 100 } };
  const chipsPool = { mode: 'virtual-chips' as const, house: 'pool' as const, rules: { margin_bps: 0, min_stake_minor: 100, rake_bps: 1000 } };

  it('direct (free chips, real money): the whole stake plays, rounded down', () => {
    expect(betQuote(400, 550, null)).toMatchObject({ feeMinor: 0, rakeMinor: 0, atRiskMinor: 400, totalReturnMinor: 2200 });
    expect(betQuote(333, 177, null)?.totalReturnMinor).toBe(589); // 589.41 → 589
    expect(betQuote(1, 105, null)?.totalReturnMinor).toBe(1);
  });

  it('diamond organizer room: 1 ◆ fee and the rake come off before the odds', () => {
    // 100 ◆: fee 1, rake 5, at risk 94; 94 × 2.10 = 197.4 → 197 (gross 210 would overstate it)
    expect(betQuote(100, 210, diamondHouse)).toEqual({ stakeMinor: 100, feeMinor: 1, rakeMinor: 5, atRiskMinor: 94, totalReturnMinor: 197, pool: false });
    expect(betQuote(21, 300, diamondHouse)).toMatchObject({ feeMinor: 1, rakeMinor: 1, atRiskMinor: 19, totalReturnMinor: 57 });
    expect(betQuote(19, 300, diamondHouse)).toBeNull(); // below the room minimum
  });

  it('diamond pool: a share of the pool, with what goes into it', () => {
    expect(betQuote(100, 100, diamondPool)).toEqual({ stakeMinor: 100, feeMinor: 1, rakeMinor: 5, atRiskMinor: 94, totalReturnMinor: null, pool: true });
  });

  it('chip organizer room: the platform fee is paid by the house, the whole stake plays', () => {
    expect(betQuote(250, 190, chipsHouse)).toMatchObject({ feeMinor: 0, rakeMinor: 0, atRiskMinor: 250, totalReturnMinor: 475 });
  });

  it('chip pool: platform fee (1.5%, min 2) and the rake come off the stake', () => {
    expect(betQuote(100, 100, chipsPool)).toMatchObject({ feeMinor: 2, rakeMinor: 10, atRiskMinor: 88, totalReturnMinor: null });
    expect(betQuote(1000, 100, chipsPool)).toMatchObject({ feeMinor: 15, rakeMinor: 100, atRiskMinor: 885 });
  });

  it('the confirm sheet shows the fees, the amount at risk and the net return', () => {
    const q = betQuote(100, 210, diamondHouse);
    const fmt = (m: number) => amountLabel(m, 'DIAMOND');
    expect(quoteLines(q, fmt)).toEqual([{ label: 'PreFlop fee', value: fmt(1) }, { label: 'Room rake', value: fmt(5) }, { label: 'At risk', value: fmt(94) }]);
    expect(quoteLines(betQuote(400, 550, null), fmt)).toEqual([]);
    const html = renderToStaticMarkup(<StakeConfirmSheet open onClose={() => {}} onConfirm={() => {}} stake={fmt(100)} potential={fmt(q!.totalReturnMinor!)}
      share={0.5} allIn={false} selection="Any pair" breakdown={quoteLines(q, fmt)} />);
    expect(html).toContain('PreFlop fee');
    expect(html).toContain('At risk');
    expect(html).toContain(fmt(197));
    expect(html).not.toContain(fmt(210));
  });
});

describe('F16: round summaries never add currencies', () => {
  const base: MyBet = {
    bet_id: 'b1', round_id: 'sim-1:h9', selection_id: 'hand-class:pair', stake_minor: 100, odds_centi: 550, potential_payout_minor: 550, mode: 'play', currency: 'PLAY',
    status: 'won', payout_minor: 550, placed_at: '2026-10-03T10:00:00Z', settled_at: '2026-10-03T10:01:00Z', hand_no: 9, table_id: 'sim-1', table_name: 'Sim', flop: ['As', 'Ad', '2c'], room_id: null,
  };
  const diamond: MyBet = { ...base, bet_id: 'b2', stake_minor: 20, mode: 'diamonds', currency: 'DIAMOND', room_id: 'room_d', status: 'lost', payout_minor: 0, potential_payout_minor: 0 };

  it('100 PLAY and 20 DIAMOND on one round: two summaries with their own totals', () => {
    const s = summarizeRounds([base, diamond]);
    expect(s).toHaveLength(2);
    const play = s.find((x) => x.currency === 'PLAY')!;
    const dia = s.find((x) => x.currency === 'DIAMOND')!;
    expect(play).toMatchObject({ usedMinor: 100, returnedMinor: 550, netMinor: 450, status: 'won', roomId: null });
    expect(dia).toMatchObject({ usedMinor: 20, returnedMinor: 0, netMinor: -20, status: 'lost', roomId: 'room_d' });
  });

  it('Activity groups by round and wallet', () => {
    const g = groupByRound([base, diamond, { ...base, bet_id: 'b3' }]);
    expect(g.map((x) => [x.roundId, x.walletKey, x.bets.length])).toEqual([['sim-1:h9', 'play:PLAY:-', 2], ['sim-1:h9', 'diamonds:DIAMOND:room_d', 1]]);
  });

  it('two rooms in the same currency are two wallets', () => {
    expect(summarizeRounds([diamond, { ...diamond, bet_id: 'b4', room_id: 'room_e' }])).toHaveLength(2);
  });

  it('summarizeRound refuses a mix instead of adding it up', () => {
    expect(() => summarizeRound([base, diamond])).toThrow(RangeError);
  });
});

describe('Activity: pages and filters', () => {
  it('asks for one wallet and one status, a page at a time', () => {
    const dia = walletFilters([{ mode: 'diamonds', currency: 'DIAMOND', balance_minor: 1, org_id: 'o', org_name: 'Org' }]).find((w) => w.currency === 'DIAMOND')!;
    expect(activityQuery('all', ALL_WALLETS)).toEqual({ limit: ACTIVITY_PAGE });
    expect(activityQuery('won', dia, 'bet_9')).toEqual({ limit: ACTIVITY_PAGE, status: 'won', mode: 'diamonds', currency: 'DIAMOND', before: 'bet_9' });
  });

  it('one filter per mode and currency, free chips first', () => {
    const w = walletFilters([
      { mode: 'diamonds', currency: 'DIAMOND', balance_minor: 1, org_id: 'o1', org_name: 'A' },
      { mode: 'diamonds', currency: 'DIAMOND', balance_minor: 1, org_id: 'o2', org_name: 'B' },
      { mode: 'play', currency: 'PLAY', balance_minor: 1 },
    ]);
    expect(w.map((x) => x.id)).toEqual(['all', 'play:PLAY', 'diamonds:DIAMOND']);
  });

  it('follows next_before, and stops on the last page', () => {
    expect(nextCursor({ bets: [], next_before: 'bet_5' })).toBe('bet_5');
    expect(nextCursor({ bets: [], next_before: null })).toBeUndefined();
  });

  it('sends the cursor and filters to GET /v1/me/bets', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ bets: [], next_before: null }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await createClient({ baseUrl: 'https://api.test' }).myBets({ limit: 50, before: 'bet_9', status: 'won', mode: 'diamonds', currency: 'DIAMOND' });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toBe('https://api.test/v1/me/bets?limit=50&before=bet_9&status=won&mode=diamonds&currency=DIAMOND');
  });
});

describe('F18: dialogs are modal for every input method', () => {
  class Node implements InertNode {
    children: Node[] = [];
    parentElement: Node | null = null;
    attrs = new Map<string, string>();
    constructor(readonly tagName: string, readonly name = tagName) {}
    add(...c: Node[]) { for (const n of c) { n.parentElement = this; this.children.push(n); } return this; }
    hasAttribute(n: string) { return this.attrs.has(n); }
    setAttribute(n: string, v: string) { this.attrs.set(n, v); }
    removeAttribute(n: string) { this.attrs.delete(n); }
  }
  // Sheets are portalled into <body>: the app root and every open sheet are siblings there.
  const page = () => {
    const body = new Node('BODY');
    const root = new Node('DIV', 'root');
    const toast = new Node('DIV', 'toast');
    const script = new Node('SCRIPT');
    const reality = new Node('DIV', 'reality-check');
    const roundDone = new Node('DIV', 'round-complete');
    body.add(root, toast, script);
    return { body, root, toast, script, reality, roundDone };
  };
  const inert = (n: Node) => n.hasAttribute('inert');

  it('makes everything outside the open sheet inert, and restores it on close', () => {
    const p = page();
    p.body.add(p.reality);
    applyModalStack(p.body, [p.reality]);
    expect([p.root, p.toast].every(inert)).toBe(true);
    expect([p.reality, p.script].some(inert)).toBe(false);
    applyModalStack(p.body, []);
    expect([p.root, p.toast].some(inert)).toBe(false);
  });

  it('a sheet opening over another (a bet settles behind the reality check) is the active one, in any closing order', () => {
    const p = page();
    p.body.add(p.reality);
    applyModalStack(p.body, [p.reality]);
    p.body.add(p.roundDone);
    applyModalStack(p.body, [p.reality, p.roundDone]);
    expect(inert(p.roundDone)).toBe(false); // the newer sheet is never inside an inert subtree
    expect([p.root, p.reality].every(inert)).toBe(true);
    // the earlier sheet closes first: the newer one stays modal over the page
    applyModalStack(p.body, [p.roundDone]);
    expect(inert(p.root)).toBe(true);
    expect(inert(p.roundDone)).toBe(false);
    applyModalStack(p.body, []);
    expect(inert(p.root)).toBe(false);
  });

  it('closing the top sheet makes the one below it active again', () => {
    const p = page();
    p.body.add(p.reality, p.roundDone);
    applyModalStack(p.body, [p.reality, p.roundDone]);
    applyModalStack(p.body, [p.reality]);
    expect(inert(p.reality)).toBe(false);
    expect(inert(p.root)).toBe(true);
  });

  it('keeps an element that was already inert inert after close', () => {
    const p = page();
    p.toast.setAttribute('inert', '');
    p.body.add(p.reality);
    applyModalStack(p.body, [p.reality]);
    applyModalStack(p.body, []);
    expect(inert(p.toast)).toBe(true);
    expect(inert(p.root)).toBe(false);
  });

  it('confirmation, self-exclusion and reality-check dialogs render as labelled modal dialogs', () => {
    for (const html of [
      renderToStaticMarkup(<StakeConfirmSheet open onClose={() => {}} onConfirm={() => {}} stake="1" potential="2" share={0.5} allIn={false} selection="Any pair" />),
      renderToStaticMarkup(<Sheet open onClose={() => {}} title="Confirm self-exclusion"><p>x</p></Sheet>),
      renderToStaticMarkup(<Sheet open onClose={() => {}} title="Reality check"><p>x</p></Sheet>),
    ]) {
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toMatch(/aria-label(ledby)?="[^"]+"/);
    }
  });
});
