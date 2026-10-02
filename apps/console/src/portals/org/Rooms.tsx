import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Room } from '@preflop/client';
import { Badge, Button, Card, Spinner, cx, formatMoney } from '@preflop/ui';
import { CheckCircle2, Lock, Pencil, Plus, Globe, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { errorMessage, isNotAvailable, MODE_LABEL, pctFromBps } from '../../lib/format.ts';
import { bpsToPct, currencyForMode, emptyRulesForm, GLOBAL, looseRules, usesMargin, usesRake, validateRulesForm, type RulesForm } from '../../lib/rules.ts';
import { StatusBadge } from '../../components/domain.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { ConfirmDialog, CopyButton, Field, Modal, PageHeader, QueryView, Select, TextInput, useAction } from '../../components/ui.tsx';

function formFromRoom(r: Room): RulesForm {
  return {
    name: r.name, table_id: r.table_id, mode: r.mode === 'diamonds' ? 'diamonds' : 'virtual-chips', house: r.house, visibility: r.visibility,
    margin_pct: bpsToPct(r.rules.margin_bps), rake_pct: bpsToPct(r.rules.rake_bps), provider_share_pct: bpsToPct(r.rules.provider_share_bps),
    min_stake: String(r.rules.min_stake_minor),
  };
}

/** Debounced server-side validation of the rules (POST /rooms/validate). */
function useServerValidation(orgId: string, f: RulesForm, enabled: boolean) {
  const loose = looseRules(f);
  const payload = loose ? JSON.stringify({ mode: f.mode, house: f.house, rules: loose }) : null;
  const [debounced, setDebounced] = useState(payload);
  useEffect(() => { const t = setTimeout(() => setDebounced(payload), 400); return () => clearTimeout(t); }, [payload]);
  const q = useQuery({
    queryKey: ['org', orgId, 'validate', debounced],
    queryFn: () => api.orgValidateRules(orgId, JSON.parse(debounced!)),
    enabled: enabled && !!debounced,
    staleTime: 60_000,
  });
  return { q, pending: payload !== debounced || q.isFetching };
}

function RoomEditor({ open, onClose, room }: { open: boolean; onClose: () => void; room: Room | null }) {
  const orgId = useOrgId();
  const [f, setF] = useState<RulesForm>(emptyRulesForm());
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setF(room ? formFromRoom(room) : emptyRulesForm()); setTouched(false); } }, [open, room]);
  const lobby = useQuery({ queryKey: ['lobby'], queryFn: api.lobby, staleTime: 60_000, enabled: open });
  const { errors, rules } = validateRulesForm(f);
  const server = useServerValidation(orgId, f, open);
  const cur = currencyForMode(f.mode);
  const set = (p: Partial<RulesForm>) => setF((x) => ({ ...x, ...p }));
  const save = useAction(async () => {
    if (!rules) throw new Error('Fix the highlighted fields.');
    return room
      ? api.orgUpdateRoom(orgId, room.id, { name: f.name.trim(), rules, visibility: f.visibility })
      : api.orgCreateRoom(orgId, { name: f.name.trim(), table_id: f.table_id, mode: f.mode, house: f.house, rules, visibility: f.visibility });
  }, { invalidate: [['org', orgId, 'rooms']], success: (r) => `Room “${r.name}” saved.${r.invite_code ? ` Invite code ${r.invite_code}.` : ''}`, onSuccess: onClose });
  const serverOk = server.q.data?.ok;
  const submit = () => { setTouched(true); if (rules && serverOk !== false) save.mutate(undefined); };
  const err = (k: keyof RulesForm) => (touched || k !== 'name' && k !== 'table_id' ? errors[k] : undefined);
  const v = server.q.data;

  return (
    <Modal open={open} onClose={onClose} wide title={room ? `Edit ${room.name}` : 'Create room'}
      footer={<><Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button><Button size="sm" onClick={submit} disabled={save.isPending || serverOk === false}>{room ? 'Save changes' : 'Create room'}</Button></>}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-4">
          <Field label="Room name" error={err('name')}>{(p) => <TextInput {...p} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Friday High Rollers" autoFocus />}</Field>
          <Field label="Table" error={err('table_id')} hint={room ? 'A room stays on its table.' : 'The live table whose flops this room bets on.'}>
            {(p) => (
              <Select {...p} value={f.table_id} onChange={(e) => set({ table_id: e.target.value })} disabled={!!room}>
                <option value="">Choose a table…</option>
                {(lobby.data?.tables ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.club_name}{t.kind === 'simulated' ? ' (simulated)' : ''}</option>)}
                {room && !lobby.data?.tables.some((t) => t.id === room.table_id) && <option value={room.table_id}>{room.table_name}</option>}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency" hint={room ? 'Fixed after creation.' : undefined}>{(p) => (
              <Select {...p} value={f.mode} disabled={!!room} onChange={(e) => { const mode = e.target.value as RulesForm['mode']; set({ mode, min_stake: mode === 'diamonds' ? String(Math.max(GLOBAL.diamondMinStake, Number(f.min_stake) || 0)) : f.min_stake, rake_pct: f.rake_pct || (mode === 'diamonds' ? '5' : '') }); }}>
                <option value="diamonds">Diamonds ◆</option><option value="virtual-chips">Virtual chips</option>
              </Select>)}</Field>
            <Field label="House" hint={f.house === 'organizer' ? 'Your collateral pays winners.' : 'Players share the pool.'}>{(p) => (
              <Select {...p} value={f.house} disabled={!!room} onChange={(e) => set({ house: e.target.value as RulesForm['house'], rake_pct: f.rake_pct || (e.target.value === 'pool' ? '10' : '') })}>
                <option value="organizer">I am the house</option><option value="pool">Pool (no house)</option>
              </Select>)}</Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {usesMargin(f.house) && <Field label="Margin %" error={err('margin_pct')} hint={`Min ${GLOBAL.minMarginBps / 100}%`}>{(p) => <TextInput {...p} inputMode="decimal" value={f.margin_pct} onChange={(e) => set({ margin_pct: e.target.value })} />}</Field>}
            {usesRake(f.mode, f.house) && <Field label={f.house === 'pool' ? 'Pool rake %' : 'Organizer rake %'} error={err('rake_pct')} hint={f.house === 'pool' ? '5–20%' : f.mode === 'diamonds' ? '0–15%' : '3–15%'}>{(p) => <TextInput {...p} inputMode="decimal" value={f.rake_pct} onChange={(e) => set({ rake_pct: e.target.value })} />}</Field>}
            <Field label={`Minimum stake (${f.mode === 'diamonds' ? '◆' : 'chips'})`} error={err('min_stake')} hint={f.mode === 'diamonds' ? 'At least 20 ◆' : undefined}>{(p) => <TextInput {...p} inputMode="numeric" value={f.min_stake} onChange={(e) => set({ min_stake: e.target.value })} />}</Field>
            <Field label="Provider club share %" error={err('provider_share_pct')} hint="Optional; of your GGR or rake">{(p) => <TextInput {...p} inputMode="decimal" value={f.provider_share_pct} onChange={(e) => set({ provider_share_pct: e.target.value })} placeholder="0" />}</Field>
          </div>
          <Field label="Visibility" hint={f.visibility === 'invite' ? 'Players join with an invite code generated on save.' : 'Listed in the app for everyone.'}>{(p) => (
            <Select {...p} value={f.visibility} onChange={(e) => set({ visibility: e.target.value as RulesForm['visibility'] })}>
              <option value="public">Public</option><option value="invite">Invite only</option>
            </Select>)}</Field>
          {room?.visibility === 'invite' && room.invite_code && (
            <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-3 py-2 text-sm"><span className="text-muted">Invite code</span><code className="font-mono text-base tracking-widest text-accent">{room.invite_code}</code><span className="ml-auto"><CopyButton text={room.invite_code} /></span></div>
          )}
        </div>

        <aside className="space-y-3" aria-live="polite">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Global rules check</div>
          <Card className="space-y-3 bg-surface-2 p-4">
            {!looseRules(f) ? (
              <p className="text-sm text-muted">Enter numbers in the highlighted fields to check the rules.</p>
            ) : server.q.isError ? (
              <p className="text-sm text-muted">{isNotAvailable(server.q.error) ? 'Server validation is not available.' : errorMessage(server.q.error)}</p>
            ) : server.pending || !v ? (
              <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4" />Checking…</p>
            ) : (
              <>
                <div className={cx('flex items-center gap-2 text-sm font-semibold', v.ok ? 'text-accent' : 'text-danger')}>
                  {v.ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}{v.ok ? 'Within the global rules' : 'Not allowed'}
                </div>
                {v.problems.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-danger">{v.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                {v.organizer_ev !== undefined && (
                  <div><div className="text-[11px] text-faint">Guaranteed organizer EV</div><div className={cx('text-xl font-semibold tabular-nums', v.organizer_ev < 0.005 ? 'text-danger' : 'text-accent')}>{(v.organizer_ev * 100).toFixed(2)}%</div><div className="text-[11px] text-faint">of turnover, after PreFlop's fee and provider share (min 0.50%)</div></div>
                )}
                {v.fee_rate_bound !== undefined && (
                  <div><div className="text-[11px] text-faint">Fee-rate bound</div><div className="text-lg font-semibold tabular-nums">{(v.fee_rate_bound * 100).toFixed(2)}%</div><div className="text-[11px] text-faint">Worst-case PreFlop fee as a share of the smallest stake{f.mode === 'diamonds' ? ' (1 ◆ fixed fee)' : ''}</div></div>
                )}
                {f.house === 'pool' && v.ok && <p className="text-xs text-muted">Pools have no house: winners share stakes minus the {f.rake_pct}% rake.</p>}
              </>
            )}
          </Card>
          <p className="text-[11px] leading-snug text-faint">Minimum stake {f.min_stake && /^\d+$/.test(f.min_stake) ? formatMoney(Number(f.min_stake), cur) : '—'}. The server re-checks everything on save.</p>
        </aside>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Rooms() {
  const portal = usePortal();
  const orgId = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', orgId, 'rooms'], queryFn: () => api.orgRooms(orgId) });
  const [editing, setEditing] = useState<Room | null | 'new'>(null);
  const [statusTarget, setStatusTarget] = useState<{ room: Room; status: Room['status'] } | null>(null);
  const setStatus = useAction((x: { room: Room; status: Room['status'] }) => api.orgUpdateRoom(orgId, x.room.id, { status: x.status }), {
    invalidate: [['org', orgId, 'rooms']], success: (r) => `${r.name} is now ${r.status}.`, onSuccess: () => setStatusTarget(null),
  });

  return (
    <>
      <PageHeader eyebrow={portal.name} title="Rooms" subtitle={portal.kind === 'club' ? 'Chip and diamond rooms your club runs on its own or other tables.' : 'Your books on live tables, in diamonds or virtual chips, with your own rules inside the global bounds.'}
        actions={write && <Button size="sm" onClick={() => setEditing('new')}><Plus size={15} aria-hidden />Create room</Button>} />
      <QueryView q={q} what="rooms">
        {(d) => d.rooms.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-line-strong p-10 text-center">
            <div className="font-serif text-xl">No rooms yet</div>
            <p className="mt-1 text-sm text-muted">Create a room on any live table, set the margin and rake, then share it publicly or by invite code.</p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {d.rooms.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-serif text-xl">{r.name}</div>
                    <div className="text-sm text-muted">{r.table_name} · {MODE_LABEL[r.mode] ?? r.mode} · {r.house === 'organizer' ? 'You are the house' : 'Pool'}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    ['Margin', r.house === 'organizer' ? pctFromBps(r.rules.margin_bps) : '—'],
                    ['Rake', pctFromBps(r.rules.rake_bps)],
                    ['Min stake', formatMoney(r.rules.min_stake_minor, r.currency)],
                    ['Provider share', pctFromBps(r.rules.provider_share_bps)],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="rounded-[12px] bg-surface-2 px-3 py-2"><dt className="text-[11px] text-faint">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
                  ))}
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm">
                    {r.visibility === 'invite' ? <><Lock size={14} className="text-muted" aria-hidden />Invite code {r.invite_code ? <><code className="font-mono tracking-widest text-accent">{r.invite_code}</code><CopyButton text={r.invite_code} label="Copy" /></> : <span className="text-faint">pending</span>}</> : <><Globe size={14} className="text-muted" aria-hidden /><Badge tone="muted" className="!py-0.5">public</Badge></>}
                  </span>
                  {write && r.status !== 'closed' && (
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r)}><Pencil size={13} aria-hidden />Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatusTarget({ room: r, status: r.status === 'paused' ? 'active' : 'paused' })}>{r.status === 'paused' ? 'Resume' : 'Pause'}</Button>
                      <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setStatusTarget({ room: r, status: 'closed' })}>Close</Button>
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      <RoomEditor open={editing !== null} onClose={() => setEditing(null)} room={editing === 'new' ? null : editing} />
      <ConfirmDialog open={!!statusTarget} onClose={() => setStatusTarget(null)} busy={setStatus.isPending} danger={statusTarget?.status !== 'active'}
        title={`${statusTarget?.status === 'closed' ? 'Close' : statusTarget?.status === 'paused' ? 'Pause' : 'Resume'} ${statusTarget?.room.name}?`}
        confirmLabel={statusTarget?.status === 'closed' ? 'Close room' : statusTarget?.status === 'paused' ? 'Pause room' : 'Resume room'}
        typePhrase={statusTarget?.status === 'closed' ? 'CLOSE' : undefined}
        onConfirm={() => statusTarget && setStatus.mutate(statusTarget)}>
        {statusTarget?.status === 'closed' ? 'Closing is permanent. No new bets are accepted; open bets settle normally.' : statusTarget?.status === 'paused' ? 'No new bets until you resume. Open bets settle normally.' : 'Players can bet in this room again.'}
      </ConfirmDialog>
    </>
  );
}
