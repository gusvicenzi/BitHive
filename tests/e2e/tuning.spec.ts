import { expect, test } from '@playwright/test';

test('demo tuning setup, persistent progress, pause/resume, confirmation and results', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/'); await page.getByRole('button', { name: 'Try demo' }).first().click();
  await page.getByRole('button', { name: 'Bitaxe 2', exact: true }).click();
  const tuning = page.getByRole('region', { name: 'Automatic tuning', exact: true });
  for (const [label, value] of Object.entries({
    'Minimum frequency (MHz)': '400', 'Maximum frequency (MHz)': '575', 'Frequency step (MHz)': '25',
    'Minimum voltage (mV)': '1100', 'Maximum voltage (mV)': '1200', 'Voltage step (mV)': '10',
    'Maximum hash error (%)': '2', 'ASIC temperature limit (°C)': '65', 'VRM temperature limit (°C)': '85',
  })) await expect(tuning.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect(tuning.getByLabel('Stabilization duration (seconds)')).toHaveValue('120');
  await expect(tuning.getByLabel('Measurement duration (seconds)')).toHaveValue('300');
  const values: Record<string, string> = { 'Minimum frequency (MHz)': '400', 'Maximum frequency (MHz)': '400', 'Frequency step (MHz)': '25',
    'Minimum voltage (mV)': '1100', 'Maximum voltage (mV)': '1100', 'Voltage step (mV)': '25',
    'ASIC temperature limit (°C)': '80', 'VRM temperature limit (°C)': '90', 'Maximum hash error (%)': '1',
    'Stabilization duration (seconds)': '5', 'Measurement duration (seconds)': '5' };
  for (const [label, value] of Object.entries(values)) await tuning.getByLabel(label, { exact: true }).fill(value);
  await expect(tuning.getByRole('status')).toContainText('400–400 MHz');
  await tuning.screenshot({ path: 'test-results/bithive-tuner-setup.png' });
  await tuning.getByRole('button', { name: 'Start tuning', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Baseline observation', exact: true })).toBeVisible();
  await expect(tuning.getByRole('progressbar', { name: 'Current phase progress' })).toBeVisible();
  await tuning.screenshot({ path: 'test-results/bithive-tuner-live.png' });
  await tuning.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Bitaxe 2', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Paused', exact: true })).toBeVisible();
  await tuning.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(tuning.getByRole('heading', { name: 'Completed', exact: true })).toBeVisible({ timeout: 80000 });
  await expect(tuning.getByRole('table')).toContainText('Confirmation');
  await expect(tuning.getByRole('button', { name: 'Apply confirmed winner' })).toHaveCount(2);
  await tuning.screenshot({ path: 'test-results/bithive-tuning-en.png' });
  await page.getByLabel('Language').selectOption('pt-BR');
  const portuguese = page.getByRole('region', { name: 'Ajuste automático', exact: true });
  await expect(portuguese.getByRole('heading', { name: 'Concluído', exact: true })).toBeVisible();
  await expect(portuguese.getByRole('table')).toContainText('Confirmação');
  await expect(portuguese.getByRole('button', { name: 'Aplicar vencedor confirmado' })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await portuguese.screenshot({ path: 'test-results/bithive-tuning-pt.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('demo recovery failure remains prominent with partial results in both languages', async ({ page }) => {
  const original = { frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60 };
  const snapshot = { hashRate: 1200, power: 20, expectedHashrate: 1200, settings: original, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
  await page.route('**/api/devices', r => r.fulfill({ json: [{ id: 'recovery-demo', address: 'demo-99', name: 'Recovery demo', demo: true, status: 'offline', lastSeen: null, snapshot }] }));
  await page.route('**/api/devices/recovery-demo/profiles', r => r.fulfill({ json: [] }));
  await page.route('**/api/devices/recovery-demo/history?*', r => r.fulfill({ json: { metrics: [], events: [], changes: [], limit: 1000 } }));
  const state = { phase: 'recovery_required', kind: 'search', profile: original, recovery: { status: 'required', reason: 'recoveryFailed' }, reason: 'recoveryFailed', winners: { hashrate: null, efficiency: null } };
  await page.route('**/api/devices/recovery-demo/tuning', r => r.fulfill({ json: [{ id: 'run', deviceId: 'recovery-demo', state, config: { mode: 'fast', expected: { source: 'firmware' }, frequency: { minimum: 400, maximum: 575, step: 25 }, voltage: { minimum: 1100, maximum: 1200, step: 10 }, maxAsicTemperature: 65, maxVrmTemperature: 85, maxErrorPercentage: 2, stabilizationSeconds: 120, measurementSeconds: 300 }, createdAt: new Date().toISOString() }] }));
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

test('live operating window, labeled readings and countdown fit desktop and mobile', async ({ page }) => {
  const profile = { frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60 };
  const snapshot = { hashRate: 1190, power: 18.2, expectedHashrate: 1200, settings: profile, capabilities: { writable: [], frequencies: [400, 525, 575], voltages: [1100, 1150, 1200], poolMode: 'none' } };
  const run = { id: 'visual-run', deviceId: 'visual-demo', createdAt: new Date().toISOString(), config: {
    mode: 'complete', expected: { source: 'firmware' }, fan: { mode: 'automatic' }, tolerance: 5,
    frequency: { minimum: 400, maximum: 575, step: 25 }, voltage: { minimum: 1100, maximum: 1200, step: 10 },
    maxAsicTemperature: 65, maxVrmTemperature: 85, maxErrorPercentage: 2, stabilizationSeconds: 120, measurementSeconds: 300,
  }, state: { phase: 'measuring', kind: 'search', profile, baselinePassed: true, deadline: Date.now() + 180000,
    recovery: { status: 'verified' }, reason: null, winners: { hashrate: null, efficiency: null },
    live: { at: Date.now(), ths: 1.19, watts: 18.2, error: 0.2, asic: 50.69, vrm: 57, expected: 1.2 } } };
  await page.route('**/api/devices', route => route.fulfill({ json: [{ id: 'visual-demo', address: 'demo-1', name: 'Console demo', demo: true, status: 'online', lastSeen: new Date().toISOString(), snapshot }] }));
  await page.route('**/api/devices/visual-demo/profiles', route => route.fulfill({ json: [] }));
  await page.route('**/api/devices/visual-demo/history?*', route => route.fulfill({ json: { metrics: [], events: [], changes: [], limit: 1000 } }));
  await page.route('**/api/devices/visual-demo/tuning', route => route.fulfill({ json: [run] }));
  await page.route('**/api/devices/visual-demo/tuning/visual-run/results?*', route => route.fulfill({ json: { attempts: [], total: 0, offset: 0, limit: 100 } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Console demo', exact: true }).click();
  const tuning = page.getByRole('region', { name: 'Automatic tuning', exact: true });
  await expect(tuning.getByRole('heading', { name: 'Measuring', exact: true })).toBeVisible();
  await expect(tuning.getByRole('img')).toHaveAccessibleName(/525 MHz, 1150 mV/);
  await expect(tuning.getByText('Current profile within the search bounds')).toBeVisible();
  await expect(tuning.getByRole('progressbar')).toHaveAttribute('max', '300');
  await tuning.screenshot({ path: 'test-results/bithive-tuner-console-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Language').selectOption('pt-BR');
  const portuguese = page.getByRole('region', { name: 'Ajuste automático', exact: true });
  await expect(portuguese.getByRole('heading', { name: 'Medindo', exact: true })).toBeVisible();
  await expect(portuguese.getByRole('progressbar')).toBeVisible();
  await portuguese.screenshot({ path: 'test-results/bithive-tuner-console-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
