import { type LinkSample, type TableCertification, canOpenRound } from '@preflop/odds-engine';
import type { Db, Tx } from '../lib/db.ts';

export const CERT_FLAGS: readonly (keyof TableCertification)[] = [
  'shufflerPaired', 'connectionTestPassed', 'camerasApproved', 'dealersTrained', 'shufflerSealsVerifiedThisShift',
  'boardCameraCalibrated', 'tableBoxAttested', 'upsOk', 'privacyMasksVerified',
];

export type CertItem = { ok: boolean; by?: string; at?: string; expires_at?: string };

/** An item that is missing, false or past expires_at counts as NOT certified (docs/13 §3). */
export function certificationFrom(json: Record<string, CertItem | undefined>, now = Date.now()): TableCertification {
  const ok = (k: string) => {
    const it = json[k];
    return !!it?.ok && (!it.expires_at || Date.parse(it.expires_at) > now);
  };
  return Object.fromEntries(CERT_FLAGS.map((k) => [k, ok(k)])) as unknown as TableCertification;
}

export interface TableRow {
  id: string;
  club_id: string;
  name: string;
  mode: string;
  currency: string;
  kind: 'physical' | 'simulated' | 'manual';
  status: 'active' | 'paused' | 'retired';
  pause_reason: string | null;
  /** Machine-readable cause of a pause (migration 014): monitor | evidence | floor | platform; null while active. */
  pause_kind: 'monitor' | 'evidence' | 'floor' | 'platform' | null;
  max_round_loss_minor: number;
  max_user_round_payout_minor: number | null;
  /** Set by the PreFlop team; real-money bets need it (migration 012). */
  real_money_approved_at: Date | null;
  real_money_approved_by: string | null;
  certification: Record<string, CertItem>;
  link: Omit<LinkSample, 'heartbeatAgeS'> | null;
  link_at: Date | null;
}

export async function physicalPlayEnabled(c: Db | Tx): Promise<boolean> {
  const r = await c.query<{ value: unknown }>("select value from settings where key = 'physical_play_enabled'");
  return r.rows[0]?.value === true;
}

export async function manualTablesEnabled(c: Db | Tx): Promise<boolean> {
  const r = await c.query<{ value: unknown }>("select value from settings where key = 'manual_tables_enabled'");
  return r.rows[0]?.value === true;
}

/** Manual tables take play money and free chips only (migration 020). */
export const MANUAL_MODES: readonly string[] = ['play', 'virtual-chips'];

/**
 * Whether betting may open at this table now: table active, physical play allowed for physical
 * tables (owner decision: OFF), every certification item valid, a fresh heartbeat with a healthy
 * link and the stream live.
 */
export async function tableReadiness(c: Db | Tx, t: TableRow, now = Date.now()): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (t.status !== 'active') problems.push(`table is ${t.status}${t.pause_reason ? `: ${t.pause_reason}` : ''}`);
  // A suspended club's tables are not ready, whatever their own state (docs/13 §10).
  const club = (await c.query<{ status: string }>('select status from organizations where id = $1', [t.club_id])).rows[0];
  if (club && club.status !== 'active') problems.push(`club is ${club.status}`);
  // A manual table has no Table Box, stream or shuffler: the PreFlop team types each flop after
  // betting closes. Its own switch, free play only.
  if (t.kind === 'manual') {
    if (!(await manualTablesEnabled(c))) problems.push('manual tables are switched off (setting manual_tables_enabled)');
    if (!MANUAL_MODES.includes(t.mode)) problems.push('a manual table takes play money or free chips only');
    return { ok: problems.length === 0, problems };
  }
  if (t.kind === 'physical' && !(await physicalPlayEnabled(c))) problems.push('physical-table play is disabled (owner decision, docs/06 #7)');
  if (!t.link || !t.link_at) problems.push('no heartbeat received');
  else {
    const sample: LinkSample = { ...t.link, heartbeatAgeS: Math.max(0, (now - t.link_at.getTime()) / 1000) };
    problems.push(...canOpenRound(certificationFrom(t.certification, now), sample).problems);
  }
  if (!t.link) problems.push(...canOpenRound(certificationFrom(t.certification, now), { uploadMbps: 1e9, rttMs: 0, jitterMs: 0, packetLossPct: 0, videoDelayMs: 0, heartbeatAgeS: 0, backupLinkUp: true, streamLive: true }).problems);
  return { ok: problems.length === 0, problems };
}
