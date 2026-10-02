import { type PlayMode, account } from '@preflop/odds-engine';
import type { Tx } from './db.ts';
import { ApiError } from './errors.ts';

export interface Transfer {
  readonly from: string;
  readonly to: string;
  readonly amountMinor: number;
}

/** `<owner>:<purpose>:<mode>:<currency>` — the engine validates the currency for the mode. */
export const acct = (owner: string, purpose: string, mode: PlayMode, currency: string): string => account(owner, purpose, mode, currency);

const currencyOf = (accountId: string): string => accountId.slice(accountId.lastIndexOf(':') + 1);

export async function ensureAccount(c: Tx, id: string): Promise<void> {
  await c.query('insert into ledger_accounts (id, currency) values ($1, $2) on conflict do nothing', [id, currencyOf(id)]);
}

/** Row-locks an account (creating it if needed). Callers lock wallets in ascending id order. */
export async function lockAccount(c: Tx, id: string): Promise<void> {
  await ensureAccount(c, id);
  await c.query('select id from ledger_accounts where id = $1 for update', [id]);
}

export async function balance(c: Tx | { query: Tx['query'] }, id: string): Promise<number> {
  const r = await c.query<{ b: number | null }>('select coalesce(sum(amount_minor), 0)::bigint as b from ledger_entries where account_id = $1', [id]);
  return Number(r.rows[0]?.b ?? 0);
}

/**
 * Posts one balanced ledger transaction, unique on (kind, ref). Returns false — and posts
 * nothing — if that (kind, ref) was already posted, so retries can never move money twice.
 * The deferred trigger in SQL independently refuses any unbalanced transaction.
 */
export async function post(c: Tx, kind: string, ref: string, transfers: readonly Transfer[]): Promise<boolean> {
  const live = transfers.filter((t) => t.amountMinor !== 0);
  for (const t of live) {
    if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor < 0) throw new ApiError(500, 'internal', `invalid ledger amount ${t.amountMinor}`);
    if (currencyOf(t.from) !== currencyOf(t.to)) throw new ApiError(500, 'internal', `cross-currency transfer ${t.from} → ${t.to}`);
  }
  const ins = await c.query<{ id: number }>('insert into ledger_tx (kind, ref) values ($1, $2) on conflict (kind, ref) do nothing returning id', [kind, ref]);
  const txId = ins.rows[0]?.id;
  if (txId === undefined) return false;
  for (const t of live) {
    await ensureAccount(c, t.from);
    await ensureAccount(c, t.to);
    const cur = currencyOf(t.from);
    await c.query(
      'insert into ledger_entries (tx_id, account_id, amount_minor, currency) values ($1, $2, $3, $5), ($1, $4, $6, $5)',
      [txId, t.from, -t.amountMinor, t.to, cur, t.amountMinor],
    );
  }
  return true;
}
