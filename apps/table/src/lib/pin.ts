/**
 * Staff PIN for the tablet lock. Only a salted PBKDF2-SHA-256 hash is stored (with the tablet
 * identity in IndexedDB); the PIN itself is never stored or sent anywhere.
 *
 * What the PIN protects: a tablet left on the table cannot be used to sign (start, cut, deal,
 * flop entry, review) by someone walking past. What it does not: anyone who can run code in the
 * tablet's browser profile can use the signing key directly. A lost or stolen tablet is handled
 * by revoking its credential in the club console (docs/12, "Revoke a lost tablet").
 */
export interface PinRecord {
  v: 1;
  alg: 'PBKDF2-SHA-256';
  iterations: number;
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
}

export const PIN_ITERATIONS = 210_000;
export const PIN_MIN = 6;
export const PIN_MAX = 8;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Why a new PIN is refused, or null when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'Use digits only.';
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return `Use ${PIN_MIN} to ${PIN_MAX} digits.`;
  if (/^(\d)\1+$/.test(pin)) return 'Too easy to guess: all digits are the same.';
  const digits = [...pin].map(Number);
  const step = digits[1]! - digits[0]!;
  if (Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step)) return 'Too easy to guess: a run of digits.';
  return null;
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, o: { iterations?: number; salt?: Uint8Array } = {}): Promise<PinRecord> {
  const salt = o.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iterations = o.iterations ?? PIN_ITERATIONS;
  return { v: 1, alg: 'PBKDF2-SHA-256', iterations, salt: b64(salt), hash: b64(await derive(pin, salt, iterations)) };
}

/** Constant-time comparison of the derived hash. */
export async function verifyPin(pin: string, rec: PinRecord): Promise<boolean> {
  if (rec.v !== 1 || rec.alg !== 'PBKDF2-SHA-256') return false;
  const got = await derive(pin, unb64(rec.salt), rec.iterations);
  const want = unb64(rec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}
