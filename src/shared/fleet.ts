import type { DeviceView, MetricView } from './domain.js';
import { poolAccountFromUser, type PoolProfile } from './pool-profiles.js';
export type FleetSeries = { id: string; metrics: MetricView[] };
export type FleetHistory = { bucketMinutes: number; series: FleetSeries[] };
export type FleetMetric = MetricView & { contributors?: Partial<Record<MetricField, number>> };
export type MetricField = 'hashRate' | 'power' | 'temp' | 'vrTemp';
const host = (value: string) => value.trim().toLowerCase().replace(/^stratum\+(tcp|ssl):\/\//, '').replace(/\/$/, '');
export function poolGroups(devices: DeviceView[], profiles: PoolProfile[]) {
  const groups = new Map<string, { key: string; endpoint: string | null; account: string; names: string[]; confirmed: boolean; demo: boolean; devices: DeviceView[] }>();
  for (const device of devices) {
    const snapshot = device.snapshot;
    const fallback = snapshot?.isUsingFallbackStratum === true;
    const settings = snapshot?.settings;
    const url = fallback ? settings?.fallbackStratumURL : settings?.stratumURL;
    const port = fallback ? settings?.fallbackStratumPort : settings?.stratumPort;
    const user = fallback ? settings?.fallbackStratumUser : settings?.stratumUser;
    const endpoint = url && port ? `${host(url)}:${port}` : null;
    const account = user ? poolAccountFromUser(user) : '';
    const confirmed = snapshot?.isUsingFallbackStratum !== undefined && device.status === 'online';
    const key = JSON.stringify([device.demo, endpoint, account]);
    let group = groups.get(key);
    if (!group) {
      const names = endpoint ? profiles.filter(p => `${host(p.settings.stratumURL)}:${p.settings.stratumPort}` === endpoint && p.settings.stratumAccount === account).map(p => p.name) : [];
      group = { key, endpoint, account, names, confirmed, demo: device.demo, devices: [] };
      groups.set(key, group);
    }
    group.confirmed = group.confirmed && confirmed;
    group.devices.push(device);
  }
  return [...groups.values()];
}
// Sum aligned time buckets. Missing readings remain unavailable, never zero-filled.
export function fleetTotals(series: FleetSeries[]): FleetMetric[] {
  const buckets = new Map<string, FleetMetric>();
  for (const device of series) for (const metric of device.metrics) {
    let total = buckets.get(metric.timestamp);
    if (!total) { total = { timestamp: metric.timestamp, hashRate: null, power: null, temp: null, vrTemp: null, errorRate: null, contributors: { hashRate: 0, power: 0 } }; buckets.set(metric.timestamp, total); }
    for (const field of ['hashRate', 'power'] as const) {
      const value = metric[field];
      if (value !== null && Number.isFinite(value)) { total[field] = (total[field] ?? 0) + value; total.contributors![field]!++; }
    }
  }
  return [...buckets.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
