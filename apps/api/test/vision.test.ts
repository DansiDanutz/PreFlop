import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { type FlopImage, normalizeReading } from '../src/lib/vision.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, harness } from './helpers.ts';

/** Webcam card recognition (docs/19): the reading is normalised, gated and only ever a suggestion. */
describe('normalizeReading', () => {
  it('turns the model answer into engine card codes', () => {
    expect(normalizeReading({ cards: [{ rank: 'A', suit: 'hearts' }, { rank: '10', suit: 'diamonds' }, { rank: '7', suit: 'clubs' }], confidence: 'high', notes: '' }))
      .toEqual({ cards: ['Ah', 'Td', '7c'], confidence: 'high', notes: '' });
  });
  it('drops repeated cards and keeps at most three', () => {
    const r = normalizeReading({ cards: [{ rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'spades' }, { rank: '2', suit: 'clubs' }], confidence: 'medium', notes: ' third card hidden ' });
    expect(r.cards).toEqual(['Ks', '2c']);
    expect(r.notes).toBe('third card hidden');
  });
});

describe('POST /v1/admin/manual/read-flop', () => {
  const image = 'A'.repeat(200);
  let seen: FlopImage | null = null;
  let h: Harness;
  let admin: string;
  beforeAll(async () => {
    h = await harness('vision', {}, { flopReader: async (img) => { seen = img; return { cards: ['Ah', 'Kd', '7c'], confidence: 'high', notes: '' }; } });
    await tx(h.db, (c) => seedAdmin(c, 'vision-admin@test.dev', 'admin-pass-1'));
    admin = (await h.api('POST', '/v1/auth/login', undefined, { email: 'vision-admin@test.dev', password: 'admin-pass-1' })).body.token;
  });
  afterAll(async () => h?.close());

  it('returns the reader’s cards to the PreFlop team only', async () => {
    const r = await h.api('POST', '/v1/admin/manual/read-flop', admin, { image_base64: image, media_type: 'image/jpeg' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cards: ['Ah', 'Kd', '7c'], confidence: 'high', notes: '' });
    expect(seen).toEqual({ base64: image, mediaType: 'image/jpeg' });
    const p = await h.register('Not staff');
    expect((await h.api('POST', '/v1/admin/manual/read-flop', p.token, { image_base64: image, media_type: 'image/jpeg' })).status).toBe(403);
  });

  it('refuses a photo that is not base64, too small or of another type', async () => {
    expect((await h.api('POST', '/v1/admin/manual/read-flop', admin, { image_base64: 'not base64!\n', media_type: 'image/jpeg' })).status).toBe(400);
    expect((await h.api('POST', '/v1/admin/manual/read-flop', admin, { image_base64: 'AAAA', media_type: 'image/jpeg' })).status).toBe(400);
    expect((await h.api('POST', '/v1/admin/manual/read-flop', admin, { image_base64: image, media_type: 'image/gif' })).status).toBe(400);
  });

  it('is 503 provider_not_configured without an API key', async () => {
    const off = await harness('vision_off');
    try {
      await tx(off.db, (c) => seedAdmin(c, 'vision-off@test.dev', 'admin-pass-1'));
      const token = (await off.api('POST', '/v1/auth/login', undefined, { email: 'vision-off@test.dev', password: 'admin-pass-1' })).body.token;
      const r = await off.api('POST', '/v1/admin/manual/read-flop', token, { image_base64: image, media_type: 'image/jpeg' });
      expect(r.status).toBe(503);
      expect(r.body.type).toBe('provider_not_configured');
    } finally {
      await off.close();
    }
  });
});
