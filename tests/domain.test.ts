import { describe, expect, it } from 'vitest';
import { addressSchema, settingsSchema, efficiency, status, aggregate, type DeviceView } from '../src/shared/domain.js';
import { privateIPv4 } from '../src/server/network.js';
import { Limiter, DeviceLocks } from '../src/server/concurrency.js';

describe('local addresses', () => {
  it.each(['192.168.1.1', '10.0.0.1', '172.16.2.4', '172.31.255.1'])('allows private address %s', value => expect(privateIPv4(value)).toBe(true));
  it.each(['127.0.0.1', '169.254.169.254', '8.8.8.8', '172.32.0.1', '10.999.0.1', '::1'])('rejects non-LAN address %s', value => expect(privateIPv4(value)).toBe(false));
  it('normalizes hostnames and rejects URL tricks', () => {
    expect(addressSchema.parse(' Bitaxe.LOCAL ')).toBe('bitaxe.local');
    for (const value of ['http://192.168.1.2', 'user@host', 'a/b', 'a:80', '..host']) expect(addressSchema.safeParse(value).success).toBe(false);
  });
});
describe('settings and metric semantics', () => {
  it('validates operating and pool input without allowing protection changes', () => {
    expect(settingsSchema.safeParse({ frequency: 525, stratumPort: 3333 }).success).toBe(true);
    for (const input of [{}, { overheat_mode: 0 }, { frequency: -1 }, { stratumPort: 65536 }, { manualFanSpeed: 101 }, { frequency: 1.1 }]) expect(settingsSchema.safeParse(input).success).toBe(false);
  });
  it('uses GH/s to calculate J/TH and handles zero and missing data', () => {
    expect(efficiency(1200, 18)).toBe(15);
    expect(efficiency(0, 18)).toBeNull();
    expect(efficiency(1000, undefined)).toBeNull();
  });
  it('marks failed or old observations stale and repeated failures offline', () => {
    const now = Date.now();
    expect(status(new Date(now), 0, now)).toBe('online');
    expect(status(new Date(now - 91000), 0, now)).toBe('stale');
    expect(status(new Date(now), 1, now)).toBe('stale');
    expect(status(new Date(now), 3, now)).toBe('offline');
    expect(status(null, 0, now)).toBe('offline');
  });
  it('excludes stale readings and calculates weighted rather than average efficiency', () => {
    const make = (id: string, hashRate: number, power: number, state: DeviceView['status'] = 'online') => ({ id, status: state, snapshot: { hashRate, power } }) as DeviceView;
    const data = aggregate([make('a', 1000, 10), make('b', 2000, 40), make('c', 9999, 999, 'stale')]);
    expect(data.hashRate).toBe(3000); expect(data.power).toBe(50); expect(data.efficiency).toBeCloseTo(16.6667); expect(data.online).toBe(2);
  });
  it('signals partial metrics without inventing efficiency', () => {
    const data = aggregate([{ status: 'online', snapshot: { hashRate: 1000 } } as DeviceView]);
    expect(data.incomplete).toBe(true); expect(data.efficiency).toBeNull();
  });
});
describe('collection concurrency', () => {
  it('bounds simultaneous requests including queued work', async () => {
    const limiter = new Limiter(3); let active = 0; let peak = 0;
    await Promise.all(Array.from({ length: 12 }, () => limiter.run(async () => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    })));
    expect(peak).toBe(3);
  });
  it('serializes a device and releases locks after failures', async () => {
    const lock = new DeviceLocks(); const order: number[] = [];
    await Promise.allSettled([lock.run('a', async () => { order.push(1); throw Error(); }), lock.run('a', async () => { order.push(2); })]);
    expect(order).toEqual([1, 2]);
    expect(await lock.run('a', async () => 3)).toBe(3);
  });
});
