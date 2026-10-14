import { expect, test } from '@playwright/test';

test('demo tuning setup, persistent progress, pause/resume, confirmation and results', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/'); await page.getByRole('button', { name: 'Try demo' }).first().click();
  await page.getByRole('button', { name: 'Bitaxe 2', exact: true }).click();
  const tuning = page.getByRole('region', { name: 'Automatic tuning', exact: true });
  await expect(tuning.getByLabel('Stabilization duration (seconds)')).toHaveValue('120');
  await expect(tuning.getByLabel('Measurement duration (seconds)')).toHaveValue('300');
  const values: Record<string, string> = { 'Minimum frequency (MHz)': '400', 'Maximum frequency (MHz)': '400', 'Frequency step (MHz)': '25',
    'Minimum voltage (mV)': '1100', 'Maximum voltage (mV)': '1100', 'Voltage step (mV)': '25',
    'ASIC temperature limit (°C)': '80', 'VRM temperature limit (°C)': '90', 'Maximum hash error (%)': '1',
    'Stabilization duration (seconds)': '5', 'Measurement duration (seconds)': '5' };
  for (const [label, value] of Object.entries(values)) await tuning.getByLabel(label, { exact: true }).fill(value);
  await expect(tuning.getByRole('status')).toContainText('400–400 MHz');
  await tuning.getByRole('button', { name: 'Start tuning', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Baseline observation', exact: true })).toBeVisible();
  await tuning.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Bitaxe 2', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await tuning.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible({ timeout: 80000 });
  await expect(tuning.getByRole('table')).toContainText('Confirmation');
  await expect(tuning.getByRole('button', { name: 'Apply confirmed winner' })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/bithive-tuning-en.png', fullPage: true });
  await page.getByLabel('Language').selectOption('pt-BR');
  const portuguese = page.getByRole('region', { name: 'Ajuste automático', exact: true });
  await expect(portuguese.getByRole('heading', { name: 'Concluído', exact: true })).toBeVisible();
  await expect(portuguese.getByRole('table')).toContainText('Confirmação');
  await expect(portuguese.getByRole('button', { name: 'Aplicar vencedor confirmado' })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/bithive-tuning-pt.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('demo recovery failure remains prominent with partial results in both languages', async ({ page }) => {
  const original = { frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60 };
  const snapshot = { hashRate: 1200, power: 20, expectedHashrate: 1200, settings: original, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
  await page.route('**/api/devices', r => r.fulfill({ json: [{ id: 'recovery-demo', address: 'demo-99', name: 'Recovery demo', demo: true, status: 'offline', lastSeen: null, snapshot }] }));
  await page.route('**/api/devices/recovery-demo/profiles', r => r.fulfill({ json: [] }));
  await page.route('**/api/devices/recovery-demo/history?*', r => r.fulfill({ json: { metrics: [], events: [], changes: [], limit: 1000 } }));
  const state = { phase: 'recovery_required', kind: 'search', profile: original, recovery: { status: 'required', reason: 'recoveryFailed' }, reason: 'recoveryFailed', winners: { hashrate: null, efficiency: null } };
  await page.route('**/api/devices/recovery-demo/tuning', r => r.fulfill({ json: [{ id: 'run', deviceId: 'recovery-demo', state, config: { mode: 'fast', expected: { source: 'firmware' } }, createdAt: new Date().toISOString() }] }));
  await page.route('**/api/devices/recovery-demo/tuning/run/results?*', r => r.fulfill({ json: { attempts: [{ id: 'attempt', kind: 'search', profile: original, outcome: 'invalid', summary: null, reason: 'connectionLoss' }], total: 1, offset: 0, limit: 100 } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Recovery demo', exact: true }).click();
  const tuning = page.getByRole('region', { name: 'Automatic tuning', exact: true });
  await expect(tuning.getByRole('heading', { name: 'Recovery required' })).toBeVisible();
  await expect(tuning).toContainText('manual recovery required');
  await expect(tuning.getByRole('button', { name: 'Resume' })).toBeDisabled();
  await expect(tuning.getByRole('table')).toContainText('Incomplete measurement');
  await expect(tuning).toContainText('Best among tested configurations');
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Recuperação necessária', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ajuste automático', exact: true }).getByRole('table')).toContainText('Medição incompleta');
});
