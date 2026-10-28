import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase } from './helpers';
import { metricHistory } from '../src/server/metric-history';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await fixture.close(); });
it('averages the full week beyond 1000 readings while preserving downtime within a bucket', async () => {
  const now = Date.now();
  const device = await fixture.db.device.create({ data: { name: 'Test', address: 'fixture' } });
  await fixture.db.metric.createMany({ data: Array.from({ length: 1200 }, (_, i) => ({ deviceId: device.id, timestamp: new Date(now - 6 * 86400000 + i * 15000), hashRate: 1000, power: 20, temp: 50 })) });
  await fixture.db.metric.createMany({ data: [0, 15000].map(delta => ({ deviceId: device.id, timestamp: new Date(now - 60000 + delta), hashRate: 2000, power: 30, temp: 60 })) });
  const result = await metricHistory(fixture.db, device.id, 168, now);
  expect(result.bucketMinutes).toBe(30);
  expect(result.metrics[0].hashRate).toBe(1000);
  expect(result.metrics.at(-1)?.hashRate).toBe(2000);
  expect(result.metrics.some(row => row.hashRate === null)).toBe(true);
  expect(result.metrics.length).toBeLessThan(30);
  expect(result.metrics[0].power).toBe(20); expect(result.metrics[0].temp).toBe(50);
});
it('preserves interruptions inside one averaging bucket and averages all three chart metrics', async () => {
  const now = Date.now(), start = Math.floor((now - 3600000) / 1800000) * 1800000;
  const device = await fixture.db.device.create({ data: { name: 'Gap', address: 'gap' } });
  await fixture.db.metric.createMany({ data: [1000, 2000, 300000, 301000].map((delta, i) => ({ deviceId: device.id, timestamp: new Date(start + delta), hashRate: i < 2 ? 1000 + i * 200 : 2000, power: i < 2 ? 10 + i * 2 : 30, temp: i < 2 ? 40 + i * 2 : 60 })) });
  const result = await metricHistory(fixture.db, device.id, 168, now);
  expect(result.metrics).toHaveLength(3);
  expect(result.metrics[0]).toMatchObject({ hashRate: 1100, power: 11, temp: 41 });
  expect(result.metrics[1].hashRate).toBeNull(); expect(result.metrics[2].hashRate).toBe(2000);
});
