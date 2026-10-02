import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, ChevronRight, Minus, Star } from 'lucide-react';
import {
  Badge, Button, Card, CardBack, ChipIcon, EmptyState, Felt, PlayingCard, Segmented, Spinner, StatusDot, Wordmark, cx, formatOdds,
} from '@preflop/ui';
import { NAV } from '../components/nav.ts';
import { Callout, Kpi, Section } from '../components/ui.tsx';
import { KIND_LABEL, type PortalKind } from '../lib/portals.ts';

/**
 * The PreFlop design system, rendered with the real shared components (packages/ui) and the
 * console kit, so this page can never drift from the apps. Public at /design.
 */

const TOKENS: [group: string, names: string[]][] = [
  ['Surfaces', ['bg', 'surface', 'surface-2', 'surface-3', 'line', 'line-strong']],
  ['Text', ['ink', 'muted', 'faint']],
  ['Brand', ['accent', 'accent-strong', 'accent-deep', 'accent-ink', 'felt']],
  ['Cards', ['card', 'card-red', 'card-black']],
  ['Signals', ['info', 'warn', 'danger', 'live']],
];

function useTokenValue(name: string) {
  const [v, setV] = useState('');
  useEffect(() => setV(getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()), [name]);
  return v;
}

function Swatch({ name }: { name: string }) {
  const v = useTokenValue(name);
  return (
    <div className="overflow-hidden rounded-[10px] border border-line-strong/60 bg-surface">
      <div className="h-16 border-b border-line-strong/60" style={{ background: `var(--color-${name})` }} />
      <div className="px-3 py-2.5">
        <div className="font-mono text-[12px] text-ink">{name}</div>
        <div className="font-mono text-[11px] text-muted">{v || '—'}</div>
      </div>
    </div>
  );
}

function Block({ id, eyebrow, title, intro, children }: { id: string; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24 border-t border-line pt-12">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
      <h2 id={`${id}-t`} className="mt-3 font-serif text-[32px] leading-tight tracking-[-0.04em]">{title}</h2>
      {intro && <p className="mt-2 max-w-3xl text-[15px] text-ink/80">{intro}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.12em] text-ink/70">{children}</div>;
}

/** The six-favorites tile from the player table. */
function FavTile({ name, family, odds, selected }: { name: string; family: string; odds: number; selected?: boolean }) {
  return (
    <div className={cx('relative flex min-h-[110px] flex-col rounded-[10px] border p-3.5', selected ? 'border-accent bg-accent-deep/35' : 'border-line-strong/60 bg-surface-2/40')}>
      <span className="text-[15px] font-bold leading-tight">{name}</span>
      <span className="mt-1 text-[12px] text-ink/70">{family}</span>
      <span className="mt-auto pt-2 text-[17px] font-bold">{formatOdds(odds)}</span>
      {selected ? <Check className="absolute bottom-2.5 right-2.5 h-3.5 w-3.5 text-accent" strokeWidth={2.5} /> : <Star className="absolute bottom-2.5 right-2.5 h-3 w-3 fill-ink/45 text-ink/45" />}
    </div>
  );
}

/** The lobby table card from the player app. */
function TableCardDemo({ name, club, city, cards, theme, offline }: { name: string; club: string; city: string; cards: string[]; theme: 'green' | 'blue' | 'violet'; offline?: boolean }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[12px] border border-line-strong/60 bg-surface">
      <Felt cards={cards} size="md" theme={theme} unavailable={!!offline} label="TABLE 04" className="h-[180px] border-b border-white/5"
        action={<span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/40"><Star className="h-[18px] w-[18px]" strokeWidth={1.7} /></span>} />
      <div className="px-[18px] pb-[18px] pt-4">
        <div className="flex items-center justify-between text-[12px]">
          <span className="tracking-[0.06em] text-ink/85">PRACTICE TABLE</span>
          <span className={cx('inline-flex items-center gap-1.5', offline ? 'text-muted' : 'text-accent')}><span className={cx('h-1.5 w-1.5 rounded-full', offline ? 'bg-faint' : 'bg-accent')} />{offline ? 'Offline' : 'Ready to play'}</span>
        </div>
        <h3 className="mt-2.5 font-serif text-[21px] tracking-[-0.03em]">{name}</h3>
        <p className="mt-1.5 text-[14px] text-muted">{club} ›</p>
        <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
          <span className="text-[12px] text-ink/80">{city} / Practice</span>
          {offline ? <span className="text-[12px] text-ink/80">Check back later</span> : (
            <span className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-accent px-3.5 text-[14px] font-bold text-accent-ink">Take a seat <ChevronRight className="h-4 w-4" /></span>
          )}
        </div>
      </div>
    </article>
  );
}

const PLAYER_NAV = ['Lobby', 'Clubs', 'Activity', 'Profile'];

type Access = 'full' | 'read' | 'none';
const TEAM_MATRIX: [area: string, admin: Access, ops: Access, risk: Access, support: Access][] = [
  ['Overview, tables wall, alerts, review queue, rounds, risk', 'full', 'full', 'full', 'full'],
  ['Void a round', 'full', 'full', 'full', 'read'],
  ['Pause / resume a table', 'full', 'full', 'full', 'read'],
  ['Users: status and KYC', 'full', 'read', 'full', 'full'],
  ['Create or suspend organizations, decide applications', 'full', 'full', 'read', 'read'],
  ['Ledger', 'full', 'full', 'full', 'none'],
  ['Audit chain', 'full', 'none', 'full', 'none'],
  ['Statements, payments, odds book', 'read', 'read', 'read', 'read'],
  ['Platform settings (modes, physical play, limits)', 'full', 'read', 'read', 'read'],
  ['Grant or remove PreFlop team roles', 'full', 'none', 'none', 'none'],
];

function AccessCell({ a }: { a: Access }) {
  if (a === 'full') return <span className="inline-flex items-center gap-1.5 text-accent"><Check size={14} strokeWidth={2.5} aria-hidden />Change</span>;
  if (a === 'read') return <span className="text-ink/75">View</span>;
  return <span className="inline-flex items-center gap-1 text-faint"><Minus size={14} aria-hidden />No access</span>;
}

const LAYERS: { kind: PortalKind | 'player' | 'tablet'; who: string; roles: string; does: string }[] = [
  { kind: 'player', who: 'Players', roles: 'Player account (18+). Partner players arrive through the embed.', does: 'Lobby, clubs, the table with six favorites and the full catalogue, activity, profile, rooms, limits and self-exclusion.' },
  { kind: 'admin', who: 'PreFlop team', roles: 'Super admin (admin) · ops · risk · support', does: 'Runs the platform: integrity review, risk and alerts, organizations, users, the money ledger, the odds book and settings.' },
  { kind: 'club', who: 'Poker clubs', roles: 'Owner · admin · viewer', does: 'Tables and the 9-item certification, staff and device keys, hand log, rooms, chips, players and revenue share.' },
  { kind: 'partner', who: 'Betting companies', roles: 'Owner · admin · viewer', does: 'API keys, signed webhooks, the embeddable widget, integration docs, bets and statements.' },
  { kind: 'organizer', who: 'Players who organize', roles: 'Owner · admin · viewer', does: 'Rooms in chips or diamonds, diamond packs, treasury and collateral, transfers to players, statements.' },
  { kind: 'tablet', who: 'Club tablet', roles: 'Dealer · floor · floor manager (signed device keys)', does: 'Start hand, lock, shuffle and cut, flop entry and capture, with every message signed (PREFLOP-SIG-1).' },
];

const SECTIONS = [
  ['principles', 'Principles'], ['color', 'Colour'], ['type', 'Type'], ['components', 'Components'], ['cards', 'Cards & tables'],
  ['patterns', 'Dashboard patterns'], ['layers', 'Layers & roles'],
] as const;

export function DesignPage() {
  const [seg, setSeg] = useState<number>(100);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-[72px] items-center gap-4 border-b border-line bg-bg/92 px-5 backdrop-blur md:px-10">
        <Link to="/" aria-label="PreFlop console"><Wordmark size="md" /></Link>
        <span className="hidden text-[13px] font-medium uppercase tracking-[0.14em] text-muted sm:inline">Design system</span>
        <nav aria-label="Sections" className="ml-auto hidden gap-1 lg:flex">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="rounded-[8px] px-3 py-2 text-[13px] text-ink/80 hover:bg-surface-2 hover:text-ink">{label}</a>)}
        </nav>
      </header>

      <main className="mx-auto max-w-[1240px] space-y-14 px-5 pb-24 pt-10 md:px-10">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">PreFlop · one system, every layer</p>
          <h1 className="mt-3 font-serif text-[40px] leading-[1.1] tracking-[-0.045em] md:text-[56px]">The design system.</h1>
          <p className="mt-3 max-w-3xl text-[16px] text-ink/80">
            Charcoal, mint and ivory. The same tokens and components power the website, the player app, the partner widget, the four console
            dashboards and the club tablet. Everything below is rendered live from <code className="font-mono text-[14px] text-ink">packages/ui</code> and the console kit.
          </p>
        </div>

        <Block id="principles" eyebrow="Before pixels" title="Principles.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ['Calm, never pushy', 'No countdown pressure, no auto-replay, no loss-chasing prompts. Every round starts with the player’s choice.'],
              ['Honest numbers', 'Every price is the engine’s real decimal odds, including the stake. Money is never implied where there is none.'],
              ['Say what is simulated', 'Physical-table play is off; every table carries SIMULATED TABLE. There is never a fake video.'],
              ['One system', 'A token change reaches every app. Layers differ in density, not in language.'],
            ].map(([t, d]) => (
              <Card key={t} className="p-6"><h3 className="text-[17px] font-bold">{t}</h3><p className="mt-2 text-[14px] leading-relaxed text-ink/80">{d}</p></Card>
            ))}
          </div>
        </Block>

        <Block id="color" eyebrow="Tokens" title="Colour." intro={<>Defined once in <code className="font-mono text-[14px] text-ink">packages/ui/src/tokens.css</code> as Tailwind theme variables (<code className="font-mono text-[14px] text-ink">bg-surface</code>, <code className="font-mono text-[14px] text-ink">text-accent</code>…). Values below are read from the running page.</>}>
          <div className="space-y-7">
            {TOKENS.map(([g, names]) => (
              <div key={g}>
                <Label>{g}</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{names.map((n) => <Swatch key={n} name={n} />)}</div>
              </div>
            ))}
            <div>
              <Label>Felt themes (one per club)</Label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(['green', 'blue', 'violet'] as const).map((t) => <Felt key={t} cards={null} size="sm" theme={t} badge={false} label={t.toUpperCase()} className="h-[120px] rounded-[10px]" />)}
                <Felt cards={null} size="sm" unavailable badge={false} label="OFFLINE" className="h-[120px] rounded-[10px]" />
              </div>
            </div>
          </div>
        </Block>

        <Block id="type" eyebrow="Georgia × Inter" title="Type.">
          <Card className="divide-y divide-line">
            {[
              ['Display · Georgia 56 / −4.5%', <span className="font-serif text-[48px] leading-none tracking-[-0.045em]">Find your table.</span>],
              ['Page title · Georgia 42', <span className="font-serif text-[36px] leading-none tracking-[-0.045em]">Your activity.</span>],
              ['Eyebrow · Inter 11 bold, +20% tracking, mint', <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Your next three cards</span>],
              ['Card title · Inter 18–20 bold', <span className="text-[20px] font-bold">Favorite bets</span>],
              ['Name · Georgia 21', <span className="font-serif text-[21px] tracking-[-0.03em]">The Green Room</span>],
              ['Body · Inter 15, 80% ink', <span className="text-[15px] text-ink/80">Different rooms. The same feeling when the cards turn.</span>],
              ['Number · Georgia 32, tabular', <span className="font-serif text-[32px] tabular-nums">10,000</span>],
              ['Wordmark', <Wordmark size="lg" />],
            ].map(([k, v], i) => (
              <div key={i} className="grid items-center gap-2 px-6 py-5 md:grid-cols-[280px_1fr]">
                <span className="font-mono text-[12px] text-muted">{k as string}</span>
                <div>{v}</div>
              </div>
            ))}
          </Card>
        </Block>

        <Block id="components" eyebrow="Building blocks" title="Components.">
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Buttons" subtitle="Primary is mint with dark ink; secondary is an outline; danger is reserved for irreversible actions.">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Take a seat</Button><Button variant="secondary">Browse all bets</Button><Button variant="ghost">Cancel</Button><Button variant="danger">Exclude me</Button>
                <Button disabled>Waiting for the next round</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3"><Button size="sm">Small</Button><Button size="md">Medium</Button><Button size="lg">Large</Button></div>
            </Section>
            <Section title="Badges, pills & status" subtitle="Badges label state; pills label context (PRACTICE, role); dots carry live status.">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge>Open</Badge><Badge tone="muted">Organizer house</Badge><Badge tone="info">Diamonds</Badge><Badge tone="warn">Paused</Badge><Badge tone="danger">Voided</Badge><Badge tone="live">Live</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-[6px] border border-accent/45 bg-accent-deep px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-accent">PRACTICE</span>
                <span className="rounded-[6px] border border-accent/45 bg-accent-deep px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-accent">SUPER ADMIN</span>
                <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#6c8a6f]/25 bg-[#101a15]/75 px-2 py-[5px] text-[8.5px] tracking-[0.09em] text-[#c4d3c8]"><span className="h-1 w-1 rounded-full bg-[#bccdbb]" />SIMULATED TABLE</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-5"><StatusDot label="Ready to play" /><StatusDot tone="info" label="Round in progress" /><StatusDot tone="warn" label="Reconnecting" /><StatusDot tone="muted" label="Offline" /></div>
            </Section>
            <Section title="Selection" subtitle="Segmented presets for amounts; text tabs for filters.">
              <Segmented<number> options={[50, 100, 250, 500]} value={seg} onChange={setSeg} />
              <div className="mt-4 flex gap-1">
                {['All tables', 'Available', 'Saved'].map((t, i) => (
                  <span key={t} className={cx('inline-flex h-11 items-center rounded-[8px] border px-4 text-[15px]', i === 0 ? 'border-line-strong bg-surface-3' : 'border-transparent text-ink/80')}>{t}</span>
                ))}
              </div>
            </Section>
            <Section title="Feedback" subtitle="Callouts explain; empty states invite the next step; spinners only while loading.">
              <div className="space-y-3">
                <Callout tone="accent" title="Round 615 is open for predictions.">Pick one of your six favorites.</Callout>
                <Callout tone="warn" title="Physical-table play is disabled">It stays off until the PreFlop Trusted Shuffler is certified.</Callout>
                <div className="flex items-center gap-3 text-sm text-muted"><Spinner /> Loading the odds book…</div>
              </div>
            </Section>
            <Section title="Balance" subtitle="The chip icon always sits beside free-chip balances.">
              <span className="flex items-center gap-2.5">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-accent/40 bg-accent-deep"><ChipIcon size={26} /></span>
                <span className="leading-tight"><span className="block text-[16px] font-bold">10,000</span><span className="block text-[12px] text-muted">free chips</span></span>
              </span>
            </Section>
            <Section title="Empty state">
              <EmptyState title="Your story starts with three cards.">Completed rounds appear here.</EmptyState>
            </Section>
          </div>
        </Block>

        <Block id="cards" eyebrow="The table" title="Cards & tables." intro="Ivory faces with Georgia indices on a noise-textured felt with an oval rail. Previous flops are shown face up; the round being predicted is never shown.">
          <div className="space-y-8">
            <div>
              <Label>Playing cards · sm · md · lg · back</Label>
              <div className="flex flex-wrap items-end gap-4 rounded-[12px] border border-line-strong/60 bg-surface p-6">
                <PlayingCard code="Ah" size="sm" /><PlayingCard code="Ks" size="md" /><PlayingCard code="Td" size="lg" /><CardBack size="md" />
              </div>
            </div>
            <div>
              <Label>Lobby table cards</Label>
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                <TableCardDemo name="The Green Room" club="Atlas Poker Club" city="Bucharest" cards={['8h', 'Qs', '3c']} theme="green" />
                <TableCardDemo name="Midnight Blue" club="Meridian Poker Club" city="London" cards={['Ah', 'Ad', 'Jc']} theme="blue" />
                <TableCardDemo name="The Quiet Table" club="Noir Card Room" city="Paris" cards={['As', '9d', '4c']} theme="violet" offline />
              </div>
            </div>
            <div>
              <Label>Favorite bets</Label>
              <div className="grid max-w-[460px] grid-cols-2 gap-3">
                <FavTile name="Any pair" family="Rank patterns" odds={550} selected />
                <FavTile name="All red" family="Suits & colors" odds={795} />
                <FavTile name="Any straight" family="Sequences" odds={2625} />
                <FavTile name="Contains an ace" family="Faces & ranks" odds={432} />
              </div>
            </div>
          </div>
        </Block>

        <Block id="patterns" eyebrow="Dashboards" title="Dashboard patterns." intro="Every console page follows the same order: an eyebrow and serif title, a strip of key numbers, then sections as cards. Data-dense tables stay in sans; names and titles stay in serif.">
          <div className="rounded-[14px] border border-line-strong/60 bg-bg p-6 md:p-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">Poker club</p>
            <h3 className="mt-3 font-serif text-[36px] leading-none tracking-[-0.045em]">Atlas Poker Club</h3>
            <p className="mt-2 text-[15px] text-ink/80">Key numbers and the last 30 days.</p>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Tables" value="2" /><Kpi label="Hands dealt (30 days)" value="1,099" /><Kpi label="Turnover (30 days)" value="600" tone="accent" /><Kpi label="Open alerts" value="1" tone="danger" />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {[['Tables & certification', 'Readiness, link health, the 9-item checklist'], ['Enroll staff credentials', 'Dealer, floor and floor-manager keys'], ['Revenue share', 'Your tier, rate and amount this period']].map(([t, d]) => (
                <Card key={t} className="flex items-start justify-between gap-3 p-5"><div><div className="font-serif text-[19px]">{t}</div><div className="mt-1.5 text-[14px] text-ink/75">{d}</div></div><ChevronRight size={16} className="mt-1 text-muted" /></Card>
              ))}
            </div>
          </div>
        </Block>

        <Block id="layers" eyebrow="Who sees what" title="Layers & roles." intro="Six surfaces share the system. The console navigation below is read from the live configuration (components/nav.ts).">
          <div className="grid gap-5 lg:grid-cols-2">
            {LAYERS.map((l) => (
              <Card key={l.kind} className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">{l.kind === 'player' ? 'Player app' : l.kind === 'tablet' ? 'Club tablet' : `Console · ${KIND_LABEL[l.kind]}`}</p>
                    <h3 className="mt-2 font-serif text-[24px] tracking-[-0.03em]">{l.who}</h3>
                  </div>
                </div>
                <p className="mt-2 text-[14px] text-ink/80">{l.does}</p>
                <p className="mt-3 text-[13px]"><span className="text-muted">Roles · </span>{l.roles}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(l.kind === 'player' ? PLAYER_NAV : l.kind === 'tablet' ? ['Setup', 'Enrollment', 'Hand flow', 'Evidence'] : NAV[l.kind].flatMap((g) => g.items.map((i) => i.label))).map((n) => (
                    <span key={n} className="rounded-[6px] border border-line-strong/70 px-2 py-1 text-[12px] text-ink/85">{n}</span>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-8">
            <Label>PreFlop team access (enforced by the API)</Label>
            <div className="overflow-x-auto rounded-[12px] border border-line-strong/60">
              <table className="w-full min-w-[720px] text-left text-[14px]">
                <thead className="bg-surface-2 text-[12px] uppercase tracking-[0.1em] text-ink/70">
                  <tr><th className="px-4 py-3 font-semibold">Area</th><th className="px-4 py-3 font-semibold text-accent">Super admin</th><th className="px-4 py-3 font-semibold">Ops</th><th className="px-4 py-3 font-semibold">Risk</th><th className="px-4 py-3 font-semibold">Support</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {TEAM_MATRIX.map(([area, ...cells]) => (
                    <tr key={area}><td className="px-4 py-3 text-ink/90">{area}</td>{cells.map((c, i) => <td key={i} className="px-4 py-3"><AccessCell a={c} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] text-ink/75">Inside every club, partner and organizer: <strong className="text-ink">owner</strong> and <strong className="text-ink">admin</strong> can change things; <strong className="text-ink">viewer</strong> is read-only. Only the super admin grants PreFlop team roles.</p>
          </div>
        </Block>
      </main>
    </div>
  );
}
