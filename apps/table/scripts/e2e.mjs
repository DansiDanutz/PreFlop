/**
 * End-to-end run of the club tablet against the live API, with three browser tablets (dealer,
 * floor, floor manager — separate browser profiles, so three separate non-extractable keys) and
 * the simulator acting ONLY as the Table Box device.
 *
 *   # API on :4000, tablet dev server on :5175 (pnpm --filter @preflop/table dev)
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node apps/table/scripts/e2e.mjs
 *
 * Hand A: dealer and floor agree with the camera → SETTLED.
 * Hand B: the floor enters a different card → REVIEW → the floor manager settles from the evidence.
 * Screenshots (1180×820) go to docs/screens/table/.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const BASE = process.env.TABLET_URL ?? 'http://localhost:5175';
const SHOTS = resolve(repo, 'docs/screens/table');
const WORK = process.env.E2E_DIR ?? join(tmpdir(), 'preflop-table-e2e');
const TABLE = 'tablet-e2e';
mkdirSync(SHOTS, { recursive: true });
mkdirSync(WORK, { recursive: true });
const flopsPath = join(WORK, 'flops.json');
rmSync(flopsPath, { force: true });

const PEOPLE = { dealer: 'Ana · D-117', floor: 'Bogdan · F-204', floor_manager: 'Carmen · FM-02' };
const PIN = '402817';
const ROLE_BUTTON = { dealer: 'Dealer', floor: 'Floor', floor_manager: 'Floor manager' };
const TSX = resolve(here, '../node_modules/.bin/tsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

const browser = await chromium.launch({ headless: true });
const tablets = {};
for (const role of ['dealer', 'floor', 'floor_manager']) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: false });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [${role} console] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`  [${role} pageerror] ${e.message}`));
  tablets[role] = page;
}
// Let transitions and the card pop animation finish so the screenshot shows the settled UI.
const shot = (page, name) => sleep(500).then(() => page.screenshot({ path: join(SHOTS, name) })).then(() => log('screenshot', name));
const extra = (page, name) => page.screenshot({ path: join(WORK, name) });

async function hold(page, locator, ms = 900) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('hold target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(ms);
  await page.mouse.up();
}

async function waitFlop(n) {
  for (let i = 0; i < 120; i++) {
    if (existsSync(flopsPath)) {
      const f = JSON.parse(readFileSync(flopsPath, 'utf8'));
      if (f[n]) return f[n];
    }
    await sleep(250);
  }
  throw new Error(`no flop recorded by the device for hand ${n}`);
}

async function enterFlop(page, cards, screenshot) {
  await page.getByTestId('flop-entry').waitFor({ timeout: 30_000 });
  for (const c of cards) await page.locator(`[data-card="${c}"]`).click();
  if (screenshot) await shot(page, screenshot);
  await page.getByTestId('flop-review-btn').click();
  await page.getByTestId('flop-review').waitFor();
  await hold(page, page.locator('button:has([data-testid=flop-submit])'));
  await page.getByTestId('flop-review').waitFor({ state: 'detached', timeout: 15_000 });
}

let device;
try {
  // ---------------------------------------------------------------- 1. setup + key generation
  const pems = {};
  for (const role of ['dealer', 'floor', 'floor_manager']) {
    const page = tablets[role];
    await page.goto(BASE);
    await page.locator('input[name=tableId]').fill(TABLE);
    await page.locator('input[name=personId]').fill(PEOPLE[role]);
    await page.getByRole('button', { name: ROLE_BUTTON[role], exact: true }).click();
    if (role === 'dealer') await shot(page, 'setup.png');
    await page.getByTestId('create-key').click();
    await page.getByTestId('public-pem').waitFor();
    pems[role] = { personId: PEOPLE[role], pem: await page.getByTestId('public-pem').textContent() };
    log(role, 'key fingerprint', await page.getByTestId('fingerprint').textContent());
  }

  // ---------------------------------------------------------------- 2. club admin enrolls the public keys
  const tabletsJson = join(WORK, 'tablets.json');
  const keysJson = join(WORK, 'device-keys.json');
  writeFileSync(tabletsJson, JSON.stringify(pems));
  const out = execFileSync(TSX, ['--conditions=preflop-source', join(here, 'e2e-setup.ts'), tabletsJson, keysJson], { cwd: repo, encoding: 'utf8' });
  const enrolled = JSON.parse(out.trim().split('\n').pop());
  log('enrolled', enrolled.credentials);

  // ---------------------------------------------------------------- 3. Table Box (device role only)
  const devLog = openSync(join(WORK, 'device.log'), 'w');
  device = spawn(TSX, ['--conditions=preflop-source', join(here, 'e2e-device.ts'), keysJson, flopsPath], { cwd: repo, stdio: ['ignore', devLog, devLog], detached: true });

  // ---------------------------------------------------------------- 4. tablets verify their credential
  for (const role of ['dealer', 'floor', 'floor_manager']) {
    const page = tablets[role];
    await page.locator('input[name=credentialId]').fill(enrolled.credentials[role]);
    if (role === 'dealer') await shot(page, 'enrollment.png');
    await page.getByTestId('verify-cred').click();
    // Last step of enrollment: the staff PIN (typed twice).
    await page.getByTestId('pin-new').fill(PIN);
    await page.getByTestId('pin-new').press('Enter');
    await page.getByTestId('pin-confirm').fill(PIN);
    await page.getByTestId('pin-confirm').press('Enter');
    await page.getByTestId('role-badge').waitFor({ timeout: 15_000 });
    log(role, 'verified:', await page.getByTestId('role-badge').textContent());
  }
  const { dealer, floor, floor_manager: manager } = tablets;

  // ---------------------------------------------------------------- 4b. staff lock: lock now, wrong PIN, right PIN
  await dealer.getByRole('button', { name: 'Tablet settings' }).click();
  await dealer.getByTestId('lock-now').click();
  await dealer.getByTestId('lock-screen').waitFor();
  await dealer.getByTestId('unlock-pin').fill('999999');
  await dealer.getByTestId('unlock-pin').press('Enter');
  await dealer.getByText('Wrong PIN.').waitFor();
  await extra(dealer, 'dealer-locked.png');
  await dealer.getByTestId('unlock-pin').fill(PIN);
  await dealer.getByTestId('unlock-pin').press('Enter');
  await dealer.getByTestId('role-badge').waitFor({ timeout: 10_000 });
  log('dealer: locked, refused a wrong PIN, unlocked with the PIN');

  async function playProcedure(first) {
    await dealer.getByTestId('dealer-open').waitFor({ timeout: 40_000 });
    const n = Number((await dealer.getByTestId('dealer-open').textContent()).match(/hand (\d+)/)[1]);
    await sleep(600);
    if (first) await shot(dealer, 'dealer-open.png');
    log(`hand ${n}: START (press and hold)`);
    await hold(dealer, dealer.locator('button:has([data-testid=btn-start])'));
    await dealer.getByTestId('dealer-cut').waitFor({ timeout: 20_000 });
    const depth = await dealer.getByTestId('cut-depth').textContent();
    if (first) await shot(dealer, 'dealer-cut.png');
    log(`hand ${n}: CUT AT ${depth}`);
    await hold(dealer, dealer.locator('button:has([data-testid=btn-cut])'));
    await hold(dealer, dealer.locator('button:has([data-testid=btn-deal-start])'));
    return n;
  }

  // ---------------------------------------------------------------- 5. hand A: everyone agrees
  const a = await playProcedure(true);
  const flopA = await waitFlop(a);
  log(`hand ${a}: true flop ${flopA.join(' ')}`);
  await enterFlop(dealer, flopA, 'dealer-flop-entry.png');
  await enterFlop(floor, flopA, 'floor-confirm.png');
  await floor.getByTestId('floor-result').filter({ hasText: 'Match' }).waitFor({ timeout: 30_000 });
  log(`hand ${a}: SETTLED, floor shows Match`);
  await extra(floor, 'floor-match.png');
  await extra(dealer, 'dealer-after-a.png');

  // ---------------------------------------------------------------- 6. hand B: floor disagrees → REVIEW
  const b = await playProcedure(false);
  const flopB = await waitFlop(b);
  const wrong = ['As', 'Ks', 'Qs', 'Js', 'Ts', '9s'].find((c) => !flopB.includes(c));
  const floorB = [flopB[0], flopB[1], wrong];
  log(`hand ${b}: true flop ${flopB.join(' ')}, floor will enter ${floorB.join(' ')}`);
  await enterFlop(dealer, flopB);
  // Portrait tablet check (extra, not committed): the floor picker at 820×1180.
  await floor.setViewportSize({ width: 820, height: 1180 });
  await floor.getByTestId('flop-entry').waitFor({ timeout: 30_000 });
  await sleep(400);
  await extra(floor, 'floor-portrait.png');
  await floor.setViewportSize({ width: 1180, height: 820 });
  await enterFlop(floor, floorB);
  await manager.getByTestId('review-panel').waitFor({ timeout: 40_000 });
  log(`hand ${b}: REVIEW reached; manager tablet switched to the review queue`);
  await manager.locator('[data-testid=evidence-image], text=evidence viewer is not available').first().waitFor({ timeout: 10_000 }).catch(() => {});
  await sleep(800);
  await shot(manager, 'manager-review.png');
  await manager.getByTestId('btn-settle-cards').click();
  await enterFlop(manager, flopB);
  await floor.getByTestId('floor-result').filter({ hasText: 'Settled by review' }).waitFor({ timeout: 30_000 });
  log(`hand ${b}: SETTLED by the floor manager with ${flopB.join(' ')}`);
  await extra(floor, 'floor-review-settled.png');
  await extra(manager, 'manager-after.png');
  await extra(dealer, 'dealer-after-b.png');
  log('E2E PASSED');
} catch (e) {
  console.error('E2E FAILED:', e);
  for (const [role, page] of Object.entries(tablets)) await extra(page, `fail-${role}.png`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (device?.pid) { try { process.kill(-device.pid, 'SIGTERM'); } catch { /* already gone */ } }
  await browser.close();
}
