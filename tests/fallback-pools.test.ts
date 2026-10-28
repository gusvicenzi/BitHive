import { describe, expect, it, vi } from 'vitest';
import { AxeAdapter, infoSchema, normalize } from '../src/server/adapter.js';
import { poolSettingsFor, poolSettingsFrom } from '../src/shared/pool-profiles.js';
import type { Transport } from '../src/server/network.js';
import { settingsSchema } from '../src/shared/domain.js';

const primary = { stratumURL: 'primary.example.com', stratumPort: 3333, stratumUser: 'primary.worker' };
const fallback = { fallbackStratumURL: 'backup.example.com', fallbackStratumPort: 4444, fallbackStratumUser: 'backup.worker' };
const info = { version: 'v2.12.0', ASICModel: 'BM1370', ...primary, ...fallback, fallbackStratumPassword: 'never-store' };
const slots = { ...info, primaryPoolIndex: 2, secondaryPoolIndex: 5, pools: [
  { id: 2, ...primary, stratumTLS: 1, stratumProtocol: 'SV1' },
  { id: 5, stratumURL: 'slot-backup.example.com', stratumPort: 5555, stratumUser: 'slot.worker', stratumTLS: 2,
    stratumProtocol: 'SV2', stratumSuggestedDifficulty: 1000, stratumExtranonceSubscribe: true, stratumCert: 'public-cert',
    stratumDecodeCoinbase: false, stratumShareWarning: false, stratumV2ChannelType: 'standard', stratumV2AuthorityPubkey: 'key', stratumV2RequireAuth: true, stratumPassword: 'never-store' },
] };
function adapterFor(raw: unknown) {
  const send = vi.fn<Transport>(async () => raw);
  return { send, adapter: new AxeAdapter(send) };
}
describe('fallback pool adapters and portable profiles', () => {
  it('copies a fallback as a portable profile, maps it to either destination and omits secrets', () => {
    const portable = { stratumURL: 'backup.example.com', stratumPort: 4444, stratumAccount: 'backup' };
    expect(poolSettingsFrom({ ...primary, ...fallback, fallbackStratumPassword: 'never-store' }, 'fallback')).toEqual(portable);
    expect(poolSettingsFor(portable, 'fallback', 'Worker')).toEqual(fallback);
    expect(poolSettingsFor(portable, 'primary', 'Worker')).toEqual({ stratumURL: portable.stratumURL, stratumPort: portable.stratumPort, stratumUser: 'backup.worker' });
    expect(poolSettingsFrom(primary, 'fallback')).toBeNull();
  });
  it('normalizes and writes the verified legacy fallback format without changing primary', async () => {
    const { adapter, send } = adapterFor(info);
    const reading = await adapter.read('fixture.local');
    expect(reading.snapshot.settings).toMatchObject({ ...primary, ...fallback });
    expect(reading.snapshot.capabilities.fallbackPoolMode).toBe('legacy');
    expect(JSON.stringify(reading)).not.toContain('never-store');
    await adapter.patch('fixture.local', { fallbackStratumUser: 'new.worker' }, reading);
    expect(send).toHaveBeenLastCalledWith('fixture.local', '/api/system', 'PATCH', { fallbackStratumUser: 'new.worker' });
  });
  it('allows a profile to initialize empty legacy fallback fields', async () => {
    const { adapter, send } = adapterFor({ ...info, fallbackStratumURL: '', fallbackStratumUser: '', fallbackStratumPort: 0 });
    const reading = await adapter.read('fixture.local');
    expect(reading.snapshot.capabilities.fallbackPoolMode).toBe('legacy');
    await adapter.patch('fixture.local', fallback, reading);
    expect(send).toHaveBeenLastCalledWith('fixture.local', '/api/system', 'PATCH', fallback);
  });
  it('targets only the reported secondary slot, preserving validated metadata and its password', async () => {
    const { adapter, send } = adapterFor(slots);
    const reading = await adapter.read('fixture.local');
    expect(reading.snapshot.settings.fallbackStratumURL).toBe('slot-backup.example.com');
    expect(reading.snapshot.capabilities.fallbackPoolMode).toBe('slots');
    await adapter.patch('fixture.local', { fallbackStratumUser: 'new.worker' }, reading);
    const publicSlot = { ...slots.pools[1], stratumPassword: undefined };
    delete publicSlot.stratumPassword;
    expect(send).toHaveBeenLastCalledWith('fixture.local', '/api/system', 'PATCH', {
      pools: [{ ...publicSlot, stratumUser: 'new.worker', stratumPassword: '*****' }],
    });
    expect(JSON.stringify(reading)).not.toContain('never-store');
  });
  it('supports changing both slots in one command and maps explicit fallback passwords only to the secondary slot', async () => {
    const { adapter, send } = adapterFor(slots);
    const reading = await adapter.read('fixture.local');
    await adapter.patch('fixture.local', { stratumPort: 4444, fallbackStratumPort: 6666, fallbackStratumPassword: 'new-secret' }, reading);
    const payload = send.mock.calls.at(-1)?.[3] as { pools: Record<string, unknown>[] } | undefined;
    expect(payload?.pools).toHaveLength(2);
    expect(payload?.pools[0]).toMatchObject({ id: 2, stratumPort: 4444, stratumPassword: '*****' });
    expect(payload?.pools[1]).toMatchObject({ id: 5, stratumPort: 6666, stratumPassword: 'new-secret' });
    expect(payload).not.toHaveProperty('secondaryPoolIndex');
    expect(payload).not.toHaveProperty('useFallbackStratum');
  });
  it.each([
    { ...slots, secondaryPoolIndex: undefined }, { ...slots, secondaryPoolIndex: 2 },
    { ...slots, secondaryPoolIndex: 7 }, { ...slots, secondaryPoolIndex: 5.5 },
    { ...slots, pools: [...slots.pools, slots.pools[1]] },
    { version: 'V1.0.1-rc.10', ASICModel: 'BM1370', ...primary },
    { ...info, fallbackStratumPort: 1.5 },
  ])('rejects fallback writes when support or a distinct slot cannot be established', async raw => {
    const { adapter, send } = adapterFor(raw);
    const reading = await adapter.read('fixture.local');
    expect(reading.snapshot.capabilities.fallbackPoolMode).toBe('none');
    await expect(adapter.patch('fixture.local', fallback, reading)).rejects.toThrow('unsupported');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('validates fallback settings and rejects arbitrary firmware flags', () => {
    for (const input of [{ fallbackStratumPort: 0 }, { fallbackStratumPort: 65536 }, { fallbackStratumPort: 1.5 }, { fallbackStratumURL: 'https://bad.example/path' }, { useFallbackStratum: 1 }]) {
      expect(settingsSchema.safeParse(input).success).toBe(false);
    }
    expect(normalize(infoSchema.parse(slots)).settings).not.toHaveProperty('fallbackStratumPassword');
  });
});
