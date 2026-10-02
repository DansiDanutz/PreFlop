import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiClient, Webhook } from '@preflop/client';
import { Button, cx, formatOdds } from '@preflop/ui';
import { Download, ExternalLink, Plus, Send } from 'lucide-react';
import { api, API_URL, WEB_URL } from '../../lib/api.ts';
import { downloadText, minorToDecimal, toCsv } from '../../lib/csv.ts';
import { fmtDateTime, relTime } from '../../lib/format.ts';
import { isHttpsUrl } from '../../lib/rules.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { FlopText, Money, StatusBadge } from '../../components/domain.tsx';
import { useCanWrite, useOrgId, usePortal } from '../../components/Shell.tsx';
import { Callout, CodeBlock, ConfirmDialog, CopyButton, Field, Mono, Modal, PageHeader, QueryView, Section, SecretOnce, Select, TextInput, useAction } from '../../components/ui.tsx';

export { Docs } from './Docs.tsx';

// ------------------------------------------------------------------ API keys

export function Keys() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'clients'], queryFn: () => api.partnerClients(id) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<ApiClient | null>(null);
  const [revoke, setRevoke] = useState<ApiClient | null>(null);
  const nameErr = !name.trim() ? 'Name the key after where it is used, e.g. “production backend”.' : null;
  const create = useAction(() => api.partnerCreateClient(id, name.trim()), { invalidate: [['org', id, 'clients']], onSuccess: (c) => { setCreated(c); setName(''); setTouched(false); } });
  const doRevoke = useAction((c: ApiClient) => api.partnerRevokeClient(id, c.id), { invalidate: [['org', id, 'clients']], success: (_, c) => `${c.name} revoked.`, onSuccess: () => setRevoke(null) });
  const close = () => { setCreating(false); setCreated(null); };
  return (
    <>
      <PageHeader eyebrow={portal.name} title="API keys" subtitle="OAuth2 client credentials for the Partner API. Exchange the client id and secret for a one-hour access token at POST /v1/partner/oauth/token."
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Create key</Button>} />
      <Section>
        <QueryView q={q} what="API keys">
          {(d) => (
            <DataTable rows={d.clients} rowKey={(c) => c.id} caption="API clients" initialSort={{ key: 'created', dir: 'desc' }} empty="No API keys yet."
              rowClassName={(c) => (c.revoked ? 'opacity-55' : undefined)}
              columns={[
                { key: 'name', header: 'Name', sort: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
                { key: 'id', header: 'Client ID', cell: (c) => <span className="inline-flex items-center gap-2"><Mono>{c.id}</Mono><CopyButton text={c.id} label="Copy" /></span> },
                { key: 'created', header: 'Created', sort: (c) => c.created_at, cell: (c) => <span className="text-xs text-muted">{fmtDateTime(c.created_at)}</span> },
                { key: 'status', header: 'Status', sort: (c) => String(c.revoked), cell: (c) => <StatusBadge status={c.revoked ? 'revoked' : 'active'} /> },
                { key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (c) => !c.revoked && write ? <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setRevoke(c)}>Revoke</Button> : null },
              ]} />
          )}
        </QueryView>
      </Section>
      <Modal open={creating} onClose={close} title={created ? 'Key created' : 'Create API key'}
        footer={created ? <Button size="sm" onClick={close}>I have stored the secret</Button> : <><Button size="sm" variant="secondary" onClick={close}>Cancel</Button><Button size="sm" disabled={create.isPending} onClick={() => { setTouched(true); if (!nameErr) create.mutate(undefined); }}>Create key</Button></>}>
        {created ? (
          <div className="space-y-4">
            <div className="text-sm"><span className="text-muted">Client ID</span> <Mono>{created.id}</Mono></div>
            {created.secret ? <SecretOnce label="Client secret" secret={created.secret} /> : <Callout tone="warn">The API did not return a secret. Revoke this key and try again.</Callout>}
          </div>
        ) : (
          <form noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!nameErr) create.mutate(undefined); }}>
            <Field label="Key name" error={touched ? nameErr : null}>{(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="production backend" />}</Field>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(null)} busy={doRevoke.isPending} title={`Revoke ${revoke?.name}?`} confirmLabel="Revoke key" typePhrase="REVOKE"
        onConfirm={() => revoke && doRevoke.mutate(revoke)}>
        Tokens issued with this key stop working at once. Any integration still using it will fail to place bets.
      </ConfirmDialog>
    </>
  );
}

// ------------------------------------------------------------------ webhooks

export const WEBHOOK_EVENTS = ['bet.settled', 'bet.voided', 'round.voided', 'event.finished', 'fee.statement.ready'] as const;

export function Webhooks() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'webhooks'], queryFn: () => api.partnerWebhooks(id), refetchInterval: 10_000 });
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENTS]);
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<Webhook | null>(null);
  const [del, setDel] = useState<Webhook | null>(null);
  const [hookFilter, setHookFilter] = useState('');
  const errs = { url: !isHttpsUrl(url) ? 'Use an https:// URL (http is allowed only for localhost).' : null, events: events.length === 0 ? 'Pick at least one event.' : null };
  const create = useAction(() => api.partnerCreateWebhook(id, { url: url.trim(), events }), { invalidate: [['org', id, 'webhooks']], onSuccess: (h) => { setCreated(h); setUrl(''); setTouched(false); } });
  const test = useAction((h: Webhook) => api.partnerTestWebhook(id, h.id), { invalidate: [['org', id, 'webhooks']], success: (d) => `Test delivery ${d.status}${d.last_error ? `: ${d.last_error}` : ''}.` });
  const remove = useAction((h: Webhook) => api.partnerDeleteWebhook(id, h.id), { invalidate: [['org', id, 'webhooks']], success: 'Webhook deleted.', onSuccess: () => setDel(null) });
  const close = () => { setCreating(false); setCreated(null); setEvents([...WEBHOOK_EVENTS]); };
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Webhooks" subtitle="Every delivery carries X-PreFlop-Signature (HMAC-SHA256 over timestamp and body), is retried with backoff for 24 h, and must be deduplicated by event_id."
        actions={write && <Button size="sm" onClick={() => setCreating(true)}><Plus size={15} aria-hidden />Add endpoint</Button>} />
      <QueryView q={q} what="webhooks">
        {(d) => (
          <div className="space-y-4">
            <Section title="Endpoints">
              <DataTable rows={d.webhooks} rowKey={(h) => h.id} caption="Webhook endpoints" empty="No endpoints. Add one to receive settlement events."
                columns={[
                  { key: 'url', header: 'URL', sort: (h) => h.url, cell: (h) => <Mono className="break-all">{h.url}</Mono> },
                  { key: 'events', header: 'Events', cell: (h) => <div className="flex flex-wrap gap-1">{h.events.map((e) => <span key={e} className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[11px]">{e}</span>)}</div> },
                  { key: 'status', header: 'Status', cell: (h) => <StatusBadge status={h.active ? 'active' : 'paused'} /> },
                  { key: 'created', header: 'Created', sort: (h) => h.created_at, cell: (h) => <span className="text-xs text-muted">{relTime(h.created_at)}</span> },
                  {
                    key: 'act', header: <span className="sr-only">Actions</span>, align: 'right', cell: (h) => write ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => test.mutate(h)}><Send size={13} aria-hidden />Test</Button>
                        <Button size="sm" variant="ghost" className="!text-danger" onClick={() => setDel(h)}>Delete</Button>
                      </div>
                    ) : null,
                  },
                ]} />
            </Section>
            <Section title="Delivery log" actions={d.webhooks.length > 1 && (
              <Select aria-label="Filter deliveries by endpoint" className="!h-9 w-64 text-xs" value={hookFilter} onChange={(e) => setHookFilter(e.target.value)}>
                <option value="">All endpoints</option>{d.webhooks.map((h) => <option key={h.id} value={h.id}>{h.url}</option>)}
              </Select>
            )}>
              <DataTable rows={d.deliveries.filter((x) => !hookFilter || x.webhook_id === hookFilter)} rowKey={(x) => x.id} dense caption="Webhook deliveries" initialSort={{ key: 'at', dir: 'desc' }} empty="No deliveries yet. Use Test to send one."
                columns={[
                  { key: 'event', header: 'Event', sort: (x) => x.event_type, cell: (x) => <Mono>{x.event_type}</Mono> },
                  { key: 'status', header: 'Status', sort: (x) => x.status, cell: (x) => <StatusBadge status={x.status} /> },
                  { key: 'attempts', header: 'Attempts', align: 'right', sort: (x) => x.attempts, cell: (x) => x.attempts },
                  { key: 'err', header: 'Last error', cell: (x) => x.last_error ? <span className="text-xs text-danger">{x.last_error}</span> : <span className="text-faint">—</span> },
                  { key: 'at', header: 'Created', sort: (x) => x.created_at, cell: (x) => <span className="text-xs text-muted">{fmtDateTime(x.created_at)}</span> },
                  { key: 'id', header: 'Delivery', cell: (x) => <Mono className="text-faint">{x.id}</Mono> },
                ]} />
            </Section>
          </div>
        )}
      </QueryView>
      <Modal open={creating} onClose={close} title={created ? 'Endpoint added' : 'Add webhook endpoint'}
        footer={created ? <Button size="sm" onClick={close}>I have stored the secret</Button> : <><Button size="sm" variant="secondary" onClick={close}>Cancel</Button><Button size="sm" disabled={create.isPending} onClick={() => { setTouched(true); if (!errs.url && !errs.events) create.mutate(undefined); }}>Add endpoint</Button></>}>
        {created ? (
          created.secret ? <SecretOnce label="Signing secret (HMAC-SHA256)" secret={created.secret} /> : <Callout tone="warn">The API did not return a signing secret for this endpoint.</Callout>
        ) : (
          <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!errs.url && !errs.events) create.mutate(undefined); }}>
            <Field label="Endpoint URL" error={touched ? errs.url : null}>{(p) => <TextInput {...p} autoFocus type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourbook.com/preflop/webhooks" />}</Field>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-muted">Events</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {WEBHOOK_EVENTS.map((e) => (
                  <label key={e} className={cx('flex items-center gap-2 rounded-[10px] border px-3 py-2 text-sm', events.includes(e) ? 'border-accent/60 bg-accent-soft' : 'border-line')}>
                    <input type="checkbox" className="accent-[var(--color-accent)]" checked={events.includes(e)} onChange={(x) => setEvents((s) => (x.target.checked ? [...s, e] : s.filter((y) => y !== e)))} />
                    <span className="font-mono text-[13px]">{e}</span>
                  </label>
                ))}
              </div>
              {touched && errs.events && <p className="mt-1.5 text-xs text-danger">{errs.events}</p>}
            </fieldset>
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} busy={remove.isPending} title="Delete this endpoint?" confirmLabel="Delete endpoint" onConfirm={() => del && remove.mutate(del)}>
        <Mono>{del?.url}</Mono> stops receiving events. Pending retries are dropped.
      </ConfirmDialog>
    </>
  );
}

// ------------------------------------------------------------------ widget

const DEFAULT_PRESETS = '50, 100, 250';

export function Widget() {
  const portal = usePortal();
  const id = useOrgId();
  const write = useCanWrite();
  const q = useQuery({ queryKey: ['org', id, 'widget'], queryFn: () => api.partnerWidget(id) });
  const lobby = useQuery({ queryKey: ['lobby'], queryFn: api.lobby, staleTime: 60_000 });
  const book = useQuery({ queryKey: ['book', 'partner'], queryFn: () => api.book('partner'), staleTime: 5 * 60_000 });
  const [accent, setAccent] = useState('#1fd38b');
  const [table, setTable] = useState('');
  const [markets, setMarkets] = useState<string[]>([]);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!q.data || loaded) return;
    const s = q.data.settings;
    if (typeof s.accent === 'string') setAccent(s.accent);
    if (typeof s.default_table_id === 'string') setTable(s.default_table_id);
    if (Array.isArray(s.markets)) setMarkets(s.markets.filter((x): x is string => typeof x === 'string'));
    if (Array.isArray(s.stake_presets)) setPresets(s.stake_presets.join(', '));
    setLoaded(true);
  }, [q.data, loaded]);
  const tableId = table || lobby.data?.tables[0]?.id || '';
  const presetList = presets.split(',').map((x) => x.trim()).filter(Boolean);
  const errs = {
    accent: !/^#[0-9a-fA-F]{6}$/.test(accent) ? 'Use a 6-digit hex colour like #1fd38b.' : null,
    presets: presetList.length < 1 || presetList.length > 5 || presetList.some((x) => !/^\d+$/.test(x) || Number(x) < 1) ? 'Enter 1–5 positive whole stakes, comma-separated.' : null,
  };
  const save = useAction(() => api.partnerSaveWidget(id, { accent, default_table_id: table || null, markets, stake_presets: presetList.map(Number) }), {
    invalidate: [['org', id, 'widget']], success: 'Widget settings saved.',
  });
  const previewUrl = useMemo(() => `${WEB_URL}/embed/table/${encodeURIComponent(tableId)}?accent=${encodeURIComponent(accent)}${markets.length ? `&markets=${encodeURIComponent(markets.join(','))}` : ''}&stakes=${encodeURIComponent(presetList.join(','))}`, [tableId, accent, markets, presetList.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const offered = book.data?.markets.filter((m) => m.first_release) ?? [];

  return (
    <>
      <PageHeader eyebrow={portal.name} title="Widget" subtitle="The fastest integration: an embeddable lobby, video, bet slip and history, themed to your brand. Money moves through your wallet." />
      <QueryView q={q} what="widget settings">
        {(d) => (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
            <div className="space-y-4">
              <Section title="Theme & defaults">
                <form noValidate className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!errs.accent && !errs.presets) save.mutate(undefined); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Accent colour" error={errs.accent}>{(p) => (
                      <div className="flex gap-2"><input type="color" aria-label="Pick accent colour" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#1fd38b'} onChange={(e) => setAccent(e.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-[10px] border border-line-strong bg-surface-2" disabled={!write} /><TextInput {...p} value={accent} onChange={(e) => setAccent(e.target.value)} disabled={!write} /></div>
                    )}</Field>
                    <Field label="Default table">{(p) => (
                      <Select {...p} value={table} onChange={(e) => setTable(e.target.value)} disabled={!write}>
                        <option value="">First available</option>
                        {lobby.data?.tables.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.club_name}</option>)}
                      </Select>
                    )}</Field>
                  </div>
                  <Field label="Stake presets" error={errs.presets} hint="Shown as pills in the bet slip, in your currency's whole units.">{(p) => <TextInput {...p} value={presets} onChange={(e) => setPresets(e.target.value)} disabled={!write} />}</Field>
                  <fieldset>
                    <legend className="mb-2 text-[13px] font-medium text-muted">Markets <span className="text-faint">({markets.length ? `${markets.length} selected` : 'all first-release markets'})</span></legend>
                    <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                      {offered.map((m) => (
                        <label key={m.id} className={cx('flex items-start gap-2 rounded-[10px] border px-3 py-2 text-sm', markets.includes(m.id) ? 'border-accent/60 bg-accent-soft' : 'border-line')}>
                          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" disabled={!write} checked={markets.includes(m.id)} onChange={(x) => setMarkets((s) => (x.target.checked ? [...s, m.id] : s.filter((y) => y !== m.id)))} />
                          <span><span className="block">{m.name}</span><span className="text-[11px] text-faint">{m.selections.filter((s) => s.offered).slice(0, 3).map((s) => `${s.label} ${formatOdds(s.odds_centi)}`).join(' · ')}</span></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div><Button type="submit" disabled={!write || save.isPending || !!errs.accent || !!errs.presets}>Save widget settings</Button></div>
                </form>
              </Section>
              <Section title="Embed snippet" subtitle="Generated by the API for your saved settings. Create the player session server-side; never expose your client secret in the browser.">
                <CodeBlock lang="html" code={d.snippet} />
              </Section>
            </div>
            <Section title="Live preview" actions={<a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Open <ExternalLink size={12} aria-hidden /></a>}>
              <div className="overflow-hidden rounded-[18px] border border-line bg-bg">
                {tableId ? <iframe key={previewUrl} src={previewUrl} title="Widget preview" className="h-[720px] w-full border-0" /> : <div className="grid h-[400px] place-items-center text-sm text-muted">No tables in the lobby.</div>}
              </div>
              <p className="mt-2 text-xs text-faint">Preview served by the PreFlop web app at {WEB_URL}. If it is not running, the frame stays blank.</p>
            </Section>
          </div>
        )}
      </QueryView>
    </>
  );
}

// ------------------------------------------------------------------ bets report

export function Bets() {
  const portal = usePortal();
  const id = useOrgId();
  const [limit, setLimit] = useState(500);
  const q = useQuery({ queryKey: ['org', id, 'bets', limit], queryFn: () => api.partnerBets(id, { limit }), refetchInterval: 15_000 });
  const [status, setStatus] = useState('');
  const rows = (q.data?.bets ?? []).filter((b) => !status || b.status === status);
  const exportCsv = () => downloadText(`${portal.name.replace(/\W+/g, '-').toLowerCase()}-bets.csv`, toCsv(rows, [
    { header: 'bet_id', value: (b) => b.bet_id }, { header: 'player_ref', value: (b) => b.player_ref }, { header: 'placed_at', value: (b) => b.placed_at },
    { header: 'table', value: (b) => b.table_name }, { header: 'hand_no', value: (b) => b.hand_no }, { header: 'round_id', value: (b) => b.round_id },
    { header: 'selection_id', value: (b) => b.selection_id }, { header: 'currency', value: (b) => b.currency },
    { header: 'stake', value: (b) => minorToDecimal(b.stake_minor, b.currency) }, { header: 'odds', value: (b) => (b.odds_centi / 100).toFixed(2) },
    { header: 'payout', value: (b) => (b.payout_minor === null ? '' : minorToDecimal(b.payout_minor, b.currency)) }, { header: 'status', value: (b) => b.status },
    { header: 'flop', value: (b) => b.flop?.join(' ') ?? '' }, { header: 'settled_at', value: (b) => b.settled_at ?? '' },
  ]));
  return (
    <>
      <PageHeader eyebrow={portal.name} title="Bets report" subtitle="Every bet your players placed through the API or widget. Reconcile against your wallet with the CSV."
        actions={<Button size="sm" variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download size={14} aria-hidden />Export CSV ({rows.length})</Button>} />
      <Section>
        <div className="mb-4 flex flex-wrap gap-3">
          <Field label="Status" className="w-44">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['accepted', 'won', 'lost', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
          <Field label="Load" className="w-36">{(p) => <Select {...p} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[100, 500, 2000].map((n) => <option key={n} value={n}>Last {n}</option>)}</Select>}</Field>
        </div>
        <QueryView q={q} what="bets">
          {() => (
            <DataTable rows={rows} rowKey={(b) => b.bet_id} dense caption="Partner bets" initialSort={{ key: 'at', dir: 'desc' }} empty="No bets yet."
              columns={[
                { key: 'at', header: 'Placed', sort: (b) => b.placed_at, cell: (b) => <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(b.placed_at)}</span> },
                { key: 'player', header: 'Player ref', sort: (b) => b.player_ref, cell: (b) => <Mono>{b.player_ref}</Mono> },
                { key: 'table', header: 'Table · hand', sort: (b) => b.table_name, cell: (b) => <span>{b.table_name} <span className="text-muted">#{b.hand_no}</span></span> },
                { key: 'sel', header: 'Selection', sort: (b) => b.selection_id, cell: (b) => <Mono>{b.selection_id}</Mono> },
                { key: 'stake', header: 'Stake', align: 'right', sort: (b) => b.stake_minor, cell: (b) => <Money minor={b.stake_minor} currency={b.currency} /> },
                { key: 'odds', header: 'Odds', align: 'right', sort: (b) => b.odds_centi, cell: (b) => formatOdds(b.odds_centi) },
                { key: 'payout', header: 'Payout', align: 'right', sort: (b) => b.payout_minor, cell: (b) => <Money minor={b.payout_minor} currency={b.currency} /> },
                { key: 'flop', header: 'Flop', cell: (b) => <FlopText cards={b.flop} /> },
                { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
              ]} />
          )}
        </QueryView>
      </Section>
    </>
  );
}

export const PARTNER_API_URL = API_URL;
