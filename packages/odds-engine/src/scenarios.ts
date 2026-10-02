import { DEFAULT_COST_MODEL } from './costModel.ts';
import { GLOBAL_RULES } from './globalRules.ts';
import { MODES } from './modes.ts';
import { type Scenario, type ScenarioResult, evaluate } from './profitability.ts';
import { CLUB_POLICY, PARTNER_POLICY, POOL_CREATOR_POLICY, PROVIDER_POLICY, computeShare, tierBps } from './sharing.ts';

/**
 * PLACEHOLDER SCENARIOS — activity levels are planning assumptions. A table
 * deals ~30 hands per hour; "participation" is the share of players who bet on
 * any one flop.
 */

const flops = (tables: number, hoursPerDay: number) => tables * 30 * hoursPerDay * 30;

const club = (id: string, title: string, players: number, tables: number): Scenario => ({
  id, title, kind: 'preflop-house', mode: 'real-fiat', channel: 'club', costs: DEFAULT_COST_MODEL.channels.club,
  story: `A poker club brings ${players} of its own players to PreFlop and streams ${tables} table(s). PreFlop is the house and pays all winnings; the club earns a dynamic share of GGR for content (hands dealt) and distribution (players brought).`,
  activity: { players, flopsPerMonth: flops(tables, 10), participation: 0.05, betsPerFlop: 1.2, avgStake: 4 },
  parties: [{ party: 'Club', role: 'Provider + distributor', policy: CLUB_POLICY, metrics: { handsDealt: flops(tables, 10), activePlayers: players } }],
});

const bigPartnerActivity = { players: 50_000, flopsPerMonth: flops(10, 16), participation: 0.0015, betsPerFlop: 1.2, avgStake: 6 };
const bigPartnerTurnoverCents = Math.round(50_000 * 0.0015 * 1.2 * flops(10, 16) * 6 * 100);

const creatorBps = Math.round(computeShare(POOL_CREATOR_POLICY, { poolsCreated: 600 }).bps);
const providerPoolBps = 1500;

export const SCENARIOS: readonly Scenario[] = [
  club('club-100', 'Club with 100 players, 2 tables — PreFlop is the house (EUR)', 100, 2),
  club('club-1000', 'Same club grown to 1,000 players, 4 tables — higher tiers apply', 1000, 4),
  {
    id: 'partner-preflop-house', title: 'Betting company with 50,000 players — PreFlop is the house (EUR)', kind: 'preflop-house',
    mode: 'real-fiat', channel: 'partner', costs: DEFAULT_COST_MODEL.channels.partner,
    story: 'A large betting company embeds PreFlop. Its traffic bets on 10 provider-club tables. PreFlop is the house; the partner\'s share rises progressively with the turnover it generates; each provider club earns a content share by hands dealt.',
    activity: bigPartnerActivity,
    parties: [
      { party: 'Betting company', role: 'Distributor (turnover tiers)', policy: PARTNER_POLICY, metrics: { turnoverMinor: bigPartnerTurnoverCents } },
      { party: 'Provider clubs (10)', role: 'Flop providers (content tiers)', policy: PROVIDER_POLICY, metrics: { handsDealt: flops(1, 16) } },
    ],
  },
  {
    id: 'partner-pools', title: 'Same betting company creates prize pools inside the app (EUR, no house)', kind: 'pool',
    mode: 'real-fiat', rakeBps: 1000, unitsPerEuro: 1, poolsCreated: 600,
    story: 'The betting company runs 600 prize pools a month on PreFlop flops. Players play against each other; nobody is the house. The rake is split between PreFlop, the pool creator (share grows with pools created) and the provider club.',
    activity: { players: 20_000, flopsPerMonth: flops(10, 16), participation: 0.0005, betsPerFlop: 1, avgStake: 10 },
    roles: [
      { role: 'Pool creator (pools-created tiers)', party: 'Betting company', bps: creatorBps },
      { role: 'Flop provider', party: 'Provider clubs', bps: providerPoolBps },
      { role: 'Platform', party: 'PreFlop', bps: 10000 - creatorBps - providerPoolBps },
    ],
  },
  {
    id: 'partner-organizer-house', title: 'Same betting company as the house (EUR) — PreFlop takes a platform fee', kind: 'organizer-house',
    mode: 'real-fiat', organizer: 'Betting company', provider: 'Provider clubs (10)',
    marginBps: 600, platformFee: GLOBAL_RULES.platformFee, providerShareBps: 1000, minStakeMinor: 100, organizerCostRate: 0.012,
    story: 'The betting company holds the licence and the bankroll: it is the house and pays the winnings from collateral locked on PreFlop. PreFlop earns a risk-free platform fee per bet; the company pays the provider clubs a share of its GGR.',
    activity: bigPartnerActivity,
  },
  {
    id: 'diamond-organizer', title: 'Diamond organizer — community of 300 players, organizer is the house', kind: 'diamonds',
    mode: 'diamonds', organizer: 'Organizer', provider: 'Provider club',
    rules: { rakeBps: 300, minStake: GLOBAL_RULES.diamonds.minStake, rakeShares: [{ role: 'organizer', party: 'Organizer', bps: 10000 }] },
    marginBps: 300, organizerIncomePerPlayerEUR: 15, diamondFloatMonths: 3,
    story: 'An organizer (a poker community, streamer or club) buys diamonds from PreFlop, gives them to its 300 members and runs a room on one provider table. Every bet pays PreFlop a fixed 1 ◆ (sunk), plus the organizer\'s 3% rake; the rest plays against the organizer\'s diamond house. The organizer charges its members off-platform (here €15/month) and rebuys the diamonds PreFlop\'s fee consumes.',
    activity: { players: 300, flopsPerMonth: flops(1, 10), participation: 0.1, betsPerFlop: 1, avgStake: 100 },
  },
  {
    id: 'chips-room', title: 'Virtual-chips social room — 2,000 players, pools (no house)', kind: 'pool',
    mode: 'virtual-chips', rakeBps: 800, unitsPerEuro: GLOBAL_RULES.virtualChips.chipsPerEuro, poolsCreated: 0,
    story: 'Players get chips by buying them from PreFlop (100 chips = €1) or by online transfer from their club or organizer, then play pools against each other. The rake leaves the chip economy, so players buy more chips; the chip-sales revenue that the rake represents is shared with the room organizer and provider club.',
    activity: { players: 2_000, flopsPerMonth: flops(2, 10), participation: 0.03, betsPerFlop: 1, avgStake: 50 },
    roles: [
      { role: 'Platform', party: 'PreFlop', bps: 5000 },
      { role: 'Room organizer', party: 'Organizer', bps: 3000 },
      { role: 'Flop provider', party: 'Provider club', bps: 2000 },
    ],
  },
  {
    id: 'play-money', title: 'Play money — 5,000 players, fun only', kind: 'play', mode: 'play', costPerActivePlayerEUR: 0.15,
    story: 'Free play with the real odds book and no fees. No revenue; it is PreFlop\'s acquisition funnel into chips, diamonds and real-money rooms.',
    activity: { players: 5_000, flopsPerMonth: flops(2, 10), participation: 0.05, betsPerFlop: 1.5, avgStake: 100 },
  },
];

export const evaluateAll = (): ScenarioResult[] => SCENARIOS.map(evaluate);

// ---------- Markdown ----------

const e0 = (x: number) => `${x < 0 ? '−' : ''}€${Math.abs(Math.round(x)).toLocaleString('en-US')}`;
const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

export function renderProfitabilityMarkdown(results: readonly ScenarioResult[]): string {
  const L: string[] = [];
  L.push('# PreFlop Profitability by Participant');
  L.push('');
  L.push('> **Generated file — do not edit by hand.** Run `pnpm book`. Every input is a placeholder in');
  L.push('> `packages/odds-engine/src/{scenarios,sharing,globalRules,costModel}.ts`. Figures are **expected values per month**;');
  L.push('> real months vary with luck, which is why houses hold bankroll or collateral.');
  L.push('');
  L.push('Each scenario reconciles: what players are expected to lose (or pay) equals the sum of every participant\'s income plus costs.');
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| Scenario | Mode | Who pays the winnings | Bets / month | Turnover (EUR) | PreFlop | Others | Reconciles |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const pre = r.lines.find((l) => l.participant === 'PreFlop')!;
    const others = r.lines.filter((l) => l.participant !== 'PreFlop' && !l.role.startsWith('Variable')).map((l) => `${l.participant} ${e0(l.eur)}`).join('; ');
    L.push(`| ${r.scenario.title} | ${MODES[r.scenario.mode].label} | ${houseLabel(r)} | ${n0(r.bets)} | ${e0(r.turnoverEUR)} | **${e0(pre.eur)}** | ${others} | ${r.reconciles ? '✅' : '❌'} |`);
  }
  for (const r of results) {
    const s = r.scenario;
    L.push('');
    L.push(`## ${s.title}`);
    L.push('');
    L.push(s.story);
    L.push('');
    const a = s.activity;
    L.push(`Activity: ${n0(a.players)} players · ${n0(a.flopsPerMonth)} flops/month · ${pct(a.participation, 2)} bet on each flop · ${a.betsPerFlop} bets each · average stake ${a.avgStake} ${MODES[s.mode].currencies[0]} → **${n0(r.bets)} bets, ${n0(r.turnover)} ${MODES[s.mode].currencies[0]} turnover**.`);
    L.push('');
    L.push('| Participant | Role | Expected EUR / month | How |');
    L.push('|---|---|---|---|');
    for (const l of r.lines) L.push(`| ${l.participant} | ${l.role} | ${e0(l.eur)} | ${l.note} |`);
    L.push(`| **Players** | Bettors | **${e0(-r.playersCostEUR)}** | ${s.kind === 'diamonds' ? 'what members pay the organizer off-platform' : s.kind === 'play' ? 'free' : 'expected cost of play (house edge / rake, net of promotions)'} |`);
    L.push('');
    const x = r.extra;
    if (s.kind === 'preflop-house') {
      L.push(`Book edge (market mix): ${pct(x.edge as number)} · GGR ${e0(x.ggr as number)} · external shares applied: ${pct(x.appliedShare as number)} of GGR.`);
      for (const p of s.parties) {
        const sh = computeShare(p.policy, p.metrics);
        L.push(`- ${p.party}: ${Object.entries(sh.components).map(([k, v]) => `${k} ${(v / 100).toFixed(2)}%`).join(' + ')} → **${(sh.bps / 100).toFixed(2)}%** (floor ${p.policy.floorBps / 100}%, cap ${p.policy.capBps / 100}%)`);
      }
    } else if (s.kind === 'organizer-house') {
      L.push(`Organizer book edge: ${pct(x.edge as number)}. Admission is validated at the room's minimum stake (${((x.minStakeMinor as number) / 100).toFixed(2)} EUR), where PreFlop's minimum fee weighs most: platform fee ${pct(x.platformFeeRate as number)} of stake, organizer EV ${pct(x.organizerEvPerUnit as number)} per unit staked. At the typical stake (forecast only): ${pct(x.typicalEv as number)}.`);
    } else if (s.kind === 'diamonds' && r.dilution) {
      const d = r.dilution;
      L.push(`Diamond flows / month: ${n0(x.diamondsSunk as number)} ◆ sunk to PreFlop (fixed ${GLOBAL_RULES.diamonds.preflopFeePerBet} ◆ per bet) · organizer rebuys ${n0(x.diamondsRebuy as number)} ◆ at ${((x.eurPerDiamond as number) * 100).toFixed(2)} cents each · players' diamond cost ${n0(x.playersDiamondCost as number)} ◆ (fee + rake + house edge), most of it recirculating to the organizer.`);
      L.push('');
      L.push(`**Dilution tracker:** sink rate ${pct(d.sinkRate)} of every diamond staked · a diamond is staked ~${d.stakesPerDiamondLife.toFixed(0)} times before it is consumed · ${d.consumedPerBet.toFixed(2)} ◆ consumed per bet · with ${s.diamondFloatMonths} months of float the organizer's stock lasts ${n0(d.betsUntilEmpty)} more bets.`);
    } else if (s.kind === 'pool') {
      L.push(`Rake ${(s.rakeBps / 100).toFixed(1)}% of pool turnover = ${e0((x.rake as number) / s.unitsPerEuro)}.${s.poolsCreated ? ` Creator share from ${s.poolsCreated} pools/month: ${(creatorBps / 100).toFixed(0)}%.` : ''}`);
    }
    L.push('');
    L.push(`Checks: ${r.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}`).join(' · ')}`);
  }
  L.push('');
  L.push('## Share tiers used');
  L.push('');
  for (const p of [CLUB_POLICY, PROVIDER_POLICY, PARTNER_POLICY, POOL_CREATOR_POLICY]) {
    L.push(`**${p.id}** — ${p.description} (base: ${p.base.toUpperCase()}, floor ${p.floorBps / 100}%, cap ${p.capBps / 100}%)`);
    L.push('');
    for (const c of p.components) {
      L.push(`- ${c.name} by \`${c.metric}\` (${c.mode}): ${c.tiers.map((t) => `${n0(c.metric === 'turnoverMinor' ? t.from / 100 : t.from)}${c.metric === 'turnoverMinor' ? ' EUR' : ''}+ → ${t.bps / 100}%`).join(' · ')}`);
    }
    L.push('');
  }
  L.push(`Example (progressive): a partner with €${n0(bigPartnerTurnoverCents / 100)} monthly turnover earns ${(tierBps(bigPartnerTurnoverCents, PARTNER_POLICY.components[0]!.tiers, 'progressive') / 100).toFixed(2)}% of GGR.`);
  L.push('');
  return L.join('\n');
}

function houseLabel(r: ScenarioResult): string {
  const s = r.scenario;
  if (s.kind === 'play') return 'Nobody (no money)';
  if (r.house === 'preflop') return 'PreFlop';
  if (r.house === 'pool') return 'Nobody — players\' pool';
  return s.kind === 'organizer-house' || s.kind === 'diamonds' ? s.organizer : 'Organizer';
}
