import pg from 'pg';
import { ApiError } from './errors.ts';

// int8 / numeric come back as strings by default. Money is bigint in SQL but always within
// Number.MAX_SAFE_INTEGER by construction (the engine enforces it), so parse to number and refuse
// anything unsafe rather than silently losing precision.
pg.types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 value ${v} is outside the safe integer range`);
  return n;
});

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 20): Db {
  // Every session runs in UTC, so date casts (month windows, day totals) never depend on the server's zone.
  return new pg.Pool({ connectionString, max, options: '-c TimeZone=UTC' });
}

const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure
const BACKOFF: readonly [number, number][] = [[10, 50], [50, 200], [200, 800]];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs fn in one transaction. A deadlock or serialization failure rolls back and retries the
 * WHOLE transaction up to 3 times with jittered backoff (docs/13 §4); every write is idempotent,
 * so a retry is safe. After the last retry the caller gets 503 retry_later.
 */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await db.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      const code = (e as { code?: string }).code;
      if (code && RETRYABLE.has(code)) {
        const window = BACKOFF[attempt];
        if (window) {
          retryCount.value++;
          if (code === '40P01') retryStats.deadlocks++;
          else retryStats.serializationFailures++;
          await sleep(window[0] + Math.random() * (window[1] - window[0]));
          continue;
        }
        retryStats.exhausted++;
        throw new ApiError(503, 'retry_later', 'database contention, retry later');
      }
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Number of deadlock/serialization retries since start (exported for metrics and tests). */
export const retryCount = { value: 0 };
/** The same retries split by cause, plus transactions that gave up after the last retry (503). */
export const retryStats = { deadlocks: 0, serializationFailures: 0, exhausted: 0 };

export async function one<T extends pg.QueryResultRow>(c: Tx | Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await c.query<T>(sql, params)).rows[0];
}

export async function many<T extends pg.QueryResultRow>(c: Tx | Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query<T>(sql, params)).rows;
}
