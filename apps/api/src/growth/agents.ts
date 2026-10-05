import { randomBytes } from 'node:crypto';
import { type PlayMode } from '@preflop/odds-engine';
import { audit } from '../lib/audit.ts';
import { recordOutcome } from '../lib/decisions.ts';
import type { Tx } from '../lib/db.ts';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { acct, post } from '../lib/ledger.ts';
import { modeEnabled } from './leaderboards.ts';

/**
 * Agents (docs/16 §4): a two-level affiliate paid on net gaming revenue. Only modes with cash
 * value count; play money, chips and diamonds never earn commission. Depth is capped at two by
 * construction: a sub-agent's parent is always a top-level agent, and an agent with sub-agents
 * cannot itself be given a parent.
 */

export const REAL_CURRENCIES: Record<string, PlayMode> = { EUR: 'real-fiat', USDT: 'real-crypto', USDC: 'real-crypto' };
export const RATE_CAPS = { l1: 4000, l2: 1000 } as const;

export interface AgentRow {
  user_id: string; code: string; parent_agent_id: string | null; status: 'applied' | 'active' | 'suspended' | 'rejected';
  rate_l1_bps: number; rate_l2_bps: number; note: string | null; approved_by: string | null; created_at: Date;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode(): string {
  const b = randomBytes(6);
  return 'PF' + [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

export async function apply(c: Tx, userId: string, note: string | null): Promise<AgentRow> {
  const existing = (await c.query<AgentRow>('select * from agents where user_id = $1', [userId])).rows[0];
  if (existing && existing.status !== 'rejected') throw conflict('already_applied', `your agent account is ${existing.status}`);
  // A re-application is a new case: the hint stored for the rejected one must not be shown for it,
  // but that case stays in the adviser's record (docs/20 §Measuring the adviser), so the row is
  // archived under a dated reference rather than deleted. A row that never got an answer or a
  // decision has nothing to keep.
  if (existing) {
    await c.query(`delete from decision_hints where kind = 'agent' and ref = $1 and model is null and outcome is null`, [userId]);
    await c.query(`update decision_hints set ref = $1 || '@' || to_char(now(), 'YYYYMMDD"T"HH24MISSMS') where kind = 'agent' and ref = $1`, [userId]);
  }
  const row = existing
    ? (await c.query<AgentRow>(`update agents set status = 'applied', note = $2 where user_id = $1 returning *`, [userId, note])).rows[0]!
    : (await c.query<AgentRow>('insert into agents (user_id, code, note) values ($1, $2, $3) returning *', [userId, newCode(), note])).rows[0]!;
  await audit(c, { type: 'agent.applied', userId });
  return row;
}

/** Binds a newly registered player to the agent whose code they used. Unknown or inactive codes are ignored. */
export async function bindReferral(c: Tx, userId: string, code: string | undefined): Promise<string | null> {
  if (!code) return null;
  const a = (await c.query<{ user_id: string }>(`select user_id from agents where code = $1 and status = 'active'`, [code.trim().toUpperCase()])).rows[0];
  if (!a || a.user_id === userId) return null;
  await c.query('update users set referred_by_agent = $2 where id = $1 and referred_by_agent is null', [userId, a.user_id]);
  await audit(c, { type: 'agent.referral', userId, agentId: a.user_id });
  return a.user_id;
}

export interface AgentUpdate { status?: 'active' | 'suspended' | 'rejected'; rate_l1_bps?: number; rate_l2_bps?: number; parent_agent_id?: string | null }

export async function updateAgent(c: Tx, agentId: string, u: AgentUpdate, by: string): Promise<AgentRow> {
  // Lock the agent and the new parent together, in id order, so two concurrent reparentings
  // serialize and each depth check below sees the other's result.
  const ids = [agentId, ...(u.parent_agent_id ? [u.parent_agent_id] : [])].sort();
  await c.query('select 1 from agents where user_id = any($1) order by user_id for update', [ids]);
  const a = (await c.query<AgentRow>('select * from agents where user_id = $1', [agentId])).rows[0];
  if (!a) throw notFound('agent');
  if (agentId === by) throw forbidden('self_approval', 'another team member decides on your own agent account');
  if (u.rate_l1_bps !== undefined && (u.rate_l1_bps < 0 || u.rate_l1_bps > RATE_CAPS.l1)) throw unprocessable('rate_cap', `level-1 rate is 0–${RATE_CAPS.l1 / 100}%`);
  if (u.rate_l2_bps !== undefined && (u.rate_l2_bps < 0 || u.rate_l2_bps > RATE_CAPS.l2)) throw unprocessable('rate_cap', `level-2 rate is 0–${RATE_CAPS.l2 / 100}%`);
  if (u.parent_agent_id !== undefined && u.parent_agent_id !== null) {
    if (u.parent_agent_id === agentId) throw unprocessable('invalid_parent', 'an agent cannot be its own parent');
    if (u.parent_agent_id === by) throw forbidden('self_approval', 'you cannot place an agent under your own agent account');
    const p = (await c.query<AgentRow>('select * from agents where user_id = $1', [u.parent_agent_id])).rows[0];
    if (!p || p.status !== 'active') throw unprocessable('invalid_parent', 'the parent must be an active agent');
    if (p.parent_agent_id) throw unprocessable('depth_limit', 'agents go two levels deep: the parent must be a top-level agent');
    const kids = (await c.query('select 1 from agents where parent_agent_id = $1 limit 1', [agentId])).rowCount;
    if (kids) throw unprocessable('depth_limit', 'this agent has its own sub-agents, so it cannot have a parent');
  }
  const row = (await c.query<AgentRow>(
    `update agents set status = coalesce($2, status), rate_l1_bps = coalesce($3, rate_l1_bps), rate_l2_bps = coalesce($4, rate_l2_bps),
            parent_agent_id = case when $6 then $5 else parent_agent_id end,
            approved_by = case when $2 = 'active' and status <> 'active' then $7 else approved_by end
      where user_id = $1 returning *`,
    [agentId, u.status ?? null, u.rate_l1_bps ?? null, u.rate_l2_bps ?? null, u.parent_agent_id ?? null, u.parent_agent_id !== undefined, by])).rows[0]!;
  // Leaving 'applied' is the decision on the application: activation approves it, anything else
  // (rejected, or suspended straight from applied) declines it. Later status changes are not decisions.
  if (a.status === 'applied' && u.status !== undefined) await recordOutcome(c, 'agent', agentId, u.status === 'active' ? 'approve' : 'reject', by);
  await audit(c, { type: 'agent.updated', agentId, by, ...u });
  return row;
}

/** Bets that settle in the last moments of a month may commit a little later; wait this long after month end. */
export const CLOSE_GRACE_MS = 3_600_000;

const monthStart = (m: string, now: Date) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw unprocessable('invalid_month', 'month is YYYY-MM');
  const [y, mo] = m.split('-').map(Number) as [number, number];
  if (Date.UTC(y, mo, 1) + CLOSE_GRACE_MS > now.getTime()) throw unprocessable('month_not_ended', `${m} can be closed an hour after it ends (UTC)`);
  return `${m}-01`;
};

/**
 * NGR of a set of players for one month and currency: settled stakes − payouts on bets in modes
 * with cash value, minus the value of promotions they claimed in that currency.
 */
async function ngr(c: Tx, playersSql: string, params: unknown[], month: string, currency: string): Promise<number> {
  const i = params.length;
  const r = (await c.query<{ ngr: string }>(
    `with p as (${playersSql})
     select (coalesce((select sum(b.stake_minor - coalesce(b.payout_minor, 0)) from bets b
                        where b.user_id in (select id from p) and b.currency = $${i + 2} and b.mode in ('real-fiat','real-crypto')
                          and b.status in ('won','lost') and b.settled_at >= $${i + 1}::date and b.settled_at < ($${i + 1}::date + interval '1 month')), 0)
           - coalesce((select sum(pc.amount_minor) from promotion_claims pc join promotions pr on pr.id = pc.promotion_id
                        where pc.user_id in (select id from p) and pr.currency = $${i + 2}
                          and pc.claimed_at >= $${i + 1}::date and pc.claimed_at < ($${i + 1}::date + interval '1 month')), 0))::text as ngr`,
    [...params, month, currency])).rows[0]!;
  return Number(r.ngr);
}

/**
 * Builds the statements for a month that has ended, once: the month is recorded as closed, so
 * closing it again changes nothing even if agents were reparented or suspended since. Suspended
 * agents keep their accounts (and their carry) but are not paid while suspended. Level 1 carries
 * a negative balance forward; level 2 does not.
 */
export async function closeMonth(c: Tx, monthYm: string, by: string, now = new Date()): Promise<number> {
  const month = monthStart(monthYm, now);
  // Months close in order: the level-1 carry runs from each month into the next, so closing out of
  // order would apply a negative balance twice or lose it.
  await c.query('lock table agent_month_closes in share row exclusive mode');
  if ((await c.query('select 1 from agent_month_closes where month = $1', [month])).rowCount) return 0;
  const order = (await c.query<{ later: boolean; any: boolean; prev: boolean }>(
    `select exists (select 1 from agent_month_closes where month > $1) as later, exists (select 1 from agent_month_closes) as any,
            exists (select 1 from agent_month_closes where month = ($1::date - interval '1 month')::date) as prev`, [month])).rows[0]!;
  if (order.later) throw unprocessable('month_out_of_order', 'a later month is already closed');
  if (order.any && !order.prev) throw unprocessable('month_out_of_order', 'close the previous month first');
  await c.query('insert into agent_month_closes (month, statements, closed_by) values ($1, 0, $2)', [month, by]);
  const agents = (await c.query<AgentRow>(`select * from agents where status in ('active','suspended') order by user_id`)).rows;
  let created = 0;
  for (const a of agents) {
    for (const currency of Object.keys(REAL_CURRENCIES)) {
      const ngr1 = await ngr(c, 'select id from users where referred_by_agent = $1', [a.user_id], month, currency);
      // The latest earlier level-1 statement holds the running negative balance.
      const prev = (await c.query<{ carry_out_minor: string }>(
        `select carry_out_minor::text from agent_statements where agent_id = $1 and currency = $2 and level = 1 and month < $3::date order by month desc limit 1`,
        [a.user_id, currency, month])).rows[0];
      const carryIn = Number(prev?.carry_out_minor ?? 0);
      const base = ngr1 + carryIn;
      const ngr2 = await ngr(c, 'select u.id from users u join agents s on s.user_id = u.referred_by_agent where s.parent_agent_id = $1', [a.user_id], month, currency);
      const rows: [level: 1 | 2, n: number, cin: number, cout: number, rate: number, amount: number][] = [
        [1, ngr1, carryIn, Math.min(0, base), a.rate_l1_bps, base > 0 ? Math.floor((base * a.rate_l1_bps) / 10_000) : 0],
        [2, ngr2, 0, 0, a.rate_l2_bps, ngr2 > 0 ? Math.floor((ngr2 * a.rate_l2_bps) / 10_000) : 0],
      ];
      for (const [level, n, cin, cout, rate, amount] of rows) {
        if (n === 0 && cin === 0) continue;
        const ins = await c.query(
          `insert into agent_statements (id, agent_id, month, currency, level, ngr_minor, carry_in_minor, carry_out_minor, rate_bps, amount_minor)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (agent_id, month, currency, level) do nothing`,
          [newId('ast'), a.user_id, month, currency, level, n, cin, cout, rate, amount]);
        created += ins.rowCount ?? 0;
      }
    }
  }
  await c.query('update agent_month_closes set statements = $2 where month = $1', [month, created]);
  await audit(c, { type: 'agent.month_closed', month, statements: created, by });
  return created;
}

export async function approveStatement(c: Tx, id: string, by: string): Promise<void> {
  const own = (await c.query('select 1 from agent_statements where id = $1 and agent_id = $2', [id, by])).rowCount;
  if (own) throw forbidden('self_approval', 'another team member approves your own statements');
  const r = await c.query(`update agent_statements set status = 'approved', decided_by = $2 where id = $1 and status = 'draft'`, [id, by]);
  if (!r.rowCount) throw unprocessable('not_draft', 'only a draft statement can be approved');
  await audit(c, { type: 'agent.statement_approved', statementId: id, by });
}

/** Pays an approved statement from PreFlop marketing into the agent's wallet in that currency. */
export async function payStatement(c: Tx, id: string, by: string): Promise<void> {
  const s = (await c.query<{ agent_id: string; currency: string; amount_minor: string; status: string; decided_by: string | null }>(
    'select agent_id, currency, amount_minor::text, status, decided_by from agent_statements where id = $1 for update', [id])).rows[0];
  if (!s) throw notFound('statement');
  if (s.status !== 'approved') throw unprocessable('not_approved', 'approve the statement before paying it');
  if (s.agent_id === by) throw forbidden('self_approval', 'another admin pays your own statements');
  // Four eyes on money leaving PreFlop: the team member who approved a statement does not pay it.
  if (s.decided_by === by) throw forbidden('four_eyes', 'the team member who approved a statement does not pay it; another admin does');
  // Held until the payment commits, so a concurrent suspension waits for it (or wins before it).
  const agent = (await c.query<{ status: string }>('select status from agents where user_id = $1 for share', [s.agent_id])).rows[0];
  if (agent?.status !== 'active') throw unprocessable('agent_not_active', 'commission is paid to active agents only; re-activate the agent first');
  const mode = REAL_CURRENCIES[s.currency]!;
  if (!(await modeEnabled(c, mode))) throw forbidden('mode_disabled', `${mode} is switched off; commissions are paid when it is enabled`);
  const amount = Number(s.amount_minor);
  if (amount > 0) {
    await post(c, 'agent.commission', id, [{ from: acct('PreFlop', 'marketing', mode, s.currency), to: acct(s.agent_id, 'wallet', mode, s.currency), amountMinor: amount }]);
  }
  await c.query(`update agent_statements set status = 'paid', paid_by = $2 where id = $1`, [id, by]);
  await audit(c, { type: 'agent.statement_paid', statementId: id, amountMinor: amount, by });
}
