import type { FastifyRequest } from 'fastify';
import { tooManyRequests } from './errors.ts';

/**
 * A small in-process fixed-window rate limiter (no external store; @fastify/rate-limit is not
 * vendored). Counters live in this process only, so with N API instances behind a load balancer
 * a client gets at most N × limit per window. The limits that must hold across instances — the
 * login lockout — are kept in Postgres instead (lib/loginLockout.ts).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;

  constructor(
    readonly name: string,
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit for key; throws 429 rate_limited (with Retry-After) once the limit is passed. */
  consume(key: string): void {
    const t = this.now();
    if (++this.calls % 1000 === 0) this.sweep(t);
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    if (e.count > this.limit) throw tooManyRequests('rate_limited', `too many requests (${this.name}); retry later`, e.resetAt - t);
  }

  private sweep(t: number): void {
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
  }
}

/** A limiter that never refuses (RATE_LIMIT_ENABLED=false, used by tests and the soak). */
export const unlimited = (name: string): Pick<RateLimiter, 'consume' | 'name'> => ({ name, consume: () => {} });

export type Limiter = Pick<RateLimiter, 'consume' | 'name'>;

/** A Fastify preHandler that limits by client IP (req.ip honours TRUST_PROXY). */
export const perIp = (l: Limiter) => async (req: FastifyRequest) => l.consume(`ip:${req.ip}`);
