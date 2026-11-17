// Mask frames for the walkthrough: node video/capture.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'pages', 'js-animation.html'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 160 }, deviceScaleFactor: 2 });
await page.setContent(html);
for (const [name, selectors] of [['mask-bar', ['#bar', '#clock']], ['mask-track', ['.track', '#clock']]]) {
  for (const frame of ['a', 'b']) {
    await page.screenshot({ path: join(here, 'assets', `${name}-${frame}.png`), animations: 'disabled', mask: selectors.map((s) => page.locator(s)) });
    await page.waitForTimeout(100);
  }
}
await browser.close();
