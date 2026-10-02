import { type KeyObject, createPrivateKey, randomInt, sign } from 'node:crypto';
import { DECK, type FlopCapture, captureHash, formatCard, sha256Hex, signCapture } from '@preflop/odds-engine';
import { signRequest } from '../auth/envelope.ts';
import { type ShuffleAttestation, attestationBytes } from '../rounds/service.ts';
import type { SimTableKeys } from '../seed.ts';

/** Minimal HTTP transport so the simulator runs against a live server (fetch) or app.inject in tests. */
export type Send = (req: { method: string; url: string; headers: Record<string, string>; body?: string | Buffer }) => Promise<{ status: number; json: () => unknown }>;

export const fetchSend = (base: string): Send => async (r) => {
  const res = await fetch(base + r.url, { method: r.method, headers: r.headers, ...(r.body !== undefined ? { body: typeof r.body === 'string' ? r.body : new Uint8Array(r.body) } : {}) });
  const text = await res.text();
  return { status: res.status, json: () => (text ? JSON.parse(text) : null) };
};

/** Keys serialised to disk for the CLI (PEM). */
export interface SimKeysFile {
  tableId: string;
  deviceId: string;
  devicePem: string;
  shufflerPem: string;
  staff: Record<'dealer' | 'floor' | 'floor_manager', { id: string; pem: string }>;
}

export const keysToFile = (k: SimTableKeys): SimKeysFile => ({
  tableId: k.tableId, deviceId: k.deviceId, devicePem: k.device.privatePem, shufflerPem: k.shuffler.privatePem,
  staff: { dealer: { id: k.staff.dealer.id, pem: k.staff.dealer.key.privatePem }, floor: { id: k.staff.floor.id, pem: k.staff.floor.key.privatePem }, floor_manager: { id: k.staff.floor_manager.id, pem: k.staff.floor_manager.key.privatePem } },
});

/** Renders the evidence image of a flop as SVG (the simulated board camera). */
export function boardSvg(tableId: string, handNo: number, cards: readonly string[]): string {
  const sym: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const card = (c: string, i: number) => {
    const rank = c.slice(0, -1).replace('T', '10');
    const suit = c.slice(-1);
    const red = suit === 'h' || suit === 'd';
    const x = 40 + i * 150;
    return `<g transform="translate(${x},40)"><rect width="130" height="182" rx="12" fill="#fafaf7" stroke="#222"/>`
      + `<text x="14" y="40" font-size="34" font-family="Georgia" fill="${red ? '#c0392b' : '#111'}">${rank}</text>`
      + `<text x="65" y="122" font-size="64" text-anchor="middle" fill="${red ? '#c0392b' : '#111'}">${sym[suit]}</text></g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="530" height="262" viewBox="0 0 530 262"><rect width="530" height="262" fill="#0f5132"/>`
    + `${cards.map(card).join('')}<text x="265" y="252" font-size="12" text-anchor="middle" fill="#cfe" font-family="monospace">${tableId} hand ${handNo}</text></svg>`;
}

export interface HandOutcome {
  handNo: number;
  cards: string[];
  cutDepth: number;
  captureStatus: number;
}

/**
 * One simulated table: the Table Box (device key, hash-chained captures), the PreFlop Trusted
 * Shuffler (fresh crypto shuffle per command, signed with its own key) and three staff tablets.
 * It follows the real per-hand sequence: Start → shuffle command → shuffle → cut → deal → capture
 * + dealer/floor entries.
 */
export class SimTable {
  readonly tableId: string;
  private readonly deviceId: string;
  private readonly device: KeyObject;
  private readonly shuffler: KeyObject;
  private readonly staff: Record<'dealer' | 'floor' | 'floor_manager', { id: string; key: KeyObject }>;
  seq = 0;
  prevHash = 'genesis';
  /** Test hook: change the deck after the shuffle (e.g. the F01 stacked deck). */
  stackDeck?: ((deck: string[]) => string[]) | undefined;
  /** Test hook: what the dealer / floor type (default: the true flop). */
  entryFor?: ((role: "dealer" | "floor", cards: string[]) => string[]) | undefined;

  constructor(private readonly send: Send, keys: SimKeysFile) {
    this.tableId = keys.tableId;
    this.deviceId = keys.deviceId;
    this.device = createPrivateKey(keys.devicePem);
    this.shuffler = createPrivateKey(keys.shufflerPem);
    this.staff = {
      dealer: { id: keys.staff.dealer.id, key: createPrivateKey(keys.staff.dealer.pem) },
      floor: { id: keys.staff.floor.id, key: createPrivateKey(keys.staff.floor.pem) },
      floor_manager: { id: keys.staff.floor_manager.id, key: createPrivateKey(keys.staff.floor_manager.pem) },
    };
  }

  private n = 0;
  private key() {
    return `sim-${this.tableId}-${Date.now()}-${++this.n}-${randomInt(1e9)}`;
  }

  async call(as: 'device' | 'dealer' | 'floor' | 'floor_manager', method: string, url: string, body?: unknown, raw?: Buffer): Promise<{ status: number; body: any }> {
    const cred = as === 'device' ? { id: this.deviceId, key: this.device } : this.staff[as];
    const payload = raw ?? (body === undefined ? '' : JSON.stringify(body));
    const idem = method === 'GET' ? undefined : this.key();
    const headers: Record<string, string> = {
      'x-preflop-auth': signRequest(cred.id, cred.key, { method, url, ...(idem ? { idempotencyKey: idem } : {}), body: payload }),
      ...(idem ? { 'idempotency-key': idem } : {}),
    };
    if (method !== 'GET') headers['content-type'] = raw ? 'application/octet-stream' : 'application/json';
    const res = await this.send({ method, url, headers, ...(method !== 'GET' ? { body: payload } : {}) });
    return { status: res.status, body: res.json() };
  }

  async heartbeat(sample: Partial<{ streamLive: boolean; uploadMbps: number }> = {}) {
    return this.call('device', 'POST', `/v1/provider/tables/${this.tableId}/heartbeat`, {
      uploadMbps: 40, rttMs: 35, jitterMs: 4, packetLossPct: 0.1, videoDelayMs: 1200, backupLinkUp: true, streamLive: true, ...sample,
    });
  }

  /** Re-synchronises the Box's chain from the server (after restart or buffer loss). */
  async syncCheckpoint() {
    const r = await this.call('device', 'GET', `/v1/provider/devices/${this.deviceId}/checkpoint`);
    if (r.status === 200) {
      this.seq = r.body.last_seq;
      this.prevHash = r.body.last_hash;
    }
    return r;
  }

  async state() {
    return (await this.call('device', 'GET', `/v1/provider/tables/${this.tableId}/state`)).body;
  }

  /** The hand number currently OPEN for betting, if any. */
  async openHand(): Promise<number | null> {
    const s = await this.state();
    const open = (s.rounds as { hand_no: number; state: string }[]).find((r) => r.state === 'OPEN');
    return open ? open.hand_no : null;
  }

  private must(r: { status: number; body: unknown }, what: string) {
    if (r.status !== 200) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  }

  /** Start → shuffle command → trusted shuffle → cut → deal-start. Returns the dealt flop. */
  async procedure(handNo: number, o: { manualShuffle?: boolean } = {}): Promise<{ cards: string[]; cutDepth: number }> {
    const base = `/v1/provider/tables/${this.tableId}/hands/${handNo}`;
    this.must(await this.call('dealer', 'POST', `${base}/start`, {}), 'start');
    const cmd = this.must(await this.call('device', 'GET', `${base}/shuffle-command`), 'shuffle-command');
    // PreFlop Trusted Shuffler: a fresh crypto-random shuffle of one deck, signed for the command nonce.
    let deck = DECK.map(formatCard);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    if (this.stackDeck) deck = this.stackDeck(deck);
    const record: ShuffleAttestation['record'] = { shufflerId: `ts-${this.tableId}`, tableId: this.tableId, handNo, nonce: cmd.nonce, completedAt: Date.now() };
    const attestation: ShuffleAttestation = { record, signature: sign(null, attestationBytes(record), this.shuffler).toString('base64') };
    const { cut_depth } = this.must(o.manualShuffle
      ? await this.call('dealer', 'POST', `${base}/shuffle-complete`, {})
      : await this.call('device', 'POST', `${base}/shuffle-complete`, { attestation }), 'shuffle-complete');
    this.must(await this.call('dealer', 'POST', `${base}/cut`, {}), 'cut');
    this.must(await this.call('dealer', 'POST', `${base}/deal-start`, {}), 'deal-start');
    const cutDeck = [...deck.slice(cut_depth), ...deck.slice(0, cut_depth)];
    // 9 seats × 2 hole cards = 18, then a burn: the flop is positions 19–21.
    return { cards: [cutDeck[19]!, cutDeck[20]!, cutDeck[21]!], cutDepth: cut_depth };
  }

  /** Builds (and signs) the Table Box capture for this hand; does not send it. */
  buildCapture(handNo: number, cards: string[], o: Partial<FlopCapture> = {}) {
    const image = Buffer.from(boardSvg(this.tableId, handNo, cards));
    const capture: FlopCapture = {
      deviceId: this.deviceId, tableId: this.tableId, roundId: `${this.tableId}:h${handNo}`, handNo,
      cards: cards as [string, string, string], source: 'vision', imageSha256: sha256Hex(image), capturedAt: Date.now(),
      seq: this.seq + 1, prevHash: this.prevHash, ...o,
    };
    return { capture, image, signed: signCapture(capture, this.device) };
  }

  /** Sends a signed capture; advances the Box's own chain only on authentic: true. */
  async sendCapture(handNo: number, signed: { capture: FlopCapture; signature: string }, image?: Buffer) {
    const res = await this.call('device', 'POST', `/v1/provider/tables/${this.tableId}/hands/${handNo}/capture`, { ...signed, ...(image ? { image_base64: image.toString('base64') } : {}) });
    if (res.status === 200 && res.body.authentic) {
      this.seq = signed.capture.seq;
      this.prevHash = captureHash(signed.capture);
    }
    return res;
  }

  async enter(handNo: number, role: 'dealer' | 'floor' | 'floor_manager', cards: string[]) {
    return this.call(role, 'POST', `/v1/provider/tables/${this.tableId}/hands/${handNo}/flop`, { cards });
  }

  /** Plays one complete hand on the currently OPEN round. */
  async playHand(handNo: number): Promise<HandOutcome> {
    const { cards, cutDepth } = await this.procedure(handNo);
    const { signed, image } = this.buildCapture(handNo, cards);
    const cap = await this.sendCapture(handNo, signed, image);
    for (const role of ['dealer', 'floor'] as const) await this.enter(handNo, role, this.entryFor ? this.entryFor(role, cards) : cards);
    return { handNo, cards, cutDepth, captureStatus: cap.status };
  }
}
