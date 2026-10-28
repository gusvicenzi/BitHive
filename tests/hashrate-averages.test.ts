import { describe, expect, it } from 'vitest';
import { AxeAdapter } from '../src/server/adapter.js';
import { aggregate, averageHashrates, type DeviceView } from '../src/shared/domain.js';

const info = { ASICModel: 'BM1370', hashRate: 1700, hashRate_1m: 1650, hashRate_10m: 1600, hashRate_1h: 1500 };
describe('firmware average hashrates', () => {
  it('reads all three averages through the existing info request in GH/s', async () => {
    const adapter = new AxeAdapter(async (_host, path) => path.endsWith('/info') ? info : {});
    expect((await adapter.read('fixture.local')).snapshot).toMatchObject({ model: 'BM1370', hashRate: 1700, hashRate_1m: 1650, hashRate_10m: 1600, hashRate_1h: 1500 });
  });
  it('supports older firmware without averages', async () => {
    const adapter = new AxeAdapter(async () => ({ ASICModel: 'BM1370', hashRate: 1700 }));
    expect(averageHashrates([(await adapter.read('fixture.local')).snapshot]).every(value => value.value === null)).toBe(true);
  });
  it.each(['hashRate_1m', 'hashRate_10m', 'hashRate_1h'])('rejects malformed %s telemetry', async field => {
    for (const value of [-1, Infinity, NaN, '1234', null]) {
      const adapter = new AxeAdapter(async () => ({ ...info, [field]: value }));
      await expect(adapter.read('fixture.local')).rejects.toThrow('invalidDeviceResponse');
    }
  });
  it('sums each available period from online miners and tracks partial coverage', () => {
    const device = (snapshot: object | null, status = 'online') => ({ status, snapshot }) as DeviceView;
    const totals = aggregate([device(info), device({ hashRate_1m: 0, hashRate_1h: 500 }), device(null), device(info, 'stale'), device(info, 'offline')]);
    expect(totals.averageHashrates).toEqual([
      { period: '1m', value: 1650, count: 2 }, { period: '10m', value: 1600, count: 1 }, { period: '1h', value: 2000, count: 2 },
    ]);
    expect(totals.hashRate).toBe(1700);
    expect(aggregate([]).averageHashrates.every(value => value.value === null && value.count === 0)).toBe(true);
    expect(averageHashrates([device({ hashRate_1m: NaN }).snapshot])[0].value).toBeNull();
  });
});
