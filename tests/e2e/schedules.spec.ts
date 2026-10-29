import { expect, test } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { FleetService } from '../../src/server/service.js';
import { Scheduler } from '../../src/server/scheduler.js';
import { testDatabase } from '../helpers.js';
let fixture: Awaited<ReturnType<typeof testDatabase>>, app: FastifyInstance, scheduler: Scheduler, url: string;
test.beforeAll(async () => {
  fixture = await testDatabase(); const fleet = new FleetService(fixture.db);
  await fleet.enableDemo(); const miners = await fleet.list();
  for (const [index, miner] of miners.entries()) for (const [period, frequency] of [['Fast', index === 0 ? 550 : 575], ['Quiet', index === 0 ? 400 : 450]] as const) {
    await fixture.db.profile.create({ data: { deviceId: miner.id, name: `${miner.name} ${period}`, settings: JSON.stringify({ frequency, coreVoltage: 1150, autofanspeed: 1 }) } });
  }
  scheduler = new Scheduler(fleet, () => Date.parse('2026-10-26T12:00:00Z'));
  app = await createApp(fixture.db, { service: fleet, scheduler, webRoot: resolve('dist/web') });
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});
test.afterAll(async () => { await app?.close(); await fixture?.close(); });
test('shared timetable with per-miner profiles, preview, persistence, mobile and Portuguese', async ({ page }) => {
  await page.goto(url); await page.getByLabel('Language').selectOption('en');
  await page.getByRole('link', { name: 'Schedules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedules', exact: true })).toBeVisible();
  await page.getByLabel('Schedule name').fill('Home day and night'); await page.getByLabel('Timezone (IANA)').fill('UTC');
  await page.getByLabel('Period 1 name').fill('Day'); await page.getByLabel('Period 2 name').fill('Night');
  for (const miner of ['Bitaxe 1', 'Bitaxe 2']) {
    await page.getByLabel(`Schedule ${miner}`, { exact: true }).check();
    await page.getByLabel(`${miner} · Day profile`, { exact: true }).selectOption({ label: `${miner} Fast` });
    await page.getByLabel(`${miner} · Night profile`, { exact: true }).selectOption({ label: `${miner} Quiet` });
  }
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Schedule saved.');
  await page.getByRole('button', { name: 'Enable schedule', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review profile settings' })).toContainText('Bitaxe 1 Fast');
  await expect(page.getByRole('region', { name: 'Review profile settings' })).toContainText('Frequency (MHz): 575');
  await page.getByRole('button', { name: 'Confirm and enable' }).click();
  await expect(page.getByRole('status')).toContainText('Schedule enabled.');
  await scheduler.tick(); await page.reload();
  await page.getByRole('button', { name: /Home day and night/ }).click();
  await expect(page.locator('.schedule-status .result-verified')).toHaveCount(2);
  await expect(page.getByLabel('Bitaxe 1 · Day profile')).toHaveValue(await fixture.db.profile.findFirstOrThrow({ where: { name: 'Bitaxe 1 Fast' } }).then(p => p.id));
  await page.screenshot({ path: 'test-results/schedules-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/schedules-mobile.png', fullPage: true });
  await page.getByLabel('Language').selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Agendamentos', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome do agendamento')).toHaveValue('Home day and night');
  await page.getByRole('button', { name: 'Desativar agendamento', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Agendamento desativado');
  await page.getByRole('button', { name: 'Excluir agendamento', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar exclusão do agendamento' }).click();
  await expect(page.getByRole('status')).toContainText('Agendamento excluído');
});
