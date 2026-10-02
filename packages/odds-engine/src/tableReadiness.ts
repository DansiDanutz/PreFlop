/**
 * Table certification and live readiness (docs/11-club-requirements.md).
 *
 * Every club table must:
 *  1. use an automatic shuffling machine that reports "shuffle complete" for each hand;
 *  2. have the dealer cut the deck before each hand, recorded as an event;
 *  3. stay online with a tested connection, so the video is never far behind the table.
 *
 * A round may only open when the table is certified and its live link is healthy,
 * and a hand's bets are only valid if its shuffle and cut were recorded before deal-start.
 */

export interface ConnectivityThresholds {
  readonly minUploadMbps: number;
  readonly maxRttMs: number;
  readonly maxJitterMs: number;
  readonly maxPacketLossPct: number;
  /** Max glass-to-glass video delay (camera → viewer) in ms. */
  readonly maxVideoDelayMs: number;
  /** Max seconds since the last heartbeat from the table device. */
  readonly maxHeartbeatAgeS: number;
  /** A backup connection (e.g. 4G/5G) is required. */
  readonly requireBackupLink: boolean;
}

export const CONNECTIVITY: ConnectivityThresholds = {
  minUploadMbps: 10, // 1080p stream + data with headroom
  maxRttMs: 150,
  maxJitterMs: 30,
  maxPacketLossPct: 1,
  maxVideoDelayMs: 3000,
  maxHeartbeatAgeS: 5,
  requireBackupLink: true,
};

export interface LinkSample {
  readonly uploadMbps: number;
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly packetLossPct: number;
  readonly videoDelayMs: number;
  readonly heartbeatAgeS: number;
  readonly backupLinkUp: boolean;
}

export type LinkStatus = 'healthy' | 'degraded' | 'down';

export interface LinkCheck {
  readonly status: LinkStatus;
  readonly problems: readonly string[];
}

/**
 * - healthy:  all thresholds met → betting may open.
 * - degraded: soft limits exceeded → no new rounds open; the round in progress may finish.
 * - down:     heartbeat lost or stream far behind → PAUSE now; an unverifiable round is VOID.
 */
export function checkLink(s: LinkSample, t: ConnectivityThresholds = CONNECTIVITY): LinkCheck {
  const problems: string[] = [];
  if (s.heartbeatAgeS > t.maxHeartbeatAgeS) problems.push(`no heartbeat for ${s.heartbeatAgeS}s`);
  if (s.videoDelayMs > 2 * t.maxVideoDelayMs) problems.push(`video ${s.videoDelayMs} ms behind`);
  const hard = problems.length > 0;
  if (s.uploadMbps < t.minUploadMbps) problems.push(`upload ${s.uploadMbps} Mbps < ${t.minUploadMbps}`);
  if (s.rttMs > t.maxRttMs) problems.push(`RTT ${s.rttMs} ms > ${t.maxRttMs}`);
  if (s.jitterMs > t.maxJitterMs) problems.push(`jitter ${s.jitterMs} ms > ${t.maxJitterMs}`);
  if (s.packetLossPct > t.maxPacketLossPct) problems.push(`packet loss ${s.packetLossPct}% > ${t.maxPacketLossPct}%`);
  if (!hard && s.videoDelayMs > t.maxVideoDelayMs) problems.push(`video delay ${s.videoDelayMs} ms > ${t.maxVideoDelayMs}`);
  if (t.requireBackupLink && !s.backupLinkUp) problems.push('backup link down');
  return { status: hard ? 'down' : problems.length ? 'degraded' : 'healthy', problems };
}

export interface TableCertification {
  /** Approved automatic shuffler model, registered serial and paired with the table device. */
  readonly shufflerPaired: boolean;
  /** A 30-minute connection soak test passed at onboarding (and after any network change). */
  readonly connectionTestPassed: boolean;
  /** Camera angles approved: flop area visible, no hole-card exposure. */
  readonly camerasApproved: boolean;
  /** Dealers trained on the PreFlop procedure (cut, deal-start, flop entry). */
  readonly dealersTrained: boolean;
}

export function certificationProblems(c: TableCertification): string[] {
  const p: string[] = [];
  if (!c.shufflerPaired) p.push('automatic shuffler not paired');
  if (!c.connectionTestPassed) p.push('connection test not passed');
  if (!c.camerasApproved) p.push('cameras not approved');
  if (!c.dealersTrained) p.push('dealers not trained');
  return p;
}

/** Whether betting on the next flop may open at this table right now. */
export function canOpenRound(cert: TableCertification, link: LinkSample): { ok: boolean; problems: string[] } {
  const problems = [...certificationProblems(cert), ...checkLink(link).problems];
  return { ok: problems.length === 0, problems };
}

/** Per-hand procedure events, in the order they must occur. */
export interface HandEvents {
  readonly shuffleCompleteAt?: number;
  /** Signal must come from the paired shuffler, not typed by staff. */
  readonly shuffleSource?: 'shuffler' | 'manual';
  readonly cutAt?: number;
  readonly dealStartAt?: number;
}

/**
 * A hand is valid for settlement only if the shuffler reported a completed
 * shuffle, the dealer then cut, and both happened before deal-start (the lock).
 * Otherwise every bet on that hand's flop is void and refunded.
 */
export function handProcedureProblems(e: HandEvents): string[] {
  const p: string[] = [];
  if (e.shuffleCompleteAt === undefined) p.push('no shuffle-complete signal');
  else if (e.shuffleSource !== 'shuffler') p.push('shuffle not reported by the automatic shuffler');
  if (e.cutAt === undefined) p.push('no cut recorded');
  if (e.dealStartAt === undefined) p.push('no deal-start');
  if (e.shuffleCompleteAt !== undefined && e.cutAt !== undefined && e.cutAt < e.shuffleCompleteAt) p.push('cut recorded before the shuffle completed');
  if (e.dealStartAt !== undefined && e.cutAt !== undefined && e.dealStartAt < e.cutAt) p.push('deal started before the cut');
  return p;
}
