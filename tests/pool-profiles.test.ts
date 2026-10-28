import { describe, expect, it } from 'vitest';
import { poolProfileSchema, poolSettingsFrom } from '../src/shared/pool-profiles.js';

describe('pool profile validation and copying', () => {
  const settings = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'wallet.worker' };
  it('copies only reusable public pool settings and strips secrets and operating fields', () => {
    expect(poolSettingsFrom({ ...settings, stratumPassword: 'never-store', frequency: 500, hostname: 'miner-a' })).toEqual(settings);
    expect(poolSettingsFrom({ stratumURL: 'pool.example.com' })).toBeNull();
  });
  it('normalizes labels and validates complete pool settings', () => {
    expect(poolProfileSchema.parse({ name: ' Primary ', settings }).name).toBe('Primary');
    for (const invalid of [
      { ...settings, stratumURL: 'https://pool.example.com/path' }, { ...settings, stratumPort: 0 },
      { ...settings, stratumPort: 65536 }, { ...settings, stratumPort: 3.5 }, { ...settings, stratumUser: ' ' },
      { ...settings, stratumPassword: 'secret' }, { ...settings, frequency: 500 }, { stratumURL: 'pool.example.com' },
    ]) expect(poolProfileSchema.safeParse({ name: 'Primary', settings: invalid }).success).toBe(false);
    expect(poolProfileSchema.safeParse({ name: ' ', settings }).success).toBe(false);
  });
});
