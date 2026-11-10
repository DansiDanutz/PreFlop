import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToBase64, sha256Hex } from './snapshot.ts';

describe('flop snapshot encoding', () => {
  it('base64 matches Node for small and large frames (chunked encoding)', () => {
    for (const n of [0, 1, 3, 1000, 200_000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31) % 256);
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });

  it('SHA-256 is the lowercase hex digest the API checks', async () => {
    const b = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]);
    expect(await sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));
  });
});
