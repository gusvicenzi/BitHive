import { Prisma, type PrismaClient, type ScheduleMember } from '@prisma/client';
import { operatingSettingsSchema, scheduleSchema, schedulePeriod, type ChangePoint, type ScheduleInput, type ScheduleView, type OperatingSettings } from '../shared/schedules.js';
import { AppError } from './errors.js';
import { snapshotOf } from './repository.js';

export const scheduleInclude = { members: true } as const;
export function settingsFingerprint(settings: OperatingSettings) {
  return JSON.stringify(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)));
}
export function customSettings(settings: OperatingSettings, snapshot: ReturnType<typeof snapshotOf>) {
  return (settings.frequency !== undefined && !snapshot?.capabilities.frequencies.includes(settings.frequency))
    || (settings.coreVoltage !== undefined && !snapshot?.capabilities.voltages.includes(settings.coreVoltage));
}
export function assignmentsOf(member: ScheduleMember): Record<string, string> { return JSON.parse(member.assignments); }
export function acknowledged(member: ScheduleMember, pointId: string, settings: OperatingSettings) {
  return JSON.parse(member.acknowledgments)[pointId] === settingsFingerprint(settings);
}
export class ScheduleRepository {
  constructor(public db: PrismaClient, public now = Date.now) {}
  async load(id: string) {
    const schedule = await this.db.schedule.findUnique({ where: { id }, include: scheduleInclude });
    if (!schedule) throw new AppError('notFound', 404);
    return schedule;
  }
  async validate(input: ScheduleInput, enabled: boolean) {
    if (enabled && !input.members.length) throw new AppError('scheduleIncomplete');
    const members = [];
    for (const member of input.members) {
      const device = await this.db.device.findUnique({ where: { id: member.deviceId } });
      if (!device) throw new AppError('notFound', 404);
      const acknowledgments: Record<string, string> = {};
      for (const point of input.points) {
        const profileId = member.assignments[point.id];
        if (!profileId) { if (enabled) throw new AppError('scheduleIncomplete'); continue; }
        const profile = await this.db.profile.findUnique({ where: { id: profileId } });
        if (!profile || profile.deviceId !== member.deviceId) throw new AppError('scheduleProfileOwner');
        const settings = operatingSettingsSchema.parse(JSON.parse(profile.settings));
        if (enabled && customSettings(settings, snapshotOf(device)) && !member.customValuesAcknowledged) throw new AppError('scheduleAcknowledgment');
        if (member.customValuesAcknowledged) acknowledgments[point.id] = settingsFingerprint(settings);
      }
      members.push({ deviceId: member.deviceId, assignments: JSON.stringify(member.assignments), acknowledgments: JSON.stringify(acknowledgments), activeDeviceId: enabled ? member.deviceId : null });
    }
    return members;
  }
  async save(raw: unknown, id?: string) {
    const input = scheduleSchema.parse(raw);
    const previous = id ? await this.load(id) : null;
    const enabled = previous?.enabled ?? false;
    const members = await this.validate(input, enabled);
    try {
      const result = await this.db.$transaction(async tx => {
        if (!previous && await tx.schedule.count() >= 100) throw new AppError('scheduleLimit');
        if (previous) {
          await tx.scheduleMember.deleteMany({ where: { scheduleId: previous.id } });
          return tx.schedule.update({ where: { id: previous.id }, data: { name: input.name, timeZone: input.timeZone, points: JSON.stringify(input.points), revision: { increment: 1 }, members: { create: members } } });
        }
        return tx.schedule.create({ data: { name: input.name, timeZone: input.timeZone, points: JSON.stringify(input.points), members: { create: members } } });
      });
      return this.get(result.id);
    } catch (e) { this.conflict(e); }
  }
  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('scheduleConflict', 409);
    throw error;
  }
  async setEnabled(id: string, enabled: boolean) {
    const schedule = await this.load(id);
    if (schedule.enabled === enabled) return this.get(id);
    if (enabled) {
      if (!schedule.members.length) throw new AppError('scheduleIncomplete');
      for (const member of schedule.members) for (const point of JSON.parse(schedule.points) as ChangePoint[]) {
        const profile = await this.db.profile.findUnique({ where: { id: assignmentsOf(member)[point.id] ?? '' } });
        if (!profile || profile.deviceId !== member.deviceId) throw new AppError('scheduleIncomplete');
        const settings = operatingSettingsSchema.parse(JSON.parse(profile.settings));
        const device = await this.db.device.findUniqueOrThrow({ where: { id: member.deviceId } });
        if (customSettings(settings, snapshotOf(device)) && !acknowledged(member, point.id, settings)) throw new AppError('scheduleAcknowledgment');
      }
    }
    try {
      await this.db.$transaction(async tx => {
        await tx.scheduleMember.updateMany({ where: { scheduleId: id }, data: { activeDeviceId: null, overrideUntil: null } });
        if (enabled) for (const member of schedule.members) await tx.scheduleMember.update({ where: { id: member.id }, data: { activeDeviceId: member.deviceId } });
        await tx.schedule.update({ where: { id }, data: { enabled, revision: { increment: 1 } } });
      });
    } catch (e) { this.conflict(e); }
    return this.get(id);
  }
  async remove(id: string) { await this.load(id); await this.db.schedule.delete({ where: { id } }); return { deleted: true }; }
  async get(id: string): Promise<ScheduleView> {
    const schedule = await this.load(id);
    const points: ChangePoint[] = JSON.parse(schedule.points);
    const period = schedulePeriod(points, schedule.timeZone, this.now());
    const results = [], members = [];
    for (const member of schedule.members) {
      const assignments = assignmentsOf(member);
      const profiles = await this.db.profile.findMany({ where: { deviceId: member.deviceId, id: { in: Object.values(assignments) } } });
      const allAcknowledged = profiles.length > 0 && profiles.every(p => Object.entries(assignments).filter(([, id]) => id === p.id).every(([pointId]) => (() => { const parsed = operatingSettingsSchema.safeParse(JSON.parse(p.settings)); return parsed.success && acknowledged(member, pointId, parsed.data); })()));
      members.push({ deviceId: member.deviceId, assignments, customValuesAcknowledged: allAcknowledged });
      const execution = await this.db.scheduleExecution.findUnique({ where: { scheduleId_deviceId_revision_occurrence: { scheduleId: id, deviceId: member.deviceId, revision: schedule.revision, occurrence: period.current.at } } });
      const overridden = member.overrideUntil !== null && member.overrideUntil.getTime() > this.now();
      results.push({ deviceId: member.deviceId, profileName: profiles.find(p => p.id === assignments[period.current.pointId])?.name ?? null,
        status: !schedule.enabled ? 'disabled' : overridden ? 'manual' : execution?.status ?? 'pending', reason: execution?.reason ?? null,
        overrideUntil: member.overrideUntil?.toISOString() ?? null, timestamp: execution?.timestamp.toISOString() ?? null });
    }
    return { id, name: schedule.name, timeZone: schedule.timeZone, points, enabled: schedule.enabled, revision: schedule.revision, members, ...period, results };
  }
  async list() { return Promise.all((await this.db.schedule.findMany({ orderBy: { createdAt: 'asc' }, take: 100 })).map(s => this.get(s.id))); }
}
export async function recordManualScheduleOverride(db: PrismaClient, deviceId: string, now = Date.now()) {
  const member = await db.scheduleMember.findUnique({ where: { activeDeviceId: deviceId }, include: { schedule: true } });
  if (!member?.schedule.enabled) return;
  const { next } = schedulePeriod(JSON.parse(member.schedule.points), member.schedule.timeZone, now);
  await db.scheduleMember.update({ where: { id: member.id }, data: { overrideUntil: new Date(next.at) } });
}
