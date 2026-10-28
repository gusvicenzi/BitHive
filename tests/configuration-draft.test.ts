import { describe, expect, it } from 'vitest';
import { draftChanges, draftFrom } from '../src/web/configuration-draft';
const current = { frequency: 525, stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'worker', autofanspeed: 1 as const };
describe('configuration drafts', () => {
  it('omits prefilled, reverted and empty write-only values', () => {
    expect(draftChanges({ ...draftFrom(current), stratumPassword: '', fallbackStratumPassword: '' }, current)).toEqual({ settings: {}, dirty: [], valid: false });
    expect(draftChanges({ stratumPort: '4444' }, current)).toEqual({ settings: { stratumPort: 4444 }, dirty: ['stratumPort'], valid: true });
  });
  it('preserves explicit profile settings for a selected batch, even when the focused device matches', () => {
    expect(draftChanges(draftFrom(current), current, true).settings).toEqual(current);
  });
  it('rejects empty, fractional and out-of-range numeric drafts and preserves exact passwords', () => {
    for (const stratumPort of ['', '1.5', '0', '65536']) expect(draftChanges({ stratumPort }, current).valid).toBe(false);
    expect(draftChanges({ stratumPassword: ' x ' }, current).settings).toEqual({ stratumPassword: ' x ' });
  });
  it('does not submit an untouched invalid legacy fallback port or a disabled manual fan draft', () => {
    expect(draftChanges({ frequency: '550', manualFanSpeed: '40' }, { ...current, fallbackStratumPort: 0 }).settings).toEqual({ frequency: 550 });
  });
});
