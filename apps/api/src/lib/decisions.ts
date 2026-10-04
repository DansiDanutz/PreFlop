import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db, Tx } from './db.ts';

/**
 * Decisions (docs/20): small, repeatable yes/no and pick-one judgements handed to TypeSafe AI's
 * Jev decision model (System One API). Jev is not a chat model: it is given a state (JSON) and
 * typed questions, and answers each with a decision plus calibrated probabilities. PreFlop uses
 * it as an adviser only: a hint beside the operator's own decision, never a settlement, void,
 * payout or account action. The key is read from JEV_API_KEY; without it every surface degrades
 * to "no hint" and nothing else changes.
 */

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria?: Record<string, string> };

export const Answer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: z.boolean(), confidence: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal('score'), score: z.number(), legend: z.unknown().optional(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().min(0).max(1).optional() }),
]);
export type Answer = z.infer<typeof Answer>;
export type Answers = Record<string, Answer>;

const Response = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), Answer),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).partial().optional(),
});

export class DecisionError extends Error {
  constructor(readonly status: number, message: string, readonly retryable = false) {
    super(message);
    this.name = 'DecisionError';
  }
}

export interface Decider {
  /** False when no key is configured: callers skip the call and report "no hint". */
  readonly enabled: boolean;
  /** The model name reported to operators ("jev-latest"), or null when disabled. */
  readonly model: string | null;
  /** One call: the state (JSON, up to ~32k tokens) and the questions, keyed as the answers come back. */
  decide(state: unknown, questions: Record<string, Question>): Promise<Answers>;
  /** Running totals of this process, for GET /v1/admin/metrics. */
  readonly stats: { calls: number; failures: number; inputTokens: number; outputTokens: number };
}

export const disabledDecider: Decider = {
  enabled: false,
  model: null,
  stats: { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 },
  async decide() { throw new DecisionError(503, 'decisions are not configured (JEV_API_KEY)'); },
};

export interface JevOptions {
  url: string;
  key: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Statuses the API documents: 401 bad key, 422 bad request, 429 rate limit, 529 overloaded. */
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

export function jevDecider(o: JevOptions): Decider {
  const f = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? 8_000;
  const stats = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
  const once = async (body: string): Promise<Answers> => {
    stats.calls++;
    let res: Response;
    try {
      res = await f(o.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${o.key}`, 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      stats.failures++;
      throw new DecisionError(0, `decision service unreachable: ${e instanceof Error ? e.message : String(e)}`, true);
    }
    if (!res.ok) {
      stats.failures++;
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new DecisionError(res.status, `decision service answered ${res.status}${text ? `: ${text}` : ''}`, RETRYABLE.has(res.status));
    }
    const parsed = Response.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      stats.failures++;
      throw new DecisionError(502, 'decision service answered with an unexpected body');
    }
    stats.inputTokens += parsed.data.usage?.input_tokens ?? 0;
    stats.outputTokens += parsed.data.usage?.output_tokens ?? 0;
    return parsed.data.answers;
  };
  /** Every question asked must be answered, with the type it asked for; otherwise the hint would be stored half-empty and never asked again. */
  const complete = (answers: Answers, questions: Record<string, Question>): Answers => {
    const missing = Object.entries(questions).filter(([k, q]) => answers[k]?.type !== q.type).map(([k]) => k);
    if (missing.length) { stats.failures++; throw new DecisionError(502, `decision service left questions unanswered or mistyped: ${missing.join(', ')}`); }
    return answers;
  };
  return {
    enabled: true,
    model: o.model,
    stats,
    async decide(state, questions) {
      const body = JSON.stringify({ model: o.model, state, questions });
      try {
        return complete(await once(body), questions);
      } catch (e) {
        // One retry on a rate limit or an overloaded service; anything else is reported at once.
        if (e instanceof DecisionError && e.retryable) {
          await new Promise((r) => setTimeout(r, 400));
          return complete(await once(body), questions);
        }
        throw e;
      }
    },
  };
}

export const deciderFromConfig = (config: Config): Decider =>
  config.decisions.apiKey ? jevDecider({ url: config.decisions.url, key: config.decisions.apiKey, model: config.decisions.model }) : disabledDecider;

// ---------------------------------------------------------------- stored hints

/** What the worker stores per (kind, ref): the answers, or the error that stopped us asking again. */
export type Hint = { answers: Answers; model: string | null; created_at: string; error?: string };

export async function saveHint(c: Tx | Db, kind: string, ref: string, model: string | null, answers: Answers | null, error?: string): Promise<void> {
  await c.query(
    `insert into decision_hints (kind, ref, model, answers, error) values ($1, $2, $3, $4, $5)
       on conflict (kind, ref) do update set model = excluded.model, answers = excluded.answers, error = excluded.error, attempts = decision_hints.attempts + 1, created_at = now()`,
    [kind, ref, model, JSON.stringify(answers ?? {}), error ?? null]);
}

// ---------------------------------------------------------------- the questions PreFlop asks

/** Alert triage: what the on-duty operator should do first with an open alert. */
export const ALERT_TRIAGE: Record<string, Question> = {
  triage: {
    type: 'choice',
    instructions: 'An integrity alert was raised on a poker flop-betting platform. Choose the first action for the on-duty operator. Prefer the least disruptive action that still protects players\' money.',
    criteria: {
      dismiss: 'Noise or already explained by the details: resolve it without further action.',
      watch: 'Plausible but low impact: keep the table running and watch the next hands.',
      pause_table: 'Betting on this table should stop until a person has looked (evidence, device or shuffle problems on a live table).',
      escalate: 'Security or money at risk, or a pattern across tables: wake the risk lead now.',
    },
  },
  money_at_risk: { type: 'noul', instructions: 'Is there a realistic chance that players\' money is misallocated or exposed because of this alert, as opposed to a monitoring or link problem?' },
};

/** Round review: the two possible outcomes of a round in REVIEW, plus "a person must look first". */
export const REVIEW_HINT: Record<string, Question> = {
  outcome: {
    type: 'choice',
    instructions: 'A poker flop-betting round is in review because the entries of the three flop cards disagree, or the evidence was rejected. Suggest the most likely correct outcome for the reviewer. Settlement pays bets on the flop; a void refunds every bet. Only suggest settle when one entry is clearly the right one and consistent with the capture.',
    criteria: {
      settle: 'One entry is clearly right (consistent with the capture or two of three sources agree): settle on those cards.',
      void: 'The cards cannot be established from the evidence: void and refund.',
      escalate: 'Signs of tampering or a device problem: a person must examine the evidence before anything else.',
    },
  },
};

/** Card reading: is one recognised card sure enough to pre-fill the operator's picker? */
export const READING_CHECK: Record<string, Question> = {
  accept: { type: 'noul', instructions: 'A camera read one playing card on a felt table and reports a match confidence (0..1, normalised correlation of the corner index) and the margin to the runner-up glyph. Should this card be pre-filled for the operator to confirm? Answer no when a mistake is plausible; the operator can always type the card.' },
};
