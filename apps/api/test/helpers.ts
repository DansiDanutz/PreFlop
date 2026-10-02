import { migrate } from '@preflop/db';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { type Db, createPool, tx } from '../src/lib/db.ts';
import { seedSimTable, upsertClub } from '../src/seed.ts';
import { SimTable, type Send, keysToFile } from '../src/sim/tableSim.ts';
import { runOutboxOnce, sweepOnce } from '../src/worker.ts';

export const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';
/** Prefix of the per-file test databases; set TEST_DB_PREFIX to run several checkouts against one server. */
export const testDbName = (name: string) => `${process.env.TEST_DB_PREFIX ?? 'preflop_test'}_${name}`;

/** Database name of a test file. TEST_DB_PREFIX keeps parallel runs (several checkouts, one server) apart. */
export const testDbName = (name: string) => `${process.env.TEST_DB_PREFIX ?? 'preflop_test'}_${name}`;

/** A fresh, migrated database per test file. */
export async function freshDb(name: string): Promise<Db> {
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  const db = testDbName(name);
  await admin.query(`drop database if exists ${db} with (force)`);
  await admin.query(`create database ${db}`);
  await admin.end();
  const u = new URL(BASE_URL);
  u.pathname = `/${db}`;
  const pool = createPool(u.toString(), 30);
  await migrate(pool);
  return pool;
}

export interface Harness {
  db: Db;
  app: FastifyInstance;
  config: Config;
  send: Send;
  sim: SimTable;
  work: () => Promise<void>;
  register: (name?: string) => Promise<{ token: string; id: string }>;
  api: (method: string, url: string, token?: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

let userN = 0;

export async function harness(name: string, overrides: Partial<Config> = {}): Promise<Harness> {
  const db = await freshDb(name);
  const base = loadConfig({});
  // Rate limits are off unless a test opts in: the suites register and bet far faster than a person.
  const config: Config = { ...base, runWorker: false, rateLimit: { ...base.rateLimit, enabled: false }, ...overrides };
  const app = await buildApp(db, config);
  const send: Send = async (r) => {
    const res = await app.inject({ method: r.method as 'GET', url: r.url, headers: r.headers, ...(r.body !== undefined ? { payload: r.body } : {}) });
    return { status: res.statusCode, json: () => (res.body ? JSON.parse(res.body) : null) };
  };
  const keys = await tx(db, async (c) => {
    await upsertClub(c, 'club-sim', 'Simulation Club', { city: 'Online' });
    return seedSimTable(c, { clubId: 'club-sim', tableId: 'sim-1', name: 'The Green Room' });
  });
  const sim = new SimTable(send, keysToFile(keys));
  const timing = { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs };
  const api: Harness['api'] = async (method, url, token, body, headers = {}) => {
    const res = await app.inject({
      method: method as 'GET', url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    db, app, config, send, sim, api,
    work: async () => {
      await runOutboxOnce(db, timing);
      await sweepOnce(db, timing);
    },
    register: async (dn = 'Player') => {
      const r = await api('POST', '/v1/auth/register', undefined, { email: `p${++userN}-${Date.now()}@test.dev`, password: 'correct horse', display_name: dn });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      return { token: r.body.token, id: r.body.user.id };
    },
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

let betN = 0;
export async function bet(h: Harness, token: string, roundId: string, selectionId: string, stake: number, extra: Record<string, unknown> = {}) {
  const book = (await h.api('GET', '/v1/book')).body;
  const sel = book.markets.flatMap((m: any) => m.selections).find((s: any) => s.id === selectionId);
  return h.api('POST', '/v1/bets', token, { round_id: roundId, selection_id: selectionId, stake_minor: stake, odds_centi: sel.odds_centi, ...extra }, { 'idempotency-key': `k-${++betN}-${Date.now()}` });
}

export async function walletOf(h: Harness, token: string, mode = 'play'): Promise<number> {
  const w = (await h.api('GET', '/v1/me/wallets', token)).body.wallets.find((x: any) => x.mode === mode);
  return w?.balance_minor ?? 0;
}

export async function ledgerSums(db: Db): Promise<{ currency: string; total: number }[]> {
  return (await db.query<{ currency: string; total: number }>('select currency, sum(amount_minor)::bigint as total from ledger_entries group by currency')).rows;
}

/** Creates an organization as the PreFlop team; the owner takes it over with the single-use claim link. */
export async function ownedOrg(h: Harness, adminToken: string, body: { kind: 'club' | 'partner' | 'organizer'; name: string; settings?: Record<string, unknown> },
  owner: { token: string; email: string }): Promise<string> {
  const r = await h.api('POST', '/v1/admin/orgs', adminToken, { ...body, owner_email: owner.email });
  if (r.status !== 201) throw new Error(`org create failed: ${r.status} ${JSON.stringify(r.body)}`);
  const c = await h.api('POST', '/v1/me/org-claims', owner.token, { token: r.body.owner_claim.token });
  if (c.status !== 200) throw new Error(`claim failed: ${c.status} ${JSON.stringify(c.body)}`);
  return r.body.id as string;
}

