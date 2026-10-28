import { settingsSchema, type Settings } from '../shared/domain';

export type ConfigurationDraft = Partial<Record<keyof Settings, string>>;
const numeric = new Set<keyof Settings>(['frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed', 'stratumPort', 'fallbackStratumPort']);
export const isSecret = (key: keyof Settings) => key === 'stratumPassword' || key === 'fallbackStratumPassword';
export function draftFrom(settings: Settings): ConfigurationDraft {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
}
export function draftChanges(draft: ConfigurationDraft, current: Settings, includeExplicit = false) {
  const settings: Settings = {};
  const dirty: (keyof Settings)[] = [];
  for (const key of Object.keys(draft) as (keyof Settings)[]) {
    const text = draft[key]!;
    // An empty password means preserve the write-only value, never send an accidental reset.
    if (isSecret(key) && text === '') continue;
    const value = numeric.has(key) ? text === '' ? NaN : Number(text) : isSecret(key) ? text : text.trim();
    if (value !== current[key]) dirty.push(key);
    if (includeExplicit || value !== current[key]) Object.assign(settings, { [key]: value });
  }
  if ((settings.autofanspeed ?? current.autofanspeed) === 1) {
    delete settings.manualFanSpeed;
    const index = dirty.indexOf('manualFanSpeed'); if (index >= 0) dirty.splice(index, 1);
  }
  return { settings, dirty, valid: settingsSchema.safeParse(settings).success };
}
