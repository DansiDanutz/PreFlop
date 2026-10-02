/**
 * Renders the PWA PNG icons from public/icon.svg and public/icon-maskable.svg with the local
 * Chromium (no network, no image library). Run after changing an icon:
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node apps/web/scripts/icons.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const pub = join(dirname(fileURLToPath(import.meta.url)), '../public');
const OUT = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon.svg', png: 'apple-touch-icon.png', size: 180 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
];

const browser = await chromium.launch();
try {
  for (const o of OUT) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    const svg = readFileSync(join(pub, o.svg), 'utf8');
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${o.size}" height="${o.size}" `)}</body></html>`);
    await page.screenshot({ path: join(pub, o.png), omitBackground: true, clip: { x: 0, y: 0, width: o.size, height: o.size } });
    await page.close();
    console.log('wrote', o.png);
  }
} finally {
  await browser.close();
}
