import { z } from 'zod';
import { settingsSchema, type Settings } from './domain.js';

export const poolSettingsSchema = z.object({
  stratumURL: settingsSchema.shape.stratumURL.unwrap(),
  stratumPort: settingsSchema.shape.stratumPort.unwrap(),
  stratumUser: settingsSchema.shape.stratumUser.unwrap(),
}).strict();
export const poolProfileSchema = z.object({
  name: z.string().trim().min(1).max(80), settings: poolSettingsSchema,
}).strict();
export type PoolSettings = z.infer<typeof poolSettingsSchema>;
export type PoolProfile = z.infer<typeof poolProfileSchema> & { id: string };
export type PoolTarget = 'primary' | 'fallback';
export const poolFields = {
  primary: ['stratumURL', 'stratumPort', 'stratumUser', 'stratumPassword'],
  fallback: ['fallbackStratumURL', 'fallbackStratumPort', 'fallbackStratumUser', 'fallbackStratumPassword'],
} as const;
export function poolSettingsFor(settings: PoolSettings, target: PoolTarget): Settings {
  const [url, port, user] = poolFields[target];
  return { [url]: settings.stratumURL, [port]: settings.stratumPort, [user]: settings.stratumUser };
}
export function poolSettingsFrom(settings: Settings, target: PoolTarget = 'primary') {
  const [url, port, user] = poolFields[target];
  const result = poolSettingsSchema.safeParse({ stratumURL: settings[url], stratumPort: settings[port], stratumUser: settings[user] });
  return result.success ? result.data : null;
}
