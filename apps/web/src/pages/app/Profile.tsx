import type { Limits } from '@preflop/client';
import { Badge, Button, Card, ChipIcon, cx, currencyLabel, formatMoney } from '@preflop/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ChevronDown, ChevronRight, HeartHandshake, LogOut, RotateCcw, ShieldCheck, Ticket, Wallet } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader, initials } from '../../components/AppShell.tsx';
import { Field, Notice, Select, Sheet, Skeleton, TextArea } from '../../components/ui.tsx';
import { api, setToken } from '../../lib/api.ts';
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
  const others = u?.wallets.filter((w) => w.mode !== 'play') ?? [];
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
          <p className="mt-3 font-serif text-[46px] leading-none tracking-[-0.03em]">{play ? formatMoney(play.balance_minor, 'PLAY') : <Skeleton className="mx-auto h-11 w-36" />}</p>
          <p className="mt-3 text-[13px] text-ink/80">Free chips · No cash value</p>
          <Button className="mt-5" onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" aria-hidden /> Reset free chips</Button>
          <p className="mt-3 text-[11px] text-ink/70">Always free. Your history stays.</p>
          {reset.isSuccess && <Notice tone="accent" className="mt-3">Free chips reset to {formatMoney(reset.data.balance_minor, 'PLAY')}.</Notice>}
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

      {others.length > 0 && (
        <Card className="mt-6 p-6">
          <h2 className="flex items-center gap-2 text-[17px] font-bold"><Wallet className="h-5 w-5 text-accent" aria-hidden /> Organizer wallets</h2>
          <ul className="mt-3 divide-y divide-line">
            {others.map((w) => (
              <li key={`${w.mode}:${w.currency}:${w.org_name ?? ''}`} className="flex items-center gap-3 py-3">
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-line text-xs">{w.currency === 'DIAMOND' ? '◆' : w.currency[0]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-semibold leading-tight">{formatMoney(w.balance_minor, w.currency)}</div>
                  <div className="text-xs text-muted">{currencyLabel(w.currency)}{w.org_name ? ` · ${w.org_name}` : ''}</div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-faint">Chips and diamonds from organizers have no cash value.</p>
        </Card>
      )}

      <div className="mt-6 space-y-4">
      <Section icon={<Ticket className="h-5 w-5" />} title="Join a room" subtitle="Have an invite code from an organizer?"><JoinRoom /></Section>
      <Section icon={<Briefcase className="h-5 w-5" />} title="Become an organizer" subtitle="Run your own room with chips or diamonds"><OrganizerForm email={u?.email ?? ''} name={u?.display_name ?? ''} /></Section>
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

const toMinor = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s))));

function ResponsiblePlay() {
  const qc = useQueryClient();
  const limits = useQuery({ queryKey: qk.limits, queryFn: () => api.limits() });
  const unavailable = limits.isError && isNotImplemented(limits.error);
  const [loss, setLoss] = useState('');
  const [deposit, setDeposit] = useState('');
  const [session, setSession] = useState('');
  const save = useMutation({
    mutationFn: (l: Limits) => api.setLimits(l),
    onSuccess: (l) => qc.setQueryData(qk.limits, l),
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
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ loss_day_minor: toMinor(loss) ?? cur?.loss_day_minor ?? null, deposit_day_minor: toMinor(deposit) ?? cur?.deposit_day_minor ?? null, session_minutes: toMinor(session) ?? cur?.session_minutes ?? null });
      }}>
        <Field label="Daily loss limit (free chips)" inputMode="numeric" disabled={unavailable} placeholder={cur?.loss_day_minor != null ? String(cur.loss_day_minor) : 'No limit'} value={loss} onChange={(e) => setLoss(e.target.value.replace(/\D/g, ''))} />
        <Field label="Daily deposit limit" inputMode="numeric" disabled={unavailable} placeholder={cur?.deposit_day_minor != null ? String(cur.deposit_day_minor) : 'No limit'} value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ''))} hint="Applies to real-money deposits when they are available." />
        <Field label="Session reminder (minutes)" inputMode="numeric" disabled={unavailable} placeholder={cur?.session_minutes != null ? String(cur.session_minutes) : 'Off'} value={session} onChange={(e) => setSession(e.target.value.replace(/\D/g, ''))} />
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
