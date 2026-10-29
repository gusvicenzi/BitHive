import { z } from 'zod';
import { settingsSchema, type Settings, type Snapshot } from '../shared/domain.js';
import { profileSchema, type TuningProfile } from '../shared/tuning.js';
import { AppError } from './errors.js';
import { poolFields, type PoolTarget } from '../shared/pool-profiles.js';
import { type Transport, transport, resolveAddress } from './network.js';

const n = z.number().finite().nonnegative().optional();
const s = z.string().max(255).optional();
export const infoSchema = z.object({
  ASICModel: s, deviceModel: s, boardVersion: s, version: s, axeOSVersion: s, macAddr: s, hostname: s,
  hashRate: n, hashRate_1m: n, hashRate_10m: n, hashRate_1h: n, power: n, voltage: n, temp: n, vrTemp: n, errorPercentage: n, sharesAccepted: n, sharesRejected: n,
  uptimeSeconds: n, fanrpm: n, fanspeed: z.number().finite().min(0).max(100).optional().catch(undefined), bestDiff: z.union([z.string().max(64), z.number().finite()]).optional(),
  expectedHashrate: n, actualFrequency: n, overheat_mode: n, miningPaused: z.boolean().optional(),
  resetReason: s, hardware_fault: s, power_fault: s,
  frequency: n, coreVoltage: n, autofanspeed: n, manualFanSpeed: n,
  stratumURL: s, stratumPort: n, stratumUser: s, primaryPoolIndex: n, secondaryPoolIndex: n,
  isUsingFallbackStratum: z.union([z.literal(0), z.literal(1), z.boolean()]).optional().catch(undefined),
  fallbackStratumURL: s, fallbackStratumPort: n, fallbackStratumUser: s,
  pools: z.array(z.object({ id: z.number().int().min(0).max(7), stratumURL: z.string().max(255),
    stratumPort: z.number().int().min(1).max(65535), stratumUser: z.string().max(255),
    stratumProtocol: z.enum(['SV1', 'SV2']).optional(), stratumTLS: z.number().int().min(0).max(2).optional(),
    stratumSuggestedDifficulty: n, stratumExtranonceSubscribe: z.boolean().optional(),
    stratumCert: z.string().max(16384).optional(), stratumDecodeCoinbase: z.boolean().optional(),
    stratumShareWarning: z.boolean().optional(), stratumV2ChannelType: z.enum(['standard', 'extended']).optional(),
    stratumV2AuthorityPubkey: s, stratumV2RequireAuth: z.boolean().optional(),
  })).max(8).optional(),
}).refine(v => Boolean(v.ASICModel || v.version || v.axeOSVersion), 'Not an AxeOS device');
const asicSchema = z.object({ deviceModel: s, frequencyOptions: z.array(z.number().int().positive()).max(128).default([]), voltageOptions: z.array(z.number().int().positive()).max(128).default([]) });
type Info = z.infer<typeof infoSchema>;
export interface Reading { snapshot: Snapshot; raw: Info }
export interface MinerAdapter {
  stableAddress?(address: string): Promise<string>;
  restart?(address: string): Promise<void>;
  read(address: string): Promise<Reading>;
  patchTuning?(address: string, settings: TuningProfile, reading: Reading): Promise<void>;
  patch(address: string, settings: Settings, reading: Reading, customValuesAcknowledged?: boolean): Promise<void>;
}
function poolSlot(info: Info, target: PoolTarget) {
  const index = target === 'primary' ? info.primaryPoolIndex ?? 0 : info.secondaryPoolIndex;
  if (index === undefined || (target === 'fallback' && index === (info.primaryPoolIndex ?? 0))) return undefined;
  if (new Set(info.pools?.map(p => p.id)).size !== info.pools?.length) return undefined;
  return info.pools?.find(pool => pool.id === index);
}
export function normalize(info: Info, asic?: z.infer<typeof asicSchema>): Snapshot {
  const settings: Snapshot['settings'] = {};
  for (const key of ['hostname', 'frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed', 'stratumURL', 'stratumPort', 'stratumUser', 'fallbackStratumURL', 'fallbackStratumPort', 'fallbackStratumUser'] as const) {
    if (info[key] !== undefined) Object.assign(settings, { [key]: info[key] });
  }
  const slot = poolSlot(info, 'primary');
  const fallbackSlot = poolSlot(info, 'fallback');
  if (slot) Object.assign(settings, { stratumURL: slot.stratumURL, stratumPort: slot.stratumPort, stratumUser: slot.stratumUser });
  if (fallbackSlot) Object.assign(settings, { fallbackStratumURL: fallbackSlot.stratumURL, fallbackStratumPort: fallbackSlot.stratumPort, fallbackStratumUser: fallbackSlot.stratumUser });
  if (info.pools !== undefined) {
    if (!slot) for (const key of poolFields.primary.slice(0, 3)) delete settings[key as keyof typeof settings];
    if (!fallbackSlot) for (const key of poolFields.fallback.slice(0, 3)) delete settings[key as keyof typeof settings];
  }
  // A slot API must never fall back to legacy writes when an index is missing or ambiguous.
  const poolMode = info.pools !== undefined ? slot ? 'slots' : 'none' : settings.stratumURL !== undefined && settings.stratumPort !== undefined && settings.stratumUser !== undefined ? 'legacy' : 'none';
  const fallbackPoolMode = info.pools !== undefined ? fallbackSlot ? 'slots' : 'none' : settings.fallbackStratumURL !== undefined && settings.fallbackStratumPort !== undefined && Number.isInteger(settings.fallbackStratumPort) && settings.fallbackStratumPort >= 0 && settings.fallbackStratumPort <= 65535 && settings.fallbackStratumUser !== undefined ? 'legacy' : 'none';
  const writable: (keyof Settings)[] = [];
  if (info.hostname?.trim()) writable.push('hostname');
  if (info.frequency !== undefined && asic?.frequencyOptions.length) writable.push('frequency');
  if (info.coreVoltage !== undefined && asic?.voltageOptions.length) writable.push('coreVoltage');
  if (info.autofanspeed === 0 || info.autofanspeed === 1) writable.push('autofanspeed');
  if (info.manualFanSpeed !== undefined) writable.push('manualFanSpeed');
  if (poolMode !== 'none') writable.push(...poolFields.primary);
  if (fallbackPoolMode !== 'none') writable.push(...poolFields.fallback);
  return {
    model: asic?.deviceModel ?? info.deviceModel ?? info.ASICModel, board: info.boardVersion,
    firmware: info.version ?? info.axeOSVersion, mac: info.macAddr, hostname: info.hostname,
    // AxeOS reports supply voltage in millivolts; snapshots use volts.
    inputVoltage: info.voltage === undefined ? undefined : info.voltage / 1000,
    isUsingFallbackStratum: info.isUsingFallbackStratum === undefined ? undefined : Boolean(info.isUsingFallbackStratum),
    expectedHashrate: info.expectedHashrate, actualFrequency: info.actualFrequency,
    firmwareProtection: info.overheat_mode === undefined ? undefined : info.overheat_mode !== 0,
    hardwareFault: Boolean(info.hardware_fault || info.power_fault || info.miningPaused), resetReason: info.resetReason,
    hashRate: info.hashRate, hashRate_1m: info.hashRate_1m, hashRate_10m: info.hashRate_10m, hashRate_1h: info.hashRate_1h, power: info.power, temp: info.temp, vrTemp: info.vrTemp,
    errorRate: info.errorPercentage, accepted: info.sharesAccepted, rejected: info.sharesRejected,
    uptime: info.uptimeSeconds, fanRpm: info.fanrpm, fanPercent: info.fanspeed, bestDiff: info.bestDiff?.toString(), settings,
    capabilities: { frequencies: asic?.frequencyOptions ?? [], voltages: asic?.voltageOptions ?? [], writable, poolMode, fallbackPoolMode },
  };
}
function validateWritable(settings: Settings, snapshot: Snapshot) {
  if (Object.keys(settings).some(key => !snapshot.capabilities.writable.includes(key as keyof Settings))) throw new AppError('unsupported');
}
export function validateTuningCapabilities(input: TuningProfile, snapshot: Snapshot) {
  const profile = profileSchema.parse(input);
  validateWritable(profile, snapshot);
  return profile;
}
export function validateCapabilities(settings: Settings, snapshot: Snapshot, customValuesAcknowledged = false) {
  settingsSchema.parse(settings);
  validateWritable(settings, snapshot);
  if (!customValuesAcknowledged && settings.frequency !== undefined && !snapshot.capabilities.frequencies.includes(settings.frequency)) throw new AppError('unsupportedProfile');
  if (!customValuesAcknowledged && settings.coreVoltage !== undefined && !snapshot.capabilities.voltages.includes(settings.coreVoltage)) throw new AppError('unsupportedProfile');
  if (settings.manualFanSpeed !== undefined && (settings.autofanspeed ?? snapshot.settings.autofanspeed) !== 0) throw new AppError('manualFanRequiresManualMode');
}
export class AxeAdapter implements MinerAdapter {
  constructor(private send: Transport = transport) {}
  stableAddress(address: string) { return resolveAddress(address); }
  async restart(address: string) { await this.send(address, '/api/system/restart', 'POST'); }
  async read(address: string): Promise<Reading> {
    const parsed = infoSchema.safeParse(await this.send(address, '/api/system/info'));
    if (!parsed.success) throw new AppError('invalidDeviceResponse');
    const raw = parsed.data;
    let asic: z.infer<typeof asicSchema> | undefined;
    try { asic = asicSchema.parse(await this.send(address, '/api/system/asic')); }
    catch { /* Monitoring remains available when optional capabilities cannot be established. */ }
    return { raw, snapshot: normalize(raw, asic) };
  }
  async patchTuning(address: string, input: TuningProfile, reading: Reading) {
    // Full operating profiles also restore the saved manual fan percentage while
    // automatic cooling is active. Never forward pool fields or OC/protection flags.
    const profile = validateTuningCapabilities(input, reading.snapshot);
    await this.send(address, '/api/system', 'PATCH', profile);
  }
  async patch(address: string, settings: Settings, reading: Reading, customValuesAcknowledged = false) {
    validateCapabilities(settings, reading.snapshot, customValuesAcknowledged);
    const payload: Record<string, unknown> = { ...settings };
    const pools = [];
    for (const target of ['primary', 'fallback'] as const) {
      const mode = target === 'primary' ? reading.snapshot.capabilities.poolMode : reading.snapshot.capabilities.fallbackPoolMode;
      const fields = poolFields[target];
      if (mode !== 'slots' || !fields.some(key => settings[key] !== undefined)) continue;
      const slot = poolSlot(reading.raw, target);
      if (!slot) throw new AppError('unsupported');
      const pool = { ...slot, stratumPassword: settings[fields[3]] ?? '*****' };
      fields.forEach((key, index) => {
        if (settings[key] !== undefined) Object.assign(pool, { [poolFields.primary[index]]: settings[key] });
        delete payload[key];
      });
      pools.push(pool);
    }
    if (pools.length) payload.pools = pools;
    await this.send(address, '/api/system', 'PATCH', payload);
  }
}
