import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server/app.js';
import { testDatabase } from './helpers.js';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
const headers = { host: 'localhost:3080', 'x-bithive': '1' };
const settings = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumAccount: 'wallet' };
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload, headers });
beforeAll(async () => { fixture = await testDatabase(); app = await createApp(fixture.db); });
beforeEach(async () => { await fixture.db.poolProfile.deleteMany(); await fixture.db.device.deleteMany(); });
afterAll(async () => { await app?.close(); await fixture?.close(); });

describe('shared pool profile storage and API', () => {
  it('creates, migrates idempotently, persists after app restart, updates and deletes without changing miners', async () => {
    const device = await fixture.db.device.create({ data: { address: 'demo-1', name: 'Existing', snapshot: '{}' } });
    const created = await post('/api/pool-profiles', { name: 'Main', settings });
    expect(created.statusCode).toBe(201);
    const profile = created.json(); fixture.migrate();
    const restarted = await createApp(fixture.db);
    try { expect((await restarted.inject({ url: '/api/pool-profiles', headers })).json()).toEqual([profile]); }
    finally { await restarted.close(); }
    expect((await post(`/api/pool-profiles/${profile.id}`, { name: 'Updated', settings: { ...settings, stratumPort: 4444 } })).json()).toMatchObject({ name: 'Updated', settings: { stratumPort: 4444 } });
    expect((await post(`/api/pool-profiles/${profile.id}/delete`, {})).json()).toEqual({ deleted: true });
    expect((await app.inject({ url: '/api/pool-profiles', headers })).json()).toEqual([]);
    expect(await fixture.db.device.findUnique({ where: { id: device.id } })).toEqual(device);
    expect(await fixture.db.configChange.count()).toBe(0);
  });
  it('rejects passwords, arbitrary fields, duplicate names, invalid settings and missing profiles', async () => {
    for (const bad of [{ ...settings, stratumPassword: 'never-store' }, { ...settings, frequency: 500 }, { ...settings, stratumPort: 0 }, {}]) {
      expect((await post('/api/pool-profiles', { name: 'Bad', settings: bad })).statusCode).toBe(400);
    }
    const profile = (await post('/api/pool-profiles', { name: 'Main', settings })).json();
    expect((await post('/api/pool-profiles', { name: ' Main ', settings })).statusCode).toBe(409);
    expect((await post(`/api/pool-profiles/${profile.id}`, { name: 'Main', settings: { ...settings, stratumPassword: 'never-store' } })).statusCode).toBe(400);
    expect(JSON.stringify(await fixture.db.poolProfile.findMany())).not.toContain('never-store');
    expect((await post('/api/pool-profiles/missing', { name: 'Main', settings })).statusCode).toBe(404);
    expect((await post('/api/pool-profiles/missing/delete', {})).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/pool-profiles', payload: { name: 'Untrusted', settings }, headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
  });
  it('enforces the global profile limit', async () => {
    await fixture.db.poolProfile.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ name: `Profile ${i}`, settings: JSON.stringify(settings) })) });
    expect((await post('/api/pool-profiles', { name: 'Extra', settings })).json()).toEqual({ error: 'poolProfileLimit' });
    const profile = await fixture.db.poolProfile.findFirstOrThrow();
    expect((await post(`/api/pool-profiles/${profile.id}`, { name: profile.name, settings })).statusCode).toBe(200);
  });
  it('applies a saved profile through the existing audited readback workflow', async () => {
    const service = new FleetService(fixture.db, new DemoAdapter());
    const device = await service.register('192.168.1.42');
    const profile = (await post('/api/pool-profiles', { name: 'Reusable', settings: { ...settings, stratumPort: 4444 } })).json();
    const configured = await createApp(fixture.db, { service });
    try {
      const result = await configured.inject({ method: 'POST', url: '/api/batch', headers, payload: { ids: [device.id], action: 'configure', settings: { stratumURL: profile.settings.stratumURL, stratumPort: profile.settings.stratumPort }, poolAccounts: { primary: profile.settings.stratumAccount } } });
      expect(result.json()).toEqual([{ id: device.id, result: 'verified' }]);
      expect((await service.list())[0].snapshot?.settings).toMatchObject({ stratumURL: profile.settings.stratumURL, stratumPort: profile.settings.stratumPort, stratumUser: `wallet.${device.snapshot!.hostname}` });
      expect(await fixture.db.configChange.count({ where: { result: 'verified' } })).toBe(1);
    } finally { await configured.close(); }
  });
});


describe('fallback configuration workflow', () => {
  it('persists fallback readback and redacts both passwords from snapshots and audits', async () => {
    const service = new FleetService(fixture.db, new DemoAdapter());
    const device = await service.register('192.168.1.42');
    const originalPrimary = { stratumURL: device.snapshot!.settings.stratumURL, stratumPort: device.snapshot!.settings.stratumPort, stratumUser: device.snapshot!.settings.stratumUser };
    const config = { fallbackStratumURL: 'backup.example.com', fallbackStratumPort: 5555, fallbackStratumUser: 'backup.worker' };
    expect((await service.configure(device.id, config)).result).toBe('verified');
    expect((await service.list())[0].snapshot?.settings).toMatchObject({ ...originalPrimary, ...config });
    const restarted = new FleetService(fixture.db, new DemoAdapter());
    expect((await restarted.list())[0].snapshot?.settings).toMatchObject(config);
    expect((await restarted.configure(device.id, { ...config, stratumPassword: 'primary-secret', fallbackStratumPassword: 'fallback-secret' })).result).toBe('unverified');
    const audit = JSON.stringify(await fixture.db.configChange.findMany());
    expect(audit).not.toContain('primary-secret'); expect(audit).not.toContain('fallback-secret');
    expect(audit).toContain('fallbackPasswordChanged'); expect(audit).toContain('passwordChanged');
    const stored = JSON.stringify(await fixture.db.device.findMany());
    expect(stored).not.toContain('fallback-secret'); expect(stored).not.toContain('primary-secret');
    expect((await post('/api/batch', { ids: [device.id], action: 'configure', settings: { fallbackStratumPort: 0 } })).statusCode).toBe(400);
  });
  it('reads back once after an uncertain fallback write and never retries it', async () => {
    const hardware = new DemoAdapter();
    const service = new FleetService(fixture.db, hardware);
    const device = await service.register('192.168.1.42');
    const patch = vi.spyOn(hardware, 'patch').mockRejectedValue(new Error('timeout'));
    const read = vi.spyOn(hardware, 'read');
    expect((await service.configure(device.id, { fallbackStratumPort: 5555 })).result).toBe('unknown');
    expect(patch).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  });
});


describe('profile workers', () => {
  it('reads old stored profiles as account-only without modifying storage and saves the canonical account', async () => {
    const old = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'account.dotted.oldworker' };
    const row = await fixture.db.poolProfile.create({ data: { name: 'Legacy', settings: JSON.stringify(old) } });
    const [profile] = (await app.inject({ url: '/api/pool-profiles', headers })).json();
    expect(profile.settings).toEqual({ stratumURL: old.stratumURL, stratumPort: 3333, stratumAccount: 'account.dotted' });
    expect((await fixture.db.poolProfile.findUniqueOrThrow({ where: { id: row.id } })).settings).toBe(JSON.stringify(old));
    expect((await post(`/api/pool-profiles/${row.id}`, { name: 'Legacy', settings: profile.settings })).statusCode).toBe(200);
    expect((await fixture.db.poolProfile.findUniqueOrThrow({ where: { id: row.id } })).settings).not.toContain('oldworker');
  });
  it('derives each selected miner worker from its freshly read AxeOS hostname for both pools', async () => {
    const hardware = new DemoAdapter(); const service = new FleetService(fixture.db, hardware);
    const first = await service.register('192.168.1.41', 'Unrelated display label');
    const second = await service.register('192.168.1.42', 'Another display label');
    hardware.restore(first.address, { ...(await hardware.read(first.address)).snapshot.settings, hostname: 'Living Room AXE' });
    hardware.restore(second.address, { ...(await hardware.read(second.address)).snapshot.settings, hostname: 'OFFICE AXE' });
    // Stored snapshots still contain the old name; command resolution must use the fresh read.
    const configured = await createApp(fixture.db, { service });
    try {
      const response = await configured.inject({ method: 'POST', url: '/api/batch', headers, payload: {
        ids: [first.id, second.id], action: 'configure', poolAccounts: { primary: 'wallet', fallback: 'backup.account' },
      } });
      expect(response.json().map((r: { result: string }) => r.result)).toEqual(['verified', 'verified']);
      const devices = await service.list();
      expect(devices[0].snapshot?.settings).toMatchObject({ stratumUser: 'wallet.livingroomaxe', fallbackStratumUser: 'backup.account.livingroomaxe' });
      expect(devices[1].snapshot?.settings).toMatchObject({ stratumUser: 'wallet.officeaxe', fallbackStratumUser: 'backup.account.officeaxe' });
      expect((await fixture.db.configChange.findMany()).map(c => JSON.parse(c.requested).stratumUser)).toContain('wallet.officeaxe');
    } finally { await configured.close(); }
  });
  it('rejects ambiguous requests and fails only the miner with no AxeOS name without dispatching its configuration', async () => {
    const hardware = new DemoAdapter(); const service = new FleetService(fixture.db, hardware);
    const first = await service.register('192.168.1.41'); const second = await service.register('192.168.1.42');
    const originalRead = hardware.read.bind(hardware);
    vi.spyOn(hardware, 'read').mockImplementation(async address => {
      const reading = await originalRead(address);
      if (address === second.address) { delete reading.snapshot.hostname; delete reading.snapshot.settings.hostname; }
      return reading;
    });
    const patch = vi.spyOn(hardware, 'patch');
    const configured = await createApp(fixture.db, { service });
    try {
      const base = { ids: [first.id, second.id], action: 'configure', poolAccounts: { primary: 'wallet' } };
      const result = await configured.inject({ method: 'POST', url: '/api/batch', headers, payload: base });
      expect(result.json()).toEqual([{ id: first.id, result: 'verified' }, { id: second.id, result: 'rejected', reason: 'axeosNameRequired' }]);
      expect(patch).toHaveBeenCalledTimes(1);
      for (const payload of [{ ...base, settings: { stratumUser: 'copied.worker' } }, { ...base, poolAccounts: {} }, { ...base, action: 'refresh' }]) {
        expect((await configured.inject({ method: 'POST', url: '/api/batch', headers, payload })).statusCode).toBe(400);
      }
    } finally { await configured.close(); }
  });
});
