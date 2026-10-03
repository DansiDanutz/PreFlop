import { formatAmount, formatMoney, formatMoneyShort } from '@preflop/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveBanner } from '../src/components/table/LiveBanner.tsx';
import { streamGate } from '../src/lib/live.ts';
import { qk } from '../src/lib/queries.ts';
import { amountLabel, amountRange } from '../src/lib/rooms.ts';
import { statsBlocks } from '../src/lib/stats.ts';
import { reconnectTracker } from '../src/lib/stream.ts';
import { reconnectKeys } from '../src/lib/useTableLive.ts';

describe('live connection: refetch after a reconnect', () => {
  it('reports a re-open after a drop, never the first open', () => {
    let n = 0;
    const track = reconnectTracker(() => { n++; });
    track('open');
    expect(n).toBe(0);
    track('closed');
    track('closed'); // retries that fail
    expect(n).toBe(0);
    track('open');
    expect(n).toBe(1);
    track('open'); // a duplicate open is not another reconnect
    expect(n).toBe(1);
    track('closed');
    track('open');
    expect(n).toBe(2);
  });

  it('a socket that never opened is not reconnecting when it finally does', () => {
    let n = 0;
    const track = reconnectTracker(() => { n++; });
    track('closed');
    track('open');
    expect(n).toBe(0);
  });

  it('invalidates the table, the lobby, the bets and the wallets', () => {
    expect(reconnectKeys('sim-1')).toEqual([qk.table('sim-1'), qk.lobby, qk.bets, qk.wallets]);
  });

  it('keeps bets paused after the re-open until the table has been refetched', () => {
    expect(streamGate('open', true)).toEqual({ paused: true, message: 'Reconnected · updating the table…' });
    expect(streamGate('open', false).paused).toBe(false);
    expect(renderToStaticMarkup(<LiveBanner ws="open" resyncing />)).toContain('updating the table');
    expect(renderToStaticMarkup(<LiveBanner ws="open" />)).toBe('');
    expect(renderToStaticMarkup(<LiveBanner ws="closed" />)).toContain('Reconnecting… bets paused');
  });
});

describe('money: every amount carries its unit and scale', () => {
  it('formats each currency with its unit', () => {
    expect(formatMoney(10_000, 'PLAY')).toBe('10,000 free chips');
    expect(formatMoney(1500, 'CHIP')).toBe('1,500 chips');
    expect(formatMoney(100, 'DIAMOND')).toBe('100 ◆');
    expect(formatMoney(150, 'EUR')).toBe('€1.50');
    expect(formatMoney(-150, 'EUR')).toBe('-€1.50');
    expect(formatMoney(2_500_000, 'USDT')).toBe('2.50 USDT');
    expect(formatMoney(-30, 'PLAY')).toBe('-30 free chips');
  });

  it('scales the bare number by the currency minor digits', () => {
    expect(formatAmount(150, 'EUR')).toBe('1.50');
    expect(formatAmount(2_500_000, 'USDC')).toBe('2.50');
    expect(formatAmount(1234, 'PLAY')).toBe('1,234');
    expect(formatAmount(-5, 'DIAMOND')).toBe('-5');
    expect(formatMoneyShort(250, 'PLAY')).toBe('250');
    expect(formatMoneyShort(250, 'DIAMOND')).toBe('250 ◆');
    expect(formatMoneyShort(250, 'EUR')).toBe('€2.50');
  });

  it('labels stakes and ranges in the room or round currency, never as free chips', () => {
    expect(amountLabel(100, 'DIAMOND')).toBe('100 ◆');
    expect(amountLabel(100, 'EUR')).toBe('€1.00');
    expect(amountRange(1, 10_000, 'PLAY')).toBe('1–10,000 free chips');
    expect(amountRange(20, 500, 'DIAMOND')).toBe('20–500 ◆');
    expect(amountRange(1, 2500, 'EUR')).toBe('€0.01–€25.00');
  });
});

describe('activity stats per currency', () => {
  const legacy = { bets: 10, won: 3, lost: 6, staked_minor: 1000, returned_minor: 1200 };

  it('labels the legacy headline as free chips', () => {
    const b = statsBlocks(legacy);
    expect(b).toHaveLength(1);
    expect(b[0]!.title).toBe('Free chips');
    expect(b[0]!.cells.map((c) => c.value)).toEqual(['10', '3', '33%', '+200 free chips']);
  });

  it('renders one block per currency with bets, never summing across currencies', () => {
    const b = statsBlocks({
      ...legacy,
      by_currency: [
        { mode: 'play', currency: 'PLAY', bets: 10, won: 3, lost: 6, staked_minor: 1000, returned_minor: 1200 },
        { mode: 'diamonds', currency: 'DIAMOND', bets: 2, won: 0, lost: 2, staked_minor: 40, returned_minor: 0 },
        { mode: 'real-fiat', currency: 'EUR', bets: 1, won: 1, lost: 0, staked_minor: 500, returned_minor: 1250 },
        { mode: 'virtual-chips', currency: 'CHIP', bets: 0, won: 0, lost: 0, staked_minor: 0, returned_minor: 0 },
      ],
    });
    expect(b.map((x) => x.title)).toEqual(['Free chips', 'Diamonds', 'Euro · Real money']);
    expect(b[1]!.cells[3]!.value).toBe('-40 ◆');
    expect(b[2]!.cells[3]!.value).toBe('+€7.50');
    expect(b[2]!.cells[3]!.accent).toBe(true);
  });

  it('falls back to the headline when by_currency is empty', () => {
    expect(statsBlocks({ ...legacy, by_currency: [] })[0]!.title).toBe('Free chips');
    expect(statsBlocks(undefined)).toEqual([]);
  });
});
