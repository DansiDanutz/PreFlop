import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ALERT_TRIAGE, type Answers, type Decider, DecisionError, type Question, deciderFromConfig, disabledDecider, jevDecider } from '../src/lib/decisions.ts';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { HINT_RETRY_MAX, decisionsOnce, startWorker } from '../src/worker.ts';
import { type Harness, harness } from './helpers.ts';

/**
 * Decision hints (docs/20): TypeSafe AI's Jev answers typed questions about alerts, rounds in
 * review and card readings. Advice only; off without JEV_API_KEY.
 */

type Call = { url: string; init: RequestInit };
/** A fake System One endpoint: records requests and answers from a script of responses. */
function fakeFetch(script: (() => Response)[]) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = script.shift();
    if (!next) throw new Error('no scripted response left');
    return next();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ANSWER = { model: 'jev-latest', answers: { triage: { type: 'choice', choice: 'watch', probabilities: { dismiss: 0.1, watch: 0.7, pause_table: 0.15, escalate: 0.05 }, confidence: 0.7 }, money_at_risk: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 120, output_tokens: 8 } };

describe('the Jev decider', () => {
  it('posts the model, state and questions with the bearer key and parses the typed answers', async () => {
    const { f, calls } = fakeFetch([json(200, ANSWER)]);
    const d = jevDecider({ url: 'https://api.typesafe.ai/v1/systemone', key: 'k'.repeat(24), model: 'jev-latest', fetch: f });
    const answers = await d.decide({ alert: { kind: 'device_flagged' } }, ALERT_TRIAGE);
    expect(answers.triage).toMatchObject({ type: 'choice', choice: 'watch', confidence: 0.7 });
    expect(answers.money_at_risk).toMatchObject({ type: 'noul', noul: 0.1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${'k'.repeat(24)}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'jev-latest', state: { alert: { kind: 'device_flagged' } } });
    expect(Object.keys(body.questions)).toEqual(['triage', 'money_at_risk']);
    expect(body.questions.triage).toMatchObject({ type: 'choice', criteria: { dismiss: expect.any(String), escalate: expect.any(String) } });
    expect(d.stats).toMatchObject({ calls: 1, failures: 0, inputTokens: 120, outputTokens: 8 });
  });

  it('retries once on a rate limit or an overloaded service, then succeeds', async () => {
    const { f, calls } = fakeFetch([json(429, { error: 'rate limited' }), json(200, ANSWER)]);
    const d = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: f });
    expect((await d.decide({}, ALERT_TRIAGE)).triage).toMatchObject({ choice: 'watch' });
    expect(calls).toHaveLength(2);
    expect(d.stats).toMatchObject({ calls: 2, failures: 1 });
  });

  it('gives up after the second failure and reports the status; a bad request is not retried', async () => {
    const twice = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: fakeFetch([json(529, {}), json(529, {})]).f });
    await expect(twice.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ name: 'DecisionError', status: 529, retryable: true });
    const bad = fakeFetch([json(422, { error: 'state too long' })]);
    const d = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: bad.f });
    await expect(d.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ status: 422, retryable: false });
    expect(bad.calls).toHaveLength(1);
    const unauthorized = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: fakeFetch([json(401, {})]).f });
    await expect(unauthorized.decide({}, ALERT_TRIAGE)).rejects.toBeInstanceOf(DecisionError);
  });

  it('refuses an answer body it does not understand or that leaves a question out; an unreachable service is retryable', async () => {
    const d = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: fakeFetch([json(200, { answers: { triage: { type: 'choice' } } })]).f });
    await expect(d.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ status: 502 });
    // Every question asked must come back answered with its type, otherwise a half-empty hint would be stored as final.
    const partial = fakeFetch([json(200, { answers: { triage: ANSWER.answers.triage } })]);
    const p = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: partial.f });
    await expect(p.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ status: 502, retryable: false, message: expect.stringContaining('money_at_risk') });
    expect(partial.calls).toHaveLength(1);
    const mistyped = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: fakeFetch([json(200, { answers: { triage: { type: 'noul', noul: 0.9 }, money_at_risk: { type: 'noul', noul: 0.1 } } })]).f });
    await expect(mistyped.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('triage') });
    const down = jevDecider({ url: 'https://x.test/s1', key: 'k'.repeat(24), model: 'jev-latest', fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    await expect(down.decide({}, ALERT_TRIAGE)).rejects.toMatchObject({ status: 0, retryable: true });
  });

  it('is off without JEV_API_KEY and on with it; production needs https', () => {
    const off = deciderFromConfig(loadConfig({}));
    expect(off).toBe(disabledDecider);
    expect(off.enabled).toBe(false);
    const on = deciderFromConfig(loadConfig({ JEV_API_KEY: 'k'.repeat(24), JEV_MODEL: 'jev-2' }));
    expect(on).toMatchObject({ enabled: true, model: 'jev-2' });
    expect(() => loadConfig({ JEV_API_KEY: 'short' })).toThrow(/JEV_API_KEY/);
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p3k9x2m8q1w7e5r4t6y0@db.example.com/pf?sslmode=verify-full', CORS_ORIGINS: 'https://a.example.com', JEV_API_KEY: 'k'.repeat(24) };
    expect(() => loadConfig({ ...prod, JEV_API_URL: 'http://api.typesafe.ai/v1/systemone' })).toThrow(/JEV_API_URL must be https/);
    expect(() => loadConfig({ ...prod, JEV_API_KEY: 'changeme-changeme-changeme' })).toThrow(/JEV_API_KEY is a known demo/);
    expect(loadConfig(prod).decisions).toMatchObject({ url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' });
  });
});

/** A scripted decider for the worker and route tests: answers from a function of the questions asked. */
function fakeDecider(answer: (state: any, questions: Record<string, Question>) => Answers | Error): Decider & { seen: any[] } {
  const seen: any[] = [];
  return {
    enabled: true, model: 'fake-jev', seen, stats: { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 },
    async decide(state, questions) { seen.push(state); const a = answer(state, questions); if (a instanceof Error) throw a; return a; },
  };
}

describe('decision hints in the worker and the console API', () => {
  let h: Harness;
  let admin: string;
  const decider = fakeDecider((state) => {
    if ('card' in state) return { accept: { type: 'noul', noul: state.match_confidence >= 0.9 ? 0.8 : state.match_confidence >= 0.6 ? 0.55 : 0.2 } };
    if ('alert' in state) return { triage: { type: 'choice', choice: state.alert.severity === 'critical' ? 'escalate' : 'watch', confidence: 0.66 }, money_at_risk: { type: 'noul', noul: 0.1 } };
    return { outcome: { type: 'choice', choice: 'void', confidence: 0.55 } };
  });
  beforeAll(async () => {
    h = await harness('decisions', {}, { decider });
    await tx(h.db, (c) => seedAdmin(c, 'dec-admin@test.dev', 'admin-pass-1'));
    admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'dec-admin@test.dev', password: 'admin-pass-1' })).body.token;
  });
  afterAll(async () => h?.close());

  it('stores one triage per open alert, once, and the alerts route carries it as a hint', async () => {
    await h.db.query(`insert into alerts (kind, severity, table_id, details) values ('device_flagged', 'warning', 'sim-1', '{"why":"clock skew"}'), ('capture_conflict', 'critical', 'sim-1', '{}')`);
    expect(await decisionsOnce(h.db, decider)).toBe(2);
    expect(await decisionsOnce(h.db, decider)).toBe(0); // nothing asked twice
    expect(decider.seen.filter((s) => 'alert' in s)).toHaveLength(2);
    expect(decider.seen.find((s) => s.alert?.kind === 'device_flagged')).toMatchObject({ alert: { severity: 'warning', details: { why: 'clock skew' }, table_id: 'sim-1' }, other_open_alerts_on_table: 1 });
    const { alerts } = (await h.api('GET', '/v1/admin/alerts', admin)).body;
    const flagged = alerts.find((a: any) => a.kind === 'device_flagged');
    expect(flagged.hint).toMatchObject({ model: 'fake-jev', answers: { triage: { choice: 'watch' }, money_at_risk: { noul: 0.1 } } });
    expect(alerts.find((a: any) => a.kind === 'capture_conflict').hint.answers.triage.choice).toBe('escalate');
    // a resolved alert is never asked about
    await h.db.query(`insert into alerts (kind, severity, resolved_at) values ('old', 'info', now())`);
    expect(await decisionsOnce(h.db, decider)).toBe(0);
  });

  it('a round in review gets an outcome hint built from its entries; the review queue shows it', async () => {
    await h.sim.heartbeat();
    await h.work();
    const hand = await h.sim.openHand();
    const rid = `sim-1:h${hand}`;
    await h.db.query(`update rounds set state = 'REVIEW', review_started_at = now(), review_reasons = '["cards_disagree"]' where id = $1`, [rid]);
    const creds = (await h.db.query<{ id: string; role: string }>(`select id, role from staff_credentials where table_id = 'sim-1' and role in ('dealer','floor_manager') order by role`)).rows;
    const dealer = creds.find((c) => c.role === 'dealer')!.id, floor = creds.find((c) => c.role === 'floor_manager')!.id;
    await h.db.query(`insert into flop_entries (round_id, source, credential_id, person_id, cards) values ($1, 'dealer', $2, 'd1', '{Ah,Kd,7c}'), ($1, 'floor', $3, 'f1', '{Ah,Kd,7s}')`, [rid, dealer, floor]);
    expect(await decisionsOnce(h.db, decider)).toBe(1);
    const asked = decider.seen.find((s) => s.round && s.entries);
    expect(asked).toMatchObject({ round: { state: 'REVIEW', review_reasons: ['cards_disagree'] }, entries: [{ source: 'dealer', cards: ['Ah', 'Kd', '7c'] }, { source: 'floor', cards: ['Ah', 'Kd', '7s'] }] });
    const q = (await h.api('GET', '/v1/admin/review-queue', admin)).body.rounds.find((r: any) => r.id === rid);
    expect(q.hint).toMatchObject({ model: 'fake-jev', answers: { outcome: { choice: 'void', confidence: 0.55 } } });
  });

  it('a refused question is remembered as an error (no hint), retried ten minutes later a bounded number of times; an outage pauses the pass', async () => {
    const refusing = fakeDecider(() => new DecisionError(422, 'state too long'));
    await h.db.query(`insert into alerts (kind, severity) values ('weird', 'info')`);
    const ref = `(select max(id)::text from alerts where kind = 'weird')`;
    expect(await decisionsOnce(h.db, refusing)).toBe(0);
    expect((await h.db.query(`select error, attempts from decision_hints where kind = 'alert' and ref = ${ref}`)).rows[0]).toMatchObject({ error: 'state too long', attempts: 1 });
    expect(await decisionsOnce(h.db, refusing)).toBe(0);
    expect(refusing.seen).toHaveLength(1); // not within ten minutes
    const alerts = (await h.api('GET', '/v1/admin/alerts', admin)).body.alerts;
    expect(alerts.find((a: any) => a.kind === 'weird').hint).toBeNull();
    // Ten minutes later it is asked again (the key or the service may have been fixed) …
    await h.db.query(`update decision_hints set created_at = now() - interval '11 minutes' where kind = 'alert' and ref = ${ref}`);
    expect(await decisionsOnce(h.db, refusing)).toBe(0);
    expect(refusing.seen).toHaveLength(2);
    expect((await h.db.query(`select attempts from decision_hints where kind = 'alert' and ref = ${ref}`)).rows[0].attempts).toBe(2);
    // … until the bound, after which it is left alone for good
    await h.db.query(`update decision_hints set attempts = $1, created_at = now() - interval '1 day' where kind = 'alert' and ref = ${ref}`, [HINT_RETRY_MAX]);
    expect(await decisionsOnce(h.db, refusing)).toBe(0);
    expect(refusing.seen).toHaveLength(2);
    // … and a fixed service answers it on the next due retry
    await h.db.query(`update decision_hints set attempts = 2 where kind = 'alert' and ref = ${ref}`);
    expect(await decisionsOnce(h.db, decider)).toBe(1);
    expect((await h.api('GET', '/v1/admin/alerts', admin)).body.alerts.find((a: any) => a.kind === 'weird').hint.answers.triage.choice).toBe('watch');
    const down = fakeDecider(() => new DecisionError(529, 'overloaded', true));
    await h.db.query(`insert into alerts (kind, severity) values ('a1', 'info'), ('a2', 'info')`);
    expect(await decisionsOnce(h.db, down)).toBe(0);
    expect(down.seen).toHaveLength(1); // stopped after the first failure, nothing stored
    expect((await h.db.query(`select count(*)::int as n from decision_hints where ref in (select id::text from alerts where kind in ('a1','a2'))`)).rows[0].n).toBe(0);
    expect(await decisionsOnce(h.db, disabledDecider)).toBe(0);
  });

  it('a slow adviser never delays the game tick: hints run on their own loop', async () => {
    await h.db.query(`insert into alerts (kind, severity) values ('slow1', 'info'), ('slow2', 'info'), ('slow3', 'info')`);
    const slow = fakeDecider(() => ({ triage: { type: 'choice', choice: 'watch' }, money_at_risk: { type: 'noul', noul: 0.1 } }));
    const slowDecider: Decider = { ...slow, decide: async (st, q) => { await new Promise((r) => setTimeout(r, 150)); return slow.decide(st, q); } };
    await h.db.query('delete from worker_heartbeats');
    const stop = startWorker(h.db, { resultSlaMs: 300_000, reviewSlaMs: 1_800_000, maxCaptureDelayMs: 180_000 }, 20, undefined, 40, slowDecider);
    try {
      await new Promise((r) => setTimeout(r, 400));
      // three sequential 150 ms answers take ~450 ms; the tick (20/40 ms) must have beaten many times meanwhile
      const ticks = (await h.db.query<{ ticks: number }>('select ticks from worker_heartbeats')).rows[0]?.ticks ?? 0;
      expect(ticks).toBeGreaterThanOrEqual(5);
      expect(slow.seen.length).toBeGreaterThanOrEqual(1);
    } finally {
      await stop();
    }
    // stop() waited for the pass in flight; hints stored so far are complete rows
    const stored = (await h.db.query(`select count(*)::int as n from decision_hints where error is null and ref in (select id::text from alerts where kind like 'slow%')`)).rows[0].n;
    expect(stored).toBeGreaterThanOrEqual(1);
    // a disabled decider never schedules the loop
    const stopOff = startWorker(h.db, { resultSlaMs: 300_000, reviewSlaMs: 1_800_000, maxCaptureDelayMs: 180_000 }, 20, undefined, 40, disabledDecider);
    await new Promise((r) => setTimeout(r, 60));
    await stopOff();
  });

  it('the reading check answers per card and says so when the adviser is off', async () => {
    const r = await h.api('POST', '/v1/admin/manual/reading-check', admin, { cards: [{ card: 'Ah', confidence: 0.91, margin: 0.3 }, { card: 'Kd', confidence: 0.47 }, { card: 'Qs', confidence: 0.7 }] });
    expect(r.status).toBe(200);
    // A near-even answer (0.55) is not accepted: the operator checks that card by eye.
    expect(r.body).toEqual({ enabled: true, model: 'fake-jev', cards: [{ card: 'Ah', accept: true, confidence: 0.8 }, { card: 'Kd', accept: false, confidence: 0.8 }, { card: 'Qs', accept: false, confidence: 0.55 }] });
    expect(decider.seen.find((s) => s.card === 'Ah')).toEqual({ card: 'Ah', match_confidence: 0.91, runner_up_margin: 0.3 });
    expect((await h.api('POST', '/v1/admin/manual/reading-check', admin, { cards: [{ card: 'Zz', confidence: 0.9 }] })).status).toBe(400);
    const player = await h.register();
    expect((await h.api('POST', '/v1/admin/manual/reading-check', player.token, { cards: [{ card: 'Ah', confidence: 0.9 }] })).status).toBe(403);
    const off = await harness('decisions_off');
    try {
      await tx(off.db, (c) => seedAdmin(c, 'off-admin@test.dev', 'admin-pass-1'));
      const t = (await off.api('POST', '/v1/auth/login', undefined, { email: 'off-admin@test.dev', password: 'admin-pass-1' })).body.token;
      expect((await off.api('POST', '/v1/admin/manual/reading-check', t, { cards: [{ card: 'Ah', confidence: 0.9 }] })).body).toEqual({ enabled: false, model: null, cards: [] });
      expect((await off.api('GET', '/v1/admin/metrics', t)).body.instance.decisions).toMatchObject({ enabled: false, model: null, calls: 0 });
    } finally {
      await off.close();
    }
    expect((await h.api('GET', '/v1/admin/metrics', admin)).body.instance.decisions).toMatchObject({ enabled: true, model: 'fake-jev' });
  });
});
