import { expect, test } from '@playwright/test';

test('first run, demonstration fleet, configuration readback and language', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Your hive starts with one miner.')).toBeVisible();
  await page.getByRole('button', { name: 'Try demo' }).first().click();
  await expect(page.getByText('Demonstration', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Hash error (%)' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include power supply losses' }).check();
  await expect(page.getByLabel('Power supply efficiency (%)')).toHaveValue('85');
  await page.getByLabel('Power supply efficiency (%)').fill('90');
  await expect(page.getByText(/wall estimate · 90% efficiency/)).toBeVisible();
  await page.getByRole('button', { name: 'Bitaxe 1', exact: true }).click();
  await expect(page.getByText('Starminer 601').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Frequency (MHz)', exact: true }).selectOption('550');
  await page.getByRole('button', { name: 'Apply & verify' }).click();
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Frequency (MHz)', exact: true }).locator('option').first()).toContainText('550');
  for (const [label, unit] of [['Hashrate', 'TH/s'], ['Power', 'W'], ['Chip temperature', '°C']]) {
    const chart = page.getByRole('slider', { name: `Inspect ${label} history` });
    await expect(page.getByLabel(`${label} scale (${unit})`)).toBeVisible();
    await chart.hover({ position: { x: 5, y: 80 } });
    await expect(chart.getByRole('tooltip')).toContainText(unit);
    await expect(chart.getByRole('tooltip').locator('time')).toHaveAttribute('datetime', /.+/);
    await chart.focus();
    await page.keyboard.press('Home');
    await expect(chart).toHaveAttribute('aria-valuenow', '0');
    await page.keyboard.press('End');
    const plotBox = (await chart.boundingBox())!;
    const tooltipBox = (await chart.getByRole('tooltip').boundingBox())!;
    expect(tooltipBox.x).toBeGreaterThanOrEqual(plotBox.x - 1);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(plotBox.x + plotBox.width + 1);
    await page.keyboard.press('Escape');
    await expect(chart.getByRole('tooltip')).toHaveCount(0);
  }
  await page.getByRole('slider', { name: 'Inspect Hashrate history' }).hover({ position: { x: 20, y: 80 } });
  await page.locator('.charts').screenshot({ path: 'test-results/bithive-chart-tooltip.png' });
  await page.getByLabel('AxeOS name (hostname)').fill('demo-office');
  await page.getByRole('button', { name: 'Change AxeOS name & verify' }).click();
  await expect(page.getByLabel('AxeOS name (hostname)')).toHaveValue('demo-office');
  await expect(page.getByRole('region', { name: 'Miner names' }).getByRole('status')).toContainText('Verified');
  await page.getByLabel('BitHive display name', { exact: true }).fill('Office miner');
  await page.getByRole('button', { name: 'Save display name' }).click();
  await expect(page.getByRole('heading', { name: 'Office miner', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/bithive-detail.png', fullPage: true });
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Sua colmeia, à vista.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sua colmeia, à vista.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Office miner', exact: true })).toBeVisible();
  await expect(page.getByLabel('Eficiência da fonte (%)')).toHaveValue('90');
  await page.screenshot({ path: 'test-results/bithive-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/bithive-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('graph TH/s, fleet hash errors and nonzero power-supply estimates', async ({ page }) => {
  // Synthetic responses exercise the UI without contacting or configuring miners.
  const now = Date.now();
  const snapshot = { model: 'Gamma', hostname: 'office-gamma', hashRate: 1712, power: 56.7, temp: 54.8, errorRate: 0.93, bestDiff: '1564123456789',
    settings: {}, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
  await page.route('**/api/devices', route => route.fulfill({ json: [{ id: 'example', address: '192.168.1.42', name: 'Office miner', demo: false, status: 'online', lastSeen: new Date(now).toISOString(), snapshot }] }));
  await page.route(/\/api\/devices\/example\/history\?/, route => route.fulfill({ json: {
    metrics: [0, 15, 30].map((seconds, index) => ({ timestamp: new Date(now - 30000 + seconds * 1000).toISOString(), hashRate: 1690 + index * 11, power: 56.7, temp: 54.8, vrTemp: 60, errorRate: 0.93 })), events: [], changes: [], limit: 1000,
  } }));
  await page.route('**/api/devices/example/profiles', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('columnheader', { name: 'Hash error (%)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Office miner' }).locator('xpath=ancestor::tr')).toContainText('0.93');
  await page.getByRole('checkbox', { name: 'Include power supply losses' }).check();
  await expect(page.getByLabel(/Miner power 56.7 W/)).toContainText('56.7+10.0=66.7 W');
  await page.locator('.summary').screenshot({ path: 'test-results/bithive-power-estimate.png' });
  await page.getByRole('button', { name: 'Office miner', exact: true }).click();
  const difficulty = page.getByRole('button', { name: 'Show full best difficulty' });
  await expect(difficulty).toHaveText('1.564T');
  await difficulty.hover();
  await expect(page.getByRole('tooltip')).toHaveText('1,564,123,456,789');
  await page.mouse.move(0, 0);
  await expect(page.locator('.chart-hashRate figcaption')).toContainText('1.712 TH/s');
  await page.getByRole('slider', { name: 'Inspect Hashrate history' }).focus();
  await expect(page.getByRole('tooltip')).toContainText('1.712 TH/s');
  await expect(page.getByLabel('Hashrate scale (TH/s)')).toBeVisible();
  await page.locator('.charts').screenshot({ path: 'test-results/bithive-ths-charts.png' });
});
