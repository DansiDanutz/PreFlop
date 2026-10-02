import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlayMode } from '@preflop/client';
import { Button, cx } from '@preflop/ui';
import { ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { fmtDateTime, MODE_LABEL } from '../../lib/format.ts';
import { Callout, ConfirmDialog, PageHeader, QueryView, Section, TextArea, Toggle, useAction } from '../../components/ui.tsx';

const MODES: { mode: PlayMode; note: string }[] = [
  { mode: 'play', note: 'Free, resettable PLAY balance. No fees, no revenue.' },
  { mode: 'virtual-chips', note: 'Bought or gifted CHIP. Never cashed out.' },
  { mode: 'diamonds', note: 'Organizers buy and transfer ◆; fixed 1 ◆ fee per bet.' },
  { mode: 'real-fiat', note: 'EUR. Licensed territories only; KYC, limits, AML.' },
  { mode: 'real-crypto', note: 'USDT / USDC only. Licensed territories; Travel Rule.' },
];

/** Parses the territories editor; returns an error message or the value. */
export function parseTerritories(text: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Territories must be a JSON object, e.g. { "RO": { "modes": ["play"] } }.' };
    const bad = Object.keys(v).find((k) => !/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(k));
    if (bad) return { error: `“${bad}” is not an ISO 3166 country (or subdivision) code like "RO" or "GB-ENG".` };
    return { value: v as Record<string, unknown> };
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }
}

export function Settings() {
  const { me } = useAuth();
  const isAdmin = me?.platform_role === 'admin';
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: api.adminSettings });
  const save = useAction((a: { key: string; value: unknown }) => api.adminSetSetting(a.key, a.value), {
    invalidate: [['admin', 'settings'], ['modes']], success: (_, a) => `Saved ${a.key}.`,
  });
  const [confirmPhysical, setConfirmPhysical] = useState<boolean | null>(null);
  const [confirmReal, setConfirmReal] = useState<{ mode: PlayMode; next: Record<string, boolean> } | null>(null);
  const [terr, setTerr] = useState<string | null>(null);

  const get = (k: string) => q.data?.settings.find((s) => s.key === k);
  const terrServer = JSON.stringify(get('territories')?.value ?? {}, null, 2);
  useEffect(() => { if (q.data && terr === null) setTerr(terrServer); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const terrParsed = parseTerritories(terr ?? '{}');
  const meta = (k: string) => { const s = get(k); return s ? `Last changed ${fmtDateTime(s.updated_at)}${s.updated_by ? ` by ${s.updated_by}` : ''}` : ''; };

  return (
    <>
      <PageHeader eyebrow="Platform" title="Settings" subtitle="Platform-wide switches. Every change is audited." />
      {!isAdmin && <div className="mb-4"><Callout tone="info" title="Read-only">Only PreFlop admins can change settings.</Callout></div>}
      <QueryView q={q} what="settings">
        {() => {
          const modes = (get('modes_enabled')?.value ?? {}) as Record<string, boolean>;
          const physical = get('physical_play_enabled')?.value === true;
          return (
            <div className="grid gap-4 xl:grid-cols-2">
              <Section title="Play modes" subtitle={meta('modes_enabled')}>
                <ul className="divide-y divide-line/60">
                  {MODES.map(({ mode, note }) => {
                    const real = mode === 'real-fiat' || mode === 'real-crypto';
                    return (
                      <li key={mode} className="flex items-center gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{MODE_LABEL[mode]} <span className="font-mono text-[11px] text-faint">{mode}</span>{real && <span className="ml-2 text-[11px] font-semibold uppercase text-warn">licensed</span>}</div>
                          <div className="text-xs text-muted">{note}</div>
                        </div>
                        <Toggle checked={!!modes[mode]} label={`${MODE_LABEL[mode]} enabled`} disabled={!isAdmin || save.isPending}
                          onChange={(v) => {
                            const next = { ...modes, [mode]: v };
                            if (real && v) setConfirmReal({ mode, next });
                            else save.mutate({ key: 'modes_enabled', value: next });
                          }} />
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section title="Physical-table play" subtitle={meta('physical_play_enabled')} className={cx(physical && 'border-danger/60')}>
                <Callout tone="danger" icon={<ShieldAlert size={16} />} title="Owner decision: off until the Trusted Shuffler is certified">
                  Physical-table play stays <strong>disabled</strong> until the <strong>PreFlop Trusted Shuffler</strong> is laboratory-certified (docs/06 #7, docs/12 §2a). No defence exists at the table against a shuffler that controls the deck order; the random cut does not prevent it. While this is off, physical tables cannot open rounds and every live table is simulated.
                </Callout>
                <div className="mt-4 flex items-center justify-between gap-4 rounded-[14px] border border-line px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">Allow rounds on physical tables</div>
                    <div className={cx('text-xs', physical ? 'text-danger' : 'text-muted')}>{physical ? 'ENABLED — physical tables can open rounds' : 'Disabled (default)'}</div>
                  </div>
                  <Toggle danger checked={physical} label="Physical-table play enabled" disabled={!isAdmin || save.isPending} onChange={(v) => setConfirmPhysical(v)} />
                </div>
              </Section>

              <Section title="Territories" subtitle={meta('territories') || 'Per-territory mode availability and limits (JSON).'} className="xl:col-span-2"
                actions={<>
                  <Button size="sm" variant="ghost" onClick={() => setTerr(terrServer)} disabled={terr === terrServer}>Revert</Button>
                  <Button size="sm" disabled={!isAdmin || !!terrParsed.error || terr === terrServer || save.isPending} onClick={() => save.mutate({ key: 'territories', value: terrParsed.value })}>Save territories</Button>
                </>}>
                <label htmlFor="territories" className="sr-only">Territories JSON</label>
                <TextArea id="territories" spellCheck={false} rows={12} value={terr ?? ''} onChange={(e) => setTerr(e.target.value)} readOnly={!isAdmin}
                  aria-invalid={!!terrParsed.error} aria-describedby="territories-msg" className="min-h-56" />
                <p id="territories-msg" className={cx('mt-2 text-xs', terrParsed.error ? 'text-danger' : 'text-faint')}>
                  {terrParsed.error ?? `Valid JSON · ${Object.keys(terrParsed.value ?? {}).length} territories${terr !== terrServer ? ' · unsaved changes' : ''}`}
                </p>
              </Section>
            </div>
          );
        }}
      </QueryView>

      <ConfirmDialog open={confirmPhysical !== null} onClose={() => setConfirmPhysical(null)} busy={save.isPending} danger={confirmPhysical === true}
        title={confirmPhysical ? 'Enable physical-table play?' : 'Disable physical-table play?'}
        confirmLabel={confirmPhysical ? 'Enable physical play' : 'Disable physical play'}
        typePhrase={confirmPhysical ? 'ENABLE PHYSICAL PLAY' : undefined}
        onConfirm={() => { save.mutate({ key: 'physical_play_enabled', value: confirmPhysical }); setConfirmPhysical(null); }}>
        {confirmPhysical
          ? <>This reverses the <strong>owner decision</strong>. Only proceed if the PreFlop Trusted Shuffler has been laboratory-certified and the owner has signed off. Certified physical tables will start opening rounds with real players' stakes on them.</>
          : 'Physical tables stop opening new rounds. Rounds in progress finish or are voided and refunded.'}
      </ConfirmDialog>
      <ConfirmDialog open={!!confirmReal} onClose={() => setConfirmReal(null)} busy={save.isPending} title={`Enable ${confirmReal ? MODE_LABEL[confirmReal.mode] : ''}?`} confirmLabel="Enable" typePhrase="REAL MONEY"
        onConfirm={() => { if (confirmReal) save.mutate({ key: 'modes_enabled', value: confirmReal.next }); setConfirmReal(null); }}>
        Real-money modes need a licence in every territory where they are offered, plus KYC, responsible-gaming limits and AML. This environment is a <strong>sandbox</strong>.
      </ConfirmDialog>
    </>
  );
}
