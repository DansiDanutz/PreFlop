/**
 * Typed client for the PreFlop API. This file IS the contract between the backend (apps/api)
 * and every frontend (apps/web, apps/console, apps/table). See docs/14-platform-api.md.
 *
 * Money is always integer minor units with a currency. Odds are integer hundredths.
 */

import type { z } from 'zod';
import * as S from './schemas.ts';
export { COUNTRY_CODES, isCountryCode } from './countries.ts';

// ======================================================================================= types

export type PlayMode = 'real-fiat' | 'real-crypto' | 'play' | 'virtual-chips' | 'diamonds';
export type RoundState = 'OPEN' | 'LOCKED' | 'DEALT' | 'REVIEW' | 'EVIDENCE_REJECTED' | 'SETTLED' | 'VOID';
export type Step = 'open' | 'locked' | 'shuffle_commanded' | 'shuffled' | 'cut_instructed' | 'cut' | 'dealing';
export type OrgKind = 'club' | 'partner' | 'organizer';
export type OrgRole = 'owner' | 'admin' | 'viewer';
export type PlatformRole = 'admin' | 'ops' | 'risk' | 'support';

export interface Problem { type: string; title: string; status: number; [k: string]: unknown }

/** GET /v1/admin/metrics. Database counters are global; `instance` is the API process that answered. */
export interface AdminMetrics {
  at: string;
  outbox: { pending: number; oldest_pending_age_s: number | null };
  webhook_deliveries: { pending: number; failed: number; oldest_pending_age_s: number | null };
  alerts: { open: number; open_critical: number };
  rounds_by_state: Partial<Record<'OPEN' | 'LOCKED' | 'DEALT' | 'REVIEW' | 'EVIDENCE_REJECTED' | 'SETTLED' | 'VOID', number>>;
  sweeper_voids_last_hour: number;
  worker: { ok: boolean; last_beat_age_ms: number | null; max_age_ms: number };
  instance: {
    pid: number; started_at: string; uptime_s: number;
    db_retries: { total: number; deadlocks: number; serialization_failures: number; exhausted: number };
    ws_clients: number;
  };
}

export interface User {
  id: string; email: string; display_name: string; status: 'active' | 'suspended' | 'self_excluded' | 'closed';
  kyc_status: 'none' | 'pending' | 'verified' | 'rejected'; platform_role: PlatformRole | null; country: string | null; partner_id: string | null;
}
/** The signed-in account (GET /v1/me). */
export interface SessionUser extends User {
  /** YYYY-MM-DD; null for accounts created before the age gate (they can add it once with updateMe). */
  date_of_birth: string | null;
  email_verified: boolean;
  /** Two-factor authentication (TOTP) is on for sign-in. */
  mfa_enabled: boolean;
}
export interface Membership { org_id: string; kind: OrgKind; name: string; role: OrgRole; status: string }
export interface Wallet { mode: PlayMode; currency: string; balance_minor: number; org_id?: string | null; org_name?: string | null }
export interface Me extends SessionUser {
  /** A PreFlop team account while settings.require_staff_mfa is on and 2FA is off: only enrolment works. */
  mfa_enrollment_required: boolean;
  memberships: Membership[]; wallets: Wallet[]; agent?: { status: AgentStatus; code: string } | null;
}

/** settings.territories: ISO 3166-1 alpha-2 codes. */
export interface Territories { blocked: string[]; real_money_allowed: string[] }

/** GET /v1/me/session: the play session of this sign-in (session_minutes and reality checks). */
export interface PlaySession {
  started_at: string; minutes_played: number;
  /** The player's session_minutes limit, or null. Bets are refused (403 session_limit) from ends_at until a new sign-in. */
  limit_minutes: number | null; ends_at: string | null; limit_reached: boolean;
  /** Show a reality check every this many minutes (session_minutes, else 60). */
  reality_check_minutes: number;
  /** Bets placed in this session, per wallet. net_minor = returned - staked over settled bets. */
  results: { mode: PlayMode; currency: string; bets: number; staked_minor: number; returned_minor: number; open_stake_minor: number; net_minor: number }[];
}
export interface MfaSetup { secret: string; otpauth_uri: string }

export interface BookSelection { id: string; label: string; probability: number; wins: number; offered: boolean; odds_centi: number; reason?: string }
export interface BookMarket { id: string; family: string; name: string; description: string; first_release: boolean; exhaustive: boolean; selections: BookSelection[] }
export interface Book { channel: string; flop_count: number; families: Record<string, string>; markets: BookMarket[] }

export interface TableSummary {
  id: string; name: string; club_id: string; club_name: string; city: string | null; kind: 'physical' | 'simulated' | 'manual';
  mode: PlayMode; currency: string; status: 'active' | 'paused' | 'retired'; ready: boolean; problems: string[]; stream_live: boolean;
  /** review_deadline: see Round. */
  current_round: { id: string; hand_no: number; state: RoundState; step: Step; review_deadline?: string | null } | null;
  open_round_id: string | null;
  last_flop: { round_id: string; hand_no: number; cards: string[] } | null;
}
/** GET /v1/admin/tables/manual: tables whose flop the PreFlop team types in the console (free play only). */
export interface ManualTable {
  id: string; name: string; mode: 'play'; currency: string; status: string; pause_reason: string | null;
  round: { id: string; hand_no: number; state: RoundState; opened_at: string; locked_at: string | null; settled_at: string | null; flop: string[] | null; void_reason: string | null; bets: number; staked_minor: number } | null;
  last_settled: { hand_no: number; flop: string[]; settled_at: string } | null;
}
export interface ManualTables { enabled: boolean; result_sla_ms: number; tables: ManualTable[] }
export interface RoundHistoryItem { id: string; hand_no: number; state: RoundState; flop: string[] | null; settled_at: string | null; voided_at: string | null; void_reason: string | null }
export interface TableDetail extends TableSummary { history: RoundHistoryItem[] }
export interface ClubSummary { id: string; name: string; city: string | null; status: string | null; tables: number }
export interface Lobby { clubs: ClubSummary[]; tables: TableSummary[] }
export interface Round {
  id: string; table_id: string; hand_no: number; state: RoundState; step: Step; mode: PlayMode; currency: string;
  opened_at: string; locked_at: string | null; settled_at: string | null; voided_at: string | null; void_reason: string | null; flop: string[] | null;
  /** ISO-8601 time the review must be decided by (review start + REVIEW_SLA_MS; undecided → VOID). Null unless state is REVIEW. */
  review_deadline?: string | null;
}

export interface PlaceBet { round_id: string; selection_id: string; stake_minor: number; odds_centi: number; accept_price_change?: boolean; room_id?: string }
export interface BetView { bet_id: string; round_id: string; selection_id: string; stake_minor: number; odds_centi: number; potential_payout_minor: number; mode: PlayMode; currency: string; status: string }
export interface MyBet extends BetView {
  payout_minor: number | null; placed_at: string; settled_at: string | null; hand_no: number; table_id: string; table_name: string; flop: string[] | null; room_id?: string | null;
  /** The Idempotency-Key the bet was placed with: how a client finds out whether its uncertain request landed. */
  idempotency_key?: string | null;
}
/** GET /v1/me/bets filters. `before` is a bet_id (the previous page's next_before); room_id "none" means bets outside rooms. */
export interface MyBetsFilter { limit?: number; round_id?: string; status?: string; before?: string; mode?: PlayMode; currency?: string; room_id?: string }
/** A money amount of one (mode, currency): amounts of different currencies are never added together. */
export interface CurrencyAmount { currency: string; mode: PlayMode; amount_minor: number }
/** Top-level fields: play money only (as before). by_currency: one row per (mode, currency) bet in. */
export interface MyStats {
  bets: number; won: number; lost: number; staked_minor: number; returned_minor: number;
  by_currency?: { mode: PlayMode; currency: string; bets: number; won: number; lost: number; staked_minor: number; returned_minor: number }[];
}
export interface LedgerLine { kind: string; ref: string; created_at: string; account_id: string; amount_minor: number; currency: string }

// --- rooms (organizer- or club-run books in chips or diamonds)
export interface RoomRules { margin_bps: number; min_stake_minor: number; rake_bps?: number; provider_share_bps?: number }
export interface Room {
  id: string; org_id: string; org_name: string; name: string; table_id: string; table_name: string; mode: PlayMode; currency: string;
  house: 'organizer' | 'pool'; rules: RoomRules; status: 'active' | 'paused' | 'closed'; visibility: 'public' | 'invite'; invite_code?: string | null;
}

/** GET /v1/rooms/:id: the room plus its own book. Odds are null where the room does not offer a selection.
 *  Pool rooms return 100 for every selection: send odds_centi 100 for pool bets (payouts are parimutuel). */
export interface RoomDetail extends Room { odds: Record<string, number | null> }

// --- organization portals
export interface OrgOverview {
  org: { id: string; kind: OrgKind; name: string; status: string; settings: Record<string, unknown> };
  kpis: { label: string; value: number; currency?: string; hint?: string }[];
  /** One row per day, mode and currency (amounts are minor units of that currency). */
  series: { day: string; mode?: PlayMode; currency: string; turnover_minor: number; ggr_minor: number; bets: number }[];
  /** 30-day totals per (mode, currency). */
  turnover_by_currency?: CurrencyAmount[];
  ggr_by_currency?: CurrencyAmount[];
}
export interface StaffCredential { id: string; table_id: string; person_id: string; role: 'dealer' | 'floor' | 'floor_manager'; revoked: boolean; created_at: string }
export interface Device { id: string; table_id: string; revoked: boolean; last_seq: number; created_at: string }
export interface CertItem { ok: boolean; by?: string; at?: string; expires_at?: string }
export interface LinkSample { uploadMbps: number; rttMs: number; jitterMs: number; packetLossPct: number; videoDelayMs: number; backupLinkUp: boolean; streamLive: boolean }
export interface ClubTable extends TableSummary { certification: Record<string, CertItem>; max_round_loss_minor: number; link: LinkSample | null; link_at: string | null }
export interface Statement {
  party: string; period: string; currency: string;
  lines: { label: string; metric?: number; tier?: string; rate_bps?: number; base_minor?: number; amount_minor: number }[];
  total_minor: number;
}
export interface DiamondPack { diamonds: number; price_minor: number; currency: string; unit_price_minor: number; tier: string }
export interface Transfer { id: string; org_id: string; user_email: string; mode: PlayMode; currency: string; amount_minor: number; created_at: string }
export interface Dilution { period: string; bought: number; sunk_preflop_fee: number; rake: number; house_net: number; transferred: number; circulating: number; bets_until_empty: number | null }
export interface ApiClient { id: string; name: string; created_at: string; revoked: boolean; secret?: string }
export interface Webhook { id: string; url: string; events: string[]; active: boolean; created_at: string; secret?: string }
export interface WebhookDelivery { id: string; webhook_id: string; event_type: string; status: 'pending' | 'delivered' | 'failed'; attempts: number; last_error: string | null; created_at: string }
// ---------------------------------------------------------------- tournaments (docs/17)
/**
 * scheduled → running (starts_at) → settling (ends_at, until open bets settle) → completed; or cancelled.
 * `status` is derived from the clock on every read, so it is exact even between worker ticks.
 */
export type TournamentStatus = 'scheduled' | 'running' | 'settling' | 'completed' | 'cancelled';
/** playing: has stack and bets left · busted: stack below the minimum stake · finished: used every bet. */
export type TournamentEntryStatus = 'playing' | 'busted' | 'finished';
export interface Tournament {
  id: string; name: string; description: string; owner_org: string | null; owner_name: string;
  mode: PlayMode; currency: string;
  /** Paid from the wallet at registration (0 = freeroll). */
  buy_in_minor: number;
  /** Share of the buy-ins kept by the organizer of the tournament (PreFlop or the club/organizer). */
  fee_bps: number;
  /** Fixed amount the owner adds to the prize pool. */
  added_minor: number;
  /** Tournament points: every entry starts with this stack, has no cash value, and only exists inside the tournament. */
  starting_stack: number;
  bets_allowed: number; min_stake: number; max_stake: number | null;
  starts_at: string; ends_at: string; duration_minutes: number;
  /** Registration closes at this time (starts_at + late registration). */
  late_reg_until: string;
  min_entries: number; max_entries: number | null; entries: number;
  /** Buy-ins after the fee, plus the added amount. */
  prize_pool_minor: number;
  /** Share of the prize pool per final position, e.g. [5000, 3000, 2000]; sums to 10,000. */
  payout_bps: number[];
  status: TournamentStatus; registration_open: boolean; cancel_reason: string | null;
  /** Present when signed in. */
  you?: { registered: boolean };
}
export interface TournamentStanding {
  /** Shared by tied players: same stack and same number of bets used. */
  rank: number;
  display_name: string;
  /** Current stack = points accumulated. */
  stack: number;
  bets_used: number; bets_left: number;
  /** Bets placed and waiting for their flop. */
  pending_bets: number;
  status: TournamentEntryStatus;
  /** Projected while running (by current position), final once completed. */
  prize_minor: number;
  you: boolean;
}
export interface TournamentBet {
  id: string; round_id: string; table_id: string; selection_id: string;
  /** Present on your bets in the tournament dashboard. */
  table_name?: string;
  stake: number; odds_centi: number; status: 'accepted' | 'won' | 'lost' | 'void'; payout: number | null;
  created_at: string; settled_at: string | null;
}
export interface TournamentDetail {
  tournament: Tournament;
  /** Everyone, best first (top 200). */
  standings: TournamentStanding[];
  you: (TournamentStanding & { bets: TournamentBet[] }) | null;
  /** For the countdown: compare with ends_at / starts_at instead of trusting the device clock. */
  server_time: string;
}
export interface TournamentInput {
  name: string; description?: string; mode: PlayMode; currency: string;
  buy_in_minor: number; fee_bps: number; added_minor?: number;
  starting_stack: number; bets_allowed: number; min_stake: number; max_stake?: number | null;
  starts_at: string; duration_minutes: number; late_reg_minutes?: number;
  min_entries?: number; max_entries?: number | null; payout_bps: number[];
}
export interface TournamentBetInput {
  round_id: string; selection_id: string; stake: number; odds_centi: number;
  accept_price_change?: boolean; idempotency_key: string;
}

/** A single-use link that makes whoever redeems it (signed in) an owner of the organization. */
export interface OwnerClaim { token: string; expires_at: string }

export interface Application { id: string; kind: OrgKind; name: string; email: string; details: Record<string, unknown>; status: 'new' | 'approved' | 'rejected'; created_at: string; user_id: string | null; hint?: DecisionHint | null }
/** One typed answer of the decision model (docs/20). */
export type DecisionAnswer =
  | { type: 'noul'; noul: number }  // probability of "yes", 0..1; at least 0.5 reads as yes
  | { type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; confidence?: number };
/** A stored hint of the decision model beside an alert or a round in review: advice, never an action. */
export interface DecisionHint { model: string | null; answers: Record<string, DecisionAnswer>; at: string }
export interface Alert { id: number; table_id: string | null; round_id: string | null; kind: string; severity: 'info' | 'warning' | 'critical'; details: Record<string, unknown>; created_at: string; resolved_at: string | null; hint?: DecisionHint | null }
/** The decision model's verdict on cards the browser read (docs/19): pre-fill or let the operator type. `confidence` is the model's probability (0..1) that pre-filling the card is safe; `accept` is true from 0.7 up. */
export interface ReadingCheck { enabled: boolean; model: string | null; cards: { card: string; accept: boolean; confidence: number | null }[] }
export interface Evidence { round: Round & { review_reasons: string[] | null }; capture: Record<string, unknown> | null; image_data_url: string | null; entries: { source: string; person_id: string; cards: string[] }[]; events: { ord: number; step: string; at: string }[] }
export interface Limits { deposit_day_minor?: number | null; loss_day_minor?: number | null; session_minutes?: number | null }
export interface Payment { id: string; kind: 'deposit' | 'withdrawal' | 'purchase'; method: string; currency: string; amount_minor: number; status: string; created_at: string; address?: string | null }

// --- stream
export interface StreamEvent { type: string; table_id?: string; round_id?: string; data: Record<string, any>; at: number }

// =================================================================================== client

export class ApiError extends Error {
  constructor(readonly status: number, readonly problem: Problem) {
    super(problem.title || problem.type);
  }
  get type() { return this.problem.type; }
  /** Seconds to wait before retrying a 429 (rate_limited, login_locked), else null. */
  get retryAfterS(): number | null { return typeof this.problem.retry_after_s === 'number' ? this.problem.retry_after_s : null; }
}

export const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '');

export interface ClientOptions {
  baseUrl: string;
  getToken?: () => string | null | undefined;
  onUnauthorized?: () => void;
}


// --- leaderboards and promotions (docs/16)
export type LeaderboardMetric = 'net' | 'volume' | 'roi' | 'points';
export interface Leaderboard {
  id: string; name: string; owner_org: string | null; owner_name: string; mode: PlayMode; currency: string;
  scope: 'global' | 'org' | 'table' | 'room'; scope_ref: string | null; metric: LeaderboardMetric; min_rounds: number; prize_split_bps: number[];
  starts_at: string; ends_at: string; status: 'scheduled' | 'active' | 'settled' | 'cancelled'; margin_bps: number; contribution_bps: number; pool_minor: number;
}
export interface LeaderboardEntry { rank: number | null; display_name: string; score: number; rounds: number; qualified: boolean; prize_minor: number; badge: string | null; you: boolean }
export interface LeaderboardDetail { leaderboard: Leaderboard; standings: LeaderboardEntry[]; you: LeaderboardEntry | null }
export interface LeaderboardInput {
  name: string; mode: PlayMode; currency: string; scope?: Leaderboard['scope']; scope_ref?: string | null; metric: LeaderboardMetric; min_rounds?: number;
  prize_split_bps: number[]; starts_at: string; ends_at: string; margin_bps?: number; contribution_bps?: number; fund_minor?: number;
}
export type PromotionKind = 'announcement' | 'leaderboard' | 'free-chips' | 'org-drop';
export interface Promotion {
  id: string; owner_org: string | null; owner_name?: string; kind: PromotionKind; title: string; body: string; link: string | null; leaderboard_id: string | null;
  mode: PlayMode | null; currency: string | null; amount_minor: number | null; budget_minor: number | null; claimed_minor: number;
  starts_at: string; ends_at: string; status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'ended'; review_note: string | null; claimed?: boolean; eligible?: boolean; live?: boolean; hint?: DecisionHint | null;
}
export interface PromotionInput {
  kind: PromotionKind; title: string; body?: string; link?: string | null; leaderboard_id?: string | null; mode?: PlayMode | null; currency?: string | null;
  amount_minor?: number | null; budget_minor?: number | null; starts_at: string; ends_at: string; draft?: boolean;
}
export type AgentStatus = 'applied' | 'active' | 'suspended' | 'rejected';
export interface Agent { user_id: string; code: string; parent_agent_id: string | null; status: AgentStatus; rate_l1_bps: number; rate_l2_bps: number; note: string | null; created_at: string }
export interface AgentStatement {
  id: string; agent_id: string; month: string; currency: string; level: 1 | 2; ngr_minor: number; carry_in_minor: number; carry_out_minor: number;
  rate_bps: number; amount_minor: number; status: 'draft' | 'approved' | 'paid'; display_name?: string;
}
export interface MyAgent { agent: Agent | null; players?: number; sub_agents?: { user_id: string; display_name: string; code: string; status: AgentStatus; players: number }[]; statements?: AgentStatement[] }
export interface AdminAgents {
  caps: { rate_l1_bps: number; rate_l2_bps: number };
  agents: (Agent & { display_name: string; email: string; players: number; parent_name: string | null; hint?: DecisionHint | null })[];
  statements: AgentStatement[];
}
// --- news (migration 015)
/** A published post as the public site lists it (no body). */
export interface NewsCard { id: string; slug: string; title: string; summary: string; tags: string[]; published_at: string }
/** GET /v1/news/:slug. `body` is the small Markdown subset rendered by @preflop/ui/markdown. */
export interface NewsPost extends NewsCard { body: string; updated_at: string }
/** Every post, drafts included, for the PreFlop team. */
export interface AdminNewsPost {
  id: string; slug: string; title: string; summary: string; body: string; tags: string[]; status: 'draft' | 'published';
  published_at: string | null; author_id: string | null; created_at: string; updated_at: string;
}
/** Create (title required) or update (every field optional). A slug is made from the title when none is given. */
export interface NewsInput { title: string; summary?: string; body?: string; tags?: string[]; slug?: string }
export interface Badge { id: string; kind: 'champion' | 'podium' | 'top10'; label: string; leaderboard_id: string | null; awarded_at: string }

const isProblem = (d: unknown): d is Problem => !!d && typeof d === 'object' && typeof (d as Problem).type === 'string';

/**
 * The body of a response as JSON, as an ApiError when it is not usable: a proxy's HTML error
 * page, a truncated body, or (with a schema) JSON that does not have the shape the apps compute
 * money with (`invalid_response`). Never a raw SyntaxError, never an unchecked `as T`.
 */
export function parseResponse<T>(status: number, statusText: string, text: string, schema?: z.ZodTypeAny): T {
  let data: unknown = null;
  let json = true;
  if (text) { try { data = JSON.parse(text); } catch { json = false; } }
  if (status < 200 || status >= 300) {
    throw new ApiError(status, json && isProblem(data) ? data : { type: 'http_error', title: statusText || `HTTP ${status}`, status });
  }
  if (!json) throw new ApiError(status, { type: 'invalid_response', title: 'The server sent a response that is not JSON.', status });
  if (schema) {
    const r = schema.safeParse(data);
    if (!r.success) {
      throw new ApiError(status, {
        type: 'invalid_response', title: 'The server sent a response this app cannot read.', status,
        issues: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
  }
  return data as T;
}

export function createClient(o: ClientOptions) {
  async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, schema?: z.ZodTypeAny): Promise<T> {
    const token = o.getToken?.();
    const res = await fetch(o.baseUrl + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (res.status === 401) o.onUnauthorized?.();
    return parseResponse<T>(res.status, res.statusText, text, schema);
  }
  const get = <T>(p: string, s?: z.ZodTypeAny) => req<T>('GET', p, undefined, {}, s);
  const post = <T>(p: string, b: unknown = {}, h?: Record<string, string>, s?: z.ZodTypeAny) => req<T>('POST', p, b, h, s);
  const put = <T>(p: string, b: unknown = {}) => req<T>('PUT', p, b);
  const del = <T>(p: string) => req<T>('DELETE', p);
  const q = (o2: Record<string, string | number | undefined | null>) => {
    const s = Object.entries(o2).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    return s ? `?${s}` : '';
  };
  const org = (id: string) => `/v1/org/${encodeURIComponent(id)}`;

  return {
    raw: req,

    // ---------- public
    health: () => get<{ ok: boolean }>('/v1/health'),
    book: (channel = 'direct') => get<Book>(`/v1/book${q({ channel })}`),
    modes: () => get<{ modes: Record<PlayMode, boolean>; physical_play_enabled: boolean }>('/v1/modes'),
    lobby: () => get<Lobby>('/v1/lobby'),
    club: (id: string) => get<ClubSummary & { country: string | null; tables: TableSummary[] }>(`/v1/clubs/${encodeURIComponent(id)}`),
    table: (id: string) => get<TableDetail>(`/v1/tables/${encodeURIComponent(id)}`),
    currentRound: (tableId: string) => get<{ latest: Round; open: { id: string; hand_no: number; opened_at: string } | null }>(`/v1/tables/${encodeURIComponent(tableId)}/rounds/current`),
    round: (id: string) => get<Round>(`/v1/rounds/${encodeURIComponent(id)}`),
    rooms: () => get<{ rooms: Room[] }>('/v1/rooms'),
    room: (id: string) => get<RoomDetail>(`/v1/rooms/${encodeURIComponent(id)}`),
    apply: (a: { kind: OrgKind; name: string; email: string; details?: Record<string, unknown> }) => post<{ id: string }>('/v1/applications', a),
    /** Published news, newest first. 400 bad_request for a limit outside 1–50 or a malformed tag. */
    newsList: (f: { limit?: number; tag?: string } = {}) => get<{ posts: NewsCard[] }>(`/v1/news${q(f)}`, S.newsListSchema),
    /** One published post; 404 not_found for drafts and unknown slugs. */
    newsPost: (slug: string) => get<NewsPost>(`/v1/news/${encodeURIComponent(slug)}`, S.newsPostSchema),

    // ---------- auth
    /** 403 underage (under 18), 403 territory_blocked; country is ISO 3166-1 alpha-2, date_of_birth YYYY-MM-DD. Sends a verification email. */
    register: (b: { email: string; password: string; display_name: string; date_of_birth: string; country: string; ref?: string }) => post<{ token: string; user: Pick<User, 'id' | 'email' | 'display_name'> }>('/v1/auth/register', b),
    /** With 2FA on, a call without `otp` answers 401 mfa_required (no session); a wrong code is 401 invalid_otp. */
    login: (b: { email: string; password: string; otp?: string }) => post<{ token: string }>('/v1/auth/login', b),
    logout: () => post<{ ok: true }>('/v1/auth/logout'),
    verifyEmail: (token: string) => post<{ ok: true; email_verified: true }>('/v1/auth/verify-email', { token }),
    /** Always { ok: true }, whether or not the address has an account. */
    forgotPassword: (email: string) => post<{ ok: true }>('/v1/auth/forgot-password', { email }),
    /** Signs the account out everywhere. 400 invalid_token for an unknown, used or expired link. */
    resetPassword: (token: string, password: string) => post<{ ok: true }>('/v1/auth/reset-password', { token, password }),

    // ---------- player
    me: () => get<Me>('/v1/me', S.meSchema),
    /** date_of_birth and country can only be added when missing (409 already_set otherwise). */
    updateMe: (b: { display_name?: string; date_of_birth?: string; country?: string }) =>
      req<{ id: string; display_name: string; date_of_birth: string | null; country: string | null }>('PATCH', '/v1/me', b),
    resendVerification: () => post<{ ok: true }>('/v1/me/resend-verification'),
    /** Signs out every other session. 401 invalid_credentials when `current` is wrong. */
    changePassword: (current: string, next: string) => post<{ ok: true }>('/v1/me/password', { current, new: next }),
    mfaSetup: () => post<MfaSetup>('/v1/me/mfa/setup'),
    mfaEnable: (code: string) => post<{ mfa_enabled: true }>('/v1/me/mfa/enable', { code }),
    mfaDisable: (code: string) => post<{ mfa_enabled: false }>('/v1/me/mfa/disable', { code }),
    mySession: () => get<PlaySession>('/v1/me/session'),
    wallets: () => get<{ wallets: Wallet[] }>('/v1/me/wallets', S.walletsSchema),
    resetPlay: () => post<{ balance_minor: number }>('/v1/me/play/reset', {}, undefined, S.balanceSchema),
    placeBet: (b: PlaceBet, idempotencyKey = newIdempotencyKey()) => post<BetView>('/v1/bets', b, { 'idempotency-key': idempotencyKey }, S.betViewSchema),
    /** Newest first; next_before (null on the last page) is the `before` of the next page. */
    myBets: (f: MyBetsFilter = {}) => get<{ bets: MyBet[]; next_before?: string | null }>(`/v1/me/bets${q({ ...f })}`, S.myBetsSchema),
    myLedger: () => get<{ entries: LedgerLine[] }>('/v1/me/ledger'),
    myStats: () => get<MyStats>('/v1/me/stats', S.myStatsSchema),
    favorites: () => get<{ selection_ids: string[] }>('/v1/me/favorites'),
    setFavorites: (selection_ids: string[]) => put<{ selection_ids: string[] }>('/v1/me/favorites', { selection_ids }),
    joinRoom: (code: string) => post<Room>('/v1/rooms/join', { code }),
    leaderboards: (mode?: PlayMode) => get<{ leaderboards: Leaderboard[] }>(`/v1/leaderboards${mode ? `?mode=${mode}` : ''}`),
    leaderboard: (id: string) => get<LeaderboardDetail>(`/v1/leaderboards/${encodeURIComponent(id)}`),
    // tournaments (docs/17). Live updates: WS /v1/stream, subscribe to `tournament:<id>` → `tournament.standings`.
    tournaments: (status?: 'upcoming' | 'running' | 'finished') => get<{ tournaments: Tournament[]; server_time: string }>(`/v1/tournaments${q({ status })}`, S.tournamentsSchema),
    tournament: (id: string) => get<TournamentDetail>(`/v1/tournaments/${encodeURIComponent(id)}`, S.tournamentDetailSchema),
    registerTournament: (id: string) => post<TournamentDetail>(`/v1/tournaments/${encodeURIComponent(id)}/register`, {}, undefined, S.tournamentDetailSchema),
    unregisterTournament: (id: string) => req<{ ok: true; refunded_minor: number }>('DELETE', `/v1/tournaments/${encodeURIComponent(id)}/register`, undefined, {}, S.refundSchema),
    tournamentBet: (id: string, b: TournamentBetInput) => post<TournamentBet>(`/v1/tournaments/${encodeURIComponent(id)}/bets`, b, undefined, S.tournamentBetSchema),
    myAgent: () => get<MyAgent>('/v1/me/agent'),
    applyAgent: (note?: string) => post<Agent>('/v1/me/agent/apply', note ? { note } : {}),
    myBadges: () => get<{ badges: Badge[] }>('/v1/me/badges'),
    promotions: () => get<{ promotions: Promotion[] }>('/v1/promotions'),
    claimPromotion: (id: string) => post<{ amount_minor: number; currency: string }>(`/v1/promotions/${encodeURIComponent(id)}/claim`, {}, undefined, S.claimSchema),
    limits: () => get<Limits>('/v1/me/limits'),
    setLimits: (l: Limits) => put<Limits>('/v1/me/limits', l),
    selfExclude: (days: number) => post<{ until: string }>('/v1/me/self-exclusion', { days }),
    startKyc: () => post<{ kyc_status: string }>('/v1/me/kyc'),
    payments: () => get<{ payments: Payment[] }>('/v1/me/payments', S.paymentsSchema),
    // Money in/out: pass the same idempotencyKey to retry safely (a retry never moves money twice).
    deposit: (b: { mode: PlayMode; currency: string; amount_minor: number; method: string }, idempotencyKey = newIdempotencyKey()) => post<Payment>('/v1/me/deposits', b, { 'idempotency-key': idempotencyKey }, S.paymentSchema),
    withdraw: (b: { mode: PlayMode; currency: string; amount_minor: number; method: string; destination?: string }, idempotencyKey = newIdempotencyKey()) => post<Payment>('/v1/me/withdrawals', b, { 'idempotency-key': idempotencyKey }, S.paymentSchema),
    buyChips: (b: { chips: number; pay_with: string }, idempotencyKey = newIdempotencyKey()) => post<Payment>('/v1/me/chips/purchases', b, { 'idempotency-key': idempotencyKey }, S.paymentSchema),

    // ---------- organization portals (club / partner / organizer)
    orgOverview: (id: string) => get<OrgOverview>(`${org(id)}/overview`),
    orgUpdate: (id: string, b: { name?: string; settings?: Record<string, unknown> }) => put<{ ok: true }>(`${org(id)}`, b),
    orgMembers: (id: string) => get<{ members: { user_id: string; email: string; display_name: string; role: OrgRole }[] }>(`${org(id)}/members`),
    orgAddMember: (id: string, b: { email: string; role: OrgRole }) => post<{ ok: true }>(`${org(id)}/members`, b),
    orgSetMemberRole: (id: string, userId: string, role: OrgRole) => put<{ ok: true }>(`${org(id)}/members/${encodeURIComponent(userId)}`, { role }),
    orgRemoveMember: (id: string, userId: string) => del<{ ok: true }>(`${org(id)}/members/${encodeURIComponent(userId)}`),
    orgStatements: (id: string, period?: string) => get<{ statements: Statement[] }>(`${org(id)}/statements${q({ period })}`),
    orgRounds: (id: string, f: { table_id?: string; state?: string; limit?: number } = {}) => get<{ rounds: (Round & { bets: number; staked_minor: number; paid_minor: number })[] }>(`${org(id)}/rounds${q(f)}`),
    /** balances: one entry per (mode, currency). balance_minor/currency are deprecated: the first currency only. */
    orgPlayers: (id: string) => get<{ players: { user_id: string; email: string | null; display_name: string; balances?: CurrencyAmount[]; balance_minor: number; currency: string; bets: number }[] }>(`${org(id)}/players`),
    // club
    clubTables: (id: string) => get<{ tables: ClubTable[] }>(`${org(id)}/tables`),
    clubCreateTable: (id: string, b: { name: string; kind: 'physical' | 'simulated'; mode: PlayMode; currency: string }) => post<{ id: string }>(`${org(id)}/tables`, b),
    clubCertify: (id: string, tableId: string, items: Record<string, boolean>) => put<{ certification: Record<string, CertItem> }>(`${org(id)}/tables/${encodeURIComponent(tableId)}/certification`, { items }),
    clubStaff: (id: string) => get<{ credentials: StaffCredential[]; devices: Device[] }>(`${org(id)}/staff`),
    clubEnrollStaff: (id: string, b: { table_id: string; person_id: string; role: StaffCredential['role']; public_key_pem: string }) => post<StaffCredential>(`${org(id)}/staff`, b),
    clubRevokeStaff: (id: string, credId: string) => post<{ ok: true }>(`${org(id)}/staff/${encodeURIComponent(credId)}/revoke`),
    // organizer & club rooms / currencies
    orgRooms: (id: string) => get<{ rooms: Room[] }>(`${org(id)}/rooms`),
    orgLeaderboards: (id: string) => get<{ leaderboards: Leaderboard[] }>(`${org(id)}/leaderboards`),
    orgTournaments: (id: string) => get<{ tournaments: Tournament[] }>(`${org(id)}/tournaments`),
    orgCreateTournament: (id: string, b: TournamentInput) => post<Tournament>(`${org(id)}/tournaments`, b),
    orgCancelTournament: (id: string, t: string, reason: string) => post<{ ok: true }>(`${org(id)}/tournaments/${encodeURIComponent(t)}/cancel`, { reason }),
    orgCreateLeaderboard: (id: string, b: LeaderboardInput) => post<Leaderboard>(`${org(id)}/leaderboards`, b),
    orgFundLeaderboard: (id: string, lb: string, amount_minor: number) => post<Leaderboard>(`${org(id)}/leaderboards/${encodeURIComponent(lb)}/fund`, { amount_minor }),
    orgPromotions: (id: string) => get<{ promotions: Promotion[] }>(`${org(id)}/promotions`),
    orgCreatePromotion: (id: string, b: PromotionInput) => post<Promotion>(`${org(id)}/promotions`, b),
    orgCreateRoom: (id: string, b: { name: string; table_id: string; mode: PlayMode; house: 'organizer' | 'pool'; rules: RoomRules; visibility: 'public' | 'invite' }) => post<Room>(`${org(id)}/rooms`, b),
    orgUpdateRoom: (id: string, roomId: string, b: Partial<{ name: string; rules: RoomRules; status: Room['status']; visibility: Room['visibility'] }>) => put<Room>(`${org(id)}/rooms/${encodeURIComponent(roomId)}`, b),
    orgValidateRules: (id: string, b: { mode: PlayMode; house: 'organizer' | 'pool'; rules: RoomRules }) => post<{ ok: boolean; problems: string[]; organizer_ev?: number; fee_rate_bound?: number }>(`${org(id)}/rooms/validate`, b),
    orgTreasury: (id: string) => get<{ accounts: { purpose: string; mode: PlayMode; currency: string; balance_minor: number; reserved_minor?: number }[] }>(`${org(id)}/treasury`),
    orgFundCollateral: (id: string, b: { mode: PlayMode; currency: string; amount_minor: number }, idempotencyKey = newIdempotencyKey()) => post<{ ok: true }>(`${org(id)}/collateral/deposits`, b, { 'idempotency-key': idempotencyKey }),
    diamondPacks: (id: string) => get<{ packs: DiamondPack[] }>(`${org(id)}/diamonds/packs`),
    buyDiamonds: (id: string, b: { diamonds: number; pay_with: 'EUR' | 'USDT' | 'USDC' }, idempotencyKey = newIdempotencyKey()) => post<Payment>(`${org(id)}/diamonds/purchases`, b, { 'idempotency-key': idempotencyKey }),
    buyOrgChips: (id: string, b: { chips: number; pay_with: 'EUR' | 'USDT' | 'USDC' }, idempotencyKey = newIdempotencyKey()) => post<Payment>(`${org(id)}/chips/purchases`, b, { 'idempotency-key': idempotencyKey }),
    orgTransfers: (id: string) => get<{ transfers: Transfer[] }>(`${org(id)}/transfers`),
    orgTransfer: (id: string, b: { email: string; mode: PlayMode; amount_minor: number }, idempotencyKey = newIdempotencyKey()) => post<Transfer>(`${org(id)}/transfers`, b, { 'idempotency-key': idempotencyKey }),
    orgDilution: (id: string, period?: string) => get<Dilution>(`${org(id)}/dilution${q({ period })}`),
    // partner
    partnerClients: (id: string) => get<{ clients: ApiClient[] }>(`${org(id)}/api-clients`),
    partnerCreateClient: (id: string, name: string) => post<ApiClient>(`${org(id)}/api-clients`, { name }),
    partnerRevokeClient: (id: string, clientId: string) => post<{ ok: true }>(`${org(id)}/api-clients/${encodeURIComponent(clientId)}/revoke`),
    partnerWebhooks: (id: string) => get<{ webhooks: Webhook[]; deliveries: WebhookDelivery[] }>(`${org(id)}/webhooks`),
    partnerCreateWebhook: (id: string, b: { url: string; events: string[] }) => post<Webhook>(`${org(id)}/webhooks`, b),
    partnerDeleteWebhook: (id: string, hookId: string) => del<{ ok: true }>(`${org(id)}/webhooks/${encodeURIComponent(hookId)}`),
    partnerTestWebhook: (id: string, hookId: string) => post<WebhookDelivery>(`${org(id)}/webhooks/${encodeURIComponent(hookId)}/test`),
    partnerBets: (id: string, f: { limit?: number } = {}) => get<{ bets: (MyBet & { player_ref: string })[] }>(`${org(id)}/bets${q(f)}`),
    partnerWidget: (id: string) => get<{ settings: Record<string, unknown>; snippet: string }>(`${org(id)}/widget`),
    partnerSaveWidget: (id: string, settings: Record<string, unknown>) => put<{ settings: Record<string, unknown>; snippet: string }>(`${org(id)}/widget`, { settings }),

    // ---------- PreFlop team (admin)
    // ---------- Partner API (server to server only: never ship client_secret to a browser)
    partnerToken: (client_id: string, client_secret: string) => post<{ access_token: string; token_type: 'Bearer'; expires_in: number }>('/v1/partner/oauth/token', { grant_type: 'client_credentials', client_id, client_secret }),
    partnerCreatePlayer: (token: string, player_ref: string, display_name?: string) => req<{ player_ref: string; user_id: string }>('POST', '/v1/partner/players', { player_ref, ...(display_name ? { display_name } : {}) }, { authorization: `Bearer ${token}` }),
    partnerPlayerSession: (token: string, player_ref: string) => req<{ token: string; user_id: string }>('POST', `/v1/partner/players/${encodeURIComponent(player_ref)}/session`, {}, { authorization: `Bearer ${token}` }),

    /** bets_24h.staked_by_currency: 24 h stakes per (mode, currency). `staked` (a sum across currencies) is no longer sent. */
    adminOverview: () => get<{ users: { n: number }; bets_24h: { n: number; staked_by_currency: CurrencyAmount[]; /** @deprecated not sent any more: use staked_by_currency */ staked?: number }; rounds_24h: { settled: number; voided: number }; open_alerts: { n: number }; tables: TableSummary[] }>('/v1/admin/overview'),
    adminManualTables: () => get<ManualTables>('/v1/admin/tables/manual'),
    adminCreateManualTable: (b: { name: string }) => post<{ id: string; name: string; kind: 'manual'; mode: string; currency: string }>('/v1/admin/tables/manual', b),
    adminManualLock: (tableId: string, handNo: number) => post<{ state: 'LOCKED' }>(`/v1/admin/tables/${encodeURIComponent(tableId)}/manual/lock`, { hand_no: handNo }),
    adminReadingCheck: (cards: { card: string; confidence: number; margin?: number }[]) => post<ReadingCheck>('/v1/admin/manual/reading-check', { cards }),
    adminManualFlop: (tableId: string, handNo: number, cards: string[]) => post<{ state: 'SETTLED'; cards: string[]; next_round_id: string | null }>(`/v1/admin/tables/${encodeURIComponent(tableId)}/manual/flop`, { hand_no: handNo, cards }),
    adminSettings: () => get<{ settings: { key: string; value: unknown; updated_at: string; updated_by: string | null }[] }>('/v1/admin/settings'),
    adminSetSetting: (key: string, value: unknown, note?: string) => put<{ key: string; value: unknown }>(`/v1/admin/settings/${encodeURIComponent(key)}`, { value, ...(note ? { note } : {}) }),
    adminAlerts: () => get<{ alerts: Alert[] }>('/v1/admin/alerts'),
    adminResolveAlert: (id: number) => post<{ ok: true }>(`/v1/admin/alerts/${id}/resolve`),
    adminReviewQueue: () => get<{ rounds: (Round & { review_reasons: string[] | null; table_name: string; hint?: DecisionHint | null })[] }>('/v1/admin/review-queue'),
    adminEvidence: (roundId: string) => get<Evidence>(`/v1/admin/rounds/${encodeURIComponent(roundId)}/evidence`),
    adminVoidRound: (roundId: string, reason: string) => post<{ state: string }>(`/v1/admin/rounds/${encodeURIComponent(roundId)}/void`, { reason }),
    adminRounds: (f: { table_id?: string; state?: string; limit?: number } = {}) => get<{ rounds: (Round & { bets: number; staked_minor: number; paid_minor: number; table_name: string })[] }>(`/v1/admin/rounds${q(f)}`),
    adminUsers: (f: { q?: string; limit?: number } = {}) => get<{ users: (User & { created_at: string; bets: number })[] }>(`/v1/admin/users${q(f)}`),
    adminUpdateUser: (id: string, b: Partial<Pick<User, 'status' | 'kyc_status' | 'platform_role'>>) => put<User>(`/v1/admin/users/${encodeURIComponent(id)}`, b),
    adminAgents: () => get<AdminAgents>('/v1/admin/agents'),
    adminUpdateAgent: (id: string, b: { status?: 'active' | 'suspended' | 'rejected'; rate_l1_bps?: number; rate_l2_bps?: number; parent_agent_id?: string | null }) => put<Agent>(`/v1/admin/agents/${encodeURIComponent(id)}`, b),
    adminCloseAgentMonth: (month: string) => post<{ created: number }>(`/v1/admin/agents/statements/close?month=${encodeURIComponent(month)}`),
    adminApproveStatement: (id: string) => post<{ ok: true }>(`/v1/admin/agents/statements/${encodeURIComponent(id)}/approve`),
    adminPayStatement: (id: string) => post<{ ok: true }>(`/v1/admin/agents/statements/${encodeURIComponent(id)}/pay`),
    adminLeaderboards: () => get<{ leaderboards: Leaderboard[] }>('/v1/admin/leaderboards'),
    adminTournaments: () => get<{ tournaments: Tournament[] }>('/v1/admin/tournaments'),
    adminCreateTournament: (b: TournamentInput) => post<Tournament>('/v1/admin/tournaments', b),
    adminCancelTournament: (t: string, reason: string) => post<{ ok: true }>(`/v1/admin/tournaments/${encodeURIComponent(t)}/cancel`, { reason }),
    /** Full standings for the team (same shape as the public detail). */
    adminTournament: (t: string) => get<TournamentDetail>(`/v1/admin/tournaments/${encodeURIComponent(t)}`),
    adminCreateLeaderboard: (b: LeaderboardInput) => post<Leaderboard>('/v1/admin/leaderboards', b),
    adminFundLeaderboard: (lb: string, amount_minor: number) => post<Leaderboard>(`/v1/admin/leaderboards/${encodeURIComponent(lb)}/fund`, { amount_minor }),
    adminSettleLeaderboard: (lb: string) => post<{ ok: true }>(`/v1/admin/leaderboards/${encodeURIComponent(lb)}/settle`),
    adminCancelLeaderboard: (lb: string) => post<{ ok: true }>(`/v1/admin/leaderboards/${encodeURIComponent(lb)}/cancel`),
    // news (admin, ops; every change is audited)
    adminNews: () => get<{ posts: AdminNewsPost[] }>('/v1/admin/news', S.adminNewsListSchema),
    /** 409 slug_taken when an explicit slug is in use. */
    adminCreateNews: (b: NewsInput) => post<AdminNewsPost>('/v1/admin/news', b, undefined, S.adminNewsSchema),
    adminUpdateNews: (id: string, b: Partial<NewsInput>) => req<AdminNewsPost>('PUT', `/v1/admin/news/${encodeURIComponent(id)}`, b, {}, S.adminNewsSchema),
    /** A first publication is dated now; publishing again after an unpublish keeps the original date. */
    adminPublishNews: (id: string) => post<AdminNewsPost>(`/v1/admin/news/${encodeURIComponent(id)}/publish`, {}, undefined, S.adminNewsSchema),
    adminUnpublishNews: (id: string) => post<AdminNewsPost>(`/v1/admin/news/${encodeURIComponent(id)}/unpublish`, {}, undefined, S.adminNewsSchema),
    adminDeleteNews: (id: string) => del<{ ok: true }>(`/v1/admin/news/${encodeURIComponent(id)}`),
    adminPromotions: () => get<{ promotions: Promotion[] }>('/v1/admin/promotions'),
    adminCreatePromotion: (b: PromotionInput) => post<Promotion>('/v1/admin/promotions', b),
    adminDecidePromotion: (id: string, decision: 'approve' | 'reject', note?: string) => post<{ id: string; status: string }>(`/v1/admin/promotions/${encodeURIComponent(id)}/decision`, { decision, ...(note ? { note } : {}) }),
    adminEndPromotion: (id: string) => post<{ ok: true }>(`/v1/admin/promotions/${encodeURIComponent(id)}/end`),
    adminOrgs: () => get<{ orgs: (OrgOverview['org'] & { members: number; created_at: string })[] }>('/v1/admin/orgs'),
    adminCreateOrg: (b: { kind: OrgKind; name: string; owner_email: string; settings?: Record<string, unknown> }) =>
      post<{ id: string; owner_user_id: string | null; owner_claim: OwnerClaim | null }>('/v1/admin/orgs', b),
    adminIssueOwnerClaim: (id: string, email?: string) => post<{ owner_claim: OwnerClaim }>(`/v1/admin/orgs/${encodeURIComponent(id)}/owner-claim`, email ? { email } : {}),
    claimOrg: (token: string) => post<{ org_id: string; kind: OrgKind }>('/v1/me/org-claims', { token }),
    adminSetOrgStatus: (id: string, status: 'active' | 'suspended') => put<{ ok: true }>(`/v1/admin/orgs/${encodeURIComponent(id)}/status`, { status }),
    adminApplications: () => get<{ applications: Application[] }>('/v1/admin/applications'),
    adminDecideApplication: (id: string, decision: 'approved' | 'rejected') => post<{ ok: true; org_id?: string; owner_user_id?: string | null; owner_claim?: OwnerClaim | null }>(`/v1/admin/applications/${encodeURIComponent(id)}/decision`, { decision }),
    adminTables: () => get<{ tables: ClubTable[] }>('/v1/admin/tables'),
    adminSetTableStatus: (id: string, status: 'active' | 'paused', reason?: string) => put<{ ok: true }>(`/v1/admin/tables/${encodeURIComponent(id)}/status`, { status, reason }),
    adminLedger: (f: { account?: string; kind?: string; limit?: number } = {}) => get<{ accounts: { account_id: string; balance_minor: number; currency: string }[]; entries: (LedgerLine & { tx_id: number })[] }>(`/v1/admin/ledger${q(f)}`),
    adminAudit: (f: { limit?: number } = {}) => get<{ chain: { ok: boolean; brokenAt: number | null; count: number }; events: { seq: number; at: string; hash: string; event: string }[] }>(`/v1/admin/audit${q(f)}`),
    adminStatements: (period?: string) => get<{ statements: Statement[] }>(`/v1/admin/statements${q({ period })}`),
    adminMetrics: () => get<AdminMetrics>('/v1/admin/metrics'),
    adminRisk: () => get<{ rounds: { round_id: string; table_name: string; bets: number; staked_minor: number; worst_case_loss_minor: number; limit_minor: number; currency: string }[]; monitor: { table_id: string; table_name: string; hands: number; threshold: number; top: { selection_id: string; statistic: number }[] }[] }>('/v1/admin/risk'),
    adminPayments: () => get<{ payments: (Payment & { user_email: string | null; org_id: string | null })[] }>('/v1/admin/payments'),
  };
}

export type PreFlopClient = ReturnType<typeof createClient>;

// =================================================================================== stream

/** A stream frame, or null when it is not one (not JSON, or no `type`). */
export function parseStreamFrame(raw: unknown): StreamEvent | null {
  try {
    const d: unknown = JSON.parse(String(raw));
    if (!d || typeof d !== 'object' || typeof (d as StreamEvent).type !== 'string') return null;
    const e = d as StreamEvent;
    if (e.data !== undefined && (e.data === null || typeof e.data !== 'object')) return null;
    return { ...e, data: e.data ?? {} };
  } catch {
    return null;
  }
}

/**
 * Live events over WebSocket with auto-reconnect. Topics: "lobby", "table:<id>". Pass a session
 * token to also receive your own bet events (bet.accepted, bet.settled, bet.voided): it is sent as
 * the first frame ({"type":"auth"}), never in the URL, so it stays out of proxy and access logs.
 */
export function connectStream(o: { url: string; topics: string[]; token?: string | null; onEvent: (e: StreamEvent) => void; onStatus?: (s: 'open' | 'closed') => void }) {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let topics = [...o.topics];
  const open = () => {
    timer = null;
    // A reconnect scheduled before close() (logout, token change, unmount) never opens a socket.
    if (closed) return;
    const sock = new WebSocket(o.url);
    ws = sock;
    sock.onopen = () => {
      if (closed || ws !== sock) { sock.close(); return; }
      retry = 500;
      o.onStatus?.('open');
      if (o.token) sock.send(JSON.stringify({ type: 'auth', token: o.token }));
      sock.send(JSON.stringify({ subscribe: topics }));
    };
    sock.onmessage = (m) => {
      if (closed || ws !== sock) return;
      const e = parseStreamFrame(m.data);
      if (e) o.onEvent(e);
    };
    sock.onclose = () => {
      if (closed || ws !== sock) return;
      o.onStatus?.('closed');
      timer = setTimeout(open, (retry = Math.min(retry * 2, 10_000)));
    };
  };
  open();
  return {
    setTopics(next: string[]) {
      const un = topics.filter((t) => !next.includes(t));
      topics = [...next];
      if (ws?.readyState === 1) ws.send(JSON.stringify({ subscribe: topics, unsubscribe: un }));
    },
    /** Disposes the stream for good: cancels a pending reconnect and closes the socket. */
    close() {
      closed = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      const s = ws;
      ws = null;
      s?.close();
    },
  };
}

/** Market families shown as categories in "Browse bets" (concept 3). */
export const FAMILY_ORDER = ['rank-patterns', 'suits-colours', 'high-low', 'face-named', 'sequences', 'totals-parity', 'combined'] as const;
