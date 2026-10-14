import { describe, expect, it } from 'vitest';
import { nearestSample, valueScale, hashRateScale } from '../src/web/chart-data';

describe('chart scales', () => {
  it.each([[1400, 1500], [27.6, 27.8], [54.2, 55], [0, 0], [55, 55], [-10, -10], [0.00001, 0.00002]])('bounds readings and produces a finite labeled scale for %j', (...values) => {
    const scale = valueScale(values);
    expect(scale.min).toBeLessThanOrEqual(Math.min(...values));
    expect(scale.max).toBeGreaterThanOrEqual(Math.max(...values));
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    expect(scale.ticks.length).toBeLessThanOrEqual(8);
    expect(scale.ticks.every(Number.isFinite)).toBe(true);
    expect(scale.ticks[0]).toBe(scale.min);
    expect(scale.ticks.at(-1)).toBeCloseTo(scale.max);
  });
  it('handles absent or invalid values without a broken scale', () => {
    expect(valueScale([NaN, Infinity])).toEqual(valueScale([]));
    expect(valueScale([]).ticks).toHaveLength(5);
  });
});
describe('sample inspection', () => {
  it('selects by timestamp, handles endpoints, and uses earlier samples for ties', () => {
    const times = [0, 1000, 9000, 10000];
    expect(nearestSample(times, -100)).toBe(0);
    expect(nearestSample(times, 99999)).toBe(3);
    expect(nearestSample(times, 5000)).toBe(1);
    expect(nearestSample(times, 8500)).toBe(2);
    expect(nearestSample([123], 0)).toBe(0);
  });
});


describe('hashrate display units', () => {
  it('uses TH/s above 1000 GH/s and retains one unit across the entire chart', () => {
    expect(hashRateScale([900, 1712])).toEqual({ unit: 'TH/s', divisor: 1000 });
    expect(hashRateScale([1000, 750])).toEqual({ unit: 'GH/s', divisor: 1 });
    expect(hashRateScale([])).toEqual({ unit: 'GH/s', divisor: 1 });
  });
});
