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
}

export interface Entry {
  source: 'dealer' | 'floor';
  person_id: string;
  cards: string[];
}

export interface TableState {
  table: { id: string; name: string; status: 'active' | 'paused' | 'retired'; pause_reason: string | null; kind: 'physical' | 'simulated' };
  readiness: { ok: boolean; problems: string[] };
  /** Latest 3, newest first. */
  rounds: Round[];
  /** Entries of rounds[0] only. */
  entries: Entry[];
}

export interface Evidence {
  round?: Partial<Round> & Record<string, unknown>;
  capture?: { cards?: string[]; capturedAt?: number; seq?: number; [k: string]: unknown } | null;
  image_data_url?: string | null;
  entries?: (Entry & { credential_id?: string; created_at?: string })[];
  events?: { step: string; ord: number; at?: string; created_at?: string; credential_id?: string | null }[];
}
