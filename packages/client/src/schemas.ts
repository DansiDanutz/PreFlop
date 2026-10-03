import { z } from 'zod';

/**
 * Runtime checks for money-bearing API responses. TypeScript types end at the network boundary:
 * a proxy page, a half-deployed API or a shape change must never reach a balance, a bet slip or a
 * prize as `undefined` or as a string. Each schema pins the fields the apps compute with (amounts,
 * odds, currencies, statuses) and lets unknown extra fields through, so the API can add fields
 * without breaking older clients.
 */

const minor = z.number().int().safe();
const nonNegMinor = minor.nonnegative();
const currency = z.string().min(1).max(16);
const mode = z.enum(['real-fiat', 'real-crypto', 'play', 'virtual-chips', 'diamonds']);
const isoTime = z.string().min(1);
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable();
const optNullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

export const walletSchema = z.object({
  mode, currency, balance_minor: minor,
  org_id: optNullable(z.string()), org_name: optNullable(z.string()),
}).passthrough();

export const walletsSchema = z.object({ wallets: z.array(walletSchema) }).passthrough();

/** GET /v1/me: only the wallets carry money; the rest is checked loosely. */
export const meSchema = z.object({ id: z.string(), email: z.string(), wallets: z.array(walletSchema) }).passthrough();

export const balanceSchema = z.object({ balance_minor: minor }).passthrough();

export const betViewSchema = z.object({
  bet_id: z.string().min(1), round_id: z.string().min(1), selection_id: z.string().min(1),
  stake_minor: nonNegMinor, odds_centi: z.number().int().positive(), potential_payout_minor: nonNegMinor,
  mode, currency, status: z.string().min(1),
}).passthrough();

export const myBetSchema = betViewSchema.extend({
  payout_minor: nullable(nonNegMinor), placed_at: isoTime, settled_at: nullable(isoTime),
  hand_no: z.number().int(), table_id: z.string(), table_name: z.string(), flop: nullable(z.array(z.string())),
}).passthrough();

export const myBetsSchema = z.object({ bets: z.array(myBetSchema) }).passthrough();

export const myStatsSchema = z.object({
  bets: z.number().int().nonnegative(), won: z.number().int().nonnegative(), lost: z.number().int().nonnegative(),
  staked_minor: nonNegMinor, returned_minor: nonNegMinor,
}).passthrough();

export const paymentSchema = z.object({
  id: z.string().min(1), kind: z.enum(['deposit', 'withdrawal', 'purchase']), method: z.string(), currency,
  amount_minor: minor, status: z.string().min(1), created_at: isoTime,
}).passthrough();

export const paymentsSchema = z.object({ payments: z.array(paymentSchema) }).passthrough();

export const claimSchema = z.object({ amount_minor: nonNegMinor, currency }).passthrough();
export const refundSchema = z.object({ ok: z.literal(true), refunded_minor: nonNegMinor }).passthrough();

const tournamentStatus = z.enum(['scheduled', 'running', 'settling', 'completed', 'cancelled']);
export const tournamentSchema = z.object({
  id: z.string().min(1), mode, currency,
  buy_in_minor: nonNegMinor, fee_bps: z.number().int().min(0).max(10_000), added_minor: nonNegMinor,
  starting_stack: z.number().int().nonnegative(), bets_allowed: z.number().int().nonnegative(),
  min_stake: z.number().int().nonnegative(), max_stake: nullable(z.number().int().nonnegative()),
  entries: z.number().int().nonnegative(), prize_pool_minor: nonNegMinor,
  payout_bps: z.array(z.number().int().min(0).max(10_000)),
  status: tournamentStatus, registration_open: z.boolean(),
}).passthrough();

export const tournamentsSchema = z.object({ tournaments: z.array(tournamentSchema), server_time: isoTime }).passthrough();

const entryStatus = z.enum(['playing', 'busted', 'finished']);
export const tournamentBetSchema = z.object({
  id: z.string().min(1), round_id: z.string(), selection_id: z.string(),
  stake: z.number().int().nonnegative(), odds_centi: z.number().int().positive(),
  status: z.enum(['accepted', 'won', 'lost', 'void']), payout: nullable(z.number().int().nonnegative()),
}).passthrough();

export const standingSchema = z.object({
  rank: z.number().int().positive(), stack: z.number().int().nonnegative(),
  bets_used: z.number().int().nonnegative(), bets_left: z.number().int().nonnegative(), pending_bets: z.number().int().nonnegative(),
  status: entryStatus, prize_minor: nonNegMinor, you: z.boolean(),
}).passthrough();

export const tournamentDetailSchema = z.object({
  tournament: tournamentSchema,
  standings: z.array(standingSchema),
  you: nullable(standingSchema.extend({ bets: z.array(tournamentBetSchema) }).passthrough()),
  server_time: isoTime,
}).passthrough();

// ------------------------------------------------------------------ news

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const newsCardSchema = z.object({
  id: z.string().min(1), slug, title: z.string(), summary: z.string(), tags: z.array(z.string()), published_at: isoTime,
}).passthrough();
export const newsListSchema = z.object({ posts: z.array(newsCardSchema) }).passthrough();
export const newsPostSchema = newsCardSchema.extend({ body: z.string(), updated_at: isoTime }).passthrough();
export const adminNewsSchema = z.object({
  id: z.string().min(1), slug, title: z.string(), summary: z.string(), body: z.string(), tags: z.array(z.string()),
  status: z.enum(['draft', 'published']), published_at: nullable(isoTime), author_id: nullable(z.string()), created_at: isoTime, updated_at: isoTime,
}).passthrough();
export const adminNewsListSchema = z.object({ posts: z.array(adminNewsSchema) }).passthrough();
