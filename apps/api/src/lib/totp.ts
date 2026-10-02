import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226) with HMAC-SHA1, 6 digits and a 30-second step: the
 * parameters every authenticator app supports. Built on node:crypto only.
 */
export const TOTP = { stepSeconds: 30, digits: 6, window: 1 } as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, without padding. */
export function base32Encode(buf: Uint8Array): string {
  let out = '', bits = 0, value = 0;
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decodes base32 (case-insensitive; spaces and padding ignored). Throws on other characters. */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=]/g, '');
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (the RFC 4226 recommendation), base32-encoded. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

/** HOTP value for one counter, zero-padded to `digits`. */
export function hotp(key: Buffer, counter: number, digits: number = TOTP.digits): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (unixMs: number) => Math.floor(unixMs / 1000 / TOTP.stepSeconds);

/** The code an authenticator shows at `unixMs` (tests and tooling). */
export const totpAt = (secret: string, unixMs: number) => hotp(base32Decode(secret), stepAt(unixMs));

/**
 * Verifies a code within ±1 step of now. Returns the matched step, or null. A step at or below
 * `lastStep` is never accepted again, so a code (or an older one) cannot be replayed.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, unixMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const now = stepAt(unixMs);
  let hit: number | null = null;
  for (let w = -TOTP.window; w <= TOTP.window; w++) {
    const step = now + w;
    if (lastStep !== null && step <= lastStep) continue;
    // Compare every candidate in constant time; keep checking so the timing does not reveal which step matched.
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code)) && hit === null) hit = step;
  }
  return hit;
}

/** otpauth:// URI for authenticator apps (shown as text, or as a QR code by the console). */
export function otpauthUri(secret: string, account: string, issuer = 'PreFlop'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP.digits}&period=${TOTP.stepSeconds}`;
}
