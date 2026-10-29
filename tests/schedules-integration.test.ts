import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';
import { Scheduler } from '../src/server/scheduler.js';
import { createApp } from '../src/server/app.js';
import { retention } from '../src/server/repository.js';
import type { ScheduleInput } from '../src/shared/schedules.js';
import { testDatabase } from './helpers.js';
let fixture: Awaited<ReturnType<typeof testDatabase>>, app: FastifyInstance;
let fleet: FleetService, adapter: DemoAdapter, scheduler: Scheduler, now: number, first: string, second: string;
let dayA: string, nightA: string, dayB: string, nightB: string;
const headers = { host: 'localhost', 'x-bithive': '1' };
const post = (path: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/schedules${path}`, headers, payload });
const input = (): ScheduleInput => ({ name: 'Home', timeZone: 'UTC', points: [
  { id: 'day', name: 'Day', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'night', name: 'Night', time: '22:00', days: [0, 1, 2, 3, 4, 5, 6] },
], members: [ { deviceId: first, assignments: { day: dayA, night: nightA }, customValuesAcknowledged: false },
  { deviceId: second, assignments: { day: dayB, night: nightB }, customValuesAcknowledged: false } ] });
async function create(data = input(), enabled = true) {
  const response = await post('', data); expect(response.statusCode).toBe(201);
  const id: string = response.json().id;
  if (enabled) expect((await post(`/${id}/enable`)).statusCode).toBe(200);
  return id;
}
async function settings(deviceId: string) { return (await fleet.list()).find(d => d.id === deviceId)?.snapshot?.settings; }
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await app?.close(); await fixture?.close(); });
beforeEach(async () => {
  await app?.close(); vi.restoreAllMocks();
  await fixture.db.schedule.deleteMany(); await fixture.db.device.deleteMany();
  now = Date.parse('2026-10-26T12:00:00Z'); adapter = new DemoAdapter(); fleet = new FleetService(fixture.db, adapter);
  first = (await fleet.register('miner-1')).id; second = (await fleet.register('miner-2')).id;
  const profile = async (deviceId: string, name: string, frequency: number) => (await fixture.db.profile.create({ data: { deviceId, name, settings: JSON.stringify({ frequency, coreVoltage: 1150, autofanspeed: 1 }) } })).id;
  dayA = await profile(first, 'A Fast', 550); nightA = await profile(first, 'A Efficient', 400);
  dayB = await profile(second, 'B Fast', 575); nightB = await profile(second, 'B Efficient', 450);
  scheduler = new Scheduler(fleet, () => now); app = await createApp(fixture.db, { service: fleet, scheduler });
});
describe('persistent scheduled profiles', () => {
  it('creates disabled schedules and applies different profiles to miners at shared transitions exactly once', async () => {
    const id = await create(input(), false); const patch = vi.spyOn(adapter, 'patch');
    await scheduler.tick(); expect(patch).not.toHaveBeenCalled();
    await post(`/${id}/enable`); await scheduler.tick();
    expect(await settings(first)).toMatchObject({ frequency: 550 }); expect(await settings(second)).toMatchObject({ frequency: 575 });
    await scheduler.tick(); await new Scheduler(fleet, () => now).tick(); expect(patch).toHaveBeenCalledTimes(2);
    now = Date.parse('2026-10-26T22:00:00Z'); await scheduler.tick();
    expect(await settings(first)).toMatchObject({ frequency: 400 }); expect(await settings(second)).toMatchObject({ frequency: 450 });
    expect(patch).toHaveBeenCalledTimes(4);
    const view = await scheduler.repository.get(id); expect(view.results.every(r => r.status === 'verified')).toBe(true);
    const history = await app.inject({ url: `/api/devices/${first}/history?hours=720`, headers });
    expect(history.json().scheduleChanges[0]).toMatchObject({ scheduleName: 'Home', periodName: 'Night', profileName: 'A Efficient', status: 'verified' });
  });
  it('catches up only the current period after downtime and preserves profiles through migrations and reconnection', async () => {
    await create(); const patch = vi.spyOn(adapter, 'patch');
    now = Date.parse('2026-10-28T23:00:00Z'); await scheduler.tick(); expect(patch).toHaveBeenCalledTimes(2);
    expect(await settings(first)).toMatchObject({ frequency: 400 });
    fixture.migrate(); const db = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    try { await new Scheduler(new FleetService(db, adapter), () => now).tick(); expect(patch).toHaveBeenCalledTimes(2); } finally { await db.$disconnect(); }
  });
  it('waits without dispatch when offline and chooses the current profile on reconnection', async () => {
    await create(); const patch = vi.spyOn(adapter, 'patch'); const read = vi.spyOn(adapter, 'read').mockRejectedValue(new Error('offline'));
    await scheduler.tick(); expect(patch).not.toHaveBeenCalled();
    expect((await fixture.db.scheduleExecution.findMany()).every(e => !e.attempted && e.status === 'waiting')).toBe(true);
    now = Date.parse('2026-10-26T23:00:00Z'); read.mockRestore(); await scheduler.tick();
    expect(await settings(first)).toMatchObject({ frequency: 400 }); expect(patch).toHaveBeenCalledTimes(2);
  });
  it('never replays attempted writes with unknown outcomes after a restart', async () => {
    const id = await create(); const patch = vi.spyOn(adapter, 'patch').mockRejectedValue(new Error('timeout'));
    await scheduler.tick(); await new Scheduler(fleet, () => now).tick();
    expect(patch).toHaveBeenCalledTimes(2); expect((await scheduler.repository.get(id)).results.every(r => r.status === 'unknown')).toBe(true);
  });
  it('reconciles a crash claim by reads only, marking a match verified and a mismatch unknown', async () => {
    await create(); await scheduler.tick();
    await fixture.db.scheduleExecution.updateMany({ data: { status: 'dispatching' } });
    adapter.restore('miner-2', { frequency: 400 });
    const patch = vi.spyOn(adapter, 'patch'); await new Scheduler(fleet, () => now).tick(); expect(patch).not.toHaveBeenCalled();
    const records = await fixture.db.scheduleExecution.findMany(); expect(records.find(e => e.deviceId === first)?.status).toBe('verified'); expect(records.find(e => e.deviceId === second)?.status).toBe('unknown');
  });
  it('skips matching settings without sending configuration commands', async () => {
    adapter.restore('miner-1', { frequency: 550, coreVoltage: 1150, autofanspeed: 1 });
    adapter.restore('miner-2', { frequency: 575, coreVoltage: 1150, autofanspeed: 1 });
    await create(); const patch = vi.spyOn(adapter, 'patch'); await scheduler.tick(); expect(patch).not.toHaveBeenCalled();
    expect((await fixture.db.scheduleExecution.findMany()).every(e => e.attempted && e.status === 'verified')).toBe(true);
  });
  it('keeps manual changes until the next transition across restarts, while pool-only edits do not override', async () => {
    const id = await create(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    await fleet.configure(first, { frequency: 500 }); await new Scheduler(fleet, () => now).tick();
    expect(await settings(first)).toMatchObject({ frequency: 500 }); expect((await scheduler.repository.get(id)).results.find(r => r.deviceId === first)?.status).toBe('manual');
    await fleet.configure(second, { stratumURL: 'pool.new.test' });
    expect((await fixture.db.scheduleMember.findUniqueOrThrow({ where: { scheduleId_deviceId: { scheduleId: id, deviceId: second } } })).overrideUntil).toBeNull();
    now = Date.parse('2026-10-26T22:00:00Z'); await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 400 });
  });
  it('rechecks a manual override queued ahead of scheduled work under the device lock', async () => {
    await create(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    await Promise.all([fleet.configure(first, { frequency: 500 }), scheduler.tick()]);
    expect(await settings(first)).toMatchObject({ frequency: 500 });
    expect(await fixture.db.scheduleExecution.count({ where: { deviceId: first, attempted: true } })).toBe(0);
  });
  it('defers to tuning, then reevaluates the current period after tuning releases ownership', async () => {
    const id = await create();
    await fixture.db.tuningRun.create({ data: { deviceId: first, requestKey: 'test', activeSlot: 1, config: '{}', state: '{}' } });
    await scheduler.tick(); expect((await scheduler.repository.get(id)).results.find(r => r.deviceId === first)).toMatchObject({ status: 'waiting', reason: 'tuningOwnsDevice' });
    await fixture.db.tuningRun.deleteMany(); now = Date.parse('2026-10-26T23:00:00Z'); await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 400 });
  });
  it('requires custom-value acknowledgment and invalidates it after profile settings change', async () => {
    await fixture.db.profile.update({ where: { id: dayA }, data: { settings: JSON.stringify({ frequency: 537 }) } });
    const id = await create(input(), false); expect((await post(`/${id}/enable`)).json().error).toBe('scheduleAcknowledgment');
    const data = input(); data.members[0].customValuesAcknowledged = true;
    expect((await post(`/${id}`, data)).statusCode).toBe(200); expect((await post(`/${id}/enable`)).statusCode).toBe(200);
    await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 537 });
    await fixture.db.profile.update({ where: { id: dayA }, data: { settings: JSON.stringify({ frequency: 538 }) } });
    now += 86400000; await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 537 });
    expect((await scheduler.repository.get(id)).results.find(r => r.deviceId === first)?.status).toBe('blocked');
  });
  it('validates complete matrices, profile ownership, overlapping points, and exclusive enabled membership', async () => {
    const data = input(); data.members[0].assignments.day = dayB;
    expect((await post('', data)).json().error).toBe('scheduleProfileOwner');
    data.members = []; const empty = await create(data, false); expect((await post(`/${empty}/enable`)).json().error).toBe('scheduleIncomplete');
    const incomplete = input(); delete incomplete.members[0].assignments.day;
    const partial = await create(incomplete, false); expect((await post(`/${partial}/enable`)).statusCode).toBe(400);
    const overlap = input(); overlap.points[1].time = '08:00'; expect((await post('', overlap)).statusCode).toBe(400);
    await create(); const conflict = await create(input(), false); expect((await post(`/${conflict}/enable`)).statusCode).toBe(409);
    expect((await post(`/${conflict}/enable`, { enabled: true })).statusCode).toBe(400);
  });
  it('enabled edits take effect, disabling/deleting leave settings and preserve activity until retention', async () => {
    const id = await create(); await scheduler.tick();
    const data = input(); data.members[0].assignments.day = nightA;
    await post(`/${id}`, data); await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 400 });
    await post(`/${id}/disable`); await scheduler.tick(); expect(await settings(first)).toMatchObject({ frequency: 400 });
    await post(`/${id}/delete`); expect(await fixture.db.schedule.count()).toBe(0); expect(await fixture.db.scheduleExecution.count()).toBeGreaterThan(0);
    await retention(fixture.db, now + 91 * 86400000); expect(await fixture.db.scheduleExecution.count()).toBe(0);
  });
  it('resolves an uncertain acknowledged write by reading after reconnect, without dispatching it again', async () => {
    const data = input(); data.members = data.members.slice(0, 1); const id = await create(data);
    const originalPatch = adapter.patch.bind(adapter), originalRead = adapter.read.bind(adapter);
    const patch = vi.spyOn(adapter, 'patch').mockImplementation(async (...args) => { await originalPatch(...args); throw new Error('lost acknowledgement'); });
    let reads = 0;
    vi.spyOn(adapter, 'read').mockImplementation(async address => { if (++reads === 2) throw new Error('read timeout'); return originalRead(address); });
    await scheduler.tick(); expect((await scheduler.repository.get(id)).results[0].status).toBe('unknown');
    await new Scheduler(fleet, () => now).tick(); expect((await scheduler.repository.get(id)).results[0].status).toBe('verified');
    expect(patch).toHaveBeenCalledTimes(1);
  });
  it('blocks firmware-protected miners and resumes after protection clears', async () => {
    const id = await create(); const originalRead = adapter.read.bind(adapter); let protectedMiner = true;
    vi.spyOn(adapter, 'read').mockImplementation(async address => { const r = await originalRead(address); r.snapshot.firmwareProtection = protectedMiner; return r; });
    const patch = vi.spyOn(adapter, 'patch'); await scheduler.tick(); expect(patch).not.toHaveBeenCalled();
    expect((await scheduler.repository.get(id)).results.every(r => r.status === 'blocked' && r.reason === 'scheduleProtection')).toBe(true);
    protectedMiner = false; await scheduler.tick(); expect(patch).toHaveBeenCalledTimes(2);
  });
  it('uses durable claims when separate scheduler instances race for the same transition', async () => {
    await create(); const patch = vi.spyOn(adapter, 'patch');
    await Promise.allSettled([scheduler.tick(), new Scheduler(fleet, () => now).tick()]);
    await scheduler.tick(); expect(patch).toHaveBeenCalledTimes(2);
    expect(await fixture.db.scheduleExecution.count({ where: { attempted: true } })).toBe(2);
  });
  it('paginates schedule activity independently of device events', async () => {
    await create(); await scheduler.tick(); now += 86400000; await scheduler.tick();
    const response = await app.inject({ url: `/api/devices/${first}/history?hours=720&section=schedules&pageSize=1`, headers });
    expect(response.json().scheduleChanges).toHaveLength(1); expect(response.json().hasMore).toBe(true); expect(response.json().events).toEqual([]);
    const next = await app.inject({ url: `/api/devices/${first}/history?hours=720&section=schedules&pageSize=1&offset=1`, headers });
    expect(next.json().scheduleChanges[0].id).not.toBe(response.json().scheduleChanges[0].id);
  });
  it('starts idempotently and stops its background cycle cleanly', async () => {
    const tick = vi.spyOn(scheduler, 'tick').mockResolvedValue(undefined);
    scheduler.start(); scheduler.start(); await scheduler.stop(); expect(tick).toHaveBeenCalledTimes(1);
  });

  it('disables promptly during a slow read and cancels dispatch after taking the device lock', async () => {
    const data = input(); data.members = data.members.slice(0, 1); const id = await create(data);
    const originalRead = adapter.read.bind(adapter), patch = vi.spyOn(adapter, 'patch');
    let release!: () => void, entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(adapter, 'read').mockImplementation(async address => { entered(); await held; return originalRead(address); });
    const cycle = scheduler.tick(); await reading;
    try { expect((await post(`/${id}/disable`)).statusCode).toBe(200); } finally { release(); }
    await cycle; expect(patch).not.toHaveBeenCalled();
  });

});
