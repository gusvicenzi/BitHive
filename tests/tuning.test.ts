import { describe, expect, it } from 'vitest';
import { grid, nextPosition, preview, rank, summarize, measurementFailure, tuningConfigSchema, type TuningAttempt, type TuningSample } from '../src/shared/tuning.js';

export const config = tuningConfigSchema.parse({ frequency: { minimum: 400, maximum: 500, step: 50 }, voltage: { minimum: 1100, maximum: 1200, step: 50 },
  maxAsicTemperature: 70, maxVrmTemperature: 80, maxErrorPercentage: 1, fan: { mode: 'automatic' }, expected: { source: 'firmware' } });
const point = (at: number, changes: Partial<TuningSample> = {}): TuningSample => ({ at, ths: 1, watts: 20, expected: 1, error: 1, asic: 50, vrm: 60, ...changes });
const summary = summarize([point(0), point(10000)], 0, 10000, 'firmware')!;
const attempt = (id: string, ths: number, efficiency: number, voltage = 1100, frequency = 400): TuningAttempt => ({ id, kind: 'search', profile: { frequency, coreVoltage: voltage, autofanspeed: 1, manualFanSpeed: 60 },
  outcome: 'passed', summary: { ...summary, ths, efficiency }, reason: null, startedAt: '', completedAt: '', candidateId: null });
describe('validated grids and traversal', () => {
  it('generates integer endpoints without overshooting nondivisible maxima', () => {
    expect(grid({ minimum: 401, maximum: 500, step: 33 })).toEqual([401, 434, 467, 500]);
    expect(grid({ minimum: 400, maximum: 499, step: 50 })).toEqual([400, 450]);
    expect(grid({ minimum: 400, maximum: 400, step: 10 })).toEqual([400]);
    expect(preview(config).count).toBe(9); expect(preview(config).seconds).toBeGreaterThan(9 * 420);
  });
  it('rejects missing limits, zero steps, fractional settings, unknown input and excessive grids', () => {
    for (const invalid of [{ ...config, maxAsicTemperature: undefined }, { ...config, frequency: { minimum: 400.5, maximum: 500, step: 1 } },
      { ...config, voltage: { minimum: 1200, maximum: 1100, step: 50 } }, { ...config, voltage: { minimum: 1100, maximum: 1200, step: 0 } },
      { ...config, frequency: { minimum: 1, maximum: 100000, step: 1 } }, { ...config, overheat_mode: 0 }]) expect(tuningConfigSchema.safeParse(invalid).success).toBe(false);
  });
  it('defaults durations, tolerance and complete search without defaulting hardware limits', () => {
    expect(config).toMatchObject({ stabilizationSeconds: 120, measurementSeconds: 300, tolerance: 5, mode: 'complete' });
    expect(tuningConfigSchema.safeParse({}).success).toBe(false);
  });
  it('restarts complete sweeps, retests the last pass in fast mode, and handles empty sweeps', () => {
    expect(nextPosition(config, 1, 0, 0, false)).toEqual({ frequencyIndex: 0, voltageIndex: 1, lastPassIndex: null });
    expect(nextPosition({ ...config, mode: 'fast' }, 2, 0, 1, false)).toEqual({ frequencyIndex: 1, voltageIndex: 1, lastPassIndex: null });
    expect(nextPosition({ ...config, mode: 'fast' }, 0, 0, null, false)?.frequencyIndex).toBe(0);
    expect(nextPosition({ ...config, mode: 'fast' }, 2, 0, 1, true)?.frequencyIndex).toBe(2);
    expect(nextPosition(config, 2, 2, 1, true)).toBeNull();
  });
});
describe('measurement mathematics', () => {
  it('weights irregular samples by time, excluding stabilization, and divides averaged power by hashrate', () => {
    const result = summarize([point(-5000, { ths: 1000 }), point(0, { ths: 1, watts: 10 }), point(1000, { ths: 3, watts: 30 }), point(10000, { ths: 3, watts: 50 })], 0, 10000, 'reference')!;
    expect(result.ths).toBeCloseTo(2.9); expect(result.watts).toBeCloseTo(38); expect(result.efficiency).toBeCloseTo(38 / 2.9);
    expect(result.duration).toBe(10); expect(result.expectedSource).toBe('reference');
  });
  it('clips a delayed endpoint using interpolation without extending the measurement', () => {
    const result = summarize([point(0, { ths: 1 }), point(8000, { ths: 1 }), point(12000, { ths: 3 })], 0, 10000, 'firmware')!;
    expect(result.duration).toBe(10); expect(result.ths).toBeCloseTo(1.1);
  });
  it('reports unavailable efficiency for zero hashrate rather than an artificial ratio', () => {
    const result = summarize([point(0, { ths: 0 }), point(10000, { ths: 0 })], 0, 10000, 'firmware')!;
    expect(result.efficiency).toBeNull();
    expect(rank([{ ...attempt('zero', 0, 1), summary: result }], 'efficiency')).toEqual([]);
  });
  it('requires both timing boundaries and a positive window', () => {
    expect(summarize([point(1000), point(10000)], 0, 10000, 'firmware')).toBeNull();
    expect(summarize([point(0), point(5000)], 0, 10000, 'firmware')).toBeNull();
    expect(summarize([point(0)], 0, 0, 'firmware')).toBeNull();
  });
  it('passes equality at the hash error limit and hashrate tolerance', () => {
    expect(measurementFailure({ ...summary, attainment: 95, error: 1 }, config)).toBeNull();
    expect(measurementFailure({ ...summary, attainment: 94.99 }, config)).toBe('hashrate');
    expect(measurementFailure({ ...summary, error: 1.01 }, config)).toBe('hashError');
  });
  it('uses share deltas; zero submissions, absent counters and resets are unavailable', () => {
    expect(summarize([point(0, { accepted: 100, rejected: 9 }), point(10000, { accepted: 109, rejected: 10 })], 0, 10000, 'firmware')!.rejects).toBe(10);
    expect(summary.rejects).toBeNull();
    expect(summarize([point(0, { accepted: 100, rejected: 9 }), point(5000, { accepted: 1, rejected: 0 }), point(10000, { accepted: 200, rejected: 20 })], 0, 10000, 'firmware')!.rejects).toBeNull();
    expect(summarize([point(0, { accepted: 1, rejected: 0 }), point(10000, { accepted: 1, rejected: 0 })], 0, 10000, 'firmware')!.rejects).toBeNull();
  });
  it('ranks passing search candidates with deterministic tie breaks', () => {
    const a = attempt('a', 1, 20, 1150), b = attempt('b', 2, 20), c = attempt('c', 2, 19), d = attempt('d', 2, 19, 1100, 450);
    const invalid = { ...attempt('invalid', 10, 1), outcome: 'invalid' as const };
    expect(rank([a, b, c, d, invalid], 'hashrate').map(a => a.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(rank([a, b, c, d, invalid], 'efficiency').map(a => a.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
