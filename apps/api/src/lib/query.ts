import { z } from 'zod';

const Limit = z.object({ limit: z.coerce.number().int().min(1).optional() });

/**
 * `?limit=` of a list route: a whole number ≥ 1, `dflt` when absent, capped at `max` (larger values
 * are served as `max`, as before). Anything else (`abc`, `1.5`, `0`, empty) is 400 bad_request,
 * never NaN in SQL.
 */
export function limitParam(query: unknown, max: number, dflt: number): number {
  const { limit } = Limit.parse(query ?? {});
  return Math.min(max, limit ?? dflt);
}
