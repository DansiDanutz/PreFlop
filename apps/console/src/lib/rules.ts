import type { RoomRules } from '@preflop/client';

/**
 * Client-side checks for the room rules form, mirroring the global rules in docs/08 (placeholders from
 * globalRules.ts). The server's POST /rooms/validate is authoritative; these only give instant inline errors.
 */
export const GLOBAL = {
  minMarginBps: 300, // organizer-run book keeps ≥ 3%
  maxMarginBps: 3000,
  diamondMinStake: 20, // 1 ◆ fee must be ≤ 5% of the minimum stake
  diamondFee: 1,
  diamondRakeBps: [0, 1500] as const,
  chipRakeBps: [300, 1500] as const,
  poolRakeBps: [500, 2000] as const,
  maxProviderShareBps: 5000,
};

export type RoomMode = 'virtual-chips' | 'diamonds';
export type House = 'organizer' | 'pool';

export interface RulesForm {
  name: string;
  table_id: string;
  mode: RoomMode;
  house: House;
  visibility: 'public' | 'invite';
  /** Percent strings as typed by the user, e.g. "6" or "6.5". */
  margin_pct: string;
  rake_pct: string;
  provider_share_pct: string;
  /** Whole currency units (chips or diamonds). */
  min_stake: string;
}

export type RulesErrors = Partial<Record<keyof RulesForm, string>>;

export const emptyRulesForm = (mode: RoomMode = 'diamonds'): RulesForm => ({
  name: '', table_id: '', mode, house: 'organizer', visibility: 'public',
  margin_pct: '6', rake_pct: mode === 'diamonds' ? '5' : '', provider_share_pct: '10',
  min_stake: mode === 'diamonds' ? '20' : '10',
});

/** "6.5" → 650 bps; "" → null; rejects anything that is not a plain number with ≤ 2 decimals. */
export function pctToBps(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const bpsToPct = (bps: number | undefined | null) => (bps === undefined || bps === null ? '' : String(Number((bps / 100).toFixed(2))));

/** Does this mode/house combination use a rake field? */
export const usesRake = (mode: RoomMode, house: House) => house === 'pool' || mode === 'diamonds';
export const usesMargin = (house: House) => house === 'organizer';

function rakeRange(mode: RoomMode, house: House): readonly [number, number] {
  if (house === 'pool') return GLOBAL.poolRakeBps;
  return mode === 'diamonds' ? GLOBAL.diamondRakeBps : GLOBAL.chipRakeBps;
}

const pct = (bps: number) => `${bps / 100}%`;

/** Validates the form; returns inline errors and, when valid, the RoomRules payload. */
export function validateRulesForm(f: RulesForm, opts: { requireTable?: boolean } = {}): { errors: RulesErrors; rules: RoomRules | null } {
  const e: RulesErrors = {};
  if (!f.name.trim()) e.name = 'Give the room a name.';
  else if (f.name.trim().length > 60) e.name = 'Keep the name under 60 characters.';
  if ((opts.requireTable ?? true) && !f.table_id) e.table_id = 'Pick the table this room follows.';

  let margin_bps = 0;
  if (usesMargin(f.house)) {
    const m = pctToBps(f.margin_pct);
    if (m === null) e.margin_pct = 'Enter a percentage, e.g. 6 or 6.5.';
    else if (m < GLOBAL.minMarginBps) e.margin_pct = `The global minimum margin is ${pct(GLOBAL.minMarginBps)}.`;
    else if (m > GLOBAL.maxMarginBps) e.margin_pct = `Margins above ${pct(GLOBAL.maxMarginBps)} are not allowed.`;
    else margin_bps = m;
  }

  let rake_bps: number | undefined;
  if (usesRake(f.mode, f.house)) {
    const r = pctToBps(f.rake_pct);
    const [lo, hi] = rakeRange(f.mode, f.house);
    if (r === null) e.rake_pct = 'Enter a percentage.';
    else if (r < lo || r > hi) e.rake_pct = `Rake must be between ${pct(lo)} and ${pct(hi)}.`;
    else rake_bps = r;
  }

  let provider_share_bps: number | undefined;
  if (f.provider_share_pct.trim() !== '') {
    const p = pctToBps(f.provider_share_pct);
    if (p === null) e.provider_share_pct = 'Enter a percentage.';
    else if (p > GLOBAL.maxProviderShareBps) e.provider_share_pct = `At most ${pct(GLOBAL.maxProviderShareBps)}.`;
    else provider_share_bps = p;
  }

  let min_stake_minor = 0;
  const ms = f.min_stake.trim();
  if (!/^\d+$/.test(ms) || Number(ms) < 1) e.min_stake = 'Enter a whole number of at least 1.';
  else if (f.mode === 'diamonds' && Number(ms) < GLOBAL.diamondMinStake) e.min_stake = `Diamond rooms need a minimum stake of at least ${GLOBAL.diamondMinStake} ◆ (the 1 ◆ fee may be at most 5%).`;
  else min_stake_minor = Number(ms);

  if (Object.keys(e).length) return { errors: e, rules: null };
  const rules: RoomRules = { margin_bps, min_stake_minor };
  if (rake_bps !== undefined) rules.rake_bps = rake_bps;
  if (provider_share_bps !== undefined) rules.provider_share_bps = provider_share_bps;
  return { errors: e, rules };
}

/**
 * Rules payload from whatever parses, without the bound checks, so the server's /rooms/validate can report
 * its own problems and EV while the user types. Null only when a field is not a number at all.
 */
export function looseRules(f: RulesForm): RoomRules | null {
  const margin = usesMargin(f.house) ? pctToBps(f.margin_pct) : 0;
  const ms = f.min_stake.trim();
  if (margin === null || !/^\d+$/.test(ms)) return null;
  const r: RoomRules = { margin_bps: margin, min_stake_minor: Number(ms) };
  if (usesRake(f.mode, f.house)) {
    const x = pctToBps(f.rake_pct);
    if (x === null) return null;
    r.rake_bps = x;
  }
  if (f.provider_share_pct.trim()) {
    const p = pctToBps(f.provider_share_pct);
    if (p === null) return null;
    r.provider_share_bps = p;
  }
  return r;
}

export const currencyForMode =(mode: string) => (mode === 'diamonds' ? 'DIAMOND' : mode === 'virtual-chips' ? 'CHIP' : mode === 'play' ? 'PLAY' : mode === 'real-crypto' ? 'USDT' : 'EUR');

// ------------------------------------------------------------- generic field validators

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function isHttpsUrl(s: string, allowLocalHttp = true): boolean {
  try {
    const u = new URL(s.trim());
    if (u.protocol === 'https:') return true;
    return allowLocalHttp && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

/** A PEM-encoded public key block (what the club tablet shows on its enrollment screen). */
export const isPublicKeyPem = (s: string) => /^-----BEGIN PUBLIC KEY-----\s*[A-Za-z0-9+/=\s]{40,}\s*-----END PUBLIC KEY-----\s*$/.test(s.trim());

/** Positive whole amount typed in display units → integer minor units for the currency; null when invalid. */
export function parseAmount(s: string, currency: string): number | null {
  const d = ({ EUR: 2, USDT: 6, USDC: 6, PLAY: 0, CHIP: 0, DIAMOND: 0 } as Record<string, number>)[currency] ?? 2;
  const t = s.trim().replace(/,/g, '');
  const re = d === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${Math.min(d, 2)}})?$`);
  if (!re.test(t)) return null;
  const [w, f = ''] = t.split('.');
  const minor = Number(w) * 10 ** d + Number((f + '0'.repeat(d)).slice(0, d) || 0);
  return minor > 0 && Number.isSafeInteger(minor) ? minor : null;
}
