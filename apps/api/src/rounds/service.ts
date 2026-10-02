import { createPublicKey, randomBytes, verify } from 'node:crypto';
import {
  type FlopCapture, type HandEvents, type PlayMode, type SignedCapture,
  captureAdmissionProblems, captureHash, drawCutDepth, flopFromCards, flopIndex, getSelection, handProcedureProblems,
  parseCard, settle, settleParimutuel, sha256Hex, verifyCaptureAuthenticity, verifyCaptureContent,
} from '@preflop/odds-engine';
import type { Principal } from '../auth/envelope.ts';
import { audit } from '../lib/audit.ts';
import type { Tx } from '../lib/db.ts';
import { ApiError, conflict, notFound, unprocessable } from '../lib/errors.ts';
import type { EventBatch } from '../lib/events.ts';
import { acct, post, reverse, walletPurpose } from '../lib/ledger.ts';
import { updateMonitor } from './monitor.ts';
import { type TableRow, tableReadiness } from './readiness.ts';

/**
 * The round state machine (docs/13 §4).
 *
 * Every function here runs inside ONE transaction that starts by row-locking the round
 * (`select … for update`). Lock order everywhere: one round → device → wallets (ascending id).
 * Money moves only after the caller wins the terminal compare-and-set on the round's state.
 */

export type RoundState = 'OPEN' | 'LOCKED' | 'DEALT' | 'REVIEW' | 'EVIDENCE_REJECTED' | 'SETTLED' | 'VOID';
export type Step = 'open' | 'locked' | 'shuffle_commanded' | 'shuffled' | 'cut_instructed' | 'cut' | 'dealing';

export interface RoundRow {
  id: string;
  table_id: string;
  hand_no: number;
  mode: PlayMode;
  currency: string;
  channel: string;
  state: RoundState;
  procedure_step: Step;
  opened_at: Date;
  locked_at: Date | null;
  shuffle_command_nonce: string | null;
  shuffle_source: string | null;
  shuffle_attested_nonce: string | null;
  cut_depth: number | null;
  deal_start_at: Date | null;
  review_started_at: Date | null;
  flop: string[] | null;
}

export interface Timing {
  resultSlaMs: number;
  reviewSlaMs: number;
  maxCaptureDelayMs: number;
}

export const roundId = (tableId: string, handNo: number) => `${tableId}:h${handNo}`;
const VOIDABLE: RoundState[] = ['OPEN', 'LOCKED', 'DEALT', 'REVIEW', 'EVIDENCE_REJECTED'];

export async function lockRound(c: Tx, id: string): Promise<RoundRow> {
  const r = (await c.query<RoundRow>('select * from rounds where id = $1 for update', [id])).rows[0];
  if (!r) throw notFound('round');
  return r;
}

export async function getTable(c: Tx, tableId: string): Promise<TableRow> {
  const t = (await c.query<TableRow>('select * from poker_tables where id = $1', [tableId])).rows[0];
  if (!t) throw notFound('table');
  return t;
}

async function nextOrd(c: Tx, rid: string): Promise<number> {
  return (await c.query<{ n: number }>('select coalesce(max(ord), 0) + 1 as n from round_events where round_id = $1', [rid])).rows[0]!.n;
}

async function event(c: Tx, rid: string, step: string, credentialId: string | null): Promise<void> {
  await c.query('insert into round_events (round_id, ord, step, credential_id) values ($1, $2, $3, $4)', [rid, await nextOrd(c, rid), step, credentialId]);
}

export async function enqueue(c: Tx, kind: 'resolve_round' | 'void_round' | 'void_paused', ref: string): Promise<void> {
  await c.query('insert into outbox (kind, ref) values ($1, $2) on conflict do nothing', [kind, ref]);
}

export async function alert(c: Tx, a: { tableId?: string; roundId?: string; kind: string; severity?: 'info' | 'warning' | 'critical'; details?: Record<string, unknown> }): Promise<void> {
  await c.query('insert into alerts (table_id, round_id, kind, severity, details) values ($1, $2, $3, $4, $5)',
    [a.tableId ?? null, a.roundId ?? null, a.kind, a.severity ?? 'warning', JSON.stringify(a.details ?? {})]);
}

function requireStep(r: RoundRow, expected: Step): void {
  if (r.state !== 'LOCKED' || r.procedure_step !== expected)
    throw conflict('invalid_procedure_step', `expected step ${expected} on a LOCKED round, round is ${r.state}/${r.procedure_step}`);
}

// ---------------------------------------------------------------- opening

/**
 * Opens betting on the next hand if the table is ready and no hand is in progress. Safe to call
 * concurrently: the partial unique index allows one OPEN round per table.
 * Returns the opened round id, or null (not ready / already open / hand in progress).
 */
export async function ensureOpenRound(c: Tx, tableId: string, ev: EventBatch): Promise<string | null> {
  const t = await getTable(c, tableId);
  const latest = (await c.query<{ hand_no: number; state: RoundState }>(
    'select hand_no, state from rounds where table_id = $1 order by hand_no desc limit 1', [tableId])).rows[0];
  if (latest && (latest.state === 'OPEN' || latest.state === 'LOCKED')) return null;
  if (!(await tableReadiness(c, t)).ok) return null;
  const handNo = (latest?.hand_no ?? 0) + 1;
  const id = roundId(tableId, handNo);
  const ins = await c.query(
    `insert into rounds (id, table_id, hand_no, mode, currency, channel, state) values ($1, $2, $3, $4, $5, 'direct', 'OPEN')
     on conflict do nothing`, [id, tableId, handNo, t.mode, t.currency]);
  if (ins.rowCount !== 1) return null;
  await audit(c, { type: 'round.opened', roundId: id, tableId, handNo });
  ev.push({ type: 'round.opened', tableId, roundId: id, data: { handNo, mode: t.mode, currency: t.currency } });
  return id;
}

// ---------------------------------------------------------------- procedure

/** Start hand: OPEN → LOCKED, issues the single-use shuffle command nonce. */
export async function startHand(c: Tx, r: RoundRow, p: Principal, ev: EventBatch): Promise<{ shuffle_command: { nonce: string } }> {
  if (r.state !== 'OPEN') throw conflict('invalid_round_state', `round is ${r.state}`);
  const t = await getTable(c, r.table_id);
  if (t.status !== 'active') throw conflict('table_not_ready', `table is ${t.status}${t.pause_reason ? `: ${t.pause_reason}` : ''}`);
  const nonce = randomBytes(16).toString('base64url');
  await c.query(
    `update rounds set state = 'LOCKED', locked_at = clock_timestamp(), procedure_step = 'shuffle_commanded',
            shuffle_command_nonce = $2, shuffle_command_at = clock_timestamp() where id = $1`, [r.id, nonce]);
  await event(c, r.id, 'lock', p.id);
  await event(c, r.id, 'shuffle_command', p.id);
  await audit(c, { type: 'round.locked', roundId: r.id, by: p.id });
  ev.push({ type: 'round.locked', tableId: r.table_id, roundId: r.id, data: { handNo: r.hand_no } });
  return { shuffle_command: { nonce } };
}

export function shuffleCommand(r: RoundRow): { nonce: string } {
  if (r.state !== 'LOCKED' || !r.shuffle_command_nonce) throw conflict('invalid_round_state', 'no shuffle command for this hand');
  return { nonce: r.shuffle_command_nonce };
}

export interface ShuffleAttestation {
  record: { shufflerId: string; tableId: string; handNo: number; nonce: string; completedAt: number };
  signature: string;
}

const sortedJson = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
export const attestationBytes = (rec: ShuffleAttestation['record']) => Buffer.from(sortedJson(rec as unknown as Record<string, unknown>));

/**
 * The Trusted Shuffler's signed completion for this hand's command. The source is derived from
 * the credential: a device with a valid shuffler attestation → 'shuffler'; anything else → 'manual'
 * (recorded, and the hand voids at resolution). Then PreFlop draws the random cut depth.
 */
export async function shuffleComplete(c: Tx, r: RoundRow, p: Principal, att: ShuffleAttestation | undefined, ev: EventBatch): Promise<{ cut_depth: number }> {
  requireStep(r, 'shuffle_commanded');
  let source: 'shuffler' | 'manual' = 'manual';
  let attested: string | null = null;
  if (p.kind === 'device' && att && p.shufflerKeyPem) {
    let ok = false;
    try { ok = verify(null, attestationBytes(att.record), createPublicKey(p.shufflerKeyPem), Buffer.from(att.signature, 'base64')); } catch { ok = false; }
    if (ok && att.record.tableId === r.table_id && att.record.handNo === r.hand_no) {
      source = 'shuffler';
      attested = att.record.nonce;
    } else {
      await alert(c, { tableId: r.table_id, roundId: r.id, kind: 'shuffle_attestation_invalid', severity: 'critical' });
    }
  }
  const depth = drawCutDepth();
  await c.query(
    `update rounds set shuffle_complete_at = clock_timestamp(), shuffle_source = $2, shuffle_attested_nonce = $3,
            cut_depth = $4, cut_instruction_at = clock_timestamp(), procedure_step = 'cut_instructed' where id = $1`,
    [r.id, source, attested, depth]);
  await event(c, r.id, 'shuffle_complete', p.id);
  await event(c, r.id, 'cut_instruction', null);
  await audit(c, { type: 'round.shuffled', roundId: r.id, source, cutDepth: depth });
  ev.push({ type: 'round.cut_instruction', tableId: r.table_id, roundId: r.id, data: { cutDepth: depth } });
  return { cut_depth: depth };
}

export async function cut(c: Tx, r: RoundRow, p: Principal): Promise<{ ok: true }> {
  requireStep(r, 'cut_instructed');
  await c.query(`update rounds set cut_at = clock_timestamp(), procedure_step = 'cut' where id = $1`, [r.id]);
  await event(c, r.id, 'cut', p.id);
  return { ok: true };
}

export async function dealStart(c: Tx, r: RoundRow, p: Principal, ev: EventBatch): Promise<{ ok: true }> {
  requireStep(r, 'cut');
  await c.query(`update rounds set deal_start_at = clock_timestamp(), procedure_step = 'dealing' where id = $1`, [r.id]);
  await event(c, r.id, 'deal_start', p.id);
  ev.push({ type: 'round.dealing', tableId: r.table_id, roundId: r.id, data: {} });
  return { ok: true };
}

// ---------------------------------------------------------------- manual entries

export function parseThreeCards(cards: unknown): string[] {
  if (!Array.isArray(cards) || cards.length !== 3) throw unprocessable('invalid_flop', 'exactly three cards required');
  try {
    const parsed = cards.map((x) => parseCard(String(x)));
    if (new Set(parsed.map((x) => x.id)).size !== 3) throw new Error('dup');
    return cards.map(String);
  } catch {
    throw unprocessable('invalid_flop', 'cards must be three distinct cards such as Kh, Td, 7c');
  }
}

/** Dealer or floor entry. Source derived from the role; two different people; never changes state. */
export async function flopEntry(c: Tx, r: RoundRow, p: Extract<Principal, { kind: 'staff' }>, cards: unknown): Promise<{ ok: true; source: string }> {
  if (!['LOCKED', 'DEALT', 'REVIEW', 'EVIDENCE_REJECTED'].includes(r.state)) throw conflict('invalid_round_state', `round is ${r.state}`);
  const valid = parseThreeCards(cards);
  const source = p.role === 'dealer' ? 'dealer' : 'floor';
  try {
    await c.query('savepoint entry');
    await c.query('insert into flop_entries (round_id, source, credential_id, person_id, cards) values ($1, $2, $3, $4, $5)',
      [r.id, source, p.id, p.personId, valid]);
    await c.query('release savepoint entry');
  } catch (e) {
    await c.query('rollback to savepoint entry');
    if ((e as { code?: string }).code === '23505') throw conflict('duplicate_entry', 'this entry exists, or both entries would come from the same person');
    throw e;
  }
  await enqueue(c, 'resolve_round', r.id);
  return { ok: true, source };
}

// ---------------------------------------------------------------- signed capture

export interface DeviceRow {
  id: string;
  table_id: string;
  public_key_pem: string;
  revoked: boolean;
  last_seq: number;
  last_hash: string;
}

export type CaptureResult =
  | { status: 200; body: { authentic: true; admitted: boolean } }
  | { status: 409; body: { type: 'capture_conflict' | 'invalid_round_state'; title: string; status: 409; last_seq?: number; last_hash?: string } }
  | { status: 422; body: { type: 'evidence_rejected'; title: string; status: 422; expected_seq: number; expected_prev_hash: string; problems: string[] } };

const ms = (d: Date | null) => (d ? d.getTime() : undefined);

/**
 * Capture route (docs/13 §4). Returns a result instead of throwing so evidence rows written on
 * a refusal (capture_attempts, alerts) still commit.
 */
export async function receiveCapture(c: Tx, tableId: string, handNo: number, deviceId: string, body: SignedCapture & { image_base64?: string }, t: Timing, ev: EventBatch): Promise<CaptureResult> {
  const rid = roundId(tableId, handNo);
  const r = await lockRound(c, rid);
  const d = (await c.query<DeviceRow>('select * from devices where id = $1 for update', [deviceId])).rows[0];
  if (!d) throw notFound('device');
  const cap = body.capture as FlopCapture;

  const attempt = async (problems: string[]) => {
    await c.query('insert into capture_attempts (round_id, device_id, seq, capture, signature, problems) values ($1, $2, $3, $4, $5, $6)',
      [rid, deviceId, Number.isSafeInteger(cap?.seq) ? cap.seq : null, JSON.stringify(cap ?? null), String(body.signature ?? ''), JSON.stringify(problems)]);
  };

  // 1. Idempotent replay, in any round state, before any other check.
  if (cap && Number.isSafeInteger(cap.seq)) {
    const prev = (await c.query<{ signature: string; admitted: boolean; round_id: string }>('select signature, admitted, round_id from captures where device_id = $1 and seq = $2', [deviceId, cap.seq])).rows[0];
    if (prev) {
      // A replay is acknowledged only for the hand it was stored for; the same record sent to another hand is a conflict.
      if (prev.signature === body.signature && prev.round_id === rid) return { status: 200, body: { authentic: true, admitted: prev.admitted } };
      await attempt(['capture_conflict: same seq, different signature']);
      await alert(c, { tableId, roundId: rid, kind: 'capture_conflict', severity: 'critical', details: { deviceId, seq: cap.seq } });
      return { status: 409, body: { type: 'capture_conflict', title: 'same sequence number with a different signature', status: 409, last_seq: d.last_seq, last_hash: d.last_hash } };
    }
  }

  // 2. Otherwise the round must be LOCKED.
  if (r.state !== 'LOCKED') {
    await attempt([`round is ${r.state}`]);
    return { status: 409, body: { type: 'invalid_round_state', title: 'the round is not in a state that allows this', status: 409 } };
  }

  // 3. Authenticity, once, against the checkpoint before this capture.
  let publicKey;
  try { publicKey = createPublicKey(d.public_key_pem); } catch { publicKey = undefined; }
  const auth = cap && publicKey
    ? verifyCaptureAuthenticity(body, {
      device: { deviceId: d.id, tableId: d.table_id, publicKey, revoked: d.revoked },
      expectedTableId: tableId, expectedRoundId: rid, expectedHandNo: handNo, lastSeq: d.last_seq, lastHash: d.last_hash,
    })
    : { authentic: false, problems: ['malformed capture'] };

  if (!auth.authentic) {
    await attempt(auth.problems);
    await alert(c, { tableId, roundId: rid, kind: 'evidence_rejected', severity: 'critical', details: { problems: auth.problems } });
    const failures = (await c.query<{ n: number }>('select count(*)::int as n from capture_attempts where round_id = $1', [rid])).rows[0]!.n;
    if (failures >= 3) {
      await voidRound(c, r, 'capture failed 3 times', 'system:evidence', ev);
      await c.query(`update poker_tables set status = 'paused', pause_reason = 'Table Box inspection required (3 failed captures)' where id = $1`, [tableId]);
      await alert(c, { tableId, kind: 'device_flagged', severity: 'critical', details: { deviceId } });
    }
    return { status: 422, body: { type: 'evidence_rejected', title: 'capture failed authenticity checks', status: 422, expected_seq: d.last_seq + 1, expected_prev_hash: d.last_hash, problems: auth.problems } };
  }

  // 4. Chain ingestion (always, for an authentic record) + admission.
  const adm = captureAdmissionProblems(cap, { lockedAt: ms(r.locked_at)!, dealStartAt: ms(r.deal_start_at), maxCaptureDelayMs: t.maxCaptureDelayMs });
  const admitted = adm.problems.length === 0;
  let image: Buffer | null = null;
  if (body.image_base64) {
    const bytes = Buffer.from(body.image_base64, 'base64');
    if (sha256Hex(bytes) === cap.imageSha256) image = bytes;
  }
  await c.query(
    `insert into captures (round_id, device_id, seq, capture, signature, image, admitted, admission_problems)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [rid, deviceId, cap.seq, JSON.stringify(cap), body.signature, image, admitted, admitted ? null : JSON.stringify(adm.problems)]);
  await c.query('update devices set last_seq = $2, last_hash = $3 where id = $1', [deviceId, cap.seq, captureHash(cap)]);

  if (admitted) {
    await c.query(`update rounds set state = 'DEALT' where id = $1`, [rid]);
    await audit(c, { type: 'round.dealt', roundId: rid, seq: cap.seq });
    ev.push({ type: 'round.dealt', tableId, roundId: rid, data: { handNo, cards: cap.cards } });
    await enqueue(c, 'resolve_round', rid);
    await ensureOpenRound(c, tableId, ev); // betting on the next flop opens now (skipped if not ready)
  } else {
    await rejectEvidence(c, r, adm.problems, ev);
  }
  return { status: 200, body: { authentic: true, admitted } };
}

/** Image bytes are stored only if they match the signed hash (docs/13 §4). */
export async function receiveImage(c: Tx, tableId: string, handNo: number, deviceId: string, bytes: Buffer): Promise<{ ok: true }> {
  const rid = roundId(tableId, handNo);
  await lockRound(c, rid);
  const cap = (await c.query<{ capture: FlopCapture; device_id: string }>('select capture, device_id from captures where round_id = $1', [rid])).rows[0];
  if (!cap || cap.device_id !== deviceId) throw notFound('capture');
  if (sha256Hex(bytes) !== cap.capture.imageSha256) throw unprocessable('image_mismatch', 'image does not match the signed hash');
  await c.query('update captures set image = $2 where round_id = $1', [rid, bytes]);
  await enqueue(c, 'resolve_round', rid);
  return { ok: true };
}

async function rejectEvidence(c: Tx, r: RoundRow, problems: string[], ev: EventBatch): Promise<void> {
  await c.query(`update rounds set state = 'EVIDENCE_REJECTED', review_reasons = $2 where id = $1`, [r.id, JSON.stringify(problems)]);
  await enqueue(c, 'void_round', r.id); // durable: the refund survives a crash after this commit
  await alert(c, { tableId: r.table_id, roundId: r.id, kind: 'evidence_rejected', severity: 'critical', details: { problems } });
  await audit(c, { type: 'round.evidence_rejected', roundId: r.id, problems });
  ev.push({ type: 'round.evidence_rejected', tableId: r.table_id, roundId: r.id, data: { problems } });
}

// ---------------------------------------------------------------- resolution

export function handEventsFrom(r: RoundRow, ords: Record<string, number>): HandEvents {
  const e: Record<string, unknown> = {
    lockedAt: ords.lock, shuffleCommandAt: ords.shuffle_command, shuffleCompleteAt: ords.shuffle_complete,
    cutInstructionAt: ords.cut_instruction, cutAt: ords.cut, dealStartAt: ords.deal_start,
    shuffleCommandNonce: r.shuffle_command_nonce ?? undefined, shuffleAttestedNonce: r.shuffle_attested_nonce ?? undefined,
    shuffleSource: r.shuffle_source ?? undefined,
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e as HandEvents;
}

/**
 * resolve() (docs/13 §4): deadline first, then the procedure, then content-only verification.
 * Idempotent: a no-op unless the round is DEALT with every input present.
 */
export async function resolve(c: Tx, rid: string, t: Timing, ev: EventBatch): Promise<string> {
  const r = await lockRound(c, rid);
  if (r.state !== 'DEALT') return `noop:${r.state}`;
  const now = (await c.query<{ now: Date }>('select clock_timestamp() as now')).rows[0]!.now.getTime();
  if (now >= ms(r.locked_at)! + t.resultSlaMs) {
    await voidRound(c, r, 'result deadline passed', 'system:resolve', ev);
    return 'void:deadline';
  }
  const tbl = (await c.query<{ status: string; pause_reason: string | null }>('select status, pause_reason from poker_tables where id = $1', [r.table_id])).rows[0]!;
  if (tbl.status === 'paused' && tbl.pause_reason?.startsWith('outcome monitor')) {
    await voidRound(c, r, 'table paused by outcome monitor', 'system:monitor', ev);
    return 'void:monitor';
  }
  const cap = (await c.query<{ capture: FlopCapture; image: Buffer | null }>('select capture, image from captures where round_id = $1', [rid])).rows[0];
  const entries = (await c.query<{ source: string; cards: string[] }>('select source, cards from flop_entries where round_id = $1', [rid])).rows;
  const dealer = entries.find((e) => e.source === 'dealer')?.cards;
  const floor = entries.find((e) => e.source === 'floor')?.cards;
  if (!cap || !cap.image || !dealer || !floor) return 'waiting';

  const ords = Object.fromEntries((await c.query<{ step: string; ord: number }>('select step, ord from round_events where round_id = $1', [rid])).rows.map((x) => [x.step, x.ord]));
  const procedure = handProcedureProblems(handEventsFrom(r, ords));
  if (procedure.length) {
    await voidRound(c, r, `procedure: ${procedure.join('; ')}`, 'system:procedure', ev);
    return 'void:procedure';
  }

  const v = verifyCaptureContent(cap.capture, {
    lockedAt: ms(r.locked_at)!, dealStartAt: ms(r.deal_start_at), maxCaptureDelayMs: t.maxCaptureDelayMs,
    image: cap.image, dealerEntry: dealer, floorEntry: floor,
  });
  if (v.decision === 'settle') {
    await settleRound(c, r, [...cap.capture.cards], 'DEALT', 'system:resolve', ev);
    return 'settled';
  }
  if (v.decision === 'review') {
    await c.query(`update rounds set state = 'REVIEW', review_reasons = $2, review_started_at = clock_timestamp() where id = $1`, [rid, JSON.stringify(v.problems)]);
    await audit(c, { type: 'round.review', roundId: rid, problems: v.problems });
    await alert(c, { tableId: r.table_id, roundId: rid, kind: 'round_review', details: { problems: v.problems } });
    ev.push({ type: 'round.review', tableId: r.table_id, roundId: rid, data: { problems: v.problems } });
    return 'review';
  }
  await rejectEvidence(c, r, [...v.problems], ev);
  return 'evidence_rejected';
}

interface BetRow {
  id: string;
  user_id: string;
  selection_id: string;
  stake_minor: number;
  odds_centi: number;
  mode: PlayMode;
  currency: string;
  house_kind: 'preflop' | 'organizer' | 'pool';
  house_owner: string;
  room_id: string | null;
  at_risk_minor: number | null;
  partner_id: string | null;
}

/** Who pays a fixed-odds winner: PreFlop's bankroll, or the organizer's collateral (docs/10). */
const houseAccount = (b: BetRow) => acct(b.house_kind === 'preflop' ? 'PreFlop' : b.house_owner, b.house_kind === 'preflop' ? 'bankroll' : 'collateral', b.mode, b.currency);
const walletOf = (b: BetRow) => acct(b.user_id, walletPurpose(b.room_id ? b.house_owner : null), b.mode, b.currency);
export const poolAccount = (roomId: string, mode: PlayMode, currency: string) => acct(roomId, 'pool', mode, currency);

/**
 * Terminal transition to SETTLED from an explicit expected state (DEALT for resolve(), REVIEW
 * for a floor-manager decision). Pays only if this caller wins the compare-and-set.
 */
export async function settleRound(c: Tx, r: RoundRow, cards: string[], expected: 'DEALT' | 'REVIEW', by: string, ev: EventBatch): Promise<boolean> {
  const parsed = cards.map((x) => parseCard(x)) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>, ReturnType<typeof parseCard>];
  const flop = flopFromCards(parsed);
  const won = await c.query(
    `update rounds set state = 'SETTLED', settled_at = clock_timestamp(), flop = $3, flop_index = $4
      where id = $1 and state = $2 returning id`,
    [r.id, expected, cards, flopIndex(parsed.map((x) => x.id) as unknown as [number, number, number])]);
  if (won.rowCount !== 1) return false;
  const bets = (await c.query<BetRow>(`select * from bets where round_id = $1 and status = 'accepted' order by id`, [r.id])).rows;
  let paid = 0, staked = 0;
  const record = async (b: BetRow, status: 'won' | 'lost' | 'void', payout: number) => {
    await c.query(`update bets set status = $2, payout_minor = $3, settled_at = clock_timestamp() where id = $1 and status = 'accepted'`, [b.id, status, payout]);
    ev.push({ type: 'bet.settled', userId: b.user_id, roundId: r.id, data: { betId: b.id, status, payoutMinor: payout, partnerId: b.partner_id } });
  };
  // Fixed odds (PreFlop or organizer house): the at-risk amount plays at the accepted odds.
  for (const b of bets.filter((x) => x.house_kind !== 'pool')) {
    const s = settle({ betId: b.id, selectionId: b.selection_id, stakeMinor: b.at_risk_minor ?? b.stake_minor, oddsCenti: b.odds_centi }, flop);
    staked += b.stake_minor;
    if (s.status === 'won') {
      await post(c, 'bet.payout', b.id, [{ from: houseAccount(b), to: walletOf(b), amountMinor: s.payoutMinor }]);
      paid += s.payoutMinor;
    }
    await record(b, s.status, s.payoutMinor);
  }
  // Pools: players against each other per room; the rake was taken at placement (docs/05).
  const pools = new Map<string, BetRow[]>();
  for (const b of bets.filter((x) => x.house_kind === 'pool')) pools.set(b.room_id!, [...(pools.get(b.room_id!) ?? []), b]);
  for (const [roomId, pb] of pools) {
    const winning = new Set(pb.filter((b) => getSelection(b.selection_id).wins(flop)).map((b) => b.selection_id));
    const res = settleParimutuel(pb.map((b) => ({ betId: b.id, selectionId: b.selection_id, stakeMinor: b.at_risk_minor ?? b.stake_minor })), winning, 0);
    for (const b of pb) {
      const pay = res.payouts.get(b.id) ?? 0;
      staked += b.stake_minor;
      if (pay > 0) {
        await post(c, res.refunded ? 'bet.refund' : 'bet.payout', b.id, [{ from: poolAccount(roomId, b.mode, b.currency), to: walletOf(b), amountMinor: pay }]);
        paid += pay;
      }
      await record(b, res.refunded ? 'void' : pay > 0 ? 'won' : 'lost', pay);
    }
  }
  await audit(c, { type: 'round.settled', roundId: r.id, cards, by, bets: bets.length, stakedMinor: staked, paidMinor: paid });

  // Outcome monitoring: a stacked deck trips the CUSUM and pauses the table (docs/12 §2a).
  const t = (await c.query<{ monitor: Record<string, number> }>('select monitor from poker_tables where id = $1 for update', [r.table_id])).rows[0]!;
  const m = updateMonitor(t.monitor ?? {}, flop);
  if (m.alarms.length) {
    await c.query(`update poker_tables set monitor = '{}'::jsonb, monitor_hands = monitor_hands + 1, status = 'paused',
                   pause_reason = 'outcome monitor alarm: inspect shuffler and table' where id = $1`, [r.table_id]);
    await alert(c, { tableId: r.table_id, roundId: r.id, kind: 'outcome_monitor_alarm', severity: 'critical', details: { alarms: m.alarms } });
    await audit(c, { type: 'table.paused', tableId: r.table_id, reason: 'outcome_monitor_alarm', alarms: m.alarms.map((a) => a.selectionId) });
    // Bets already open on the next flop are refunded: the table is under suspicion. That round is
    // voided by a durable job, so this transaction keeps to one round lock.
    const next = (await c.query<{ id: string }>(`select id from rounds where table_id = $1 and id <> $2 and state in ('OPEN','LOCKED','DEALT','REVIEW')`, [r.table_id, r.id])).rows;
    for (const n of next) await enqueue(c, 'void_paused', n.id);
    ev.push({ type: 'table.paused', tableId: r.table_id, data: { reason: 'outcome monitor alarm' } });
  } else {
    await c.query('update poker_tables set monitor = $2, monitor_hands = monitor_hands + 1 where id = $1', [r.table_id, JSON.stringify(m.state)]);
  }
  ev.push({ type: 'round.settled', tableId: r.table_id, roundId: r.id, data: { handNo: r.hand_no, cards, bets: bets.length } });
  return true;
}

/** Terminal transition to VOID from any voidable state; refunds every accepted bet exactly once. */
export async function voidRound(c: Tx, r: RoundRow, reason: string, by: string, ev: EventBatch, from: RoundState[] = VOIDABLE): Promise<boolean> {
  const won = await c.query(
    `update rounds set state = 'VOID', voided_at = clock_timestamp(), void_reason = $2, voided_by = $3
      where id = $1 and state = any($4::text[]) returning id`, [r.id, reason, by, from]);
  if (won.rowCount !== 1) return false;
  const bets = (await c.query<BetRow>(`select * from bets where round_id = $1 and status = 'accepted' order by id`, [r.id])).rows;
  for (const b of bets) {
    // Undo every placement posting (stake, fees, rake, pool entry): the player gets the full stake back.
    await reverse(c, 'bet.stake', b.id, 'bet.refund');
    await c.query(`update bets set status = 'void', payout_minor = stake_minor, settled_at = clock_timestamp() where id = $1 and status = 'accepted'`, [b.id]);
    ev.push({ type: 'bet.voided', userId: b.user_id, roundId: r.id, data: { betId: b.id, refundMinor: b.stake_minor, partnerId: b.partner_id } });
  }
  await audit(c, { type: 'round.voided', roundId: r.id, reason, by, refunds: bets.length });
  ev.push({ type: 'round.voided', tableId: r.table_id, roundId: r.id, data: { handNo: r.hand_no, reason } });
  return true;
}

/** A floor manager's decision on a REVIEW round (docs/13 §4). */
export async function resolveReview(
  c: Tx, r: RoundRow, p: Extract<Principal, { kind: 'staff' }>, decision: { action: 'settle'; cards: unknown } | { action: 'void'; reason: string },
  t: Timing, ev: EventBatch,
): Promise<{ status: 200 | 409; body: Record<string, unknown> }> {
  if (p.role !== 'floor_manager') throw new ApiError(403, 'forbidden_role', 'floor manager only');
  if (r.state === 'EVIDENCE_REJECTED') throw conflict('invalid_round_state', 'rejected evidence can never be settled by hand');
  if (r.state !== 'REVIEW') throw conflict('invalid_round_state', `round is ${r.state}`);
  const entered = (await c.query('select 1 from flop_entries where round_id = $1 and person_id = $2', [r.id, p.personId])).rowCount;
  if (entered) throw new ApiError(403, 'forbidden_role', 'a person who entered the flop cannot resolve its review');
  const now = (await c.query<{ now: Date }>('select clock_timestamp() as now')).rows[0]!.now.getTime();
  if (now >= ms(r.review_started_at)! + t.reviewSlaMs) {
    await voidRound(c, r, 'review deadline passed', 'system:review-deadline', ev, ['REVIEW']);
    return { status: 409, body: { type: 'review_expired', title: 'the review deadline passed; the round was voided and refunded', status: 409 } };
  }
  if (decision.action === 'void') {
    const ok = await voidRound(c, r, `review: ${decision.reason}`, p.id, ev, ['REVIEW']);
    return ok ? { status: 200, body: { state: 'VOID' } } : { status: 409, body: { type: 'invalid_round_state', title: 'the round is not in a state that allows this', status: 409 } };
  }
  const cards = parseThreeCards(decision.cards);
  const ok = await settleRound(c, r, cards, 'REVIEW', p.id, ev);
  return ok ? { status: 200, body: { state: 'SETTLED' } } : { status: 409, body: { type: 'invalid_round_state', title: 'the round is not in a state that allows this', status: 409 } };
}
