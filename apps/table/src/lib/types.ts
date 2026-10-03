export type RoundState = 'OPEN' | 'LOCKED' | 'DEALT' | 'REVIEW' | 'EVIDENCE_REJECTED' | 'SETTLED' | 'VOID';
export type Step = 'open' | 'locked' | 'shuffle_commanded' | 'shuffled' | 'cut_instructed' | 'cut' | 'dealing';

export interface Round {
  id: string;
  hand_no: number;
  state: RoundState;
  step: Step;
  cut_depth: number | null;
  locked_at: string | null;
  deal_start_at: string | null;
  flop: string[] | null;
  review_reasons: string[] | null;
  /**
   * When an unresolved REVIEW is voided automatically (ISO-8601; null when not in REVIEW). Older
   * servers omit it; lib/review.ts then falls back to `review_started_at` + 30 min when present.
   */
  review_deadline?: string | null;
  review_started_at?: string | null;
  /** Per-round entries. Another person's cards are null until this person has entered (server-enforced). */
  entries: Entry[];
  has_dealer_entry: boolean;
  has_floor_entry: boolean;
  /** This person's own entry for the round, or null. */
  my_entry: string[] | null;
}

export interface Entry {
  source: 'dealer' | 'floor';
  person_id: string;
  mine?: boolean;
  cards: string[] | null;
}

export interface WhoAmI {
  kind: 'staff' | 'device';
  credential_id: string;
  role?: 'dealer' | 'floor' | 'floor_manager';
  person_id?: string;
  table_id: string;
}

export interface TableState {
  table: { id: string; name: string; status: 'active' | 'paused' | 'retired'; pause_reason: string | null; kind: 'physical' | 'simulated' };
  readiness: { ok: boolean; problems: string[] };
  /** Latest 3, newest first. */
  rounds: Round[];
  /** Same as rounds[0].entries. */
  entries: Entry[];
}

export interface Evidence {
  round?: Partial<Round> & Record<string, unknown>;
  capture?: { cards?: string[]; capturedAt?: number; seq?: number; [k: string]: unknown } | null;
  image_data_url?: string | null;
  entries?: (Entry & { credential_id?: string; created_at?: string })[];
  events?: { step: string; ord: number; at?: string; created_at?: string; credential_id?: string | null }[];
}
