import type { ScheduleExecution } from '@prisma/client';
import { operatingSettingsSchema, schedulePeriod, type ChangePoint, type OperatingSettings } from '../shared/schedules.js';
import { ScheduleRepository, assignmentsOf, acknowledged, customSettings } from './schedule-repository.js';
import { DeviceLocks } from './concurrency.js';
import { AppError } from './errors.js';
import type { FleetService } from './service.js';

export class Scheduler {
  readonly repository: ScheduleRepository;
  private lock = new DeviceLocks();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running?: Promise<void>;
  constructor(private fleet: FleetService, private now = Date.now, private report: (error: unknown) => void = () => {}) {
    this.repository = new ScheduleRepository(fleet.db, now);
  }
  // Timetable mutations and dispatch claims share a short lock. Network waits
  // never block disabling a schedule; device locks serialize manual work.
  mutate<T>(work: () => Promise<T>) { return this.lock.run('schedules', work); }
  private async record(execution: ScheduleExecution, status: string, reason: string | null = null) {
    if (execution.status === status && execution.reason === reason) return;
    await this.fleet.db.scheduleExecution.update({ where: { id: execution.id }, data: { status, reason, timestamp: new Date(this.now()) } });
  }
  async tick() {
    return this.lock.run('cycle', async () => {
      const db = this.fleet.db;
      const schedules = await db.schedule.findMany({ where: { enabled: true }, include: { members: true } });
      for (const schedule of schedules) {
        const period = schedulePeriod(JSON.parse(schedule.points) as ChangePoint[], schedule.timeZone, this.now());
        const outcomes = await Promise.allSettled(schedule.members.map(async member => {
          const key = { scheduleId: schedule.id, deviceId: member.deviceId, revision: schedule.revision, occurrence: period.current.at };
          let execution = await db.scheduleExecution.findUnique({ where: { scheduleId_deviceId_revision_occurrence: key } });
          if (execution?.attempted) {
            // A crash between claim and completion is reconciled by reads only.
            if (['dispatching', 'unknown', 'unverified'].includes(execution.status)) {
              try {
                const reading = await this.fleet.poll(member.deviceId);
                if (reading.result !== 'refreshed') throw new AppError('scheduleOffline');
                const device = (await this.fleet.list()).find(d => d.id === member.deviceId);
                const settings: OperatingSettings = JSON.parse(execution.settings);
                const matches = Object.entries(settings).every(([k, v]) => device?.snapshot?.settings[k as keyof OperatingSettings] === v);
                await this.record(execution, matches ? 'verified' : 'unknown');
              } catch { await this.record(execution, 'unknown'); }
            }
            return;
          }
          if (member.overrideUntil && member.overrideUntil.getTime() > this.now()) return;
          const profile = await db.profile.findUnique({ where: { id: assignmentsOf(member)[period.current.pointId] ?? '' } });
          const parsed = profile && profile.deviceId === member.deviceId ? operatingSettingsSchema.safeParse(JSON.parse(profile.settings)) : null;
          if (!execution) execution = await db.scheduleExecution.create({ data: { ...key, scheduleName: schedule.name, periodName: period.current.name, pointId: period.current.pointId, profileName: profile?.name ?? '', settings: JSON.stringify(parsed?.success ? parsed.data : {}), status: 'pending', timestamp: new Date(this.now()) } });
          if (!parsed?.success) { await this.record(execution, 'blocked', 'scheduleIncomplete'); return; }
          const settings = parsed.data;
          const claimed = execution;
          try {
            const result = await this.fleet.configure(member.deviceId, settings, acknowledged(member, period.current.pointId, settings), undefined, {
              prepare: reading => this.mutate(async () => {
                if (reading.snapshot.hardwareFault || reading.snapshot.firmwareProtection) throw new AppError('scheduleProtection');
                const latest = await db.schedule.findUnique({ where: { id: schedule.id }, include: { members: { where: { deviceId: member.deviceId } } } });
                const currentMember = latest?.members[0];
                if (!latest?.enabled || latest.revision !== schedule.revision || !currentMember
                  || schedulePeriod(JSON.parse(latest.points), latest.timeZone, this.now()).current.at !== period.current.at
                  || (currentMember.overrideUntil && currentMember.overrideUntil.getTime() > this.now())) throw new AppError('scheduleSuperseded');
                if (customSettings(settings, reading.snapshot) && !acknowledged(currentMember, period.current.pointId, settings)) throw new AppError('scheduleAcknowledgment');
                // Durable claim precedes every possible command, including audit writes.
                const claim = await db.scheduleExecution.updateMany({ where: { id: claimed.id, attempted: false }, data: { attempted: true, status: 'dispatching', settings: JSON.stringify(settings), profileName: profile!.name, timestamp: new Date(this.now()) } });
                if (claim.count !== 1) throw new AppError('scheduleSuperseded');
              }),
            });
            await this.record({ ...claimed, status: 'dispatching' }, result.result);
          } catch (error) {
            const reason = error instanceof AppError ? error.code : 'scheduleOffline';
            const current = await db.scheduleExecution.findUniqueOrThrow({ where: { id: claimed.id } });
            if (reason === 'scheduleSuperseded') return;
            await this.record(current, current.attempted ? 'unknown' : ['unsupportedProfile', 'unsupported', 'manualFanRequiresManualMode', 'scheduleAcknowledgment', 'scheduleProtection'].includes(reason) ? 'blocked' : 'waiting', reason);
          }
        }));
        const failure = outcomes.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
    });
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = () => {
      this.running = this.tick().catch(this.report).finally(() => { if (!this.stopped) this.timer = setTimeout(loop, 5000); });
    };
    loop();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.running; }
}
