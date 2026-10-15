// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { efficiencyFromWallPower, powerEstimate, readPowerPreferences, POWER_PREFERENCE_KEY } from '../src/web/power-estimate';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe('power supply estimates', () => {
  it('derives supply efficiency from a wattmeter reading', () => {
    expect(efficiencyFromWallPower(56.7, 70)).toBeCloseTo(81);
    expect(powerEstimate(56.7, efficiencyFromWallPower(56.7, 70)!)!.total).toBeCloseTo(70);
    expect(efficiencyFromWallPower(56.7, 56.7)).toBe(100);
  });
  it.each([[0, 0], [0, 10], [10, 0], [10, 9], [-1, 10], [NaN, 10], [10, Infinity], [Infinity, Infinity]])('rejects unusable calibration %s / %s', (power, wall) => {
    expect(efficiencyFromWallPower(power, wall)).toBeNull();
  });
  it('calculates wall input from efficiency rather than adding an arbitrary percentage', () => {
    const result = powerEstimate(56.7, 85)!;
    expect(result.total).toBeCloseTo(66.705882);
    expect(result.loss).toBeCloseTo(10.005882);
    expect(result.reported + result.loss).toBeCloseTo(result.total);
  });
  it('handles perfect efficiency and zero reported power', () => {
    expect(powerEstimate(56.7, 100)).toEqual({ reported: 56.7, loss: 0, total: 56.7 });
    expect(powerEstimate(0, 85)).toEqual({ reported: 0, loss: 0, total: 0 });
  });
  it.each([0, -1, 101, NaN, Infinity])('rejects invalid efficiency %s', efficiency => expect(powerEstimate(56.7, efficiency)).toBeNull());
  it('rejects non-finite and negative device power', () => {
    for (const value of [-1, NaN, Infinity]) expect(powerEstimate(value, 85)).toBeNull();
  });
  it('uses an optional estimate with 85% efficiency by default and restores valid preferences', () => {
    expect(readPowerPreferences()).toEqual({ enabled: false, efficiency: 85 });
    localStorage.setItem(POWER_PREFERENCE_KEY, JSON.stringify({ enabled: true, efficiency: 90 }));
    expect(readPowerPreferences()).toEqual({ enabled: true, efficiency: 90 });
  });
  it('recovers from corrupt preferences and unavailable storage', () => {
    for (const saved of ['broken', 'null', '{"enabled":true,"efficiency":0}', '{"enabled":"true","efficiency":90}']) {
      localStorage.setItem(POWER_PREFERENCE_KEY, saved);
      expect(readPowerPreferences()).toEqual({ enabled: false, efficiency: 85 });
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    expect(readPowerPreferences()).toEqual({ enabled: false, efficiency: 85 });
  });
});
