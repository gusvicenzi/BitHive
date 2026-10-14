export const DEFAULT_PSU_EFFICIENCY = 85;
export const POWER_PREFERENCE_KEY = 'bithive.powerEstimate';
export function validEfficiency(value: number) { return Number.isFinite(value) && value > 0 && value <= 100; }
export function powerEstimate(power: number, efficiency: number) {
  if (!Number.isFinite(power) || power < 0 || !validEfficiency(efficiency)) return null;
  const total = power / (efficiency / 100);
  if (!Number.isFinite(total)) return null;
  return { reported: power, loss: total - power, total };
}
export function readPowerPreferences() {
  const fallback = { enabled: false, efficiency: DEFAULT_PSU_EFFICIENCY };
  try {
    const saved = JSON.parse(localStorage.getItem(POWER_PREFERENCE_KEY) ?? 'null');
    return saved && typeof saved.enabled === 'boolean' && typeof saved.efficiency === 'number' && validEfficiency(saved.efficiency)
      ? { enabled: saved.enabled as boolean, efficiency: saved.efficiency as number } : fallback;
  } catch { return fallback; }
}
