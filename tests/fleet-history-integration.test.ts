import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { testDatabase } from './helpers';
import { fleetTotals } from '../src/shared/fleet';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => { fixture = await testDatabase(); app = await createApp(fixture.db); });
afterAll(async () => { await app?.close(); await fixture?.close(); });
it('returns aligned full-period buckets, preserves gaps and VRM, and validates ranges without device calls', async () => {
  const a = await fixture.db.device.create({ data: { name: 'a', address: 'fixture-a' } });
  const b = await fixture.db.device.create({ data: { name: 'b', address: 'fixture-b' } });
  const start = Math.floor((Date.now() - 600000) / 60000) * 60000;
  await fixture.db.metric.createMany({ data: [
    { deviceId: a.id, timestamp: new Date(start + 1000), hashRate: 1000, power: 10, vrTemp: 60 },
    { deviceId: a.id, timestamp: new Date(start + 16000), hashRate: 1200, power: 12, vrTemp: 62 },
    { deviceId: b.id, timestamp: new Date(start + 5000), hashRate: 500, power: 8, temp: 50 },
    { deviceId: a.id, timestamp: new Date(start + 181000), hashRate: 1300, power: 13, vrTemp: 64 },
    { deviceId: a.id, timestamp: new Date(start - 86400000), hashRate: 9000 },
  ] });
  const response = await app.inject({ url: '/api/fleet/history?hours=1' });
  expect(response.statusCode).toBe(200);
  const history = response.json();
  expect(history.bucketMinutes).toBe(1);
  const first = history.series.find((s: { id: string }) => s.id === a.id).metrics;
  expect(first).toHaveLength(4);
  expect(first[0]).toMatchObject({ hashRate: 1100, power: 11, vrTemp: 61 });
  expect(first[1]).toMatchObject({ hashRate: null, vrTemp: null });
  expect(fleetTotals(history.series)[0]).toMatchObject({ hashRate: 1600, power: 19, contributors: { hashRate: 2, power: 2 } });
  expect((await app.inject({ url: '/api/fleet/history?hours=168' })).json().bucketMinutes).toBe(30);
  for (const query of ['hours=0', 'hours=721', 'hours=x', 'hours=1.2', 'hours=1&unexpected=1']) expect((await app.inject({ url: `/api/fleet/history?${query}` })).statusCode).toBe(400);
  await fixture.db.device.deleteMany();
  expect((await app.inject({ url: '/api/fleet/history' })).json().series).toEqual([]);
});
