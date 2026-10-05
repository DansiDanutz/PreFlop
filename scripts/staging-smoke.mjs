#!/usr/bin/env node
/**
 * End-to-end smoke test against a deployed environment (docs/18 §Smoke test). Runs after every
 * staging deploy and can be run by hand: node scripts/staging-smoke.mjs
 *
 * What it proves, with real HTTP and a real WebSocket, no browser and no dependencies (Node 22+):
 *   1. the API is ready (database + worker heartbeat);
 *   2. the lobby lists a simulated table that is ready and has an open round;
 *   3. a new player can register and holds the play-money starting balance;
 *   4. the WebSocket stream authenticates the player and delivers events for that table;
 *   5. a free-play bet is accepted on the open round and settles within the budget, and the wallet
 *      moves by exactly stake and payout;
 *   6. the website, console and club tablet are served (HTML with the app root).
 *
 * Environment: API_URL, SITE_URLS (comma-separated), SMOKE_TIMEOUT_MS (per wait, default 180000).
 * Exit code 0 on success; 1 with a one-line reason per failed step otherwise.
 */
const API = (process.env.API_URL ?? 'https://preflop-staging-api.fly.dev').replace(/\/$/, '');
const SITES = (process.env.SITE_URLS ?? 'https://preflop-staging-web.vercel.app,https://preflop-staging-console.vercel.app,https://preflop-staging-table.vercel.app')
  .split(',').map((s) => s.trim()).filter(Boolean);
const WAIT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const STAKE = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[smoke ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const fail = (msg) => { console.error(`[smoke] FAIL: ${msg}`); process.exit(1); };

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
}

/** Polls `probe` until it returns a truthy value or the budget is spent. */
async function until(what, probe, everyMs = 3000, budgetMs = WAIT_MS) {
  const started = Date.now();
  for (;;) {
    const v = await probe().catch((e) => { log(`${what}: ${e.message}`); return null; });
    if (v) return v;
    if (Date.now() - started > budgetMs) fail(`${what}: not within ${budgetMs} ms`);
    await sleep(everyMs);
  }
}

// 1. readiness
const ready = await until('API readiness', async () => {
  const r = await api('GET', '/v1/health/ready');
  return r.status === 200 ? r.body : null;
}, 5000);
log(`API ready: ${JSON.stringify(ready)}`);

// 2. a live simulated play-money table with an open round
const table = await until('a ready play table with an open round', async () => {
  const r = await api('GET', '/v1/lobby');
  if (r.status !== 200) return null;
  const t = r.body.tables.find((x) => x.mode === 'play' && x.ready && x.open_round_id);
  if (!t) log(`lobby: ${r.body.tables.length} tables, none ready+open yet (${r.body.tables.map((x) => `${x.id}:${x.ready ? 'ready' : x.problems[0]}`).join(', ')})`);
  return t ?? null;
}, 5000);
log(`table ${table.id} (${table.club_name}) open round ${table.open_round_id}`);

// 3. register a fresh player
const email = `smoke-${Date.now()}@preflop-smoke.test`;
const reg = await api('POST', '/v1/auth/register', { body: { email, password: `Smoke-${Date.now()}-pass`, date_of_birth: '1990-01-01', country: 'MT', display_name: 'Smoke test' } });
if (reg.status !== 201) fail(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
const token = reg.body.token;
const me = await api('GET', '/v1/me', { token });
if (me.status !== 200) fail(`/v1/me: ${me.status}`);
const walletOf = async () => (await api('GET', '/v1/me/wallets', { token })).body.wallets.find((w) => w.mode === 'play')?.balance_minor ?? 0;
const before = await walletOf();
if (before < STAKE) fail(`play wallet ${before} below the stake ${STAKE}`);
log(`registered ${email} (${me.body.id}); play balance ${before}`);

// 4. WebSocket: auth as the player, follow the table
const events = [];
const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/stream`);
const wsReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('WebSocket handshake timed out')), 20_000);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
  ws.addEventListener('error', (e) => reject(new Error(`WebSocket error: ${e.message ?? 'unknown'}`)));
  ws.addEventListener('message', (m) => {
    const f = JSON.parse(String(m.data));
    if (f.type === 'auth') {
      if (!f.ok) return reject(new Error('WebSocket auth refused'));
      ws.send(JSON.stringify({ subscribe: ['lobby', `table:${table.id}`] }));
    } else if (f.type === 'subscribed') { clearTimeout(timer); resolve(f.topics); }
    else if (f.type !== 'hello') events.push(f);
  });
});
const topics = await wsReady.catch((e) => fail(e.message));
log(`stream subscribed: ${topics.join(', ')}`);

// 5. bet on the open round, then wait for settlement
const book = await api('GET', '/v1/book?channel=direct');
if (book.status !== 200) fail(`/v1/book: ${book.status}`);
const selection = book.body.markets.flatMap((m) => m.selections).find((s) => s.offered);
if (!selection) fail('no offered selection in the book');
const current = await api('GET', `/v1/tables/${table.id}/rounds/current`);
const roundId = current.body?.open?.id ?? table.open_round_id;
const bet = await api('POST', '/v1/bets', {
  token, headers: { 'idempotency-key': `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
  body: { round_id: roundId, selection_id: selection.id, stake_minor: STAKE, odds_centi: selection.odds_centi, accept_price_change: true },
});
if (bet.status !== 201) fail(`bet: ${bet.status} ${JSON.stringify(bet.body)}`);
log(`bet ${bet.body.bet_id ?? bet.body.id ?? ''} accepted on ${roundId}: ${selection.id} @ ${bet.body.odds_centi ?? selection.odds_centi}`);
const settled = await until('bet settlement', async () => {
  const r = await api('GET', `/v1/me/bets?round_id=${encodeURIComponent(roundId)}`, { token });
  const b = r.body?.bets?.[0];
  return b && b.status !== 'accepted' ? b : null;
});
const after = await walletOf();
const payout = Number(settled.payout_minor ?? 0);
const expected = settled.status === 'won' || settled.status === 'lost' ? before - STAKE + payout : before;
if (after !== expected) fail(`wallet after settlement is ${after}, expected ${expected} (bet ${settled.status}, payout ${payout})`);
log(`bet ${settled.status} (payout ${payout}); wallet ${before} → ${after}`);
ws.close();
if (events.length === 0) fail('no stream events received for the table while the round settled');
log(`${events.length} stream events received (${[...new Set(events.map((e) => e.type))].join(', ')})`);

// 6. the sites are served
for (const site of SITES) {
  const res = await fetch(site, { redirect: 'follow', signal: AbortSignal.timeout(20_000) }).catch((e) => ({ status: 0, text: async () => e.message, headers: new Headers() }));
  const html = await res.text();
  if (res.status !== 200 || !/<div id="root"/.test(html)) fail(`${site}: HTTP ${res.status}, app root ${/<div id="root"/.test(html) ? 'present' : 'missing'}`);
  log(`${site} serves the app`);
}
log('all checks passed');
