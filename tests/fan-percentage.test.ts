import { afterAll, beforeAll, expect, it } from 'vitest';
import { infoSchema, normalize, AxeAdapter } from '../src/server/adapter';
import { createApp } from '../src/server/app';
import { FleetService } from '../src/server/service';
import { testDatabase } from './helpers';
it('normalizes live fanspeed independently from the manual setting in either cooling mode', () => {
  for (const autofanspeed of [0, 1]) {
    const snapshot = normalize(infoSchema.parse({ version: 'fixture', fanspeed: 42.5, fanrpm: 4000, autofanspeed, manualFanSpeed: 80 }));
    expect(snapshot).toMatchObject({ fanPercent: 42.5, fanRpm: 4000, settings: { manualFanSpeed: 80, autofanspeed } });
  }
  expect(normalize(infoSchema.parse({ version: 'fixture', fanspeed: 0 })).fanPercent).toBe(0);
  expect(normalize(infoSchema.parse({ version: 'fixture', fanspeed: 100 })).fanPercent).toBe(100);
});
it('preserves other telemetry when fan percentage is missing or invalid, without substituting manual settings', () => {
  for (const fanspeed of [undefined, null, -1, 101, NaN, Infinity, '50']) {
    const snapshot = normalize(infoSchema.parse({ version: 'fixture', fanspeed, fanrpm: 4000, manualFanSpeed: 80 }));
    expect(snapshot.fanPercent).toBeUndefined(); expect(snapshot.fanRpm).toBe(4000);
  }
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await app?.close(); await fixture?.close(); });
it('persists live fan percentage and exposes it through the fleet API after service restart', async () => {
  const adapter = new AxeAdapter(async () => ({ version: 'fixture', fanspeed: 42.5, fanrpm: 4000, autofanspeed: 1, manualFanSpeed: 80 }));
  const service = new FleetService(fixture.db, adapter);
  await service.register('192.168.1.42', 'Fixture');
  app = await createApp(fixture.db, { service: new FleetService(fixture.db, adapter) });
  const response = await app.inject({ url: '/api/devices', headers: { host: 'localhost:3080' } });
  expect(response.statusCode).toBe(200);
  expect(response.json()[0].snapshot).toMatchObject({ fanPercent: 42.5, fanRpm: 4000, settings: { manualFanSpeed: 80 } });
});
