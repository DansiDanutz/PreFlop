import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Action, ApiProblem, TableApi, isAck } from '../src/lib/api.ts';
import { generateCredentialKey } from '../src/lib/envelope.ts';
import { runAction } from '../src/lib/hooks.ts';
import type { Identity } from '../src/lib/keystore.ts';
import { isRetryable } from '../src/lib/problems.ts';

let id: Identity;
beforeAll(async () => {
  const keys = await generateCredentialKey();
  id = { keys, config: { apiUrl: 'https://api.test', tableId: 't1', personId: 'Ana', role: 'floor_manager', credentialId: 'cred-1', publicKeyPem: '', fingerprint: '', createdAt: 0 } };
});
afterEach(() => { vi.unstubAllGlobals(); });

/** fetch answering each call with the next queued response, recording the Idempotency-Keys. */
function serve(...answers: (() => Response)[]) {
  const keys: string[] = [];
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)['idempotency-key']!);
    return answers.shift()!();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, keys };
}
const html = () => new Response('<!doctype html><html><body>502 Bad Gateway</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
const empty = () => new Response('', { status: 200 });
const truncated = () => new Response('{"state":"SET', { status: 200, headers: { 'content-type': 'application/json' } });
/** A body stream that breaks after the headers arrived. */
const cut = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"state"')); c.error(new Error('reset')); } }), { status: 200 });
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const BAD: [string, () => Response][] = [
  ['HTML', html], ['empty', empty], ['truncated', truncated], ['cut mid-body', cut], ['problem-shaped', ok({ type: 'oops' })], ['other action\'s ack', ok({ state: 'VOID' })],
];

describe('F17: a 2xx without the acknowledgement is not a success', () => {
  for (const [name, bad] of BAD) {
    it(`${name} body on Settle review: uncertain, retryable, onDone not called; retry keeps the key`, async () => {
      const s = serve(bad, ok({ state: 'SETTLED' }));
      const api = new TableApi(id);
      const a: Action = api.review('t1:h4', { action: 'settle', cards: ['As', 'Kd', '2c'] });
      const onDone = vi.fn();
      const first = await runAction(api, a, onDone);
      expect(first.ok).toBe(false);
      if (first.ok) return;
      expect(first.failed!.problem).toBeInstanceOf(ApiProblem);
      expect(first.failed!.problem.type).toBe('uncertain_response');
      expect(first.failed!.retryable).toBe(true);
      expect(first.failed!.action).toBe(a);
      expect(onDone).not.toHaveBeenCalled();

      // RETRY sends the same action: same Idempotency-Key and body.
      const second = await runAction(api, first.failed!.action, onDone);
      expect(second).toEqual({ ok: true, result: { state: 'SETTLED' } });
      expect(s.keys).toEqual([a.key, a.key]);
      expect(onDone).toHaveBeenCalledOnce();
    });
  }

  it('flop entry: HTML 200 does not mark the entry done', async () => {
    serve(html);
    const api = new TableApi(id);
    const remembered = vi.fn();
    const out = await runAction(api, api.flop(3, ['As', 'Kd', '2c']), remembered);
    expect(out.ok).toBe(false);
    expect(remembered).not.toHaveBeenCalled();
  });

  it('each action has its own acknowledgement', () => {
    expect(isAck('start', { shuffle_command: { nonce: 'n' } })).toBe(true);
    expect(isAck('start', { ok: true })).toBe(false);
    expect(isAck('cut', { ok: true })).toBe(true);
    expect(isAck('deal-start', { ok: true })).toBe(true);
    expect(isAck('flop', { ok: true, source: 'floor' })).toBe(true);
    expect(isAck('flop', null)).toBe(false);
    expect(isAck('void', { state: 'VOID' })).toBe(true);
    expect(isAck('review-settle', { state: 'SETTLED' })).toBe(true);
    expect(isAck('review-settle', { state: 'VOID' })).toBe(false);
    expect(isAck('review-void', { state: 'VOID' })).toBe(true);
    expect(isAck('pause', { status: 'paused' })).toBe(true);
    expect(isAck('resume', { status: 'active' })).toBe(true);
    expect(isAck('resume', 'active')).toBe(false);
    expect(isRetryable('uncertain_response')).toBe(true);
  });

  it('a real problem answer is still a refusal, not uncertain', async () => {
    serve(() => new Response(JSON.stringify({ type: 'review_expired', status: 409 }), { status: 409 }));
    const api = new TableApi(id);
    const out = await runAction(api, api.review('t1:h4', { action: 'void', reason: 'misdeal' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toMatchObject({ retryable: false, problem: { type: 'review_expired' } });
  });
});
