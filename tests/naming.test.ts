import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { testDatabase } from './helpers.js';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';
import { AxeAdapter, normalize, infoSchema, type Reading } from '../src/server/adapter.js';
import { createApp } from '../src/server/app.js';
import { hostnameSchema, type Settings } from '../src/shared/domain.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); });
beforeEach(async () => { await fixture.db.device.deleteMany(); });
afterAll(async () => { await fixture?.close(); });
const headers = { host: 'localhost:3080', 'x-bithive': '1' };
describe('miner names', () => {
  it('registers using the reported AxeOS name without writing to the miner', async () => {
    const adapter = new DemoAdapter(); const patch = vi.spyOn(adapter, 'patch');
    vi.spyOn(adapter, 'read').mockResolvedValue({ raw: { version: 'fixture', hostname: 'office-gamma' }, snapshot: normalize({ version: 'fixture', hostname: 'office-gamma' }) });
    const device = await new FleetService(fixture.db, adapter).register('192.168.1.42');
    expect(device.name).toBe('office-gamma'); expect(patch).not.toHaveBeenCalled();
  });
  it('accepts a deliberate local label and defaults blank labels to the AxeOS name', async () => {
    const service = new FleetService(fixture.db, new DemoAdapter());
    expect((await service.register('192.168.1.41', ' Desk miner ')).name).toBe('Desk miner');
    expect((await service.register('192.168.1.42', ' ')).name).toBe('192.168.1.42');
  });
  it('uses model or address when firmware has no usable hostname', async () => {
    const adapter = new DemoAdapter(); const read = vi.spyOn(adapter, 'read');
    read.mockResolvedValueOnce({ raw: { version: 'fixture' }, snapshot: normalize({ version: 'fixture', deviceModel: 'Gamma' }) });
    read.mockResolvedValueOnce({ raw: { version: 'fixture' }, snapshot: normalize({ version: 'fixture' }) });
    const service = new FleetService(fixture.db, adapter);
    expect((await service.register('192.168.1.41')).name).toBe('Gamma');
    expect((await service.register('192.168.1.42')).name).toBe('192.168.1.42');
  });
  it('changes only the local display name, even while offline, and records it', async () => {
    const adapter = new DemoAdapter(); const service = new FleetService(fixture.db, adapter);
    const device = await service.register('192.168.1.42');
    await fixture.db.device.update({ where: { id: device.id }, data: { failures: 3 } });
    const read = vi.spyOn(adapter, 'read'); const patch = vi.spyOn(adapter, 'patch');
    const renamed = await service.renameDisplayName(device.id, ' Desk miner ');
    expect(renamed.name).toBe('Desk miner'); expect(renamed.status).toBe('offline');
    expect(read).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
    expect(await fixture.db.configChange.count({ where: { requested: JSON.stringify({ displayName: 'Desk miner' }) } })).toBe(1);
    await expect(service.renameDisplayName(device.id, ' ')).rejects.toThrow();
    await expect(service.renameDisplayName('missing', 'Desk')).rejects.toThrow('notFound');
  });
  it('verifies AxeOS hostname changes and updates an automatically derived label', async () => {
    const adapter = new DemoAdapter(); const service = new FleetService(fixture.db, adapter);
    const device = await service.register('192.168.1.42');
    const result = await service.configure(device.id, { hostname: 'OFFICE-Gamma' });
    expect(result.result).toBe('verified');
    const updated = (await service.list())[0];
    expect(updated.snapshot?.hostname).toBe('office-gamma'); expect(updated.name).toBe('office-gamma');
  });
  it('preserves a custom BitHive label across AxeOS name changes', async () => {
    const service = new FleetService(fixture.db, new DemoAdapter());
    const device = await service.register('192.168.1.42', 'My desk');
    await service.configure(device.id, { hostname: 'office-gamma' });
    expect((await service.list())[0].name).toBe('My desk');
  });
  it('retains demo hostname changes across service restarts', async () => {
    const service = new FleetService(fixture.db); await service.enableDemo();
    const device = (await service.list())[0];
    await service.configure(device.id, { hostname: 'demo-office' });
    const restarted = new FleetService(fixture.db); await restarted.poll(device.id);
    expect((await restarted.list())[0].snapshot?.hostname).toBe('demo-office');
  });
  it('pins a hostname-based registration to IP before rename and readback', async () => {
    const demo = new DemoAdapter(); const adapter = {
      read: vi.fn<(address: string) => Promise<Reading>>(async () => demo.read('demo-1')),
      patch: vi.fn(async (_address: string, settings: Settings, reading: Reading) => demo.patch('demo-1', settings, reading)),
      stableAddress: vi.fn(async () => '192.168.1.42'),
    };
    const service = new FleetService(fixture.db, adapter); const device = await service.register('demo-1.local');
    expect((await service.configure(device.id, { hostname: 'new-name' })).result).toBe('verified');
    expect(adapter.patch.mock.calls[0][0]).toBe('192.168.1.42');
    expect(adapter.read).toHaveBeenLastCalledWith('192.168.1.42');
    expect((await service.list())[0].address).toBe('192.168.1.42');
  });
  it('does not send a rename if the resolved IP belongs to another registration', async () => {
    const adapter = Object.assign(new DemoAdapter(), { stableAddress: async () => '192.168.1.42' });
    const service = new FleetService(fixture.db, adapter);
    await service.register('192.168.1.42'); const device = await service.register('old.local');
    const patch = vi.spyOn(adapter, 'patch');
    await expect(service.configure(device.id, { hostname: 'new-name' })).rejects.toThrow('duplicateDevice');
    expect(patch).not.toHaveBeenCalled();
  });
  it('reports unknown rename outcomes without replaying the command', async () => {
    const adapter = new DemoAdapter(); const service = new FleetService(fixture.db, adapter);
    const device = await service.register('192.168.1.42');
    const patch = vi.spyOn(adapter, 'patch').mockRejectedValue(new Error('timeout'));
    expect((await service.configure(device.id, { hostname: 'new-name' })).result).toBe('unknown');
    expect(patch).toHaveBeenCalledTimes(1); expect((await service.list())[0].name).toBe(device.name);
  });
  it('validates hostname syntax and sends exactly the official PATCH field', async () => {
    expect(hostnameSchema.parse(' OFFICE-01 ')).toBe('office-01');
    for (const name of ['', 'a.local', '-abc', 'abc-', 'two words', 'x'.repeat(64), '<script>']) expect(hostnameSchema.safeParse(name).success).toBe(false);
    const send = vi.fn(async () => ({ version: 'fixture', hostname: 'old-name' }));
    const adapter = new AxeAdapter(send); const reading = await adapter.read('192.168.1.42');
    await adapter.patch('192.168.1.42', { hostname: 'new-name' }, reading);
    expect(send).toHaveBeenLastCalledWith('192.168.1.42', '/api/system', 'PATCH', { hostname: 'new-name' });
    expect(normalize(infoSchema.parse({ version: 'fixture' })).capabilities.writable).not.toContain('hostname');
  });
  it('accepts registration without a name and rejects invalid rename API input', async () => {
    const service = new FleetService(fixture.db, new DemoAdapter()); const app = await createApp(fixture.db, { service });
    try {
      const registration = await app.inject({ method: 'POST', url: '/api/devices', headers, payload: { address: '192.168.1.42' } });
      expect(registration.statusCode).toBe(201); const device = registration.json();
      expect((await app.inject({ method: 'POST', url: `/api/devices/${device.id}/name`, headers, payload: { name: 'New label' } })).json().name).toBe('New label');
      expect((await app.inject({ method: 'POST', url: `/api/devices/${device.id}/name`, headers, payload: { name: ' ' } })).statusCode).toBe(400);
      for (const body of [
        { ids: [device.id], action: 'configure', settings: { hostname: 'bad.local' } },
        { ids: [device.id, 'another'], action: 'configure', settings: { hostname: 'same-name' } },
        { ids: [device.id], action: 'configure', settings: { hostname: 'new-name', frequency: 500 } },
      ]) expect((await app.inject({ method: 'POST', url: '/api/batch', headers, payload: body })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
