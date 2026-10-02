/**
 * The Table Box for the E2E table, using the API simulator in the DEVICE role only:
 * heartbeat, trusted shuffle on the shuffle command (signed attestation), and the signed board
 * capture once the dealer tablet has pressed DEAL START. Staff steps come from the browsers.
 *
 *   npx tsx --conditions=preflop-source apps/table/scripts/e2e-device.ts <keys.json> <flops.json>
 *
 * flops.json receives { [handNo]: cards } — what the dealt flop really is, so the E2E browser
 * driver knows which cards to tap (a real dealer reads them off the felt).
 */
import { createPrivateKey, randomInt, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { type ShuffleAttestation, attestationBytes } from '../../api/src/rounds/service.ts';
import { SimTable, type SimKeysFile, fetchSend } from '../../api/src/sim/tableSim.ts';

const API = process.env.API_URL ?? 'http://localhost:4000';
const [, , keysPath, flopsPath] = process.argv;
if (!keysPath || !flopsPath) throw new Error('usage: e2e-device.ts <keys.json> <flops.json>');
const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as SimKeysFile;
const sim = new SimTable(fetchSend(API), keys);
const shuffler = createPrivateKey(keys.shufflerPem);
const base = (n: number) => `/v1/provider/tables/${keys.tableId}/hands/${n}`;

const decks = new Map<number, string[]>();
const flops: Record<number, string[]> = {};
const captured = new Set<number>();
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

await sim.syncCheckpoint();
let lastBeat = 0;

async function step() {
  if (Date.now() - lastBeat > 2000) {
    const hb = await sim.heartbeat();
    lastBeat = Date.now();
    if (hb.status !== 200) log('heartbeat', hb.status, hb.body);
  }
  const s = await sim.state();
  for (const r of (s.rounds ?? []) as { hand_no: number; state: string; step: string; cut_depth: number | null }[]) {
    if (r.state !== 'LOCKED') continue;
    const n = r.hand_no;
    if (r.step === 'shuffle_commanded' && !decks.has(n)) {
      const cmd = await sim.call('device', 'GET', `${base(n)}/shuffle-command`);
      if (cmd.status !== 200) { log('shuffle-command', cmd.status, cmd.body); continue; }
      // Trusted Shuffler: fresh crypto-random shuffle of one deck, signed for this command nonce.
      const deck = [...'23456789TJQKA'].flatMap((r) => [...'shdc'].map((x) => r + x));
      for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      await new Promise((res) => setTimeout(res, 1200)); // the machine takes a moment
      const record: ShuffleAttestation['record'] = { shufflerId: `ts-${keys.tableId}`, tableId: keys.tableId, handNo: n, nonce: cmd.body.nonce, completedAt: Date.now() };
      const attestation: ShuffleAttestation = { record, signature: sign(null, attestationBytes(record), shuffler).toString('base64') };
      const done = await sim.call('device', 'POST', `${base(n)}/shuffle-complete`, { attestation });
      if (done.status !== 200) { log('shuffle-complete', done.status, done.body); continue; }
      decks.set(n, deck);
      const cut = done.body.cut_depth as number;
      const cutDeck = [...deck.slice(cut), ...deck.slice(0, cut)];
      flops[n] = [cutDeck[19]!, cutDeck[20]!, cutDeck[21]!]; // 9 seats × 2 + burn
      writeFileSync(flopsPath, JSON.stringify(flops));
      log(`hand ${n}: shuffled, cut at ${cut}, flop will be ${flops[n]!.join(' ')}`);
    }
    if (r.step === 'dealing' && flops[n] && !captured.has(n)) {
      captured.add(n);
      await new Promise((res) => setTimeout(res, 1500)); // hole cards, burn, flop
      const { signed, image } = sim.buildCapture(n, flops[n]!);
      const res = await sim.sendCapture(n, signed, image);
      log(`hand ${n}: capture`, res.status, JSON.stringify(res.body));
      if (res.status !== 200) captured.delete(n);
    }
  }
}

let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
log(`device ${keys.deviceId} driving ${keys.tableId} against ${API}`);
while (!stop) {
  try { await step(); } catch (e) { log('error', (e as Error).message); }
  await new Promise((res) => setTimeout(res, 700));
}
process.exit(0);
