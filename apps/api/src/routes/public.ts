import { type Channel, FAMILY_NAMES, FIXED_ODDS_CHANNELS, buildBook } from '@preflop/odds-engine';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.ts';
import { notFound } from '../lib/errors.ts';
import { type TableRow, tableReadiness } from '../rounds/readiness.ts';

const BOOK = buildBook();

/** Compact, client-friendly book for one channel: every selection's exact probability and odds. */
export function bookFor(channel: Channel) {
  return {
    channel,
    flop_count: BOOK.flopCount,
    families: FAMILY_NAMES,
    markets: BOOK.markets.map((m) => ({
      id: m.id, family: m.family, name: m.name, description: m.description, first_release: m.firstRelease, exhaustive: m.exhaustive,
      selections: m.selections.map((s) => {
        const p = s.prices[channel]!;
        return { id: s.id, label: s.label, probability: s.probability, wins: s.wins, offered: p.offered, odds_centi: p.oddsCenti, ...(p.offered ? {} : { reason: p.reason }) };
      }),
    })),
  };
}

const BOOKS = Object.fromEntries(FIXED_ODDS_CHANNELS.map((ch) => [ch, bookFor(ch)]));

export async function tableSummaries(ctx: AppContext, where = 'true', params: unknown[] = []) {
  const tables = (await ctx.db.query<TableRow & { club_name: string; city: string | null }>(
    `select t.*, c.name as club_name, o.settings->>'city' as city
       from poker_tables t join clubs c on c.id = t.club_id left join organizations o on o.id = c.id
      where t.status <> 'retired' and ${where} order by c.name, t.name`, params)).rows;
  const out = [];
  for (const t of tables) {
    const rounds = (await ctx.db.query<{ id: string; hand_no: number; state: string; flop: string[] | null; procedure_step: string }>(
      'select id, hand_no, state, flop, procedure_step from rounds where table_id = $1 order by hand_no desc limit 6', [t.id])).rows;
    const open = rounds.find((r) => r.state === 'OPEN');
    const lastFlop = rounds.find((r) => r.state === 'SETTLED');
    const ready = await tableReadiness(ctx.db, t);
    out.push({
      id: t.id, name: t.name, club_id: t.club_id, club_name: t.club_name, city: t.city, kind: t.kind, mode: t.mode, currency: t.currency,
      status: t.status, ready: ready.ok, problems: ready.problems,
      stream_live: !!t.link?.streamLive,
      current_round: rounds[0] ? { id: rounds[0].id, hand_no: rounds[0].hand_no, state: rounds[0].state, step: rounds[0].procedure_step } : null,
      open_round_id: open?.id ?? null,
      last_flop: lastFlop ? { round_id: lastFlop.id, hand_no: lastFlop.hand_no, cards: lastFlop.flop } : null,
    });
  }
  return out;
}

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.get('/v1/book', async (req) => {
    const ch = ((req.query as { channel?: string }).channel ?? 'direct') as Channel;
    return BOOKS[ch] ?? BOOKS.direct;
  });

  app.get('/v1/modes', async () => {
    const v = (await ctx.db.query<{ value: Record<string, boolean> }>("select value from settings where key = 'modes_enabled'")).rows[0]?.value ?? {};
    const physical = (await ctx.db.query<{ value: boolean }>("select value from settings where key = 'physical_play_enabled'")).rows[0]?.value === true;
    return { modes: v, physical_play_enabled: physical };
  });

  app.get('/v1/lobby', async () => {
    const tables = await tableSummaries(ctx);
    const clubs = (await ctx.db.query<{ id: string; name: string; city: string | null; status: string | null }>(
      `select c.id, c.name, o.settings->>'city' as city, o.status from clubs c left join organizations o on o.id = c.id order by c.name`)).rows;
    return { clubs: clubs.map((c) => ({ ...c, tables: tables.filter((t) => t.club_id === c.id).length })), tables };
  });

  app.get('/v1/clubs/:id', async (req) => {
    const { id } = req.params as { id: string };
    const club = (await ctx.db.query(`select c.id, c.name, o.settings->>'city' as city, o.settings->>'country' as country from clubs c left join organizations o on o.id = c.id where c.id = $1`, [id])).rows[0];
    if (!club) throw notFound('club');
    return { ...club, tables: await tableSummaries(ctx, 't.club_id = $1', [id]) };
  });

  app.get('/v1/tables/:t', async (req) => {
    const { t } = req.params as { t: string };
    const [table] = await tableSummaries(ctx, 't.id = $1', [t]);
    if (!table) throw notFound('table');
    const history = (await ctx.db.query(
      `select id, hand_no, state, flop, settled_at, voided_at, void_reason from rounds where table_id = $1 and state in ('SETTLED','VOID') order by hand_no desc limit 20`, [t])).rows;
    return { ...table, history };
  });

  app.get('/v1/tables/:t/rounds/current', async (req) => {
    const { t } = req.params as { t: string };
    const r = (await ctx.db.query(
      `select id, table_id, hand_no, state, procedure_step as step, mode, currency, channel, opened_at, locked_at, flop
         from rounds where table_id = $1 order by hand_no desc limit 1`, [t])).rows[0];
    if (!r) throw notFound('round');
    const open = (await ctx.db.query(`select id, hand_no, opened_at from rounds where table_id = $1 and state = 'OPEN'`, [t])).rows[0] ?? null;
    return { latest: r, open };
  });

  app.get('/v1/rounds/:id', async (req) => {
    const { id } = req.params as { id: string };
    const r = (await ctx.db.query(
      `select id, table_id, hand_no, state, procedure_step as step, mode, currency, opened_at, locked_at, settled_at, voided_at, void_reason, flop
         from rounds where id = $1`, [id])).rows[0];
    if (!r) throw notFound('round');
    return r;
  });
}
