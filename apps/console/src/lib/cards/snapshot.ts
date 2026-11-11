import type { FlopSnapshot } from '@preflop/client';

/**
 * The frame the flop was read from (docs/19, migration 032), sent with the settlement as evidence:
 * a JPEG at most SNAPSHOT_WIDTH wide, kept under the API's 512 KB limit, with its SHA-256.
 */
export const SNAPSHOT_WIDTH = 960;
export const SNAPSHOT_MAX_BYTES = 480 * 1024;
const QUALITIES = [0.8, 0.65, 0.5, 0.35];

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

const jpegOf = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((ok, fail) =>
  c.toBlob((b) => (b ? ok(b) : fail(new Error('the browser could not encode the frame'))), 'image/jpeg', q));

/** Encodes the frame on `source` (scaled down) and returns the evidence plus a preview to show the operator. */
export async function frameSnapshot(source: HTMLCanvasElement): Promise<{ snapshot: FlopSnapshot; previewUrl: string }> {
  const scale = Math.min(1, SNAPSHOT_WIDTH / source.width);
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * scale); c.height = Math.round(source.height * scale);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  for (const q of QUALITIES) {
    const bytes = new Uint8Array(await (await jpegOf(c, q)).arrayBuffer());
    if (bytes.length > SNAPSHOT_MAX_BYTES) continue;
    const image_base64 = bytesToBase64(bytes);
    return { snapshot: { image_base64, sha256: await sha256Hex(bytes) }, previewUrl: `data:image/jpeg;base64,${image_base64}` };
  }
  throw new Error('the frame is too large to keep as evidence');
}
