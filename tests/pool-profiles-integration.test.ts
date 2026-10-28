import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/server/app.js';
import { testDatabase } from './helpers.js';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: FastifyInstance;
const headers = { host: 'localhost:3080', 'x-bithive': '1' };
const settings = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'wallet.worker' };
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
      const result = await configured.inject({ method: 'POST', url: '/api/batch', headers, payload: { ids: [device.id], action: 'configure', settings: profile.settings } });
      expect(result.json()).toEqual([{ id: device.id, result: 'verified' }]);
      expect((await service.list())[0].snapshot?.settings).toMatchObject(profile.settings);
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
