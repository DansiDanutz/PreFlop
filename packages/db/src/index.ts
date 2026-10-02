import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Directory holding the ordered SQL migrations (001_*.sql, 002_*.sql, …). */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function listMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

/**
 * Applies pending migrations, each in its own transaction, under an advisory lock so
 * concurrent starters never apply one twice. Returns the names applied.
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query('select pg_advisory_lock(7461)');
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    for (const m of listMigrations(dir)) {
      if (done.has(m.name)) continue;
      await c.query('begin');
      try {
        await c.query(m.sql);
        await c.query('insert into schema_migrations (name) values ($1)', [m.name]);
        await c.query('commit');
        applied.push(m.name);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`migration ${m.name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('select pg_advisory_unlock(7461)').catch(() => {});
    c.release();
  }
  return applied;
}
