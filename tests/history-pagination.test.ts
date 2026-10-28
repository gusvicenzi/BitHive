import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { FleetService } from '../src/server/service';
import { DemoAdapter } from '../src/server/demo';
import { testDatabase } from './helpers';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let id: string;
const headers = { host: 'localhost:3080' };
beforeAll(async () => {
  fixture = await testDatabase();
  const service = new FleetService(fixture.db, new DemoAdapter());
  id = (await service.register('192.168.1.42')).id;
  app = await createApp(fixture.db, { service });
  await fixture.db.event.deleteMany();
  await fixture.db.event.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ deviceId: id, kind: 'connected', timestamp: new Date(Date.now() - i * 1000) })) });
  await fixture.db.event.create({ data: { deviceId: id, kind: 'disconnected', timestamp: new Date(Date.now() - 2 * 3600000) } });
});
afterAll(async () => { await app?.close(); await fixture?.close(); });
it('loads one bounded activity type, paginates without overlap and filters by time', async () => {
  const get = (query: string) => app.inject({ url: `/api/devices/${id}/history?${query}`, headers });
  const first = (await get('hours=1&section=events&pageSize=20')).json();
  expect(first.events).toHaveLength(20); expect(first.hasMore).toBe(true);
  expect(first.metrics).toEqual([]); expect(first.changes).toEqual([]);
  const second = (await get('hours=1&section=events&pageSize=20&offset=20')).json();
  expect(second.events).toHaveLength(5); expect(second.hasMore).toBe(false);
  expect(second.events.some((event: { id: number }) => first.events.some((other: { id: number }) => other.id === event.id))).toBe(false);
  expect((await get('hours=24&section=events&pageSize=100')).json().events).toHaveLength(26);
  const metrics = (await get('section=metrics')).json();
  expect(metrics.events).toEqual([]); expect(metrics.changes).toEqual([]);
});
it('rejects unbounded or invalid history requests and missing miners', async () => {
  for (const query of ['section=invalid', 'offset=-1', 'pageSize=101', 'hours=0']) {
    expect((await app.inject({ url: `/api/devices/${id}/history?${query}`, headers })).statusCode).toBe(400);
  }
  expect((await app.inject({ url: '/api/devices/missing/history?section=events', headers })).statusCode).toBe(404);
});
