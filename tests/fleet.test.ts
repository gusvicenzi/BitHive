import { describe, expect, it } from 'vitest';
import { poolGroups, fleetTotals } from '../src/shared/fleet';
import { infoSchema, normalize } from '../src/server/adapter';
import type { DeviceView, MetricView } from '../src/shared/domain';
const miner = (id: string, extra = {}, demo = false): DeviceView => ({ id, name: id, address: id, demo, status: 'online', lastSeen: null, snapshot: normalize(infoSchema.parse({ ASICModel: 'BM1370', stratumURL: 'pool.test', stratumPort: 3333, stratumUser: `account.${id}`, isUsingFallbackStratum: 0, ...extra })) });
const profile = { id: 'p', name: 'Solo pool', settings: { stratumURL: 'pool.test', stratumPort: 3333, stratumAccount: 'account' } };
describe('pool grouping', () => {
  it('matches profiles independently of worker, and separates endpoint, port, payout and demo', () => {
    const groups = poolGroups([miner('a'), miner('b'), miner('port', { stratumPort: 3334 }), miner('account', { stratumUser: 'other.worker' }), miner('demo', {}, true)], [profile]);
    expect(groups).toHaveLength(4);
    expect(groups[0]).toMatchObject({ names: ['Solo pool'], confirmed: true, endpoint: 'pool.test:3333' });
    expect(groups[0].devices.map(d => d.id)).toEqual(['a', 'b']);
  });
  it('uses the live fallback and labels absent telemetry or stale state as unconfirmed', () => {
    const fallback = miner('f', { isUsingFallbackStratum: 1, fallbackStratumURL: 'solo.local', fallbackStratumPort: 3333, fallbackStratumUser: 'wallet.f' });
    expect(poolGroups([fallback], [profile])[0]).toMatchObject({ endpoint: 'solo.local:3333', account: 'wallet', confirmed: true, names: [] });
    const stale = { ...miner('s'), status: 'offline' as const };
    expect(poolGroups([miner('a'), stale], [profile])).toHaveLength(1);
    expect(poolGroups([stale], [profile])[0].confirmed).toBe(false);
    expect(poolGroups([miner('unknown', { isUsingFallbackStratum: undefined })], [profile])[0].confirmed).toBe(false);
    expect(poolGroups([{ ...miner('x'), snapshot: null }], [profile])[0].endpoint).toBeNull();
    expect(poolGroups([miner('invalid', { isUsingFallbackStratum: 9 })], [profile])[0].confirmed).toBe(false);
    expect(poolGroups([miner('missing-fallback', { isUsingFallbackStratum: true })], [profile])[0].endpoint).toBeNull();
  });
  it('normalizes actual slot selection without guessing from slot IDs', () => {
    const d = miner('slot', { primaryPoolIndex: 3, secondaryPoolIndex: 6, isUsingFallbackStratum: 1, pools: [{ id: 3, stratumURL: 'main.test', stratumPort: 1000, stratumUser: 'main.a' }, { id: 6, stratumURL: 'solo.test', stratumPort: 2000, stratumUser: 'wallet.a' }] });
    expect(poolGroups([d], [profile])[0].endpoint).toBe('solo.test:2000');
  });
});
describe('fleet time bucket totals', () => {
  const metric = (timestamp: string, hashRate: number | null, power: number | null): MetricView => ({ timestamp, hashRate, power, temp: 50, vrTemp: 60, errorRate: 0 });
  it('sums aligned readings independently with coverage and retains zero and null', () => {
    const totals = fleetTotals([{ id: 'a', metrics: [metric('2026-10-28T00:00:00Z', 1000, null), metric('2026-10-28T00:01:00Z', 0, 0)] }, { id: 'b', metrics: [metric('2026-10-28T00:00:00Z', 500, 20), metric('2026-10-28T00:02:00Z', null, null)] }]);
    expect(totals[0]).toMatchObject({ hashRate: 1500, power: 20, contributors: { hashRate: 2, power: 1 } });
    expect(totals[1]).toMatchObject({ hashRate: 0, power: 0, contributors: { hashRate: 1, power: 1 } });
    expect(totals[2]).toMatchObject({ hashRate: null, power: null });
    expect(fleetTotals([])).toEqual([]);
  });
});
