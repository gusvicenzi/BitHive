import type { Device, PrismaClient } from '@prisma/client';
import type { Snapshot, DeviceView } from '../shared/domain.js';
import { status } from '../shared/domain.js';

export function snapshotOf(device: Device): Snapshot | null {
  const parsed = JSON.parse(device.snapshot);
  return parsed.capabilities ? parsed as Snapshot : null;
}
export function view(device: Device): DeviceView {
  return { id: device.id, name: device.name, address: device.address, demo: device.demo,
    lastSeen: device.lastSeen?.toISOString() ?? null, status: status(device.lastSeen, device.failures), snapshot: snapshotOf(device) };
}
export async function persistReading(db: PrismaClient, device: Device, snapshot: Snapshot, now = new Date()) {
  const before = snapshotOf(device);
  const changed = before && JSON.stringify(before.settings) !== JSON.stringify(snapshot.settings);
  await db.$transaction([
    db.device.update({ where: { id: device.id }, data: { snapshot: JSON.stringify(snapshot), lastSeen: now, failures: 0, nextPoll: new Date(now.getTime() + 15000) } }),
    db.metric.create({ data: { deviceId: device.id, timestamp: now, hashRate: snapshot.hashRate, power: snapshot.power, temp: snapshot.temp,
      vrTemp: snapshot.vrTemp, errorRate: snapshot.errorRate, accepted: snapshot.accepted, rejected: snapshot.rejected } }),
    ...(device.failures || !device.lastSeen ? [db.event.create({ data: { deviceId: device.id, kind: 'connected', timestamp: now } })] : []),
    ...(changed ? [db.configChange.create({ data: { deviceId: device.id, before: JSON.stringify(before.settings), requested: '{}', after: JSON.stringify(snapshot.settings), result: 'observed', timestamp: now } })] : []),
  ]);
}
export async function retention(db: PrismaClient, now = Date.now()) {
  const cutoff = (days: number) => new Date(now - days * 86400000);
  await db.$transaction([
    db.metric.deleteMany({ where: { timestamp: { lt: cutoff(30) } } }),
    db.event.deleteMany({ where: { timestamp: { lt: cutoff(90) } } }),
    db.configChange.deleteMany({ where: { timestamp: { lt: cutoff(365) } } }),
  ]);
}
