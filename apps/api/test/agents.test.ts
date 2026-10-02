import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../src/lib/audit.ts';
import { tx } from '../src/lib/db.ts';
import { balance } from '../src/lib/ledger.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness, ledgerSums } from './helpers.ts';

/** Agents: two levels on net gaming revenue, real-money modes only (docs/16 §4). */
let h: Harness;
let admin: string;
let roundId: string;
beforeAll(async () => {
  h = await harness('agents');
  await tx(h.db, (c) => seedAdmin(c, 'agents-admin@test.dev', 'admin-pass-1'));
  admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'agents-admin@test.dev', password: 'admin-pass-1' })).body.token;
  await h.sim.heartbeat();
  await h.work();
  const n = await h.sim.openHand();
  roundId = `sim-1:h${n}`;
});
afterAll(async () => h?.close());

let un = 0;
async function user(name: string, ref?: string) {
  const r = await h.api('POST', '/v1/auth/register', undefined, { email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++un}@test.dev`, password: 'correct horse', display_name: name, ...(ref ? { ref } : {}) });
  return { token: r.body.token as string, id: r.body.user.id as string };
}

/** A settled bet in a given month, as settlement would leave it. */
let bn = 0;
async function settled(userId: string, mode: string, currency: string, stake: number, payout: number, at: string) {
  await h.db.query(
    `insert into bets (id, idempotency_key, user_id, round_id, selection_id, stake_minor, odds_centi, mode, currency, status, payout_minor, settled_at)
     values ($1, $1, $2, $3, 'colour:all-red', $4, 200, $5, $6, $7, $8, $9)`,
    [`agt-bet-${++bn}`, userId, roundId, stake, mode, currency, payout > 0 ? 'won' : 'lost', payout, at]);
}

async function activate(id: string, body: Record<string, unknown> = {}) {
  return h.api('PUT', `/v1/admin/agents/${id}`, admin, { status: 'active', ...body });
}

describe('agents', () => {
  let A: { token: string; id: string }, B: { token: string; id: string }, codeA = '', codeB = '';
  let p1: { id: string }, p2: { id: string };

  it('players bind to an active agent’s code at registration; unknown or inactive codes are ignored', async () => {
    A = await user('Agent A');
    B = await user('Agent B');
    codeA = (await h.api('POST', '/v1/me/agent/apply', A.token, { note: 'Poker club regular' })).body.code;
    codeB = (await h.api('POST', '/v1/me/agent/apply', B.token, {})).body.code;
    expect((await h.api('POST', '/v1/me/agent/apply', A.token, {})).body.type).toBe('already_applied');
    // Not yet active: the code does nothing.
    const early = await user('Early', codeA);
    expect((await h.db.query('select referred_by_agent from users where id = $1', [early.id])).rows[0].referred_by_agent).toBeNull();
    expect((await activate(A.id, { rate_l1_bps: 2500, rate_l2_bps: 500 })).status).toBe(200);
    expect((await activate(B.id, { parent_agent_id: A.id, rate_l1_bps: 2500 })).status).toBe(200);
    p1 = await user('Player 1', codeA.toLowerCase());
    p2 = await user('Player 2', codeB);
    await user('Nobody', 'PFNOPE99');
    const refs = (await h.db.query('select id, referred_by_agent from users where id = any($1)', [[p1.id, p2.id]])).rows;
    expect(Object.fromEntries(refs.map((r: any) => [r.id, r.referred_by_agent]))).toEqual({ [p1.id]: A.id, [p2.id]: B.id });
    expect((await h.api('GET', '/v1/me', A.token)).body.agent).toMatchObject({ status: 'active', code: codeA });
    const mine = (await h.api('GET', '/v1/me/agent', A.token)).body;
    expect(mine).toMatchObject({ players: 1 });
    expect(mine.sub_agents).toEqual([expect.objectContaining({ user_id: B.id, players: 1 })]);
  });

  it('caps depth at two levels and rates at their maxima', async () => {
    const C = await user('Agent C');
    await h.api('POST', '/v1/me/agent/apply', C.token, {});
    expect((await activate(C.id, { parent_agent_id: B.id })).body.type).toBe('depth_limit');
    expect((await activate(A.id, { parent_agent_id: C.id })).body.type).toBe('invalid_parent');
    expect((await activate(C.id, { rate_l1_bps: 4001 })).body.type).toBe('rate_cap');
    expect((await activate(C.id, { rate_l2_bps: 1001 })).body.type).toBe('rate_cap');
    expect((await h.api('PUT', `/v1/admin/agents/${C.id}`, A.token, { status: 'active' })).status).toBe(403);
  });

  it('pays level 1 on own players’ NGR and level 2 on sub-agents’ players, real money only, with a negative carry', async () => {
    // September: p1 net +7,000 for the house in EUR; p2 net +4,000. Play money is ignored entirely.
    await settled(p1.id, 'real-fiat', 'EUR', 10_000, 0, '2026-09-10');
    await settled(p1.id, 'real-fiat', 'EUR', 2_000, 5_000, '2026-09-12');
    await settled(p2.id, 'real-fiat', 'EUR', 4_000, 0, '2026-09-20');
    await settled(p1.id, 'play', 'PLAY', 50_000, 0, '2026-09-20');
    const close = await h.api('POST', '/v1/admin/agents/statements/close?month=2026-09', admin);
    expect(close.body.created).toBe(3);
    expect((await h.api('POST', '/v1/admin/agents/statements/close?month=2026-09', admin)).body.created).toBe(0);
    const sept = (await h.api('GET', '/v1/admin/agents', admin)).body.statements.filter((s: any) => s.month === '2026-09');
    const pick = (agent: string, level: number) => sept.find((s: any) => s.agent_id === agent && s.level === level);
    expect(pick(A.id, 1)).toMatchObject({ currency: 'EUR', ngr_minor: 7_000, amount_minor: 1_750 });
    expect(pick(A.id, 2)).toMatchObject({ ngr_minor: 4_000, amount_minor: 200 });
    expect(pick(B.id, 1)).toMatchObject({ ngr_minor: 4_000, amount_minor: 1_000 });
    expect(sept.some((s: any) => s.currency === 'PLAY')).toBe(false);

    // October: p1 wins big (house −8,000), so A earns nothing and carries −8,000.
    await settled(p1.id, 'real-fiat', 'EUR', 1_000, 9_000, '2026-10-05');
    await h.api('POST', '/v1/admin/agents/statements/close?month=2026-10', admin);
    // November: p1 loses 5,000; after the carry A is still at −3,000.
    await settled(p1.id, 'real-fiat', 'EUR', 5_000, 0, '2026-11-05');
    await h.api('POST', '/v1/admin/agents/statements/close?month=2026-11', admin);
    const all = (await h.api('GET', '/v1/admin/agents', admin)).body.statements;
    const l1 = (m: string) => all.find((s: any) => s.agent_id === A.id && s.level === 1 && s.month === m);
    expect(l1('2026-10')).toMatchObject({ ngr_minor: -8_000, amount_minor: 0, carry_out_minor: -8_000 });
    expect(l1('2026-11')).toMatchObject({ ngr_minor: 5_000, carry_in_minor: -8_000, amount_minor: 0, carry_out_minor: -3_000 });
  });

  it('pays approved statements only when real money is on, into the agent’s wallet', async () => {
    const st = (await h.api('GET', '/v1/admin/agents', admin)).body.statements.find((s: any) => s.agent_id === A.id && s.level === 1 && s.month === '2026-09');
    expect((await h.api('POST', `/v1/admin/agents/statements/${st.id}/pay`, admin)).body.type).toBe('not_approved');
    expect((await h.api('POST', `/v1/admin/agents/statements/${st.id}/approve`, admin)).status).toBe(200);
    expect((await h.api('POST', `/v1/admin/agents/statements/${st.id}/pay`, admin)).body.type).toBe('mode_disabled');
    await h.api('PUT', '/v1/admin/settings/modes_enabled', admin, { value: { play: true, 'virtual-chips': true, diamonds: true, 'real-fiat': true, 'real-crypto': false } });
    expect((await h.api('POST', `/v1/admin/agents/statements/${st.id}/pay`, admin)).status).toBe(200);
    expect(await balance(h.db as never, `${A.id}:wallet:real-fiat:EUR`)).toBe(1_750);
    expect((await h.api('POST', `/v1/admin/agents/statements/${st.id}/pay`, admin)).body.type).toBe('not_approved');
    const mine = (await h.api('GET', '/v1/me/agent', A.token)).body.statements;
    expect(mine.find((s: any) => s.id === st.id).status).toBe('paid');
    for (const s of await ledgerSums(h.db)) expect(Number(s.total)).toBe(0);
    expect((await verifyAuditChain(h.db)).ok).toBe(true);
  });
});
