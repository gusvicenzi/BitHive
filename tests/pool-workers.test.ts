import { describe, expect, it } from 'vitest';
import { poolWorkerName, poolAccountFromUser, poolUserForAccount, poolSettingsFrom, poolSettingsFor, readStoredPoolSettings, poolProfileSchema } from '../src/shared/pool-profiles';

describe('worker-agnostic profiles', () => {
  it('derives lowercase workers by removing all whitespace from the AxeOS name', () => {
    expect(poolWorkerName(' Living Room AXE ')).toBe('livingroomaxe');
    expect(poolWorkerName('OFFICE\tAXE\n2')).toBe('officeaxe2');
    expect(poolWorkerName('Gamma-01')).toBe('gamma-01');
    expect(poolWorkerName(' ')).toBeNull(); expect(poolWorkerName(undefined)).toBeNull();
  });
  it('removes only the last worker suffix when copying and preserves dotted accounts when composing', () => {
    expect(poolAccountFromUser('account.with.dots.old-worker')).toBe('account.with.dots');
    expect(poolAccountFromUser('bc1qwallet')).toBe('bc1qwallet');
    expect(poolUserForAccount('account.with.dots', 'Kitchen AXE')).toBe('account.with.dots.kitchenaxe');
    expect(poolUserForAccount('bc1qwallet', 'Office AXE')).toBe('bc1qwallet.officeaxe');
  });
  it('uses one account-only profile for different workers and pool targets', () => {
    const settings = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumAccount: 'wallet' };
    expect(poolSettingsFor(settings, 'primary', 'Axe One').stratumUser).toBe('wallet.axeone');
    expect(poolSettingsFor(settings, 'fallback', 'Axe Two').fallbackStratumUser).toBe('wallet.axetwo');
    expect(poolSettingsFrom({ stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'wallet.axeone' })).toEqual(settings);
    expect(poolProfileSchema.safeParse({ name: 'Bad', settings: { ...settings, stratumUser: 'wallet.axeone' } }).success).toBe(false);
  });
  it('rejects missing names and usernames exceeding the firmware limit', () => {
    expect(() => poolUserForAccount('wallet', ' ')).toThrow('axeosNameRequired');
    expect(() => poolUserForAccount('w'.repeat(250), 'axeone')).toThrow('poolWorkerInvalid');
  });
  it('reads legacy profiles without changing their source payload, and leaves canonical dotted accounts intact', () => {
    const legacy = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumUser: 'account.dotted.oldworker' };
    expect(readStoredPoolSettings(legacy)).toEqual({ stratumURL: legacy.stratumURL, stratumPort: 3333, stratumAccount: 'account.dotted' });
    expect(legacy.stratumUser).toBe('account.dotted.oldworker');
    const current = { stratumURL: legacy.stratumURL, stratumPort: 3333, stratumAccount: 'account.with.dots' };
    expect(readStoredPoolSettings(current)).toEqual(current);
  });
});
