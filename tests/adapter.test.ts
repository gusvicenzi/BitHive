import { describe, expect, it, vi } from 'vitest';
import { AxeAdapter, infoSchema, normalize, validateCapabilities } from '../src/server/adapter.js';
import { DemoAdapter } from '../src/server/demo.js';
import { AppError } from '../src/server/errors.js';

const info = { ASICModel: 'BM1370', boardVersion: '601', version: 'fixture', hashRate: 1200, power: 18, temp: 52, frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60, stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'example.worker', wifiPass: 'never-store-this', stratumPassword: 'never-store-this' };
const asic = { deviceModel: 'Gamma', frequencyOptions: [500, 525, 550], voltageOptions: [1100, 1150, 1200] };
describe('AxeOS adapter', () => {
  it.each([5208.75, 12000, 0])('converts input voltage %s mV to volts without changing core voltage', async voltage => {
    const adapter = new AxeAdapter(async (_host, path) => path.endsWith('/asic') ? asic : { ...info, voltage });
    const reading = await adapter.read('bitaxe.local');
    expect(reading.raw.voltage).toBe(voltage);
    expect(reading.snapshot.inputVoltage).toBe(voltage / 1000);
    expect(reading.snapshot.settings.coreVoltage).toBe(1150);
    expect(reading.snapshot.capabilities.writable).not.toContain('inputVoltage');
  });
  it('keeps missing input voltage unavailable', () => {
    expect(normalize(infoSchema.parse(info)).inputVoltage).toBeUndefined();
  });
  it.each([-1, Infinity, NaN, '5200', null])('rejects invalid input voltage %s', async voltage => {
    const adapter = new AxeAdapter(async () => ({ ...info, voltage }));
    await expect(adapter.read('bitaxe.local')).rejects.toThrow('invalidDeviceResponse');
  });
  it('normalizes identity, capabilities and metrics without credentials', async () => {
    const send = vi.fn(async (_host: string, path: string) => path.endsWith('/asic') ? asic : info);
    const reading = await new AxeAdapter(send).read('192.168.1.2');
    expect(reading.snapshot.model).toBe('Gamma');
    expect(reading.snapshot.capabilities.frequencies).toEqual([500, 525, 550]);
    expect(JSON.stringify(reading)).not.toContain('never-store-this');
    expect(reading.snapshot.hashRate).toBe(1200);
  });
  it('keeps monitoring with no inferred frequency options on older or custom firmware', async () => {
    const send = vi.fn(async (_host: string, path: string) => { if (path.endsWith('/asic')) throw new AppError('unsupported', 404); return info; });
    const reading = await new AxeAdapter(send).read('bitaxe.local');
    expect(reading.snapshot.hashRate).toBe(1200);
    expect(reading.snapshot.capabilities.writable).not.toContain('frequency');
    expect(() => validateCapabilities({ frequency: 550 }, reading.snapshot)).toThrow();
  });
  it('rejects malformed and non-miner data', () => {
    expect(infoSchema.safeParse({ hello: 'world' }).success).toBe(false);
    expect(infoSchema.safeParse({ ...info, hashRate: '1200' }).success).toBe(false);
    expect(infoSchema.safeParse({ ...info, temp: Infinity }).success).toBe(false);
  });
  it('sends the verified legacy PATCH format', async () => {
    const send = vi.fn(async (_host: string, path: string) => path.endsWith('/asic') ? asic : info);
    const adapter = new AxeAdapter(send); const reading = await adapter.read('bitaxe.local');
    await adapter.patch('bitaxe.local', { frequency: 550, stratumUser: 'example.other' }, reading);
    expect(send).toHaveBeenLastCalledWith('bitaxe.local', '/api/system', 'PATCH', { frequency: 550, stratumUser: 'example.other' });
  });
  it('requires acknowledgement for custom writes and never forwards it to AxeOS', async () => {
    const send = vi.fn(async (_host: string, path: string) => path.endsWith('/asic') ? asic : info);
    const adapter = new AxeAdapter(send); const reading = await adapter.read('bitaxe.local');
    await expect(adapter.patch('bitaxe.local', { frequency: 537, coreVoltage: 1160 }, reading)).rejects.toThrow('unsupportedProfile');
    expect(send).toHaveBeenCalledTimes(2);
    await adapter.patch('bitaxe.local', { frequency: 537, coreVoltage: 1160 }, reading, true);
    expect(send).toHaveBeenLastCalledWith('bitaxe.local', '/api/system', 'PATCH', { frequency: 537, coreVoltage: 1160 });
    const unsupported = { ...reading, snapshot: { ...reading.snapshot, capabilities: { ...reading.snapshot.capabilities, writable: [] } } };
    await expect(adapter.patch('bitaxe.local', { frequency: 537 }, unsupported, true)).rejects.toThrow('unsupported');
    await expect(adapter.patch('bitaxe.local', { manualFanSpeed: 40 }, reading, true)).rejects.toThrow('manualFanRequiresManualMode');
    for (const value of [0, -1, 1.5, 65536, Infinity]) {
      await expect(adapter.patch('bitaxe.local', { frequency: value }, reading, true)).rejects.toThrow();
      await expect(adapter.patch('bitaxe.local', { coreVoltage: value }, reading, true)).rejects.toThrow();
    }
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('writes only a validated full tuning profile, including restoring the automatic fan mode', async () => {
    const send = vi.fn(async (_host: string, path: string) => path.endsWith('/asic') ? asic : info);
    const adapter = new AxeAdapter(send); const reading = await adapter.read('bitaxe.local');
    const profile = { frequency: 537, coreVoltage: 1160, autofanspeed: 1 as const, manualFanSpeed: 60 };
    await adapter.patchTuning('bitaxe.local', profile, reading);
    expect(send).toHaveBeenLastCalledWith('bitaxe.local', '/api/system', 'PATCH', profile);
    await expect(adapter.patchTuning('bitaxe.local', { ...profile, overheat_mode: 0 } as typeof profile, reading)).rejects.toThrow();
    const unsupported = { ...reading, snapshot: { ...reading.snapshot, capabilities: { ...reading.snapshot.capabilities, writable: ['frequency', 'coreVoltage'] as ('frequency' | 'coreVoltage')[] } } };
    await expect(adapter.patchTuning('bitaxe.local', profile, unsupported)).rejects.toThrow('unsupported');
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('preserves active slot settings and uses the firmware password-preservation marker', async () => {
    const slots = { ...info, primaryPoolIndex: 2, pools: [{ id: 2, stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'example.worker', stratumTLS: 2, stratumProtocol: 'SV1', stratumSuggestedDifficulty: 1000 }] };
    const send = vi.fn(async (_host: string, path: string) => path.endsWith('/asic') ? asic : slots);
    const adapter = new AxeAdapter(send); const reading = await adapter.read('bitaxe.local');
    await adapter.patch('bitaxe.local', { stratumUser: 'example.changed' }, reading);
    expect(send).toHaveBeenLastCalledWith('bitaxe.local', '/api/system', 'PATCH', { pools: [{ ...slots.pools[0], stratumUser: 'example.changed', stratumPassword: '*****' }] });
  });
  it('rejects unsupported profiles and inconsistent manual fan settings before writing', () => {
    const snapshot = normalize(infoSchema.parse(info), asic);
    expect(() => validateCapabilities({ frequency: 999 }, snapshot)).toThrow('unsupportedProfile');
    expect(() => validateCapabilities({ manualFanSpeed: 60 }, snapshot)).toThrow('manualFanRequiresManualMode');
    expect(() => validateCapabilities({ manualFanSpeed: 60, autofanspeed: 0 }, snapshot)).not.toThrow();
  });
});
describe('demonstration miners', () => {
  it('simulates different miners and applies configuration through the same contract', async () => {
    const adapter = new DemoAdapter();
    const a = await adapter.read('demo-1'); const b = await adapter.read('demo-3');
    expect(a.snapshot.hashRate!).toBeGreaterThan(b.snapshot.hashRate!);
    await adapter.patch('demo-1', { frequency: 550 }, a);
    expect((await adapter.read('demo-1')).snapshot.settings.frequency).toBe(550);
    await expect(adapter.patch('demo-1', { frequency: 999 }, a)).rejects.toThrow();
  });
});
