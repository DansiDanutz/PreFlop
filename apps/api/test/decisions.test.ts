import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { ALERT_TRIAGE, type Answers, type Decider, DecisionError, type Question, deciderFromConfig, disabledDecider, jevDecider, PROSE_CHARS, recordOutcome, saveHint, SCRUB_MAX_KEYS, scrubContact, scrubDetails } from '../src/lib/decisions.ts';
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
describe('scrubContact', () => {
  it('withholds names and contact keys at every depth, lists their paths, and redacts email- and phone-shaped text wherever it sits', () => {
    const { details: scrubbed, withheld } = scrubDetails({
      city: 'Valletta', tables: 4, contact_email: 'owner@hintclub.test', phone: '+356 2122 0000',
      venue: { name: 'Hint Club', street_address: '1 Republic St', capacity: 80, manager: { email: 'm@x.test' } },
      notes: ['Call +356 2122 0000 after 6pm', 'Reach us at owner@hintclub.test or on site', 'Opened in 2019'],
      links: [{ url: 'https://hintclub.test', label: 'site' }],
      'manager_alice@example.test': 'yes', 'call +356 2122 0000': 'evenings', 'call +356 2122 0001': 'weekends', ['x'.repeat(70)]: 'a', ['x'.repeat(71)]: 'b',
    });
    expect(scrubbed).toEqual({
      city: 'Valletta', tables: 4,
      venue: { street_address: '1 Republic St', capacity: 80 },
      notes: [{ chars: 29 }, { chars: 42 }, { chars: 14 }],
      links: [{ url: 'https://hintclub.test', label: 'site' }],
      'call [phone]': 'evenings', 'call [phone] (2)': 'weekends', ['x'.repeat(64)]: 'a', ['x'.repeat(64) + ' (2)']: 'b',
    });
    // Keys are applicant text too: an email in a withheld key is redacted in the path, a phone in a kept key is redacted in the key,
    // and keys that redact or truncate to the same text stay distinct.
    expect(withheld).toEqual(['contact_email', 'phone', 'venue.name', 'venue.manager', '[email]']);
    expect(scrubContact('plain text with a year 2019 and 12 tables')).toBe('plain text with a year 2019 and 12 tables');
    expect(scrubContact('Ping me at agent@x.test or +356 2122 0000')).toBe('Ping me at [email] or [phone]');
    // Prose never travels: a free-text key, or any string longer than PROSE_CHARS, becomes its length.
    expect(scrubDetails({ message: 'Please contact Alice Smith', city: 'Alice Smith lives here and this sentence is long enough to count as prose', website: 'https://x.test' }).details)
      .toEqual({ message: { chars: 26 }, city: { chars: 73 }, website: 'https://x.test' });
    // Objects under a free-text key are scrubbed like any other object, never passed through.
    expect(scrubDetails({ notes: [{ text: 'Call Alice', email: 'a@x.test', hours: 'ring +356 2122 0000 twice', tables: 3 }, 'plain'] }))
      .toEqual({ details: { notes: [{ text: { chars: 10 }, hours: 'ring [phone] twice', tables: 3 }, { chars: 5 }] }, withheld: ['notes[0].email'] });
    // A flood of colliding keys is linear work and is cut at SCRUB_MAX_KEYS fields; the rest is counted, never sent.
    const flood = Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`${'k'.repeat(64)}${i}`, i]));
    const t0 = performance.now();
    const { details: cut, withheld: cutWithheld } = scrubDetails({ flood, city: 'Valletta' });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(PROSE_CHARS).toBe(60);
    expect(Object.keys((cut as any).flood)).toHaveLength(SCRUB_MAX_KEYS);
    expect((cut as any).flood[`${'k'.repeat(64)} (2)`]).toBe(1);
    expect(cutWithheld).toEqual([`flood.… (${8000 - SCRUB_MAX_KEYS} more fields not shown)`]);
    expect(scrubContact(null)).toBeNull();
  });
});

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
    if ('application' in state) return { decision: { type: 'choice', choice: state.organizations_with_same_contact > 0 ? 'reject' : 'approve', confidence: 0.8 }, complete: { type: 'noul', noul: 0.85 } };
    if ('promotion' in state) return { decision: { type: 'choice', choice: /guaranteed/i.test(state.promotion.body) ? 'edit' : 'approve', confidence: 0.7 }, misleading: { type: 'noul', noul: 0.75 } };
    if ('agent_application' in state) return { decision: { type: 'choice', choice: state.agent_application.note ? 'approve' : 'hold', confidence: 0.6 } };
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

  it('applications, promotions in review and agent applications get a decision hint; the admin routes carry it; contact fields never leave', async () => {
    await h.db.query(`insert into applications (id, kind, name, email, details) values ('app_hint1', 'club', 'Hint Club', 'owner@hintclub.test',
      '{"city":"Valletta","tables":4,"contact_email":"owner@hintclub.test","phone":"+356 1","venue":{"name":"Hint Club","street_address":"1 Republic St","capacity":80},"notes":["Reach us at owner@hintclub.test or +356 2122 0000"]}')`);
    // A second applicant whose contact already had an application approved (and so owns an organization).
    await h.db.query(`insert into applications (id, kind, name, email, details, status) values ('app_hint0', 'club', 'Twice Club', 'again@twice.test', '{}', 'approved')`);
    await h.db.query(`insert into organizations (id, kind, name, settings) values ('org_twice', 'club', 'Twice Club', '{"application_id":"app_hint0"}')`);
    await h.db.query(`insert into applications (id, kind, name, email, details) values ('app_hint2', 'club', 'Twice Club again', 'Again@Twice.test', '{"city":"Sliema"}')`);
    // An owner claim link that expired unredeemed never made this contact an owner; a live one counts.
    await h.db.query(`insert into organizations (id, kind, name) values ('org_expired', 'club', 'Expired Club'), ('org_live', 'club', 'Live Club')`);
    await h.db.query(`insert into org_owner_claims (token_hash, org_id, email, created_by, expires_at) values ('h_expired', 'org_expired', 'claim@hint.test', 'admin', now() - interval '1 day'), ('h_live', 'org_live', 'claim@hint.test', 'admin', now() + interval '1 day')`);
    await h.db.query(`insert into applications (id, kind, name, email, details) values ('app_hint3', 'club', 'Claim Club', 'claim@hint.test', '{"city":"Gozo"}')`);
    await h.db.query(`insert into promotions (id, owner_org, kind, title, body, link, starts_at, ends_at, status, created_by) values ('promo_hint1', null, 'announcement', 'Friday night', 'Guaranteed wins every hand!', 'https://example.test/friday', now(), now() + interval '7 days', 'pending_review', 'someone')`);
    const applicant = await h.register('Would-be agent');
    await h.db.query(`insert into agents (user_id, code, note) values ($1, 'PFHINT01', 'I run a poker club Discord with 300 members')`, [applicant.id]);
    expect(await decisionsOnce(h.db, decider)).toBeGreaterThanOrEqual(5);
    expect(await decisionsOnce(h.db, decider)).toBe(0);
    // What the model saw: the typed details with contact fields scrubbed at every depth, the promotion text,
    // link and numbers, the agent's note. Never the applicant's name, email or phone.
    const seenApps = decider.seen.filter((s) => s.application);
    const seenApp = seenApps.find((s) => s.application.details.city === 'Valletta');
    expect(seenApp.application.details).toEqual({ city: 'Valletta', tables: 4, venue: { street_address: '1 Republic St', capacity: 80 }, notes: [{ chars: 49 }] });
    expect([...seenApp.application.withheld_fields].sort()).toEqual(['contact_email', 'phone', 'venue.name']);
    expect(seenApp.organizations_with_same_contact).toBe(0);
    expect(JSON.stringify(seenApp)).not.toMatch(/hintclub|Hint Club|356/);
    // The duplicate signal comes from the approved application behind an organization, matched case-insensitively.
    expect(seenApps.find((s) => s.application.details.city === 'Sliema')).toMatchObject({ organizations_with_same_contact: 1, other_open_applications_same_contact: 0 });
    expect(seenApps.find((s) => s.application.details.city === 'Gozo')).toMatchObject({ organizations_with_same_contact: 1 });
    expect(decider.seen.find((s) => s.promotion)?.promotion).toMatchObject({ kind: 'announcement', title: 'Friday night', link: 'https://example.test/friday', runs_days: 7 });
    expect(decider.seen.find((s) => s.agent_application)?.agent_application).toMatchObject({ note: 'I run a poker club Discord with 300 members', was_active_before: false, players_registered_with_code: 0 });
    // The routes carry the hints beside the rows the team decides on.
    const app = (await h.api('GET', '/v1/admin/applications', admin)).body.applications.find((a: any) => a.id === 'app_hint1');
    expect(app.hint).toMatchObject({ model: 'fake-jev', answers: { decision: { choice: 'approve' }, complete: { noul: 0.85 } } });
    const promo = (await h.api('GET', '/v1/admin/promotions', admin)).body.promotions.find((p: any) => p.id === 'promo_hint1');
    expect(promo.hint).toMatchObject({ answers: { decision: { choice: 'edit' }, misleading: { noul: 0.75 } } });
    expect((await h.api('GET', '/v1/admin/applications', admin)).body.applications.find((a: any) => a.id === 'app_hint2').hint.answers.decision.choice).toBe('reject');
    const agent = (await h.api('GET', '/v1/admin/agents', admin)).body.agents.find((a: any) => a.user_id === applicant.id);
    expect(agent.hint).toMatchObject({ answers: { decision: { choice: 'approve', confidence: 0.6 } } });
    // A rejected agent who applies again is a new case: the old hint goes, and the next pass asks afresh about the new note.
    await h.db.query(`update agents set status = 'rejected' where user_id = $1`, [applicant.id]);
    expect((await h.api('POST', '/v1/me/agent/apply', applicant.token, {})).status).toBe(201);
    const reapplied = (await h.api('GET', '/v1/admin/agents', admin)).body.agents.find((a: any) => a.user_id === applicant.id);
    expect(reapplied.status).toBe('applied');
    expect(reapplied.hint ?? null).toBeNull();
    expect(await decisionsOnce(h.db, decider)).toBe(1);
    expect((await h.api('GET', '/v1/admin/agents', admin)).body.agents.find((a: any) => a.user_id === applicant.id).hint).toMatchObject({ answers: { decision: { choice: 'hold' } } });
  });

  it("the team's decisions are recorded beside the hints and the adviser's record reports agreement per kind", async () => {
    // Application: the hint said approve, the team approves → agreed. Promotion: the hint said edit, the team
    // rejects with a note → agreed. Agent: the hint said hold, the team activates → a disagreement.
    expect((await h.api('POST', '/v1/admin/applications/app_hint1/decision', admin, { decision: 'approved' })).status).toBe(200);
    expect((await h.api('POST', '/v1/admin/promotions/promo_hint1/decision', admin, { decision: 'reject', note: 'Nothing is guaranteed; say what the offer is.' })).status).toBe(200);
    const applicant = (await h.db.query(`select user_id from agents where code = 'PFHINT01'`)).rows[0]!.user_id as string;
    expect((await h.api('PUT', `/v1/admin/agents/${applicant}`, admin, { status: 'active' })).status).toBe(200);
    const rows = (await h.db.query(`select kind, ref, outcome, outcome_by from decision_hints where outcome is not null order by kind`)).rows;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'application', ref: 'app_hint1', outcome: 'approve' }),
      expect.objectContaining({ kind: 'promotion', ref: 'promo_hint1', outcome: 'reject' }),
      expect.objectContaining({ kind: 'agent', ref: applicant, outcome: 'approve' }),
    ]));
    const record = (await h.api('GET', '/v1/admin/decisions', admin)).body;
    const byKind = Object.fromEntries(record.kinds.map((k: any) => [k.kind, k]));
    expect(byKind.application).toMatchObject({ decided: 1, agreed: 1 });
    expect(byKind.promotion).toMatchObject({ decided: 1, agreed: 1 });
    expect(byKind.agent).toMatchObject({ decided: 1, agreed: 0 });
    expect(record.disagreements).toEqual([expect.objectContaining({ kind: 'agent', ref: applicant, suggested: 'hold', outcome: 'approve' })]);
    // A second decision on the same case never overwrites the first.
    await recordOutcome(h.db, 'agent', applicant, 'reject', 'someone');
    expect((await h.db.query(`select outcome from decision_hints where kind = 'agent' and ref = $1`, [applicant])).rows[0]!.outcome).toBe('approve');
    // The team may decide while the adviser is still being asked: the outcome waits on its own row,
    // is not counted as a hint, and the answer fills the row in when it arrives.
    await recordOutcome(h.db, 'application', 'app_early', 'approve', admin);
    let early = (await h.api('GET', '/v1/admin/decisions', admin)).body.kinds.find((k: any) => k.kind === 'application');
    expect(early).toMatchObject({ hints: byKind.application.hints, decided: byKind.application.decided });
    await saveHint(h.db, 'application', 'app_early', 'fake-jev', { decision: { type: 'choice', choice: 'approve' }, complete: { type: 'noul', noul: 0.9 } });
    early = (await h.api('GET', '/v1/admin/decisions', admin)).body.kinds.find((k: any) => k.kind === 'application');
    expect(early).toMatchObject({ hints: byKind.application.hints + 1, decided: byKind.application.decided + 1, agreed: byKind.application.agreed + 1 });
    // A question the adviser could not answer is never "decided": it is counted as failed, not as a disagreement.
    await saveHint(h.db, 'application', 'app_failed', 'fake-jev', null, 'state too long');
    await recordOutcome(h.db, 'application', 'app_failed', 'reject', admin);
    const after = (await h.api('GET', '/v1/admin/decisions', admin)).body;
    expect(after.kinds.find((k: any) => k.kind === 'application')).toMatchObject({ decided: early.decided, failed: 1 });
    expect(after.disagreements.some((d: any) => d.ref === 'app_failed')).toBe(false);
    // Suspending an applicant straight from 'applied' declines the application.
    const other = await h.register('Second applicant');
    await h.db.query(`insert into agents (user_id, code, note) values ($1, 'PFHINT02', 'note')`, [other.id]);
    await saveHint(h.db, 'agent', other.id, 'fake-jev', { decision: { type: 'choice', choice: 'approve' } });
    expect((await h.api('PUT', `/v1/admin/agents/${other.id}`, admin, { status: 'suspended' })).status).toBe(200);
    expect((await h.db.query(`select outcome from decision_hints where kind = 'agent' and ref = $1`, [other.id])).rows[0]!.outcome).toBe('reject');
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
    // confidence is the probability that pre-filling is safe; a near-even answer (0.55) is not accepted and the operator checks that card by eye.
    expect(r.body).toEqual({ enabled: true, model: 'fake-jev', cards: [{ card: 'Ah', accept: true, confidence: 0.8 }, { card: 'Kd', accept: false, confidence: 0.2 }, { card: 'Qs', accept: false, confidence: 0.55 }] });
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
