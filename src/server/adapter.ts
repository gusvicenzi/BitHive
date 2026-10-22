import { z } from 'zod';
import { settingsSchema, type Settings, type Snapshot } from '../shared/domain.js';
import { profileSchema, type TuningProfile } from '../shared/tuning.js';
import { AppError } from './errors.js';
import { type Transport, transport, resolveAddress } from './network.js';

const n = z.number().finite().nonnegative().optional();
const s = z.string().max(255).optional();
export const infoSchema = z.object({
  ASICModel: s, deviceModel: s, boardVersion: s, version: s, axeOSVersion: s, macAddr: s, hostname: s,
  hashRate: n, power: n, voltage: n, temp: n, vrTemp: n, errorPercentage: n, sharesAccepted: n, sharesRejected: n,
  uptimeSeconds: n, fanrpm: n, bestDiff: z.union([z.string().max(64), z.number().finite()]).optional(),
  expectedHashrate: n, actualFrequency: n, overheat_mode: n, miningPaused: z.boolean().optional(),
  resetReason: s, hardware_fault: s, power_fault: s,
  frequency: n, coreVoltage: n, autofanspeed: n, manualFanSpeed: n,
  stratumURL: s, stratumPort: n, stratumUser: s, primaryPoolIndex: n,
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
  read(address: string): Promise<Reading>;
  patchTuning?(address: string, settings: TuningProfile, reading: Reading): Promise<void>;
  patch(address: string, settings: Settings, reading: Reading, customValuesAcknowledged?: boolean): Promise<void>;
}
export function normalize(info: Info, asic?: z.infer<typeof asicSchema>): Snapshot {
  const settings: Snapshot['settings'] = {};
  for (const key of ['hostname', 'frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed', 'stratumURL', 'stratumPort', 'stratumUser'] as const) {
    if (info[key] !== undefined) Object.assign(settings, { [key]: info[key] });
  }
  const slot = info.pools?.find(pool => pool.id === (info.primaryPoolIndex ?? 0));
  if (slot) Object.assign(settings, { stratumURL: slot.stratumURL, stratumPort: slot.stratumPort, stratumUser: slot.stratumUser });
  const poolMode = slot ? 'slots' : settings.stratumURL !== undefined && settings.stratumPort !== undefined && settings.stratumUser !== undefined ? 'legacy' : 'none';
  const writable: (keyof Settings)[] = [];
  if (info.hostname?.trim()) writable.push('hostname');
  if (info.frequency !== undefined && asic?.frequencyOptions.length) writable.push('frequency');
  if (info.coreVoltage !== undefined && asic?.voltageOptions.length) writable.push('coreVoltage');
  if (info.autofanspeed === 0 || info.autofanspeed === 1) writable.push('autofanspeed');
  if (info.manualFanSpeed !== undefined) writable.push('manualFanSpeed');
  if (poolMode !== 'none') writable.push('stratumURL', 'stratumPort', 'stratumUser', 'stratumPassword');
  return {
    model: asic?.deviceModel ?? info.deviceModel ?? info.ASICModel, board: info.boardVersion,
    firmware: info.version ?? info.axeOSVersion, mac: info.macAddr, hostname: info.hostname,
    // AxeOS reports supply voltage in millivolts; snapshots use volts.
    inputVoltage: info.voltage === undefined ? undefined : info.voltage / 1000,
    expectedHashrate: info.expectedHashrate, actualFrequency: info.actualFrequency,
    firmwareProtection: info.overheat_mode === undefined ? undefined : info.overheat_mode !== 0,
    hardwareFault: Boolean(info.hardware_fault || info.power_fault || info.miningPaused), resetReason: info.resetReason,
    hashRate: info.hashRate, power: info.power, temp: info.temp, vrTemp: info.vrTemp,
    errorRate: info.errorPercentage, accepted: info.sharesAccepted, rejected: info.sharesRejected,
    uptime: info.uptimeSeconds, fanRpm: info.fanrpm, bestDiff: info.bestDiff?.toString(), settings,
    capabilities: { frequencies: asic?.frequencyOptions ?? [], voltages: asic?.voltageOptions ?? [], writable, poolMode },
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
    if (reading.snapshot.capabilities.poolMode === 'slots' && Object.keys(settings).some(key => key.startsWith('stratum'))) {
      const slot = reading.raw.pools!.find(pool => pool.id === (reading.raw.primaryPoolIndex ?? 0))!;
      const pool = { ...slot, stratumPassword: settings.stratumPassword ?? '*****' };
      for (const key of ['stratumURL', 'stratumPort', 'stratumUser', 'stratumPassword'] as const) {
        if (settings[key] !== undefined) Object.assign(pool, { [key]: settings[key] });
        delete payload[key];
      }
      payload.pools = [pool];
    }
    await this.send(address, '/api/system', 'PATCH', payload);
  }
}
