import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, type Page, chromium } from 'playwright';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/lib/db.ts';
import { seedAdmin } from '../src/seed.ts';
import { type Harness, bet, harness, walletOf } from './helpers.ts';

/**
 * The operator's manual-table flow, end to end (docs/19): the real console (Vite dev server) against
 * the real API (this harness, listening on a port), in a real Chromium. The webcam is a canvas with
 * three drawn cards handed to the page as its camera. Sign in → close betting → use webcam → read
 * cards → use these cards → settle → the round is settled with those cards, the bet is paid and the
 * next hand is open. Needs a Chromium Playwright can launch (CI installs one; PLAYWRIGHT_CHROMIUM=<path>).
 */

const ADMIN = { email: 'e2e-admin@test.dev', password: 'admin-pass-1' };
const FLOP = ['Ah', 'Kd', '7c'];

/** Replaces the page's camera with a canvas showing three cards on a felt, redrawn every 100 ms (so the app's fonts are in by the time it is read). */
const FAKE_CAMERA = `
  (() => {
    const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
    const CARDS = [{ card: 'Ah', x: 350 }, { card: 'Kd', x: 640 }, { card: '7c', x: 930 }];
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const g = canvas.getContext('2d');
    const draw = () => {
      g.fillStyle = '#1f5f3a'; g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#c0392b'; g.beginPath(); g.arc(1100, 600, 60, 0, Math.PI * 2); g.fill();
      for (const { card, x } of CARDS) {
        const rank = card.slice(0, -1), suit = card.slice(-1);
        g.save(); g.translate(x, 330);
        g.fillStyle = '#fff'; g.beginPath(); g.roundRect(-95, -133, 190, 266, 10); g.fill();
        g.fillStyle = suit === 'h' || suit === 'd' ? '#d10f1f' : '#111';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '600 56px "Inter", sans-serif'; g.fillText(rank, -65, -97); g.fillText(SUIT[suit], -65, -41);
        g.font = '110px "Inter", sans-serif'; g.fillText(SUIT[suit], 0, 10);
        g.restore();
      }
    };
    draw(); setInterval(draw, 100);
    const fake = async () => canvas.captureStream(10);
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: fake, configurable: true });
  })();
`;

let h: Harness;
let apiUrl: string;
let vite: ViteDevServer;
let consoleUrl: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  h = await harness('e2e_manual');
  await tx(h.db, (c) => seedAdmin(c, ADMIN.email, ADMIN.password));
  // The API listens for real: the console in the browser talks to it over HTTP.
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = h.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('api has no port');
  apiUrl = `http://127.0.0.1:${addr.port}`;
  // The console's dev server, built for that API.
  process.env.VITE_API_URL = apiUrl;
  const consoleRoot = fileURLToPath(new URL('../../console', import.meta.url));
  vite = await createServer({ configFile: `${consoleRoot}/vite.config.ts`, root: consoleRoot, logLevel: 'silent', server: { port: 5197, strictPort: false, host: '127.0.0.1' } });
  await vite.listen();
  consoleUrl = vite.resolvedUrls!.local[0]!.replace(/\/$/, '');
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.addInitScript(FAKE_CAMERA);
});

afterAll(async () => {
  await browser?.close();
  await vite?.close();
  await h?.close();
});

describe('manual table, end to end in the console', () => {
  it('sign in, close betting, read the webcam, use the cards, settle: the hand pays and the next one opens', async () => {
    // A table with one bet on it, so settlement has something to pay.
    const admin = (await h.api('POST', '/v1/auth/login', undefined, ADMIN)).body.token;
    const table = (await h.api('POST', '/v1/admin/tables/manual', admin, { name: 'E2E webcam table' })).body;
    const player = await h.register('E2E player');
    const before = await walletOf(h, player.token);
    expect((await bet(h, player.token, `${table.id}:h1`, 'colour:mixed', 1_000)).status).toBe(201);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${consoleUrl}/login`);
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto(`${consoleUrl}/admin/manual`);
    // The table's card: the innermost div holding both its heading and its hand controls.
    const heading = page.getByRole('heading', { name: /E2E webcam table/ });
    await heading.waitFor({ timeout: 30_000 });
    const card = page.locator('div').filter({ has: heading }).filter({ has: page.getByText(/^Hand #/) }).last();
    await expect.poll(() => card.getByText('Hand #001').count(), { timeout: 30_000 }).toBe(1);

    await card.getByRole('button', { name: 'Close betting' }).click();
    await card.getByRole('button', { name: 'Use webcam' }).click({ timeout: 30_000 });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return !!v && v.videoWidth > 0; }, null, { timeout: 30_000 });
    await card.getByRole('button', { name: 'Read cards' }).click();
    // The first reading loads OpenCV.js (15 MB) in the browser.
    const reading = card.getByTestId('webcam-reading');
    await expect.poll(() => reading.textContent(), { timeout: 90_000 }).toContain('Read:');
    await card.getByRole('button', { name: 'Use these cards' }).click();
    await expect.poll(() => card.getByText(/^Flop:/).textContent()).toMatch(/A♥\s*K♦\s*7♣/);

    await card.getByRole('button', { name: 'Settle hand' }).click();
    await page.getByRole('button', { name: 'Settle and pay' }).click();

    // The round settled on the cards the camera showed; the mixed-colour bet won; hand 2 is open.
    await expect.poll(async () => (await h.db.query<{ state: string }>('select state from rounds where id = $1', [`${table.id}:h1`])).rows[0]?.state, { timeout: 30_000 }).toBe('SETTLED');
    const round = (await h.db.query<{ flop: string[] }>('select flop from rounds where id = $1', [`${table.id}:h1`])).rows[0]!;
    expect(round.flop).toEqual(FLOP);
    expect(await walletOf(h, player.token)).toBeGreaterThan(before);
    expect((await h.db.query<{ state: string }>('select state from rounds where id = $1', [`${table.id}:h2`])).rows[0]?.state).toBe('OPEN');
    await expect.poll(() => card.getByText('Hand #002').count(), { timeout: 30_000 }).toBe(1);
    expect(errors).toEqual([]);
  }, 180_000);
});
