import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MoneyByCurrency } from '../components/money.tsx';
import { stakeField } from '../portals/admin/Overview.tsx';
import { chartFormat } from '../portals/org/Overview.tsx';
import { playerRows, playersCsv } from '../portals/org/People.tsx';
import { memberActions } from './members.ts';
import { moneyLines, perCurrency, seriesByCurrency } from './money.ts';
import { byUrgency, sameCards, timeLeft } from './review.ts';

describe('console money per currency', () => {
  it('keeps currencies apart and merges only same currency and mode', () => {
    const p = perCurrency([
      { currency: 'PLAY', mode: 'play', amount_minor: 1200 },
      { currency: 'EUR', mode: 'real-fiat', amount_minor: 1250 },
      { currency: 'PLAY', mode: 'play', amount_minor: 300 },
      { currency: 'DIAMOND', mode: 'diamonds', amount_minor: 40 },
    ]);
    expect(p.legacy).toBeNull();
    expect(moneyLines(p)).toEqual(['40 ◆', '€12.50', '1,500 free chips']);
  });

  it('labels the mode when one currency appears in several modes', () => {
    const p = perCurrency([{ currency: 'USDT', mode: 'real-crypto', amount_minor: 1_000_000 }, { currency: 'USDT', mode: 'play', amount_minor: 2_000_000 }]);
    expect(moneyLines(p)).toEqual(['2.00 USDT (free)', '1.00 USDT (crypto)']);
  });

  it('treats an old single number (or bigint string) as a legacy cross-currency count', () => {
    expect(perCurrency(123456)).toEqual({ legacy: 123456, amounts: [] });
    expect(perCurrency('987')).toEqual({ legacy: 987, amounts: [] });
    expect(perCurrency(null)).toEqual({ legacy: null, amounts: [] });
    const legacy = renderToStaticMarkup(createElement(MoneyByCurrency, { value: 123456 }));
    expect(legacy).toContain('123,456');
    expect(legacy).toContain('Legacy');
    const modern = renderToStaticMarkup(createElement(MoneyByCurrency, { value: [{ currency: 'EUR', mode: 'real-fiat', amount_minor: 150 }] }));
    expect(modern).toContain('€1.50');
    expect(modern).not.toContain('Legacy');
  });

  it('reads the admin 24h stake in either shape', () => {
    expect(stakeField({ n: 3, staked: 900 })).toBe(900);
    const arr = [{ currency: 'PLAY', mode: 'play', amount_minor: 900 }];
    expect(stakeField({ n: 3, staked: arr })).toBe(arr);
    expect(stakeField({ n: 3, staked: 900, staked_by_currency: arr })).toBe(arr);
    expect(stakeField({ n: 0 })).toBeNull();
  });

  it('charts each currency on its own series over every day, in major units', () => {
    const g = seriesByCurrency([
      { day: '2026-10-01', currency: 'PLAY', turnover_minor: 100, ggr_minor: 10, bets: 2 },
      { day: '2026-10-01', currency: 'EUR', turnover_minor: 5000, ggr_minor: 500, bets: 1 },
      { day: '2026-10-02', currency: 'PLAY', turnover_minor: 300, ggr_minor: -20, bets: 4 },
    ], ['turnover_minor', 'ggr_minor', 'bets']);
    expect(g.days).toEqual(['2026-10-01', '2026-10-02']);
    expect(g.currencies.map((c) => c.currency)).toEqual(['EUR', 'PLAY']);
    expect(g.currencies[0]!.values.turnover_minor).toEqual([5000, 0]);
    expect(g.currencies[1]!.values.ggr_minor).toEqual([10, -20]);
    expect(chartFormat('EUR')(5000)).toBe('€50');
    expect(chartFormat('PLAY')(300)).toBe('300');
  });

  it('exports players one line per currency with decimals of that currency', () => {
    const rows = playerRows([
      { user_id: 'u1', email: 'a@x.dev', display_name: 'Ann', balance_minor: 1250, currency: 'EUR', bets: 3 },
      { user_id: 'u2', email: null, display_name: '=cmd', balance_minor: 0, currency: 'PLAY', bets: 0,
        balances: [{ currency: 'CHIP', mode: 'virtual-chips', amount_minor: 500 }, { currency: 'DIAMOND', mode: 'diamonds', amount_minor: 7 }] } as never,
    ]);
    expect(rows.map((r) => [r.user_id, r.currency, r.balance_minor])).toEqual([['u1', 'EUR', 1250], ['u2', 'CHIP', 500], ['u2', 'DIAMOND', 7]]);
    expect(playersCsv(rows).split('\r\n')).toEqual([
      'email,name,mode,currency,balance,bets',
      'a@x.dev,Ann,,EUR,12.50,3',
      ",'=cmd,virtual-chips,CHIP,500,0",
      ",'=cmd,diamonds,DIAMOND,7,0",
      '',
    ]);
  });
});

describe('review queue', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const at = (s: number) => new Date(now + s * 1000).toISOString();

  it('shows time left, warns under 2 minutes and flags overdue', () => {
    expect(timeLeft(null, now)).toMatchObject({ label: '—', tone: 'muted' });
    expect(timeLeft(at(600), now)).toMatchObject({ label: '10 min', tone: 'normal' });
    expect(timeLeft(at(121), now)).toMatchObject({ label: '3 min', tone: 'normal' });
    expect(timeLeft(at(119), now)).toMatchObject({ label: '1:59', tone: 'warn' });
    expect(timeLeft(at(5), now)).toMatchObject({ label: '0:05', tone: 'warn' });
    expect(timeLeft(at(0), now)).toMatchObject({ label: 'Overdue', tone: 'danger' });
    expect(timeLeft(at(-30), now).tone).toBe('danger');
  });

  it('sorts by urgency, rounds without a deadline last', () => {
    const rows = [
      { id: 'none', review_deadline: null, locked_at: at(-900) },
      { id: 'later', review_deadline: at(600), locked_at: at(-60) },
      { id: 'soon', review_deadline: at(30), locked_at: at(-300) },
      { id: 'over', review_deadline: at(-10), locked_at: at(-400) },
    ];
    expect(byUrgency(rows).map((r) => r.id)).toEqual(['over', 'soon', 'later', 'none']);
  });

  it('compares evidence as card sets, not ordered lists', () => {
    expect(sameCards(['Ah', 'Kd', '7c'], ['7c', 'Ah', 'Kd'])).toBe(true);
    expect(sameCards(['Ah', 'Kd', '7c'], ['Ah', 'Kd', '7s'])).toBe(false);
    expect(sameCards(['Ah', 'Kd'], ['Ah', 'Kd', '7c'])).toBe(false);
    expect(sameCards(['ah', 'KD', '7c'], ['Ah', 'Kd', '7C'])).toBe(true);
  });
});

describe('org members actions', () => {
  it('owners manage everyone, admins never touch owners, viewers nothing', () => {
    expect(memberActions({ role: 'viewer' }, { role: 'owner', write: true }, 1)).toMatchObject({ roles: ['owner', 'admin', 'viewer'], canChange: true, canRemove: true });
    expect(memberActions({ role: 'viewer' }, { role: 'admin', write: true }, 1)).toMatchObject({ roles: ['admin', 'viewer'], canChange: true });
    expect(memberActions({ role: 'owner' }, { role: 'admin', write: true }, 2)).toMatchObject({ canChange: false, canRemove: false, note: 'Only an owner can change an owner' });
    expect(memberActions({ role: 'admin' }, { role: 'viewer', write: false }, 1)).toMatchObject({ canChange: false, canRemove: false, note: null });
  });

  it('the last owner can be neither demoted nor removed', () => {
    expect(memberActions({ role: 'owner' }, { role: 'owner', write: true }, 1)).toMatchObject({ canChange: false, canRemove: false });
    expect(memberActions({ role: 'owner' }, { role: 'owner', write: true }, 2)).toMatchObject({ canChange: true, canRemove: true });
  });
});
