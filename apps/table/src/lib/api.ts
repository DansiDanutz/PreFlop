import { authHeader, newIdempotencyKey } from './envelope.ts';
import type { Identity } from './keystore.ts';
import { problemMessage } from './problems.ts';
import { normalizeState } from './state.ts';
import type { Evidence, TableState, WhoAmI } from './types.ts';

export const DEFAULT_API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiProblem extends Error {
  constructor(readonly status: number, readonly type: string, readonly title?: string, readonly body?: unknown) {
    super(problemMessage(type, title));
  }
}

/**
 * One user action (a write). Its Idempotency-Key is fixed when the action is created and reused
 * verbatim on every retry; each send gets a new nonce and timestamp. The body string is created
 * once and sent byte-for-byte as hashed.
 */
export interface Action {
  key: string;
  method: 'POST' | 'PUT';
  path: string;
  body: string;
  label: string;
}

export const makeAction = (method: Action['method'], path: string, body: unknown, label: string): Action =>
  ({ key: newIdempotencyKey(), method, path, body: JSON.stringify(body ?? {}), label });

const TIMEOUT_MS = 10_000;

export class TableApi {
  /** serverTime − localTime, estimated from /v1/health; applied to signed timestamps. */
  clockOffsetMs = 0;

  constructor(readonly id: Identity) {}

  get base() {
    return this.id.config.apiUrl.replace(/\/+$/, '');
  }

  get t() {
    return encodeURIComponent(this.id.config.tableId);
  }

  /** Measures the tablet clock against the server's (unsigned health endpoint). */
  async syncClock(): Promise<number> {
    const t0 = Date.now();
    const res = await fetch(`${this.base}/v1/health`, { cache: 'no-store' });
    const t1 = Date.now();
    const body = (await res.json()) as { time?: string };
    if (body.time) this.clockOffsetMs = Date.parse(body.time) - Math.round((t0 + t1) / 2);
    return this.clockOffsetMs;
  }

  /** Signed request. Throws ApiProblem (type `network` / `timeout` when there was no answer). */
  async request<T>(method: string, path: string, o: { body?: string; idempotencyKey?: string } = {}): Promise<T> {
    const cred = this.id.config.credentialId;
    if (!cred) throw new ApiProblem(0, 'unknown_credential', 'tablet not enrolled');
    const url = new URL(this.base + path);
    const ts = Date.now() + (Math.abs(this.clockOffsetMs) > 1000 ? this.clockOffsetMs : 0);
    const { header } = await authHeader(cred, this.id.keys.privateKey, {
      method, url: url.pathname + url.search, idempotencyKey: o.idempotencyKey, ...(o.body !== undefined ? { body: o.body } : {}), ts,
    });
    const headers: Record<string, string> = { 'x-preflop-auth': header };
    if (o.idempotencyKey) headers['idempotency-key'] = o.idempotencyKey;
    if (o.body !== undefined) headers['content-type'] = 'application/json';

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { method, headers, ...(o.body !== undefined ? { body: o.body } : {}), signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
    } catch (e) {
      throw new ApiProblem(0, (e as Error).name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok || (json && typeof json === 'object' && 'type' in json && res.status >= 400)) {
      const p = (json ?? {}) as { type?: string; title?: string };
      throw new ApiProblem(res.status, p.type ?? (res.status === 404 ? 'not_found' : `http_${res.status}`), p.title, json);
    }
    // A write can answer 200/409 with a problem-shaped body stored by the idempotency layer.
    return json as T;
  }

  send<T = unknown>(a: Action): Promise<T> {
    return this.request<T>(a.method, a.path, { body: a.body, idempotencyKey: a.key });
  }

  async state(): Promise<TableState> {
    return normalizeState(await this.request<unknown>('GET', `/v1/provider/tables/${this.t}/state`), this.id.config.personId);
  }

  /** Who the server says this credential is (role, person, table). */
  whoami() {
    return this.request<WhoAmI>('GET', '/v1/provider/whoami');
  }

  evidence(roundId: string) {
    return this.request<Evidence>('GET', `/v1/provider/rounds/${encodeURIComponent(roundId)}/evidence`);
  }

  // ---- action builders (each call = a new action with a new Idempotency-Key)
  hand(n: number, verb: 'start' | 'cut' | 'deal-start', label: string) {
    return makeAction('POST', `/v1/provider/tables/${this.t}/hands/${n}/${verb}`, {}, label);
  }
  flop(n: number, cards: string[]) {
    return makeAction('POST', `/v1/provider/tables/${this.t}/hands/${n}/flop`, { cards }, `Submit flop for hand ${n}`);
  }
  voidHand(n: number, reason: string) {
    return makeAction('POST', `/v1/provider/tables/${this.t}/hands/${n}/void`, { reason }, `Void hand ${n}`);
  }
  review(roundId: string, decision: { action: 'settle'; cards: string[] } | { action: 'void'; reason: string }) {
    return makeAction('POST', `/v1/provider/rounds/${encodeURIComponent(roundId)}/review`, decision, decision.action === 'settle' ? 'Settle review' : 'Void review');
  }
  pause(reason: string) {
    return makeAction('POST', `/v1/provider/tables/${this.t}/pause`, { reason }, 'Pause table');
  }
  resume() {
    return makeAction('POST', `/v1/provider/tables/${this.t}/resume`, {}, 'Resume table');
  }
}
