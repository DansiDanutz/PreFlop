import { randomBytes } from 'node:crypto';
import { migrate } from '@preflop/db';
import { hashPassword } from './auth/players.ts';
import { audit } from './lib/audit.ts';
import { createPool, tx } from './lib/db.ts';
import { acct, post } from './lib/ledger.ts';
import { buyChips, buyDiamonds } from './payments/sandbox.ts';
import { seedAdmin } from './seed.ts';

/**
 * Idempotent demo data for local development and design reviews:
 * - admin@preflop.local (PreFlop admin) is also owner of a demo club, partner and organizer;
 * - player@preflop.local is a regular player with free chips.
 * Run after the simulator has seeded its tables: `pnpm --filter @preflop/api demo`.
 */
// Demo credentials come from the environment, or are generated and printed once — never fixed in source.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
const PLAYER_PASSWORD = process.env.PLAYER_PASSWORD ?? randomBytes(12).toString('base64url');
const db = createPool(process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/preflop', 4);
await migrate(db);
await tx(db, async (c) => {
  const adminId = await seedAdmin(c, process.env.ADMIN_EMAIL ?? 'admin@preflop.local', ADMIN_PASSWORD);
  const player = 'u_demo_player';
  await c.query(`insert into users (id, email, password_hash, display_name, date_of_birth, country, email_verified_at) values ($1, 'player@preflop.local', $2, 'Demo Player', '1990-01-01', 'MT', now()) on conflict (id) do update set password_hash = excluded.password_hash`, [player, await hashPassword(PLAYER_PASSWORD)]);
  await post(c, 'play.grant', player, [{ from: acct('PreFlop', 'play-issuance', 'play', 'PLAY'), to: acct(player, 'wallet', 'play', 'PLAY'), amountMinor: 10_000 }]);
  for (const [id, kind, name] of [['atlas', 'club', 'Atlas Poker Club'], ['betco', 'partner', 'BetCo (demo partner)'], ['diamond-nights', 'organizer', 'Diamond Nights (demo organizer)']] as const) {
    await c.query(`insert into organizations (id, kind, name, settings) values ($1, $2, $3, '{"city":"Bucharest","demo":true}') on conflict (id) do nothing`, [id, kind, name]);
    await c.query(`insert into memberships (user_id, org_id, role) values ($1, $2, 'owner') on conflict do nothing`, [adminId, id]);
  }
  const has = (await c.query(`select 1 from payments where org_id = 'diamond-nights'`)).rowCount;
  if (!has) {
    await buyDiamonds(c, 'diamond-nights', 100_000, 'USDT');
    await buyChips(c, { orgId: 'diamond-nights' }, 50_000, 'EUR');
    await post(c, 'collateral.deposit', 'demo-collateral', [{ from: acct('diamond-nights', 'treasury', 'diamonds', 'DIAMOND'), to: acct('diamond-nights', 'collateral', 'diamonds', 'DIAMOND'), amountMinor: 60_000 }]);
    await c.query(`insert into rooms (id, org_id, name, table_id, mode, currency, house, rules, visibility) values
      ('room_demo_diamonds', 'diamond-nights', 'Diamond High Rollers', 'atlas-04', 'diamonds', 'DIAMOND', 'organizer', '{"margin_bps":600,"min_stake_minor":20,"rake_bps":500}', 'public'),
      ('room_demo_pool', 'diamond-nights', 'Friday Chip Pool', 'green-room', 'virtual-chips', 'CHIP', 'pool', '{"margin_bps":0,"min_stake_minor":50,"rake_bps":1000}', 'public')
      on conflict do nothing`);
    await post(c, 'transfer.player', 'demo-transfer-1', [{ from: acct('diamond-nights', 'treasury', 'diamonds', 'DIAMOND'), to: acct(player, 'wallet-diamond-nights', 'diamonds', 'DIAMOND'), amountMinor: 2_000 }]);
    await c.query(`insert into transfers (id, org_id, user_id, mode, currency, amount_minor, by_user) values ('demo-transfer-1', 'diamond-nights', $1, 'diamonds', 'DIAMOND', 2000, $2) on conflict do nothing`, [player, adminId]);
  }
  await c.query(`insert into applications (id, kind, name, email, details) values ('app_demo_1', 'club', 'Vienna Card Room', 'owner@vienna.example', '{"city":"Vienna","tables":4}') on conflict do nothing`);
  await audit(c, { type: 'demo.seeded' });
});
await db.end();
console.log(`demo data ready (passwords apply to this database only):\n  admin@preflop.local / ${ADMIN_PASSWORD}\n  player@preflop.local / ${PLAYER_PASSWORD}`);
