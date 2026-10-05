#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
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
 * Environment: API_URL, SITE_URLS (comma-separated), SMOKE_TIMEOUT_MS (per wait, default 180000),
 * SMOKE_PLAY_START (the play-money starting grant, default 10000), EXPECTED_COMMIT (when set, each site
 * must serve the build of that commit, read from its <meta name="build-commit">, see
 * deploy/build-commit.mjs) and ACCEPT_NEWER_ON (a git ref such as origin/main: a site serving a
 * descendant of EXPECTED_COMMIT reachable from that ref passes too, since a newer push may already be
 * live; git is asked on every poll, and a git failure never passes a site).
 * Exit code 0 on success; 1 with a one-line reason per failed step otherwise.
 */
const API = (process.env.API_URL ?? 'https://preflop-staging-api.fly.dev').replace(/\/$/, '');
const SITES = (process.env.SITE_URLS ?? 'https://preflop-staging-web.vercel.app,https://preflop-staging-console.vercel.app,https://preflop-staging-table.vercel.app')
  .split(',').map((s) => s.trim()).filter(Boolean);
const WAIT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180_000);
const PLAY_START = Number(process.env.SMOKE_PLAY_START ?? 10_000);
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT?.trim() || null;
const ACCEPT_NEWER_ON = process.env.ACCEPT_NEWER_ON?.trim() || null;
const STAKE = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).toString().trim();
/** Whether a site's build commit is acceptable: the deployed commit, or a later commit on ACCEPT_NEWER_ON. Git failures are "no". */
function acceptableBuild(commit) {
  if (!commit) return false;
  if (commit === EXPECTED_COMMIT) return true;
  if (!ACCEPT_NEWER_ON) return false;
  try {
    if (ACCEPT_NEWER_ON.startsWith('origin/')) {
      // Full history, so ancestry holds however far the branch advanced (a shallow checkout would cut it).
      const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
      git('fetch', '--quiet', ...(shallow ? ['--unshallow'] : []), 'origin', ACCEPT_NEWER_ON.slice('origin/'.length));
    }
    git('merge-base', '--is-ancestor', EXPECTED_COMMIT, commit);
    git('merge-base', '--is-ancestor', commit, ACCEPT_NEWER_ON);
    return true;
  } catch (e) {
    log(`git could not confirm ${commit.slice(0, 7)} as a later commit on ${ACCEPT_NEWER_ON}: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`);
    return false;
  }
}
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
const openTable = (preferId) => until('a ready play table with an open round', async () => {
  const r = await api('GET', '/v1/lobby');
  if (r.status !== 200) return null;
  const live = r.body.tables.filter((x) => x.mode === 'play' && x.ready && x.open_round_id);
  const t = live.find((x) => x.id === preferId) ?? live[0];
  if (!t) log(`lobby: ${r.body.tables.length} tables, none ready+open yet (${r.body.tables.map((x) => `${x.id}:${x.ready ? 'ready' : x.problems[0]}`).join(', ')})`);
  return t ?? null;
}, 2000);
const table = await openTable();
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
if (before !== PLAY_START) fail(`a new player holds ${before} play, expected the starting grant ${PLAY_START}`);
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

// 5. bet on the open round, then wait for settlement. Betting windows are short (20 s on the
// simulated tables): a round that closes between the lookup and the bet is not a failure, the
// next open round is tried, up to five times.
const book = await api('GET', '/v1/book?channel=direct');
if (book.status !== 200) fail(`/v1/book: ${book.status}`);
const selection = book.body.markets.flatMap((m) => m.selections).find((s) => s.offered);
if (!selection) fail('no offered selection in the book');
// Always the subscribed table: a round on another table would not reach this socket.
const openRoundOf = (tableId) => until(`an open round on ${tableId}`, async () => {
  const r = await api('GET', `/v1/tables/${tableId}/rounds/current`);
  return r.status === 200 ? r.body?.open?.id ?? null : null;
}, 2000);
let roundId = table.open_round_id;
let bet;
for (let attempt = 1; ; attempt++) {
  roundId = await openRoundOf(table.id);
  bet = await api('POST', '/v1/bets', {
    token, headers: { 'idempotency-key': `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
    body: { round_id: roundId, selection_id: selection.id, stake_minor: STAKE, odds_centi: selection.odds_centi, accept_price_change: true },
  });
  if (bet.status === 201) break;
  const transient = bet.status === 409 && ['round_locked', 'table_not_ready'].includes(bet.body?.type);
  if (!transient || attempt >= 5) fail(`bet: ${bet.status} ${JSON.stringify(bet.body)}${transient ? ` after ${attempt} attempts` : ''}`);
  log(`bet on ${roundId}: ${bet.body.type} (attempt ${attempt}); trying the next open round`);
  await sleep(2000);
}
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
// The table topic itself must have delivered, for the very round the bet was on: a player-only
// event (bet.accepted) or an unrelated round on that table is not enough. The socket may sit on
// another API machine than the one that settled the round; the relay between them takes a moment.
const roundEvents = () => events.filter((e) => e.table_id === table.id && e.round_id === roundId && String(e.type).startsWith('round.'));
for (let waited = 0; roundEvents().length === 0 && waited < 10_000; waited += 250) await sleep(250);
ws.close();
const tableEvents = roundEvents();
if (tableEvents.length === 0) fail(`no round.* events received on table:${table.id} for ${roundId} while it settled (${events.length} other events)`);
log(`${events.length} stream events received, ${tableEvents.length} for the table (${[...new Set(events.map((e) => e.type))].join(', ')})`);

// 6. the sites are served, and (when EXPECTED_COMMIT is set) by the build of that commit or of a
// later one on ACCEPT_NEWER_ON: Vercel deploys them separately, so an older build may still be
// live while the new one builds, or a newer push may already have replaced it.
const fetchSite = async (site) => {
  const res = await fetch(site, { redirect: 'follow', signal: AbortSignal.timeout(20_000) }).catch((e) => ({ status: 0, text: async () => e.message }));
  const html = await res.text();
  return { status: res.status, root: /<div id="root"/.test(html), commit: /<meta name="build-commit" content="([^"]*)"/.exec(html)?.[1] ?? null };
};
for (const site of SITES) {
  const wanted = EXPECTED_COMMIT ? `${EXPECTED_COMMIT.slice(0, 7)}${ACCEPT_NEWER_ON ? ` or later on ${ACCEPT_NEWER_ON}` : ''}` : null;
  const page = await until(`${site} serving ${wanted ? `a build of ${wanted}` : 'the app'}`, async () => {
    const p = await fetchSite(site);
    if (p.status !== 200 || !p.root) { log(`${site}: HTTP ${p.status}, app root ${p.root ? 'present' : 'missing'}`); return null; }
    if (EXPECTED_COMMIT && !acceptableBuild(p.commit)) { log(`${site}: serving build ${p.commit ?? 'unknown'}, waiting for ${wanted}`); return null; }
    return p;
  }, 10_000);
  log(`${site} serves the app${page.commit ? ` (build ${page.commit.slice(0, 7)})` : ''}`);
}
log('all checks passed');
