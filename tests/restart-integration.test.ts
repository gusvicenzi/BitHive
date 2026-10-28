import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server/app.js';
import { AxeAdapter } from '../src/server/adapter.js';
import { DemoAdapter } from '../src/server/demo.js';
import { FleetService } from '../src/server/service.js';
import { AppError } from '../src/server/errors.js';
import { testDatabase } from './helpers.js';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
let service: FleetService;
let hardware: DemoAdapter;
const headers = { host: 'localhost:3080', 'x-bithive': '1' };
const post = (id: string, payload: unknown = {}) => app.inject({ method: 'POST', url: `/api/devices/${id}/restart`, payload, headers });
beforeAll(async () => { fixture = await testDatabase(); });
beforeEach(async () => { await fixture.db.device.deleteMany(); hardware = new DemoAdapter(); service = new FleetService(fixture.db, hardware); app = await createApp(fixture.db, { service }); });
afterEach(async () => { await app?.close(); });
afterAll(async () => { await app?.close(); await fixture?.close(); });
describe('explicit miner restart', () => {
  it('dispatches the official POST endpoint once and accepts an empty acknowledgement', async () => {
    const send = vi.fn(async () => undefined);
    await new AxeAdapter(send).restart('fixture.local');
    expect(send).toHaveBeenCalledExactlyOnceWith('fixture.local', '/api/system/restart', 'POST');
  });
  it('audits a restart before dispatch, observes a lower uptime, persists settings and enforces cooldown', async () => {
    const device = await service.register('192.168.1.42');
    await service.configure(device.id, { stratumUser: 'new.worker' });
    const command = vi.spyOn(hardware, 'restart').mockImplementation(async address => {
      expect(await fixture.db.event.count({ where: { deviceId: device.id, kind: 'restartRequested' } })).toBe(1);
      expect(hardware.read).toHaveBeenCalledTimes(1);
      DemoAdapter.prototype.restart.call(hardware, address);
    });
    const read = vi.spyOn(hardware, 'read');
    expect((await post(device.id)).json()).toEqual({ id: device.id, result: 'restarted', reachable: true });
    expect(command).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    expect((await service.list())[0].snapshot?.settings.stratumUser).toBe('new.worker');
    expect((await post(device.id)).statusCode).toBe(409);
    expect(command).toHaveBeenCalledTimes(1);
    const events = await fixture.db.event.findMany({ where: { deviceId: device.id } });
    expect(events.map(e => e.kind)).toContain('restartRestarted');
    fixture.migrate(); expect((await post(device.id)).json()).toEqual({ error: 'restartCooldown' });
    await app.close();
  });
  it.each(['acknowledged', 'unknown', 'rejected'] as const)('reports %s honestly and reads state without replaying', async outcome => {
    const device = await service.register('192.168.1.42');
    const restart = vi.spyOn(hardware, 'restart');
    if (outcome === 'unknown') restart.mockRejectedValue(new Error('lost acknowledgement'));
    else if (outcome === 'rejected') restart.mockRejectedValue(new AppError('unsupported', 404));
    else restart.mockResolvedValue();
    const read = vi.spyOn(hardware, 'read');
    expect((await post(device.id)).json()).toEqual({ id: device.id, result: outcome, reachable: true });
    expect(restart).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    await app.close();
  });
  it('reports an acknowledged but temporarily unreachable miner as stale and schedules collection', async () => {
    const device = await service.register('192.168.1.42');
    const before = await hardware.read(device.address);
    vi.spyOn(hardware, 'read').mockResolvedValueOnce(before).mockRejectedValue(new Error('rebooting'));
    vi.spyOn(hardware, 'restart').mockResolvedValue();
    expect((await post(device.id)).json()).toEqual({ id: device.id, result: 'acknowledged', reachable: false });
    expect((await service.list())[0].status).toBe('stale');
    await app.close();
  });
  it('validates requests, rejects missing devices and refuses restart during tuning', async () => {
    const device = await service.register('192.168.1.42');
    const restart = vi.spyOn(hardware, 'restart');
    expect((await post(device.id, { frequency: 550 })).statusCode).toBe(400);
    expect((await post('missing')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/devices/${device.id}/restart`, payload: {}, headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
    await fixture.db.tuningRun.create({ data: { deviceId: device.id, requestKey: 'test', activeSlot: 1, config: '{}', state: '{}' } });
    expect((await post(device.id)).json()).toEqual({ error: 'tuningOwnsDevice' });
    expect(restart).not.toHaveBeenCalled();
    await app.close();
  });
  it('does not dispatch a restart when the miner cannot be read beforehand', async () => {
    const device = await service.register('192.168.1.42');
    const restart = vi.spyOn(hardware, 'restart');
    vi.spyOn(hardware, 'read').mockRejectedValue(new AppError('deviceUnavailable'));
    expect((await post(device.id)).json()).toEqual({ error: 'deviceUnavailable' });
    expect(restart).not.toHaveBeenCalled();
    expect(await fixture.db.event.count({ where: { kind: 'restartRequested' } })).toBe(0);
  });
  it('serializes concurrent restart requests so only one command is dispatched', async () => {
    const device = await service.register('192.168.1.42');
    const restart = vi.spyOn(hardware, 'restart');
    const results = await Promise.all([post(device.id), post(device.id)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(restart).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
