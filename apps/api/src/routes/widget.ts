import { z } from 'zod';
import { bookFor } from './public.ts';

/** Partner widget (docs/02 §2): settings saved from the partner portal and the embed snippet. */
const MARKET_IDS = new Set(bookFor('partner').markets.map((m) => m.id));
/** Partner widget settings, saved from the partner portal and turned into the embed snippet. */
export const WidgetSettings = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a 6-digit hex colour like #53e6a7').optional(),
  default_table_id: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).nullable().optional(),
  markets: z.array(z.string().refine((m) => MARKET_IDS.has(m), 'unknown market id')).max(100)
    .refine((a) => new Set(a).size === a.length, 'duplicate market id').optional(),
  stake_presets: z.array(z.number().int().min(1).max(1_000_000)).min(1).max(5).optional(),
}).strict();

/**
 * The iframe snippet for the saved settings. The player session goes in the URL FRAGMENT
 * (#token=…): browsers never send a fragment to any server, so it stays out of access logs and
 * Referer headers. The widget moves it into sessionStorage and clears it from the address.
 */
export function widgetSnippet(orgId: string, settings: Record<string, unknown>): string {
  const web = process.env.WEB_URL ?? 'http://localhost:5173';
  // `default_table` is what older versions saved.
  const table = String(settings.default_table_id ?? settings.default_table ?? 'green-room');
  const q = new URLSearchParams({ accent: typeof settings.accent === 'string' ? settings.accent : '#53e6a7' });
  if (Array.isArray(settings.markets) && settings.markets.length) q.set('markets', settings.markets.join(','));
  if (Array.isArray(settings.stake_presets) && settings.stake_presets.length) q.set('stakes', settings.stake_presets.join(','));
  return `<iframe src="${web}/embed/table/${encodeURIComponent(table)}?${q.toString().replace(/&/g, '&amp;')}#token=PLAYER_SESSION_TOKEN" style="width:100%;max-width:440px;height:820px;border:0;border-radius:18px" allow="autoplay" title="PreFlop"></iframe>\n<!-- Get PLAYER_SESSION_TOKEN server-side: POST /v1/partner/players/{player_ref}/session (partner ${orgId}) -->`;
}
