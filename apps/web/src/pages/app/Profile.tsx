import type { Limits, Wallet } from '@preflop/client';
import { Badge, Button, Card, ChipIcon, cx, currencyLabel, formatMoney, formatMoneyShort } from '@preflop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Check, ChevronDown, Copy, KeyRound, Network, ChevronRight, HeartHandshake, LogOut, RotateCcw, ShieldCheck, Ticket, Wallet as WalletIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader, initials } from '../../components/AppShell.tsx';
import { Field, Notice, Select, Sheet, Skeleton, TextArea } from '../../components/ui.tsx';
import { api, setToken } from '../../lib/api.ts';
import { countryOptions, dobProblem } from '../../lib/account.ts';
import { type LimitsForm, limitsErrors, limitsForm, limitsPayload } from '../../lib/limits.ts';
import { publicOrigin } from '../../lib/native.ts';
import { errorText, isNotImplemented } from '../../lib/problems.ts';
import { resolveOption } from '../../lib/bets.ts';
import { qk, useBook, useFavorites, useMe, useRealMoney, useResetPlay } from '../../lib/queries.ts';
import { KEYS, readString } from '../../lib/storage.ts';

function Section({ icon, title, subtitle, children, defaultOpen = false }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode; defaultOpen?: boolean }) {
  // Content mounts on first open, so endpoints behind a closed section are not called.
  const [seen, setSeen] = useState(defaultOpen);
  return (
    <details className="group rounded-[12px] border border-line-strong/60 bg-surface" open={defaultOpen} onToggle={(e) => e.currentTarget.open && setSeen(true)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-accent/30 bg-accent-deep text-accent">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-[13px] text-muted">{subtitle}</span>
        </span>
        <ChevronDown className="h-5 w-5 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-4 py-4">{seen ? children : null}</div>
    </details>
  );
}

const agentTitle = (status: string | undefined) =>
  status === 'active' || status === 'suspended' ? 'Your agent account' : status === 'applied' ? 'Agent application' : 'Become an agent';

export function ProfilePage() {
  const me = useMe();
  const real = useRealMoney();
  const nav = useNavigate();
  const qc = useQueryClient();
  const reset = useResetPlay();
  const [confirmReset, setConfirmReset] = useState(false);
  const logout = useMutation({
    mutationFn: () => api.logout().catch(() => ({ ok: true as const })),
    onSettled: () => {
      setToken(null);
      qc.clear();
      nav('/');
    },
  });

  const u = me.data;
  const play = u?.wallets.find((w) => w.mode === 'play');
  // Real money and organizer play currencies are shown apart: only the latter have no cash value.
  const money = u?.wallets.filter((w) => w.mode === 'real-fiat' || w.mode === 'real-crypto') ?? [];
  const organizer = u?.wallets.filter((w) => w.mode === 'virtual-chips' || w.mode === 'diamonds') ?? [];
  return (
    <div>
      <PageHeader eyebrow="Make yourself at home" title="Your profile." subtitle="A little personalization. A clear view of your practice account." />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card className="p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <span className="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full border border-line-strong bg-surface-3 font-serif text-[26px]">{initials(u?.display_name)}</span>
            <div className="min-w-0">
              {u ? (
                <>
                  <div className="truncate font-serif text-[26px] leading-tight tracking-[-0.03em]">{u.display_name}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {!real && <span className="rounded-[4px] border border-accent/45 bg-accent-deep px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-accent">PRACTICE PLAYER</span>}
                    {u.status !== 'active' && <Badge tone="warn" className="py-0.5!">{u.status.replace('_', ' ')}</Badge>}
                    {u.memberships.map((m) => <Badge key={m.org_id} tone="muted" className="py-0.5!">{m.kind} · {m.name}</Badge>)}
                  </div>
                </>
              ) : me.isError ? <div className="text-sm text-muted">Could not load your profile.</div> : <><Skeleton className="h-7 w-40" /><Skeleton className="mt-2 h-4 w-28" /></>}
            </div>
          </div>
          {u && <DisplayName current={u.display_name} />}
          <p className="mt-6 border-t border-line pt-5 text-[12px] leading-relaxed text-ink/80">Signed in as <span className="text-ink">{u?.email ?? '…'}</span>. Your balance, favorites and history are kept on the server and follow you to any device you sign in on.</p>
        </Card>

        <Card className="flex flex-col items-center justify-center p-7 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full border border-accent/40 bg-accent-deep"><ChipIcon size={36} /></span>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-ink/85">Your practice balance</p>
          <div className="mt-3 font-serif text-[46px] leading-none tracking-[-0.03em]">{play ? formatMoneyShort(play.balance_minor, 'PLAY') : <Skeleton className="mx-auto h-11 w-36" />}</div>
          <p className="mt-3 text-[13px] text-ink/80">Free chips · No cash value</p>
          <Button className="mt-5" onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" aria-hidden /> Reset free chips</Button>
          <p className="mt-3 text-[11px] text-ink/70">Always free. Your history stays.</p>
          {reset.isSuccess && <Notice tone="accent" className="mt-3">Free chips reset to {formatMoneyShort(reset.data.balance_minor, 'PLAY')}.</Notice>}
          {reset.isError && <Notice tone="warn" className="mt-3">{errorText(reset.error)}</Notice>}
        </Card>

        <Card className="p-6 sm:p-7">
          <h2 className="text-[20px] font-bold">A game on your terms.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink/80">Every round starts with your choice. No automatic replays, no countdown pressure and no paid chips.</p>
          <Link to="/responsible-gaming" className="mt-4 inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline">Read about responsible play <ChevronRight className="h-4 w-4" aria-hidden /></Link>
          <p className="mt-4 text-[13px] text-ink/75">Animations follow your device’s reduced-motion preference.</p>
        </Card>

        <FavoritesCard />
      </div>

      {money.length > 0 && (
        <WalletCard title="Money wallets" wallets={money} note="Real-money balance. Play responsibly. Deposits and withdrawals open in the app when real money is enabled for your account." />
      )}
      {organizer.length > 0 && (
        <WalletCard title="Organizer wallets" wallets={organizer} note="Chips and diamonds from organizers have no cash value." />
      )}

      <div className="mt-6 space-y-4">
      <Section icon={<Ticket className="h-5 w-5" />} title="Join a room" subtitle="Have an invite code from an organizer?"><JoinRoom /></Section>
      <Section icon={<Network className="h-5 w-5" />} title={agentTitle(u?.agent?.status)} subtitle={u?.agent?.status === 'active' ? `Code ${u.agent.code} · invite players and earn commission` : u?.agent?.status === 'applied' ? 'The PreFlop team is reviewing your application' : 'Invite players and earn a share of net revenue'}>
        <AgentSection />
      </Section>
      <Section icon={<Briefcase className="h-5 w-5" />} title="Become an organizer" subtitle="Run your own room with chips or diamonds"><OrganizerForm email={u?.email ?? ''} name={u?.display_name ?? ''} /></Section>
      {u && !u.partner_id && (
        <Section icon={<KeyRound className="h-5 w-5" />} title="Sign-in & security" subtitle={u.date_of_birth && u.country ? 'Password and your details' : 'Add your missing details'}
          defaultOpen={!u.date_of_birth || !u.country}>
          <Security dob={u.date_of_birth} country={u.country} />
        </Section>
      )}
      <Section icon={<HeartHandshake className="h-5 w-5" />} title="Responsible play" subtitle="Limits, time-outs and self-exclusion"><ResponsiblePlay /></Section>
      <Section icon={<ShieldCheck className="h-5 w-5" />} title="Identity & payments" subtitle={real ? 'Verify your identity, deposit and withdraw' : 'Real money is switched off'}>
        <RealMoney enabled={real} kyc={u?.kyc_status ?? 'none'} />
      </Section>

      </div>

      <Button variant="secondary" size="lg" className="mt-6 w-full sm:w-auto" disabled={logout.isPending} onClick={() => logout.mutate()}>
        <LogOut className="h-5 w-5" aria-hidden /> Sign out
      </Button>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset free chips">
        <h2 className="font-serif text-2xl">Reset free chips?</h2>
        <p className="mt-2 text-sm text-muted">Your free-chip balance goes back to the starting amount, whatever it is now. This cannot be undone.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button disabled={reset.isPending} onClick={() => reset.mutate(undefined, { onSettled: () => setConfirmReset(false) })}>Reset</Button>
        </div>
      </Sheet>
    </div>
  );
}

function WalletCard({ title, wallets, note }: { title: string; wallets: readonly Wallet[]; note: string }) {
  return (
    <Card className="mt-6 p-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold"><WalletIcon className="h-5 w-5 text-accent" aria-hidden /> {title}</h2>
      <ul className="mt-3 divide-y divide-line">
        {wallets.map((w) => (
          <li key={`${w.mode}:${w.currency}:${w.org_id ?? ''}`} className="flex items-center gap-3 py-3">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-line text-xs">{w.currency === 'DIAMOND' ? '◆' : w.currency[0]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold leading-tight">{formatMoney(w.balance_minor, w.currency)}</div>
              <div className="text-xs text-muted">{currencyLabel(w.currency)}{w.org_name ? ` · ${w.org_name}` : ''}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-faint">{note}</p>
    </Card>
  );
}

function AgentSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'agent'], queryFn: () => api.myAgent() });
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const applyM = useMutation({ mutationFn: () => api.applyAgent(note.trim() || undefined), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['me'] }); } });
  if (q.isLoading) return <Skeleton className="h-20" />;
  if (q.isError) return <Notice tone="warn">{errorText(q.error)}</Notice>;
  const a = q.data?.agent;
  if (!a || a.status === 'rejected') {
    return (
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); applyM.mutate(); }}>
        <p className="text-sm text-ink/80">Agents invite players with a personal link. You earn a share of the net revenue from the players you bring, and a smaller share from agents you recruit. Two levels, never more. Commission is paid on real-money play only, which is switched off for now.</p>
        {a?.status === 'rejected' && <Notice tone="info">Your last application was not approved. You can apply again.</Notice>}
        <TextArea label="Tell us about your community (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" className="w-full" disabled={applyM.isPending}>Apply to become an agent</Button>
        {applyM.isError && <Notice tone="warn">{errorText(applyM.error)}</Notice>}
      </form>
    );
  }
  if (a.status === 'applied') return <Notice tone="info">Your application is with the PreFlop team. We’ll set your rates and activate your code.</Notice>;
  if (a.status === 'suspended') return <Notice tone="warn">Your agent account is suspended. Contact support for details.</Notice>;
  const link = `${publicOrigin()}/register?ref=${a.code}`;
  const copy = () => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); };
  const dueBy = new Map<string, number>();
  for (const s of q.data?.statements ?? []) if (s.status !== 'paid' && s.amount_minor > 0) dueBy.set(s.currency, (dueBy.get(s.currency) ?? 0) + s.amount_minor);
  const due = [...dueBy].map(([cur, v]) => formatMoney(v, cur)).join(', ');
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[12px] text-ink/75">Your invitation link</div>
        <div className="mt-1.5 flex gap-2">
          <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-[8px] border border-line-strong bg-surface-2 px-3 font-mono text-[13px] text-ink" />
          <Button type="button" variant="secondary" onClick={copy}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-[10px] border border-line-strong/60 p-3"><div className="font-serif text-[24px]">{q.data?.players ?? 0}</div><div className="text-[12px] text-muted">Players</div></div>
        <div className="rounded-[10px] border border-line-strong/60 p-3"><div className="font-serif text-[24px]">{q.data?.sub_agents?.length ?? 0}</div><div className="text-[12px] text-muted">Sub-agents</div></div>
        <div className="rounded-[10px] border border-line-strong/60 p-3"><div className="font-serif text-[24px]">{(a.rate_l1_bps / 100).toFixed(0)}%</div><div className="text-[12px] text-muted">Your rate</div></div>
      </div>
      <p className="text-[13px] text-ink/75">Level 1: {(a.rate_l1_bps / 100).toFixed(1)}% of your players’ net revenue. Level 2: {(a.rate_l2_bps / 100).toFixed(1)}% from agents you recruit. Losing months carry forward. {due ? `Pending commission: ${due}.` : 'Real-money play is off, so nothing is payable yet.'}</p>
    </div>
  );
}

function DisplayName({ current }: { current: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(current);
  const save = useMutation({
    mutationFn: () => api.updateMe({ display_name: name.trim() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  });
  const changed = name.trim() !== current && name.trim().length > 0;
  return (
    <form className="mt-6" onSubmit={(e) => { e.preventDefault(); if (changed) save.mutate(); }}>
      <Field label="Display name" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); save.reset(); }} autoComplete="nickname" />
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={!changed || save.isPending}>Save name</Button>
        {save.isSuccess && <span className="text-[13px] text-accent" role="status">Saved.</span>}
        {save.isError && <span className="text-[13px] text-warn" role="alert">{errorText(save.error)}</span>}
      </div>
    </form>
  );
}

function FavoritesCard() {
  const favs = useFavorites();
  const book = useBook();
  const last = readString(KEYS.lastTable);
  return (
    <Card className="p-6 sm:p-7">
      <h2 className="text-[20px] font-bold">Your six favorites</h2>
      <p className="mt-3 text-[14px] text-ink/80">The bets you see first, at every table.</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {favs.ids.map((id) => (
          <li key={id} className="rounded-[6px] border border-line-strong px-2.5 py-1.5 text-[13px]">{resolveOption(book.index, id)?.name ?? id}</li>
        ))}
      </ul>
      <Link to={last ? `/app/table/${last}/bets` : '/app'} className="mt-5 inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline">
        Manage favorites <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}

function JoinRoom() {
  const [code, setCode] = useState('');
  const join = useMutation({ mutationFn: () => api.joinRoom(code.trim()) });
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) join.mutate(); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Room code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. ATLAS-7Q2" autoComplete="off" maxLength={40} />
      <Button type="submit" disabled={!code.trim() || join.isPending} className="w-full">Join room</Button>
      {join.isSuccess && <Notice tone="accent">You joined {join.data.name} ({join.data.org_name}). <Link to={`/app/table/${join.data.table_id}?room=${encodeURIComponent(join.data.id)}`} className="font-semibold text-accent underline">Open the room</Link></Notice>}
      {join.isError && <Notice tone="warn">{isNotImplemented(join.error) ? 'No room matches this code.' : errorText(join.error)}</Notice>}
    </form>
  );
}

function OrganizerForm({ email, name }: { email: string; name: string }) {
  const [org, setOrg] = useState('');
  const [mail, setMail] = useState(email);
  const [community, setCommunity] = useState('');
  const [players, setPlayers] = useState('');
  const [currency, setCurrency] = useState('diamonds');
  const apply = useMutation({
    mutationFn: () => api.apply({ kind: 'organizer', name: org.trim(), email: (mail || email).trim(), details: { contact_name: name, community, expected_players: players, currency, source: 'player-app' } }),
  });
  if (apply.isSuccess) return <Notice tone="accent">Thanks! Your application is in. We will reply by email.</Notice>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); apply.mutate(); }} className="space-y-3">
      <Field label="Organization or community name" required value={org} onChange={(e) => setOrg(e.target.value)} />
      <Field label="Contact email" type="email" required value={mail || email} onChange={(e) => setMail(e.target.value)} />
      <Field label="Where is your community?" placeholder="Discord, club, stream…" value={community} onChange={(e) => setCommunity(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expected players" inputMode="numeric" value={players} onChange={(e) => setPlayers(e.target.value)} />
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="diamonds">Diamonds</option>
          <option value="chips">Virtual chips</option>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={apply.isPending || !org.trim()}>Send application</Button>
      {apply.isError && <Notice tone="warn">{isNotImplemented(apply.error) ? 'Applications open soon. Please try again later.' : errorText(apply.error)}</Notice>}
    </form>
  );
}

/** "Raised or removed limits apply from …" when the server holds a pending change. */
function pendingText(l: (Limits & { pending?: Record<string, number | null> | null; pending_effective_at?: string | null }) | undefined): string | null {
  if (!l?.pending || !l.pending_effective_at || !Object.keys(l.pending).length) return null;
  const when = new Date(l.pending_effective_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const what = Object.entries(l.pending).map(([k, v]) => {
    const name = k === 'loss_day_minor' ? 'loss limit' : k === 'deposit_day_minor' ? 'deposit limit' : 'session limit';
    return v === null ? `${name} removed` : `${name} ${k === 'session_minutes' ? `${v} min` : formatMoney(v, 'EUR')}`;
  }).join(', ');
  return `Waiting 24 hours: ${what} from ${when}.`;
}

function ResponsiblePlay() {
  const qc = useQueryClient();
  const limits = useQuery({ queryKey: qk.limits, queryFn: () => api.limits() });
  const unavailable = limits.isError && isNotImplemented(limits.error);
  // Prefilled with the saved limits: emptying a field removes that limit (sent as an explicit null).
  const [form, setForm] = useState<LimitsForm>(() => limitsForm(undefined));
  // The fields the player edited: only these are sent, so a queued change of another field survives.
  const [edited, setEdited] = useState<ReadonlySet<keyof LimitsForm>>(() => new Set());
  const dirty = edited.size > 0;
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (limits.data && !dirty) setForm(limitsForm(limits.data)); }, [limits.data, dirty]);
  const edit = (k: keyof LimitsForm, v: string) => { setEdited((s) => new Set(s).add(k)); setForm((f) => ({ ...f, [k]: v })); };
  const errs = limitsErrors(form);
  const save = useMutation({
    mutationFn: (l: Limits) => api.setLimits(l),
    onSuccess: (l) => { qc.setQueryData(qk.limits, l); setEdited(new Set()); setTouched(false); },
  });
  const [days, setDays] = useState('7');
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const exclude = useMutation({ mutationFn: () => api.selfExclude(Number(days)) });
  const cur = limits.data;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Set limits that suit you. Lowering a limit takes effect at once; raising one waits 24 hours.</p>
      {unavailable && <Notice tone="info">Limits are coming soon. Until then, you can reset or stop at any time, and support can help.</Notice>}
      <form className="space-y-3" noValidate onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!Object.keys(errs).length && dirty) save.mutate(limitsPayload(form, edited));
      }}>
        <Field label="Daily loss limit (€)" inputMode="decimal" disabled={unavailable} placeholder="No limit" value={form.loss} onChange={(e) => edit('loss', e.target.value.replace(/[^\d.]/g, ''))}
          error={touched ? errs.loss ?? null : null} hint={`Real-money losses over 24 hours; free chips are never limited. Now: ${cur?.loss_day_minor != null ? formatMoney(cur.loss_day_minor, 'EUR') : 'no limit'}. Empty the field to remove it.`} />
        <Field label="Daily deposit limit (€)" inputMode="decimal" disabled={unavailable} placeholder="No limit" value={form.deposit} onChange={(e) => edit('deposit', e.target.value.replace(/[^\d.]/g, ''))}
          error={touched ? errs.deposit ?? null : null} hint={`Applies to real-money deposits when they are available. Now: ${cur?.deposit_day_minor != null ? formatMoney(cur.deposit_day_minor, 'EUR') : 'no limit'}.`} />
        <Field label="Session time limit (minutes)" hint="A reminder at every interval; when the time is up, predictions stop until you sign in again. 5 minutes or more; empty for none." inputMode="numeric" disabled={unavailable}
          placeholder="Off" value={form.session} onChange={(e) => edit('session', e.target.value.replace(/\D/g, ''))} error={touched ? errs.session ?? null : null} />
        {pendingText(cur) && <Notice tone="info">{pendingText(cur)}</Notice>}
        <Button type="submit" variant="secondary" className="w-full" disabled={unavailable || save.isPending}>Save limits</Button>
        {save.isSuccess && <Notice tone="accent">Limits saved.</Notice>}
        {save.isError && <Notice tone="warn">{errorText(save.error)}</Notice>}
      </form>

      <div className="rounded-[10px] border border-danger/40 p-4">
        <h3 className="font-semibold">Self-exclusion</h3>
        <p className="mt-1 text-sm text-muted">Take a break from all PreFlop play. You will not be able to place predictions until the period ends, and it cannot be shortened.</p>
        <div className="mt-3 flex gap-3">
          <Select label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="flex-1">
            <option value="1">24 hours</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
          </Select>
          <Button variant="danger" className="mt-[26px]" onClick={() => { setTyped(''); setConfirm(true); }}>Exclude me</Button>
        </div>
        {exclude.isSuccess && <Notice tone="info" className="mt-3">You are excluded until {new Date(exclude.data.until).toLocaleDateString()}.</Notice>}
        {exclude.isError && <Notice tone="warn" className="mt-3">{isNotImplemented(exclude.error) ? 'Self-exclusion online is coming soon. Contact support and we will apply it for you today.' : errorText(exclude.error)}</Notice>}
      </div>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Confirm self-exclusion">
        <h2 className="font-serif text-2xl">Exclude yourself?</h2>
        <p className="mt-2 text-sm text-muted">For the period you chose you will not be able to play, and you cannot undo this. Type <strong className="text-ink">EXCLUDE</strong> to confirm.</p>
        <Field label="Type EXCLUDE" className="mt-4" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" disabled={typed.trim() !== 'EXCLUDE' || exclude.isPending} onClick={() => exclude.mutate(undefined, { onSettled: () => setConfirm(false) })}>Confirm</Button>
        </div>
      </Sheet>
    </div>
  );
}

function RealMoney({ enabled, kyc }: { enabled: boolean; kyc: string }) {
  const kycM = useMutation({ mutationFn: () => api.startKyc() });
  const payments = useQuery({ queryKey: ['me', 'payments'], queryFn: () => api.payments(), enabled });
  if (!enabled) {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>PreFlop currently runs on <span className="text-ink">free chips only</span>. Real-money play, identity verification, deposits and withdrawals are switched off.</p>
        <p>When real money launches in your country you will verify your identity here first. Nothing you do with free chips can ever be cashed out.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm">Identity verification</span>
        <Badge tone={kyc === 'verified' ? 'accent' : kyc === 'rejected' ? 'danger' : 'muted'}>{kyc}</Badge>
      </div>
      {kyc !== 'verified' && <Button className="w-full" disabled={kycM.isPending || kyc === 'pending'} onClick={() => kycM.mutate()}>Verify my identity</Button>}
      {kycM.isError && <Notice tone="warn">{errorText(kycM.error)}</Notice>}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Deposits & withdrawals</h3>
        {payments.isError ? <Notice tone="info">{errorText(payments.error)}</Notice> : (payments.data?.payments.length ?? 0) === 0 ? <p className="text-sm text-muted">No payments yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {payments.data!.payments.map((p) => (
              <li key={p.id} className={cx('flex justify-between py-2')}><span>{p.kind} · {p.method}</span><span>{formatMoney(p.amount_minor, p.currency)} · {p.status}</span></li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-faint">Deposits require verified identity and respect your limits.</p>
      </div>
    </div>
  );
}

/** Change password (signs out other devices), and the date of birth / country for accounts created without them (set once). */
function Security({ dob, country }: { dob: string | null; country: string | null }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => { setCurrent(''); setNext(''); },
  });
  const [newDob, setNewDob] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const countries = useMemo(() => countryOptions(), []);
  const details = useMutation({
    mutationFn: () => api.updateMe({ ...(dob ? {} : { date_of_birth: newDob }), ...(country ? {} : { country: newCountry }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.me }),
  });
  const dobErr = dob ? null : newDob ? dobProblem(newDob) : null;
  const canSave = (!!dob || (!!newDob && !dobErr)) && (!!country || !!newCountry);
  return (
    <div className="space-y-6">
      {(!dob || !country) && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (canSave) details.mutate(); }}>
          <p className="text-sm text-muted">We need these once. They can only be corrected by support afterwards.</p>
          {!dob && <Field label="Date of birth" type="date" value={newDob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setNewDob(e.target.value)} error={dobErr} />}
          {!country && (
            <Select label="Country of residence" value={newCountry} onChange={(e) => setNewCountry(e.target.value)}>
              <option value="" disabled>Choose your country</option>
              {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </Select>
          )}
          <Button type="submit" variant="secondary" className="w-full" disabled={!canSave || details.isPending}>Save my details</Button>
          {details.isError && <Notice tone="warn">{errorText(details.error)}</Notice>}
        </form>
      )}
      {dob && country && <p className="text-sm text-muted">Date of birth {dob} · country {country}. Contact support to correct them.</p>}
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (current && next.length >= 8) change.mutate(); }}>
        <h3 className="font-semibold">Change password</h3>
        <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); change.reset(); }} />
        <Field label="New password" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => { setNext(e.target.value); change.reset(); }} hint="At least 8 characters. Other devices are signed out." />
        <Button type="submit" variant="secondary" className="w-full" disabled={!current || next.length < 8 || change.isPending}>Change password</Button>
        {change.isSuccess && <Notice tone="accent">Password changed. Other devices are signed out.</Notice>}
        {change.isError && <Notice tone="warn">{errorText(change.error)}</Notice>}
      </form>
    </div>
  );
}
