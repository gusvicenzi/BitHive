import { expect, test } from '@playwright/test';

test('firmware averages below fleet and miner hashrates on desktop and mobile', async ({ page }) => {
  const snapshot = { hashRate: 1700, hashRate_1m: 1650, hashRate_10m: 1600, hashRate_1h: 1550,
    model: 'Gamma', settings: {}, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
  await page.route('**/api/devices', route => route.fulfill({ json: [
    { id: 'a', name: 'Bitaxe01', address: '192.168.1.41', demo: false, status: 'online', lastSeen: new Date().toISOString(), snapshot },
    { id: 'b', name: 'Bitaxe02', address: '192.168.1.42', demo: false, status: 'online', lastSeen: new Date().toISOString(), snapshot },
  ] }));
  await page.goto('/');
  const fleet = page.locator('.summary article').filter({ hasText: 'Fleet hashrate' });
  await expect(fleet.locator('.hashrate-averages')).toContainText('3.3');
  await expect(fleet.locator('.hashrate-averages')).toContainText('3.2');
  await expect(fleet.locator('.hashrate-averages')).toContainText('3.1');
  const row = page.getByRole('button', { name: 'Bitaxe01', exact: true }).locator('xpath=ancestor::tr');
  await expect(row.locator('.hashrate-averages')).not.toBeVisible();
  const powerColumnX = (await row.locator('.numeric').nth(1).boundingBox())!.x;
  const collapsedHeight = (await row.boundingBox())!.height;
  await page.screenshot({ path: 'test-results/bithive-hashrate-averages-desktop.png', fullPage: true });
  await row.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('.hashrate-averages')).toBeVisible();
  await expect(row.locator('.hashrate-averages')).toContainText('1.65');
  await expect(row.locator('.hashrate-averages')).not.toContainText('TH/s');
  await expect(row.locator('.hashrate-averages>div')).toHaveCount(3);
  expect((await row.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
  expect((await row.locator('.numeric').nth(1).boundingBox())!.x).toBeCloseTo(powerColumnX, 0);
  await page.screenshot({ path: 'test-results/bithive-hashrate-averages-expanded.png', fullPage: true });
  await page.keyboard.press('Enter');
  await expect(row.locator('.hashrate-averages')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fleet.locator('.hashrate-averages')).toBeVisible();
  await row.locator('summary').click();
  await expect(row.locator('.hashrate-averages')).toBeVisible();
  await row.locator('summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/bithive-hashrate-averages-mobile.png', fullPage: true });
});
