/**
 * Partner widget options from the iframe URL (/embed/table/:id?accent=…&markets=…&stakes=…, or
 * /embed?table=…). Everything is validated: a partner's URL is input, never trusted markup. Bad
 * values are dropped and the widget falls back to its defaults.
 */
export interface EmbedOptions {
  /** #rrggbb, or null for the PreFlop accent. */
  accent: string | null;
  /** Market ids to show (e.g. hand-class, colour), or null for every market. */
  markets: string[] | null;
  /** Stake pills (whole chips), ascending, or null for the default presets. */
  stakes: number[] | null;
  /** Table id from ?table=, used when the path names none. */
  table: string | null;
}

export const MAX_EMBED_STAKE = 1_000_000;
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TABLE = /^[A-Za-z0-9._:-]{1,64}$/;

export function parseEmbedParams(p: URLSearchParams): EmbedOptions {
  const accent = p.get('accent');
  const markets = [...new Set((p.get('markets') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => ID.test(s)))].slice(0, 100);
  const stakes = [...new Set((p.get('stakes') ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,7}$/.test(s)).map(Number)
    .filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_EMBED_STAKE))].sort((a, b) => a - b).slice(0, 5);
  const table = p.get('table');
  return {
    accent: accent && HEX.test(accent) ? accent.toLowerCase() : null,
    markets: markets.length ? markets : null,
    stakes: stakes.length ? stakes : null,
    table: table && TABLE.test(table) ? table : null,
  };
}

/** The session token from the iframe URL: the fragment (#token=, preferred) or the query (?token=, older snippets). */
export function embedToken(search: URLSearchParams, hash: string): string | null {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  return h.get('token') || search.get('token') || null;
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
/** WCAG relative luminance. */
function luminance([r, g, b]: number[]): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}

/**
 * The design-system accent variables for a partner colour: the accent itself, a lighter hover
 * shade, the translucent and deep backgrounds, and a readable ink (dark or white) on top of it.
 */
export function accentVars(hex: string): Record<string, string> {
  const c = rgb(hex);
  const bg = rgb('#0e1311');
  return {
    '--color-accent': hex.toLowerCase(),
    '--color-accent-strong': toHex(mix(c, [255, 255, 255], 0.2)),
    '--color-accent-soft': `rgba(${c.join(', ')}, 0.12)`,
    '--color-accent-deep': toHex(mix(bg, c, 0.22)),
    '--color-accent-ink': luminance(c) > 0.3 ? '#06170f' : '#ffffff',
  };
}

/** Whether a market is shown under the partner's market filter. */
export const marketAllowed = (markets: readonly string[] | null | undefined, marketId: string | undefined) =>
  !markets || (marketId !== undefined && markets.includes(marketId));
