import { type PlayMode } from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import type { Tx } from '../lib/db.ts';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { acct, balance, lockAccount, post, walletPurpose } from '../lib/ledger.ts';

/** Promotions (docs/16 §3): announcements, leaderboard cards, PreFlop free-chip claims and organization drops. */

export type PromoKind = 'announcement' | 'leaderboard' | 'free-chips' | 'org-drop';

export interface PromotionRow {
  id: string; owner_org: string | null; kind: PromoKind; title: string; body: string; link: string | null; leaderboard_id: string | null;
  mode: PlayMode | null; currency: string | null; amount_minor: number | null; budget_minor: number | null; claimed_minor: number;
  starts_at: Date; ends_at: Date; status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'ended';
  review_note: string | null; reviewed_by: string | null; created_by: string; created_at: Date;
}

export const isLive = (p: Pick<PromotionRow, 'status' | 'starts_at' | 'ends_at'>, now = new Date()) =>
  p.status === 'approved' && p.starts_at <= now && p.ends_at > now;

/**
 * Claims a free-chips or org-drop promotion once. The promotion row is locked, so the budget can
 * never be overspent by concurrent claims; the claim row's primary key makes a second claim fail.
 */
export async function claim(c: Tx, promotionId: string, userId: string, now = new Date()): Promise<{ amount_minor: number; currency: string }> {
  const p = (await c.query<PromotionRow>('select * from promotions where id = $1 for update', [promotionId])).rows[0];
  if (!p) throw notFound('promotion');
  if (!isLive(p, now)) throw unprocessable('promotion_not_live', 'this promotion is not running');
  if (p.kind !== 'free-chips' && p.kind !== 'org-drop') throw unprocessable('not_claimable', 'there is nothing to claim on this promotion');
  const u = (await c.query<{ status: string }>('select status from users where id = $1 for update', [userId])).rows[0];
  if (!u || u.status !== 'active') throw forbidden('account_restricted', 'your account cannot claim promotions');
  const amount = Number(p.amount_minor);
  const mode = p.mode!, currency = p.currency!;

  let from: string, to: string;
  if (p.kind === 'free-chips') {
    from = acct('PreFlop', 'play-issuance', 'play', 'PLAY');
    to = acct(userId, 'wallet', 'play', 'PLAY');
  } else {
    const member = (await c.query('select 1 from room_members m join rooms r on r.id = m.room_id where m.user_id = $1 and r.org_id = $2 limit 1', [userId, p.owner_org])).rowCount;
    if (!member) throw forbidden('not_eligible', 'this drop is for players in the organizer’s rooms');
    if (Number(p.claimed_minor) + amount > Number(p.budget_minor)) throw conflict('budget_exhausted', 'this promotion has been fully claimed');
    from = acct(p.owner_org!, 'treasury', mode, currency);
    to = acct(userId, walletPurpose(p.owner_org), mode, currency);
    await lockAccount(c, from);
    if ((await balance(c, from)) < amount) throw conflict('budget_exhausted', 'the organizer’s treasury cannot cover this drop');
  }
  const ins = await c.query('insert into promotion_claims (promotion_id, user_id, amount_minor) values ($1, $2, $3) on conflict do nothing', [p.id, userId, amount]);
  if (!ins.rowCount) throw conflict('already_claimed', 'you have already claimed this promotion');
  await post(c, 'promo.claim', `${p.id}:${userId}`, [{ from, to, amountMinor: amount }]);
  await c.query('update promotions set claimed_minor = claimed_minor + $2 where id = $1', [p.id, amount]);
  await audit(c, { type: 'promotion.claimed', promotionId: p.id, userId, amountMinor: amount });
  return { amount_minor: amount, currency };
}
