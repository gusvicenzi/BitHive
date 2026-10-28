import { z } from 'zod';
import { settingsSchema, type Settings } from './domain.js';

export const poolSettingsSchema = z.object({
  stratumURL: settingsSchema.shape.stratumURL.unwrap(),
  stratumPort: settingsSchema.shape.stratumPort.unwrap(),
  stratumAccount: settingsSchema.shape.stratumUser.unwrap(),
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
export const poolAccountsSchema = z.object({
  primary: settingsSchema.shape.stratumUser.unwrap().optional(),
  fallback: settingsSchema.shape.stratumUser.unwrap().optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export type PoolAccounts = z.infer<typeof poolAccountsSchema>;
export function poolWorkerName(hostname?: string) {
  return hostname?.toLowerCase().replace(/\s+/gu, '') || null;
}
export function poolAccountFromUser(user: string) {
  const value = user.trim();
  const separator = value.lastIndexOf('.');
  return separator < 0 ? value : value.slice(0, separator);
}
export function poolUserForAccount(account: string, hostname?: string) {
  const worker = poolWorkerName(hostname);
  if (!worker) throw new Error('axeosNameRequired');
  const value = `${account.trim()}.${worker}`;
  if (!settingsSchema.shape.stratumUser.unwrap().safeParse(value).success) throw new Error('poolWorkerInvalid');
  return value;
}
export function readStoredPoolSettings(input: unknown): PoolSettings {
  const canonical = poolSettingsSchema.safeParse(input);
  if (canonical.success) return canonical.data;
  const legacy = poolSettingsSchema.omit({ stratumAccount: true }).extend({ stratumUser: settingsSchema.shape.stratumUser.unwrap() }).strict().parse(input);
  return poolSettingsSchema.parse({ stratumURL: legacy.stratumURL, stratumPort: legacy.stratumPort, stratumAccount: poolAccountFromUser(legacy.stratumUser) });
}
export function poolSettingsFor(settings: PoolSettings, target: PoolTarget, hostname: string): Settings {
  const [url, port, user] = poolFields[target];
  return { [url]: settings.stratumURL, [port]: settings.stratumPort, [user]: poolUserForAccount(settings.stratumAccount, hostname) };
}
export function poolSettingsFrom(settings: Settings, target: PoolTarget = 'primary') {
  const [url, port, user] = poolFields[target];
  const result = poolSettingsSchema.safeParse({ stratumURL: settings[url], stratumPort: settings[port], stratumAccount: typeof settings[user] === 'string' ? poolAccountFromUser(settings[user]) : undefined });
  return result.success ? result.data : null;
}
