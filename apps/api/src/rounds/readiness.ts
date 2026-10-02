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
  kind: 'physical' | 'simulated';
  status: 'active' | 'paused' | 'retired';
  pause_reason: string | null;
  max_round_loss_minor: number;
  certification: Record<string, CertItem>;
  link: Omit<LinkSample, 'heartbeatAgeS'> | null;
  link_at: Date | null;
}

export async function physicalPlayEnabled(c: Db | Tx): Promise<boolean> {
  const r = await c.query<{ value: unknown }>("select value from settings where key = 'physical_play_enabled'");
  return r.rows[0]?.value === true;
}

/**
 * Whether betting may open at this table now: table active, physical play allowed for physical
 * tables (owner decision: OFF), every certification item valid, a fresh heartbeat with a healthy
 * link and the stream live.
 */
export async function tableReadiness(c: Db | Tx, t: TableRow, now = Date.now()): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (t.status !== 'active') problems.push(`table is ${t.status}${t.pause_reason ? `: ${t.pause_reason}` : ''}`);
  if (t.kind === 'physical' && !(await physicalPlayEnabled(c))) problems.push('physical-table play is disabled (owner decision, docs/06 #7)');
  if (!t.link || !t.link_at) problems.push('no heartbeat received');
  else {
    const sample: LinkSample = { ...t.link, heartbeatAgeS: Math.max(0, (now - t.link_at.getTime()) / 1000) };
    problems.push(...canOpenRound(certificationFrom(t.certification, now), sample).problems);
  }
  if (!t.link) problems.push(...canOpenRound(certificationFrom(t.certification, now), { uploadMbps: 1e9, rttMs: 0, jitterMs: 0, packetLossPct: 0, videoDelayMs: 0, heartbeatAgeS: 0, backupLinkUp: true, streamLive: true }).problems);
  return { ok: problems.length === 0, problems };
}
