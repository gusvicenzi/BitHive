import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/shared/domain.js';
import { tuningConfigSchema, tuningFrequency, tuningTelemetryFailure } from '../src/shared/tuning.js';

const config = tuningConfigSchema.parse({ frequency: { minimum: 400, maximum: 500, step: 25 }, voltage: { minimum: 1100, maximum: 1200, step: 10 },
  maxAsicTemperature: 65, maxVrmTemperature: 85, maxErrorPercentage: 2, fan: { mode: 'automatic' }, expected: { source: 'firmware' } });
const snapshot: Snapshot = { settings: { frequency: 500 }, actualFrequency: 495, expectedHashrate: 1000, hashRate: 950, power: 20,
  temp: 50, vrTemp: 60, errorRate: 0.2, uptime: 100, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } };
const acknowledged = { ...config, configuredFrequencyAcknowledged: true };
describe('explicit configured frequency source', () => {
  it('defaults to actual frequency and never infers acknowledgement', () => {
    expect(tuningFrequency(snapshot, config)).toBe(495);
    expect(tuningTelemetryFailure({ ...snapshot, actualFrequency: undefined }, config)).toBe('missingActualFrequency');
    expect(tuningTelemetryFailure({ ...snapshot, actualFrequency: undefined }, { ...config, configuredFrequencyAcknowledged: false })).toBe('missingActualFrequency');
    expect(tuningConfigSchema.safeParse({ ...config, configuredFrequencyAcknowledged: 'true' }).success).toBe(false);
  });
  it('consistently uses configured frequency after acknowledgement without altering actual telemetry', () => {
    expect(tuningFrequency(snapshot, acknowledged)).toBe(500);
    expect(tuningTelemetryFailure({ ...snapshot, actualFrequency: undefined }, acknowledged)).toBeNull();
    expect(snapshot.actualFrequency).toBe(495);
  });
  it.each([undefined, 0, -1, NaN, Infinity])('refuses invalid configured frequency %s', frequency => {
    expect(tuningTelemetryFailure({ ...snapshot, settings: { frequency } }, acknowledged)).toBe('missingConfiguredFrequency');
  });
  it.each(['hashRate', 'power', 'temp', 'vrTemp', 'errorRate', 'uptime'] as const)('does not bypass missing %s', key => {
    expect(tuningTelemetryFailure({ ...snapshot, [key]: undefined }, acknowledged)).toBe('missingTelemetry');
  });
  it('still requires firmware expected hashrate unless a reference is explicitly selected', () => {
    expect(tuningTelemetryFailure({ ...snapshot, expectedHashrate: undefined }, acknowledged)).toBe('missingTelemetry');
    expect(tuningTelemetryFailure({ ...snapshot, expectedHashrate: undefined }, { ...acknowledged, expected: { source: 'reference', frequency: 500, ths: 1 } })).toBeNull();
  });
});
