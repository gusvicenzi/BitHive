import { expect, test } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`best difficulty tooltip stays visible inside the card at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const snapshot = { model: 'Gamma', bestDiff: '1193857810', settings: {},
      capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
    await page.route('**/api/devices', route => route.fulfill({ json: [{
      id: 'tooltip', name: 'Tooltip miner', address: '192.168.1.42', demo: false,
      status: 'online', lastSeen: new Date().toISOString(), snapshot,
    }] }));
    await page.route('**/api/devices/tooltip/history?*', route => route.fulfill({ json: { metrics: [], events: [], changes: [], limit: 1000 } }));
    await page.route('**/api/devices/tooltip/profiles', route => route.fulfill({ json: [] }));
    await page.route('**/api/devices/tooltip/tuning', route => route.fulfill({ json: [] }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Tooltip miner', exact: true }).click();
    const value = page.getByRole('button', { name: 'Show full best difficulty' });
    await value.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('1,193,857,810');
    const box = (await tooltip.boundingBox())!;
    const card = (await page.locator('.detail').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(card.x);
    expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    // Bounding boxes alone also include clipped content: verify both edges are painted.
    expect(await tooltip.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return [rect.left + 2, rect.right - 2].every(x =>
        element.contains(document.elementFromPoint(x, rect.top + rect.height / 2)));
    })).toBe(true);
    await page.locator('.detail').screenshot({ path: `test-results/bithive-difficulty-tooltip-${width}.png` });
    await value.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await value.blur();
    await value.focus();
    await expect(tooltip).toHaveText('1,193,857,810');
  });
}
