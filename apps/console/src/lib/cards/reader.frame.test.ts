import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, type Page, chromium } from 'playwright';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIN_CONFIDENCE, type Reading } from './vision.ts';

/**
 * The card reader end to end (docs/19): the real OpenCV.js build, in a real Chromium, on synthetic
 * frames drawn by test-harness/reader.html. vision.test.ts covers the pure helpers; this one covers
 * the pipeline they feed (threshold, contours, straightening, glyph matching) so a regression in the
 * browser reading path fails the suite instead of the first operator. Needs a Chromium that Playwright
 * can launch: `pnpm exec playwright install chromium` (CI does this), or PLAYWRIGHT_CHROMIUM=<path>.
 */

type Scene = { card: string; x: number; y: number; rot: number }[];
/** What a real table does to a frame; see drawScene in test-harness/reader.html. */
type Conditions = { felt?: string; light?: number; skew?: number; blur?: number; noise?: number };
const THREE: Scene = [{ card: 'Ah', x: 350, y: 330, rot: 0 }, { card: 'Kd', x: 640, y: 330, rot: 0 }, { card: '7c', x: 930, y: 330, rot: 0 }];
const SCENES: { name: string; cards: Scene; flop: string[]; conditions?: Conditions }[] = [
  { name: 'three upright cards', cards: THREE, flop: ['Ah', 'Kd', '7c'] },
  { name: 'tilted, and one upside down', cards: [{ card: 'Ts', x: 350, y: 330, rot: -12 }, { card: 'Qh', x: 640, y: 340, rot: 180 }, { card: '2c', x: 930, y: 320, rot: 8 }], flop: ['Ts', 'Qh', '2c'] },
  { name: 'two landscape cards and one small turn', cards: [{ card: '9d', x: 300, y: 300, rot: 90 }, { card: 'Jc', x: 700, y: 300, rot: 5 }, { card: '5s', x: 1000, y: 300, rot: -90 }], flop: ['9d', 'Jc', '5s'] },
  // realistic conditions, same three cards
  { name: 'uneven light across the table', cards: THREE, flop: ['Ah', 'Kd', '7c'], conditions: { light: 0.55 } },
  { name: 'camera not straight above (skewed view)', cards: THREE, flop: ['Ah', 'Kd', '7c'], conditions: { skew: 0.18 } },
  { name: 'soft focus (1.5 px blur)', cards: THREE, flop: ['Ah', 'Kd', '7c'], conditions: { blur: 1.5 } },
  { name: 'sensor noise', cards: THREE, flop: ['Ah', 'Kd', '7c'], conditions: { noise: 28 } },
  { name: 'red felt, dim light, slight blur and noise together', cards: THREE, flop: ['Ah', 'Kd', '7c'], conditions: { felt: '#6b1d1d', light: 0.35, blur: 0.8, noise: 12 } },
  // black suits at an angle, out of focus: a blurred spade's point rounds like a club's top lobe (focus-level templates)
  { name: 'tilted black suits, 2 px blur and noise: spade stays a spade', cards: [{ card: 'Ts', x: 350, y: 330, rot: -12 }, { card: 'Qh', x: 640, y: 340, rot: 180 }, { card: '2c', x: 930, y: 320, rot: 8 }], flop: ['Ts', 'Qh', '2c'], conditions: { blur: 2, noise: 30 } },
  { name: 'tilted black suits, 2 px blur and noise: club stays a club', cards: [{ card: 'Tc', x: 350, y: 330, rot: -12 }, { card: 'Qh', x: 640, y: 340, rot: 180 }, { card: '2s', x: 930, y: 320, rot: 8 }], flop: ['Tc', 'Qh', '2s'], conditions: { blur: 2, noise: 30 } },
];

const chromiumPath = () => process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let server: ViteDevServer;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL('../../../vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    logLevel: 'silent',
    server: { port: 5199, strictPort: false, host: '127.0.0.1' },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('vite dev server gave no URL');
  const executablePath = chromiumPath();
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}test-harness/reader.html`);
  await page.waitForFunction(() => (window as unknown as { harnessReady?: boolean }).harnessReady, null, { timeout: 30_000 });
  // The first reading loads the 15 MB OpenCV.js chunk and compiles its WebAssembly.
  await page.evaluate((cards) => (window as unknown as { drawScene: (c: Scene) => void }).drawScene(cards), SCENES[0]!.cards);
  await page.evaluate(() => (window as unknown as { runReader: () => Promise<Reading> }).runReader());
  expect(errors).toEqual([]);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const read = async (cards: Scene, conditions: Conditions = {}): Promise<Reading> => {
  await page.evaluate(([c, o]) => (window as unknown as { drawScene: (c: Scene, o: Conditions) => void }).drawScene(c, o), [cards, conditions] as const);
  return page.evaluate(() => (window as unknown as { runReader: () => Promise<Reading> }).runReader());
};

describe('card reader on synthetic frames (OpenCV.js in Chromium)', () => {
  for (const s of SCENES) {
    it(`reads ${s.name}: ${s.flop.join(' ')}`, async () => {
      const r = await read(s.cards, s.conditions);
      // Printed so a CI log shows how much headroom each scene has over the confidence floor.
      console.info(`[reader.frame] ${s.name}: ${r.guesses.map((g) => `${g.card} ${(g.confidence * 100).toFixed(0)}% (margin ${(g.margin * 100).toFixed(0)}%)`).join(', ')} in ${r.ms} ms`);
      expect(r.flop).toEqual(s.flop);
      expect(r.guesses).toHaveLength(3);
      for (const g of r.guesses) {
        expect(g.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
        expect(g.margin).toBeGreaterThanOrEqual(0);
        expect(g.margin).toBeLessThanOrEqual(1);
        expect(g.corners).toHaveLength(4);
      }
      expect(r.size).toEqual({ width: 1280, height: 720 });
      expect(r.ms).toBeLessThan(5_000);
    }, 30_000);
  }

  it('two cards only: both read, no flop proposed', async () => {
    const r = await read([{ card: 'Ah', x: 400, y: 330, rot: 0 }, { card: 'Kd', x: 800, y: 330, rot: 0 }]);
    expect(r.guesses.map((g) => g.card).sort()).toEqual(['Ah', 'Kd']);
    expect(r.flop).toEqual([]);
  }, 30_000);

  it('an empty felt reads nothing', async () => {
    const r = await read([]);
    expect(r.guesses).toEqual([]);
    expect(r.flop).toEqual([]);
  }, 30_000);
});
