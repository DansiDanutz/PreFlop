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

/**
 * The System One wire contract (api.typesafe.ai/openapi.json, as mirrored by the typesafe-sdk models):
 * questions are keyed by a name of our choosing; a noul answer is a probability of "yes" from 0 to 1
 * (not a boolean), a choice answer names the most likely criteria key with a confidence and the
 * probability of every key, a score answer is the probability-weighted level with a legend.
 */
export type Question =
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export const Answer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }),
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().min(0).max(1).optional() }),
  z.object({ type: z.literal('score'), score: z.number(), legend: z.unknown().optional(), probabilities: z.record(z.string(), z.number()).optional(), confidence: z.number().min(0).max(1).optional() }),
]);
export type Answer = z.infer<typeof Answer>;
export type Answers = Record<string, Answer>;

/**
 * A noul answer read as a verdict: yes when the probability of yes is at least `sure` (one half by
 * default), with the confidence in the verdict given, max(p, 1 - p).
 */
export const noulVerdict = (a: Answer | undefined, sure = 0.5): { yes: boolean; confidence: number } | null =>
  a?.type === 'noul' ? { yes: a.noul >= sure, confidence: Math.max(a.noul, 1 - a.noul) } : null;

/** The reading check pre-fills a card only when the model is this sure; a near-even answer is "check by eye". */
export const READING_SURE = 0.7;

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

/**
 * Contact fields and names never reach the adviser. Applicants type free-form details, so the scrub
 * walks the whole value: a key that names a way to reach a person, or a name of any kind (a venue
 * name and a manager's name are indistinguishable in free text), is withheld at every depth, and any
 * string that looks like an email address or a phone number is redacted wherever it sits. Business
 * facts stay: a venue's street address, capacity, tables or website. So the adviser still knows a
 * venue name was given, the paths of the withheld fields travel with the details (`withheld`), never
 * their values. Keys are applicant text as well, so they get the same redaction before they travel.
 */
const CONTACT_KEY = /e-?mail|phone|mobile|\btel\b|telephone|whatsapp|telegram|signal|contact|name|surname|applicant|person|owner|manager|director|ceo|founder|representative/i;
const EMAIL_TEXT = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE_TEXT = /(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)/g;
/** Fields per object the adviser is shown; a real application has a few dozen at most. */
export const SCRUB_MAX_KEYS = 200;
/**
 * Prose never travels: a name inside free text cannot be told apart from any other word, so a
 * free-text field (by key, or any string longer than PROSE_CHARS) is replaced by its length. The
 * adviser learns that a 240-character message was written, not what it says.
 */
const FREE_TEXT_KEY = /message|notes?|comments?|description|about|\btext|bio|story|pitch|\bwhy|summary|remarks?|background/i;
export const PROSE_CHARS = 60;
const prose = (v: unknown): unknown => (typeof v === 'string' ? { chars: v.length } : Array.isArray(v) ? v.map(prose) : v);
const scrubText = (text: string): string =>
  text.replace(EMAIL_TEXT, '[email]').replace(PHONE_TEXT, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m));
export function scrubContact(value: unknown, withheld?: string[], path = ''): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((v, i) => scrubContact(v, withheld, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    // Keys are applicant-controlled text too: the same redaction applies to them, kept or withheld.
    // Two keys that redact (or truncate) to the same text stay distinct, so no value is lost; the
    // next free suffix per base is remembered, so a flood of colliding keys costs linear time, and
    // an object is cut at SCRUB_MAX_KEYS fields (the rest is counted, not sent).
    const used = new Set<string>();
    const next = new Map<string, number>();
    for (const [k, v] of entries.slice(0, SCRUB_MAX_KEYS)) {
      const base = scrubText(k).slice(0, 64);
      let key = base;
      if (used.has(key)) {
        let n = next.get(base) ?? 2;
        while (used.has(`${base} (${n})`)) n++;
        key = `${base} (${n})`;
        next.set(base, n + 1);
      }
      used.add(key);
      const here = path ? `${path}.${key}` : key;
      if (CONTACT_KEY.test(k)) withheld?.push(here);
      else if (FREE_TEXT_KEY.test(k) || (typeof v === 'string' && v.length > PROSE_CHARS)) out[key] = typeof v === 'object' && v !== null && !Array.isArray(v) ? scrubContact(v, withheld, here) : prose(v);
      else out[key] = scrubContact(v, withheld, here);
    }
    if (entries.length > SCRUB_MAX_KEYS) withheld?.push(`${path ? `${path}.` : ''}… (${entries.length - SCRUB_MAX_KEYS} more fields not shown)`);
    return out;
  }
  return value;
}
/** The details an application's adviser sees, and the paths of the fields it was not shown. */
export function scrubDetails(details: unknown): { details: unknown; withheld: string[] } {
  const withheld: string[] = [];
  return { details: scrubContact(details, withheld), withheld };
}

/** Organization application (club, betting partner, organizer): approve, reject or ask for more before an org is created. */
export const APPLICATION_HINT: Record<string, Question> = {
  decision: {
    type: 'choice',
    instructions: 'An organization applied to join a poker flop-betting platform as a club (hosts tables), a betting partner (brings players) or an organizer (runs rooms and promotions). From the kind, the details the applicant filled in (names and contact fields are withheld and the paths of withheld fields are listed so you know they were provided; free text is replaced by its length in characters), how long it has waited and whether the same contact already has organizations or other open applications, suggest what the reviewer does first. Approving creates the organization and gives the applicant an owner account; nothing else is automatic.',
    criteria: {
      approve: 'The details describe a real, specific operation of the kind applied for and nothing suggests a duplicate or a test: create the organization.',
      ask_more: 'Plausible but thin or inconsistent (missing venue, licence, website or tables; details that do not fit the kind): write back before deciding.',
      reject: 'Empty, nonsense or test content, a duplicate of an existing organization or open application, or an activity the platform does not offer.',
    },
  },
  complete: { type: 'noul', instructions: 'Do the details, counting the withheld fields as provided, contain enough concrete information (what, where, how big) to set this organization up without a follow-up question?' },
};

/** Promotion review: an organization's offer to players, before players see it. */
export const PROMOTION_HINT: Record<string, Question> = {
  decision: {
    type: 'choice',
    instructions: 'An organization submitted a promotion for players of a poker flop-betting platform; a PreFlop team member approves it before any player sees it. Judge the title and body as a player would read them, together with the kind, the value per claim, the budget and the period. Rules: no misleading or unverifiable claims (guaranteed wins, risk-free, best odds), no urgency pressure or targeting of vulnerable players, no promise that the platform does not keep (the value is per claim and bounded by the budget), nothing that reads as a chat message or spam, and the period must be sensible. Suggest what the reviewer does.',
    criteria: {
      approve: 'Clear, truthful, matches the kind and the numbers, sensible period: show it to players.',
      edit: 'Acceptable offer with wording that must change first (an unverifiable claim, pressure, missing condition): reject with the exact words to fix.',
      reject: 'Misleading, manipulative, off-platform, or the numbers and period do not make sense for the kind.',
    },
  },
  misleading: { type: 'noul', instructions: 'Would a reasonable player be misled about what they get, how likely it is, or what it costs them?' },
};

/** Agent application: a player asking to recruit players for a share of net revenue. */
export const AGENT_HINT: Record<string, Question> = {
  decision: {
    type: 'choice',
    instructions: 'A registered player applied to become an agent of a poker flop-betting platform: agents share a code, and earn a percentage of the net gaming revenue of the players who register with it (two levels deep at most). The state holds the note the applicant wrote (contact details redacted), the age of the account and of the application, whether a recruiting agent proposed them, whether this account was an agent before (a re-application after a rejection or suspension), and how many players registered with their code. The code of a first-time applicant has never been shown to players, so registrations with it before approval point to a code shared outside the platform; a former agent may legitimately still have players. Suggest what the reviewer does. Approval only activates the code; the rates stay at the defaults.',
    criteria: {
      approve: 'A credible note (who they are, where their players come from) and nothing odd about the account: activate the code.',
      hold: 'No note or a vague one, or a very new account: ask what audience they bring before activating.',
      reject: 'Spam, prohibited practices (buying traffic to minors, incentivising losses), signs of a self-referral scheme, or a first application whose code already has registrations.',
    },
  },
};

/** Card reading: is one recognised card sure enough to pre-fill the operator's picker? */
export const READING_CHECK: Record<string, Question> = {
  accept: { type: 'noul', instructions: 'A camera read one playing card on a felt table and reports a match confidence (0..1, normalised correlation of the corner index) and the margin to the runner-up glyph. Should this card be pre-filled for the operator to confirm? Answer no when a mistake is plausible; the operator can always type the card.' },
};
