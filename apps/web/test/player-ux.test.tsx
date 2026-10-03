import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatAmount, formatMoney, formatMoneyShort } from '@preflop/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { missingBuildEnv } from '../../../deploy/require-env.mjs';
import { LiveBanner } from '../src/components/table/LiveBanner.tsx';
import { StakeConfirmSheet } from '../src/components/table/StakeConfirmSheet.tsx';
import { GuestPanel } from '../src/components/table/TableScreen.tsx';
import { trapFocus } from '../src/components/ui.tsx';
import { isEmail, loginErrors, registerErrors } from '../src/lib/authForms.ts';
import { centsToEuros, eurosToCents, limitsErrors, limitsForm, limitsPayload } from '../src/lib/limits.ts';
import { streamGate } from '../src/lib/live.ts';
import { qk } from '../src/lib/queries.ts';
import { amountLabel, amountRange, isLargeStake } from '../src/lib/rooms.ts';
import { resetFirstRunHelp, takeFirstRunHelp } from '../src/lib/storage.ts';
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

describe('play limits form', () => {
  it('prefills euros from cents and sends explicit nulls for emptied fields', () => {
    const f = limitsForm({ loss_day_minor: 5000, deposit_day_minor: 1250, session_minutes: 30 });
    expect(f).toEqual({ loss: '50', deposit: '12.50', session: '30' });
    expect(limitsPayload(f)).toEqual({ loss_day_minor: 5000, deposit_day_minor: 1250, session_minutes: 30 });
    // Emptying a field removes the limit: null, never "keep the old value".
    expect(limitsPayload({ ...f, loss: '', session: '' })).toEqual({ loss_day_minor: null, deposit_day_minor: 1250, session_minutes: null });
    // Only edited fields are sent: an untouched deposit field never cancels its queued raise.
    expect(limitsPayload({ ...f, session: '45' }, new Set(['session'] as const))).toEqual({ session_minutes: 45 });
    expect(limitsPayload({ ...f, loss: '' }, new Set(['loss'] as const))).toEqual({ loss_day_minor: null });
    expect(limitsForm(undefined)).toEqual({ loss: '', deposit: '', session: '' });
  });

  it('validates amounts and session minutes', () => {
    expect(eurosToCents('12.5')).toBe(1250);
    expect(eurosToCents('0.07')).toBe(7);
    expect(Number.isNaN(eurosToCents('1.234'))).toBe(true);
    expect(centsToEuros(7)).toBe('0.07');
    expect(limitsErrors({ loss: '0', deposit: '', session: '' }).loss).toMatch(/above €0/);
    expect(limitsErrors({ loss: '', deposit: '', session: '3' }).session).toMatch(/5 to 1440/);
    expect(limitsErrors({ loss: '20', deposit: '100.5', session: '60' })).toEqual({});
  });
});

describe('large-stake guard', () => {
  it('asks above 25% of the balance and for an all-in, never with an unknown balance', () => {
    expect(isLargeStake(250, 1000)).toBe(false);
    expect(isLargeStake(251, 1000)).toBe(true);
    expect(isLargeStake(1000, 1000)).toBe(true);
    expect(isLargeStake(50, 40)).toBe(true);
    expect(isLargeStake(500, null)).toBe(false);
    expect(isLargeStake(500, 0)).toBe(false);
    expect(isLargeStake(0, 100)).toBe(false);
  });

  it('shows the stake and the potential win before placing', () => {
    const html = renderToStaticMarkup(<StakeConfirmSheet open onClose={() => {}} onConfirm={() => {}} stake="400 free chips" potential="2,200 free chips"
      share={0.4} allIn={false} selection="Any pair" />);
    expect(html).toContain('Confirm this stake?');
    expect(html).toContain('40% of your balance');
    expect(html).toContain('400 free chips');
    expect(html).toContain('2,200 free chips');
    const allIn = renderToStaticMarkup(<StakeConfirmSheet open onClose={() => {}} onConfirm={() => {}} stake="800 points" potential="1,760 points" share={1} allIn selection="Flush" />);
    expect(allIn).toContain('Put everything on this flop?');
  });
});

describe('first-run How to play', () => {
  it('opens once per device, and once per page load when storage is blocked', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } };
    try {
      resetFirstRunHelp();
      expect(takeFirstRunHelp()).toBe(true);
      expect(store.get('pf.howToPlay.seen')).toBe('1');
      resetFirstRunHelp(); // a new page load
      expect(takeFirstRunHelp()).toBe(false);
      g.window = { get localStorage(): Storage { throw new Error('blocked'); } };
      resetFirstRunHelp();
      expect(takeFirstRunHelp()).toBe(true);
      expect(takeFirstRunHelp()).toBe(false);
    } finally {
      g.window = prev;
    }
  });
});

describe('sign-in and register validation', () => {
  it('explains what is missing instead of a silently disabled button', () => {
    expect(loginErrors({ email: '', password: '' })).toEqual({ email: 'Enter your email address.', password: 'Enter your password.' });
    expect(loginErrors({ email: 'nope', password: 'x' }).email).toMatch(/valid email/);
    expect(loginErrors({ email: 'a@b.co', password: 'x' })).toEqual({});
    const now = new Date('2026-10-03T00:00:00Z');
    const ok = { name: 'Ann', email: 'ann@example.com', password: 'correct horse', dob: '1990-01-01', country: 'MT', adult: true };
    expect(registerErrors(ok, now)).toEqual({});
    expect(Object.keys(registerErrors({ ...ok, name: ' ', email: 'x', password: 'short', dob: '', country: '', adult: false }, now)).sort())
      .toEqual(['adult', 'country', 'dob', 'email', 'name', 'password']);
    expect(registerErrors({ ...ok, dob: '2010-01-01' }, now).dob).toMatch(/18 or over/);
    expect(isEmail('a@b')).toBe(false);
  });
});

describe('sheet focus trap', () => {
  it('wraps Tab and Shift+Tab inside the dialog', () => {
    const items = ['close', 'cancel', 'confirm'];
    expect(trapFocus(items, 'confirm', false)).toBe('close');
    expect(trapFocus(items, 'close', true)).toBe('confirm');
    expect(trapFocus(items, 'cancel', false)).toBeNull(); // the browser moves to the next one
    expect(trapFocus(items, null, false)).toBe('close'); // from the dialog itself
    expect(trapFocus(items, null, true)).toBe('confirm');
    expect(trapFocus([], null, false)).toBeNull();
  });
});

describe('contrast of the faint text token', () => {
  const tokens = readFileSync(join(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8');
  const color = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)![1]!;
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

  it('is at least 4.5:1 on every surface', () => {
    for (const s of ['bg', 'surface', 'surface-2', 'surface-3']) expect(ratio(color('faint'), color(s)), s).toBeGreaterThanOrEqual(4.5);
  });
});

describe('production builds need the API origin', () => {
  it('fails a production build without VITE_API_URL, never a dev server or test run', () => {
    expect(missingBuildEnv('production', {})).toEqual(['VITE_API_URL']);
    expect(missingBuildEnv('production', { VITE_API_URL: '  ' })).toEqual(['VITE_API_URL']);
    expect(missingBuildEnv('production', { VITE_API_URL: 'https://api.preflop.example' })).toEqual([]);
    expect(missingBuildEnv('staging', {})).toEqual(['VITE_API_URL']); // any deployable mode name
    expect(missingBuildEnv('preview', { VITE_API_URL: 'https://api.preflop.example' })).toEqual([]);
    expect(missingBuildEnv('development', {})).toEqual([]);
  });

  it('the Docker build passes a default and CI sets it', () => {
    expect(readFileSync(join(__dirname, '../../../Dockerfile'), 'utf8')).toMatch(/ARG VITE_API_URL=\S+/);
    expect(readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')).toMatch(/VITE_API_URL:/);
  });
});

describe('guest demo', () => {
  it('offers Play free and Sign in that come back to the same table', () => {
    const html = renderToStaticMarkup(<MemoryRouter><GuestPanel tableId="sim-1" /></MemoryRouter>);
    expect(html).toContain('Watching as a guest');
    expect(html).toContain('href="/register?next=%2Fapp%2Ftable%2Fsim-1"');
    expect(html).toContain('href="/login?next=%2Fapp%2Ftable%2Fsim-1"');
  });
});
