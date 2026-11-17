import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('build status card', async ({ page }) => {
  await page.setContent(readFileSync(process.env.PAGE_FILE!, 'utf8'));
  const mask = (process.env.MASK || '').split(',').filter(Boolean).map((s) => page.locator(s));
  await expect(page).toHaveScreenshot('card.png', { mask });
});
