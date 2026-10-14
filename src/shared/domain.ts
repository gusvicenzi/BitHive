import { z } from 'zod';

export const addressSchema = z.string().trim().toLowerCase().max(253).regex(/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/).refine(s => !s.includes('..'));
export const displayNameSchema = z.string().trim().min(1).max(80);
export const hostnameSchema = z.string().trim().toLowerCase().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
export const settingsSchema = z.object({
  hostname: hostnameSchema.optional(),
  frequency: z.number().int().positive().optional(),
  coreVoltage: z.number().int().positive().optional(),
  autofanspeed: z.union([z.literal(0), z.literal(1)]).optional(),
  manualFanSpeed: z.number().int().min(0).max(100).optional(),
  stratumURL: z.string().trim().min(1).max(255).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
  stratumPort: z.number().int().min(1).max(65535).optional(),
  stratumUser: z.string().trim().min(1).max(255).optional(),
  stratumPassword: z.string().max(255).optional(),
}).strict().refine(s => Object.keys(s).length > 0)
  .refine(s => s.hostname === undefined || Object.keys(s).length === 1);
export type Settings = z.infer<typeof settingsSchema>;

export interface Snapshot {
  model?: string;
  board?: string;
  firmware?: string;
  mac?: string;
  hostname?: string;
  hashRate?: number;
  power?: number;
  temp?: number;
  vrTemp?: number;
  errorRate?: number;
  accepted?: number;
  rejected?: number;
  uptime?: number;
  fanRpm?: number;
  bestDiff?: string;
  settings: Omit<Settings, 'stratumPassword'>;
  capabilities: { frequencies: number[]; voltages: number[]; writable: (keyof Settings)[]; poolMode: 'legacy' | 'slots' | 'none' };
}
export interface DeviceView {
  id: string;
  address: string;
  name: string;
  demo: boolean;
  lastSeen: string | null;
  status: 'online' | 'stale' | 'offline';
  snapshot: Snapshot | null;
}
export interface MetricView {
  timestamp: string;
  hashRate: number | null;
  power: number | null;
  temp: number | null;
  vrTemp: number | null;
  errorRate: number | null;
}
export type ActionResult = { id: string; result: 'verified' | 'unverified' | 'unknown' | 'rejected' | 'refreshed'; reason?: string };
export function efficiency(hashRate?: number | null, power?: number | null) {
  return hashRate != null && hashRate > 0 && power != null ? power * 1000 / hashRate : null;
}
export function aggregate(devices: DeviceView[]) {
  const online = devices.filter(d => d.status === 'online');
  const hashRate = online.reduce((n, d) => n + (d.snapshot?.hashRate ?? 0), 0);
  const power = online.reduce((n, d) => n + (d.snapshot?.power ?? 0), 0);
  const paired = online.filter(d => d.snapshot?.hashRate != null && d.snapshot.power != null);
  return {
    online: online.length, total: devices.length, hashRate, power,
    efficiency: efficiency(paired.reduce((n, d) => n + d.snapshot!.hashRate!, 0), paired.reduce((n, d) => n + d.snapshot!.power!, 0)),
    incomplete: online.some(d => d.snapshot?.hashRate == null || d.snapshot.power == null),
  };
}
export function status(lastSeen: Date | null, failures: number, now = Date.now()): DeviceView['status'] {
  if (!lastSeen) return 'offline';
  return failures > 0 || now - lastSeen.getTime() > 90000 ? (failures >= 3 ? 'offline' : 'stale') : 'online';
}
