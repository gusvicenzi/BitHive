import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/server/app.js';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';
import { Collector } from '../src/server/collector.js';
import { retention } from '../src/server/repository.js';
import { testDatabase } from './helpers.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let service: FleetService;
const hardware = new DemoAdapter();
const headers = { host: 'localhost:3080', 'x-bithive': '1' };
const post = (url: string, payload: unknown, extra = {}) => app.inject({ method: 'POST', url, payload, headers: { ...headers, ...extra } });
beforeAll(async () => { fixture = await testDatabase(); service = new FleetService(fixture.db, hardware); app = await createApp(fixture.db, { service }); });
beforeEach(async () => { await fixture.db.device.deleteMany(); });
afterAll(async () => { await app?.close(); await fixture?.close(); });
async function miner() { return service.register('192.168.1.42', 'Test Gamma'); }

describe('migration and persistence', () => {
  it('persists normalized input voltage and exposes it after a service restart', async () => {
    const device = await miner();
    const stored = await fixture.db.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(JSON.parse(stored.snapshot).inputVoltage).toBeCloseTo(5.11);
    const restarted = new FleetService(fixture.db, hardware);
    expect((await restarted.list())[0].snapshot?.inputVoltage).toBeCloseTo(5.11);
    const response = await app.inject({ url: '/api/devices', headers });
    expect(response.json()[0].snapshot.inputVoltage).toBeCloseTo(5.11);
  });
  it('deploys committed migrations twice without losing existing user data', async () => {
    const device = await miner(); fixture.migrate();
    const second = new PrismaClient({ datasources: { db: { url: fixture.url } } });
    expect((await second.device.findUnique({ where: { id: device.id } }))?.name).toBe('Test Gamma');
    await second.$disconnect();
  });
  it('persists readings, identity, and events at registration and handles duplicates', async () => {
    const device = await miner();
    expect(device.snapshot?.mac).toBeDefined(); expect(device.status).toBe('online');
    expect(await fixture.db.metric.count()).toBe(1); expect(await fixture.db.event.count()).toBe(1);
    await expect(miner()).rejects.toThrow('duplicateDevice');
  });
  it('retains recent data and expires old metrics/events/audits', async () => {
    const device = await miner();
    await fixture.db.metric.create({ data: { deviceId: device.id, timestamp: new Date(0), power: 10 } });
    await fixture.db.event.create({ data: { deviceId: device.id, timestamp: new Date(0), kind: 'connected' } });
    await fixture.db.configChange.create({ data: { deviceId: device.id, timestamp: new Date(0), before: '{}', requested: '{}', result: 'observed' } });
    await retention(fixture.db);
    expect(await fixture.db.metric.count()).toBe(1); expect(await fixture.db.event.count()).toBe(1); expect(await fixture.db.configChange.count()).toBe(0);
  });
});
describe('API input and browser boundary', () => {
  it('validates registration and batch inputs', async () => {
    expect((await post('/api/devices', { address: 'http://x', name: '' })).statusCode).toBe(400);
    expect((await post('/api/batch', { ids: ['a'], action: 'configure' })).statusCode).toBe(400);
    expect((await post('/api/batch', { ids: ['a', 'a'], action: 'refresh' })).statusCode).toBe(400);
    expect((await post('/api/batch', { ids: ['a'], action: 'configure', settings: { overheat_mode: 0 } })).statusCode).toBe(400);
  });
  it('rejects cross-origin writes, missing write header, and untrusted Host headers', async () => {
    expect((await post('/api/demo', {}, { origin: 'https://attacker.example' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/demo', payload: {}, headers: { host: 'localhost' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/devices', headers: { host: 'attacker.example' } })).statusCode).toBe(403);
  });
  it('accepts local origins and returns security headers', async () => {
    const response = await app.inject({ url: '/api/devices', headers: { host: 'localhost:3080', origin: 'http://localhost:3080' } });
    expect(response.statusCode).toBe(200); expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('limits historical queries and returns missing-device errors', async () => {
    const device = await miner();
    expect((await app.inject({ url: `/api/devices/${device.id}/history?hours=721`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/devices/missing/history', headers })).statusCode).toBe(404);
    const response = await app.inject({ url: `/api/devices/${device.id}/history`, headers });
    expect(response.json().metrics).toHaveLength(1); expect(response.json().limit).toBe(1000);
  });
});
describe('configuration workflows', () => {
  it('verifies changes by readback, persists audits and reports per-device batch failures', async () => {
    const device = await miner();
    const response = await post('/api/batch', { ids: [device.id, 'missing'], action: 'configure', settings: { frequency: 550 } });
    expect(response.json()).toEqual([{ id: device.id, result: 'verified' }, { id: 'missing', result: 'rejected', reason: 'notFound' }]);
    expect((await service.list())[0].snapshot?.settings.frequency).toBe(550);
    expect(await fixture.db.configChange.count({ where: { result: 'verified' } })).toBe(1);
  });
  it('never persists passwords and reports write-only values as unverified', async () => {
    const device = await miner();
    expect((await service.configure(device.id, { stratumPassword: 'test-only-secret' })).result).toBe('unverified');
    const audit = JSON.stringify(await fixture.db.configChange.findMany());
    expect(audit).not.toContain('test-only-secret'); expect(audit).toContain('passwordChanged');
    expect(JSON.stringify(await fixture.db.device.findMany())).not.toContain('test-only-secret');
  });
  it('does not replay an unknown command and still attempts readback', async () => {
    const device = await miner();
    const adapter = new DemoAdapter(); const patch = vi.spyOn(adapter, 'patch').mockRejectedValue(new Error('timeout'));
    const read = vi.spyOn(adapter, 'read'); const uncertain = new FleetService(fixture.db, adapter);
    expect((await uncertain.configure(device.id, { frequency: 575 })).result).toBe('unknown');
    expect(patch).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  });
  it('reports mismatched acknowledged writes as unverified', async () => {
    const device = await miner(); const adapter = new DemoAdapter();
    vi.spyOn(adapter, 'patch').mockResolvedValue();
    expect((await new FleetService(fixture.db, adapter).configure(device.id, { frequency: 575 })).result).toBe('unverified');
  });
  it('returns unknown when post-write verification becomes unreachable', async () => {
    const device = await miner(); const adapter = new DemoAdapter();
    const initial = await adapter.read(device.address);
    vi.spyOn(adapter, 'read').mockResolvedValueOnce(initial).mockRejectedValue(new Error('unreachable'));
    expect((await new FleetService(fixture.db, adapter).configure(device.id, { frequency: 575 })).result).toBe('unknown');
    expect((await service.list())[0].status).toBe('stale');
  });
  it('saves device-scoped operating profiles and rejects credentials or empty profiles', async () => {
    const device = await miner();
    expect((await post(`/api/devices/${device.id}/profiles`, { name: 'Quiet', settings: { frequency: 500 } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/devices/${device.id}/profiles`, headers })).json()[0].settings).toEqual({ frequency: 500 });
    expect((await post(`/api/devices/${device.id}/profiles`, { name: 'Bad', settings: { stratumPassword: 'secret' } })).statusCode).toBe(400);
    expect((await post(`/api/devices/${device.id}/profiles`, { name: 'Empty', settings: {} })).statusCode).toBe(400);
  });
});
describe('background collection and demonstration', () => {
  it('collects without any browser requests', async () => {
    const device = await miner();
    await fixture.db.device.update({ where: { id: device.id }, data: { nextPoll: new Date(0) } });
    await new Collector(service).tick();
    expect(await fixture.db.metric.count()).toBe(2);
  });
  it('backs off failures, marks stale data, and recovers with an event', async () => {
    const device = await miner(); const adapter = new DemoAdapter();
    const reader = vi.spyOn(adapter, 'read').mockRejectedValue(new Error('offline'));
    const failing = new FleetService(fixture.db, adapter);
    await failing.poll(device.id);
    const once = await fixture.db.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(once.failures).toBe(1); expect(once.nextPoll.getTime() - Date.now()).toBeGreaterThan(25000);
    expect((await failing.list())[0].status).toBe('stale');
    await failing.poll(device.id); await failing.poll(device.id);
    expect((await failing.list())[0].status).toBe('offline');
    reader.mockRestore(); await failing.poll(device.id);
    expect((await failing.list())[0].status).toBe('online'); expect(await fixture.db.event.count({ where: { kind: 'connected' } })).toBe(2);
  });
  it('creates an idempotent demo and preserves its configuration across service restarts', async () => {
    await service.enableDemo(); await service.enableDemo();
    expect(await fixture.db.device.count()).toBe(3);
    const device = (await service.list())[0];
    await service.configure(device.id, { frequency: 575 });
    const restarted = new FleetService(fixture.db);
    await restarted.poll(device.id);
    expect((await restarted.list())[0].snapshot?.settings.frequency).toBe(575);
  });
});
