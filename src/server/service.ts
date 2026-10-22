import type { Device } from '@prisma/client';
import { grid, profileSchema, tuningConfigSchema, tuningTelemetryFailure, type TuningProfile } from '../shared/tuning.js';
import type { Reading } from './adapter.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { type Settings, type ActionResult, addressSchema, settingsSchema, displayNameSchema } from '../shared/domain.js';
import { AxeAdapter, type MinerAdapter, validateCapabilities, validateTuningCapabilities } from './adapter.js';
import { DemoAdapter } from './demo.js';
import { Limiter, DeviceLocks } from './concurrency.js';
import { AppError } from './errors.js';
import { persistReading, snapshotOf, view } from './repository.js';

export class FleetService {
  private limiter = new Limiter(4);
  private locks = new DeviceLocks();
  constructor(public db: PrismaClient, private hardware: MinerAdapter = new AxeAdapter(), private demo = new DemoAdapter()) {}
  private async device(id: string) {
    const device = await this.db.device.findUnique({ where: { id } });
    if (!device) throw new AppError('notFound', 404);
    return device;
  }
  async list() { return (await this.db.device.findMany({ orderBy: { createdAt: 'asc' }, take: 500 })).map(view); }
  async register(address: string, name?: string) {
    address = addressSchema.parse(address);
    return this.limiter.run(async () => {
      if (await this.db.device.count() >= 500) throw new AppError('fleetLimit');
      if (await this.db.device.findUnique({ where: { address } })) throw new AppError('duplicateDevice', 409);
      const reading = await this.hardware.read(address);
      const displayName = name?.trim() ? displayNameSchema.parse(name) : (reading.snapshot.hostname?.trim() || reading.snapshot.model?.trim() || address).slice(0, 80);
      try {
        const device = await this.db.device.create({ data: { address, name: displayName } });
        await persistReading(this.db, device, reading.snapshot);
        return view(await this.device(device.id));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('duplicateDevice', 409);
        throw error;
      }
    });
  }
  async renameDisplayName(id: string, name: string) {
    name = displayNameSchema.parse(name);
    return this.locks.run(id, async () => {
      const device = await this.device(id);
      const [updated] = await this.db.$transaction([
        this.db.device.update({ where: { id }, data: { name } }),
        this.db.configChange.create({ data: { deviceId: id, before: JSON.stringify({ displayName: device.name }), requested: JSON.stringify({ displayName: name }), after: JSON.stringify({ displayName: name }), result: 'verified' } }),
        this.db.event.create({ data: { deviceId: id, kind: 'renamed' } }),
      ]);
      return view(updated);
    });
  }
  async enableDemo() {
    for (let index = 1; index <= 3; index++) {
      const address = `demo-${index}`;
      const device = await this.db.device.upsert({ where: { address }, create: { address, name: `Bitaxe ${index}`, demo: true }, update: {} });
      await this.poll(device.id);
    }
    return this.list();
  }
  async poll(id: string) {
    return this.locks.run(id, () => this.limiter.run(async () => {
      const device = await this.device(id);
      const adapter: MinerAdapter = device.demo ? this.demo : this.hardware;
      if (device.demo) {
        const previous = snapshotOf(device);
        if (previous) this.demo.restore(device.address, previous.settings);
      }
      try {
        const reading = await adapter.read(device.address);
        await persistReading(this.db, device, reading.snapshot);
        return { id, result: 'refreshed' } as ActionResult;
      } catch {
        const failures = device.failures + 1;
        await this.db.$transaction([
          this.db.device.update({ where: { id }, data: { failures, nextPoll: new Date(Date.now() + Math.min(300000, 15000 * 2 ** Math.min(failures, 5))) } }),
          ...(device.failures === 0 ? [this.db.event.create({ data: { deviceId: id, kind: 'disconnected' } })] : []),
        ]);
        return { id, result: 'rejected', reason: 'deviceUnavailable' } as ActionResult;
      }
    }));
  }
  async configure(id: string, input: Settings, customValuesAcknowledged = false): Promise<ActionResult> {
    const settings = settingsSchema.parse(input);
    return this.locks.run(id, () => this.limiter.run(async () => {
      let device = await this.device(id);
      if (await this.db.tuningRun.findFirst({ where: { deviceId: id, activeSlot: 1 } })) throw new AppError('tuningOwnsDevice', 409);
      const adapter: MinerAdapter = device.demo ? this.demo : this.hardware;
      if (device.demo && snapshotOf(device)) this.demo.restore(device.address, snapshotOf(device)!.settings);
      // Hostname changes can invalidate the old mDNS address. Resolve it once,
      // then keep the validated IP for dispatch, verification, and future polls.
      if (settings.hostname !== undefined && adapter.stableAddress) {
        const address = await adapter.stableAddress(device.address);
        if (address !== device.address) {
          const existing = await this.db.device.findUnique({ where: { address } });
          if (existing && existing.id !== id) throw new AppError('duplicateDevice', 409);
          device = await this.db.device.update({ where: { id }, data: { address } });
        }
      }
      // Read immediately before writing so capability checks and pool slots are current.
      const before = await adapter.read(device.address);
      validateCapabilities(settings, before.snapshot, customValuesAcknowledged);
      const { stratumPassword, ...publicSettings } = settings;
      const audit = await this.db.configChange.create({ data: { deviceId: id, before: JSON.stringify(before.snapshot.settings),
        requested: JSON.stringify({ ...publicSettings, ...(customValuesAcknowledged ? { customValuesAcknowledged: true } : {}), ...(stratumPassword !== undefined ? { passwordChanged: true } : {}) }), result: 'unknown' } });
      let result: ActionResult['result'];
      let after: string | undefined;
      let acknowledged = false;
      try { await adapter.patch(device.address, settings, before, customValuesAcknowledged); acknowledged = true; } catch { /* Never replay a write with an unknown outcome. */ }
      try {
        const reading = await adapter.read(device.address);
        after = JSON.stringify(reading.snapshot.settings);
        const matches = Object.entries(publicSettings).every(([key, value]) => reading.snapshot.settings[key as keyof typeof publicSettings] === value);
        result = matches && stratumPassword === undefined ? 'verified' : acknowledged ? 'unverified' : 'unknown';
        await persistReading(this.db, device, reading.snapshot);
      } catch {
        result = 'unknown';
        await this.db.$transaction([
          this.db.device.update({ where: { id }, data: { failures: { increment: 1 }, nextPoll: new Date(Date.now() + 30000) } }),
          ...(device.failures === 0 ? [this.db.event.create({ data: { deviceId: id, kind: 'disconnected' } })] : []),
        ]);
      }
      await this.db.$transaction([
        this.db.configChange.update({ where: { id: audit.id }, data: { result, after } }),
        this.db.event.create({ data: { deviceId: id, kind: result } }),
      ]);
      return { id, result };
    }));
  }
  // Uses the same lock and concurrency budget as collection and manual controls.
  async withTuningDevice<T>(id: string, work: (device: Device, adapter: MinerAdapter, reading: Reading) => Promise<T>) {
    return this.locks.run(id, () => this.limiter.run(async () => {
      const device = await this.device(id);
      const adapter = device.demo ? this.demo : this.hardware;
      if (device.demo && snapshotOf(device)) this.demo.restore(device.address, snapshotOf(device)!.settings);
      const reading = await adapter.read(device.address);
      await persistReading(this.db, device, reading.snapshot);
      return work(device, adapter, reading);
    }));
  }
  async tuningWrite(id: string, runId: string, input: TuningProfile, purpose: string, noVoltageIncrease = false, expectedBefore?: TuningProfile, attemptId?: string) {
    const profile = profileSchema.parse(input);
    return this.withTuningDevice(id, async (device, adapter, before) => {
      const owner = await this.db.tuningRun.findFirst({ where: { id: runId, deviceId: id, activeSlot: 1 } });
      if (!owner) throw new AppError('tuningOwnsDevice', 409);
      if (!adapter.patchTuning) throw new AppError('tuningNotValidated');
      const limits = tuningConfigSchema.parse(JSON.parse(owner.config));
      const progress = JSON.parse(owner.state);
      if (!device.demo) {
        if (limits.physicalTuningAcknowledged !== true) throw new AppError('physicalTuningAcknowledgementRequired');
        if (!before.snapshot.firmware || before.snapshot.firmware !== progress.firmware) throw new AppError('firmwareChanged');
        validateTuningCapabilities(profile, before.snapshot);
      }
      if (purpose === 'recovery') {
        const targets = [progress.original, progress.stable].filter(Boolean) as TuningProfile[];
        if (!targets.some(target => Object.entries(profile).every(([key, value]) => target[key as keyof TuningProfile] === value))) throw new AppError('unsupportedProfile');
      } else if (!grid(limits.frequency).includes(profile.frequency) || !grid(limits.voltage).includes(profile.coreVoltage)
        || profile.autofanspeed !== (limits.fan.mode === 'automatic' ? 1 : 0)
        || profile.manualFanSpeed !== (limits.fan.mode === 'fixed' ? limits.fan.percentage : progress.original.manualFanSpeed)) throw new AppError('unsupportedProfile');
      const snapshot = before.snapshot;
      const fault = snapshot.hardwareFault || snapshot.firmwareProtection;
      const hot = (snapshot.temp ?? 0) >= limits.maxAsicTemperature || (snapshot.vrTemp ?? 0) >= limits.maxVrmTemperature;
      if (purpose !== 'recovery') {
        if (snapshot.firmware !== progress.firmware) throw new AppError('firmwareChanged');
        if (progress.uptime !== null && snapshot.uptime !== undefined && snapshot.uptime < progress.uptime || (snapshot.resetReason ?? null) !== progress.resetReason) throw new AppError('reboot');
        if (fault || hot) throw new AppError(hot ? 'temperature' : 'hardwareFault');
        const missing = tuningTelemetryFailure(snapshot, limits);
        if (missing) throw new AppError(missing);
      }
      noVoltageIncrease ||= Boolean(fault || hot);
      if (expectedBefore && !Object.entries(expectedBefore).every(([key, value]) => before.snapshot.settings[key as keyof TuningProfile] === value)) throw new AppError('externalChange', 409);
      if (noVoltageIncrease && (before.snapshot.settings.coreVoltage === undefined || profile.coreVoltage > before.snapshot.settings.coreVoltage)) throw new AppError('unsafeRecovery');
      const checkpoint = await this.db.tuningCheckpoint.create({ data: { runId, profile: JSON.stringify(profile), purpose, status: 'intended' } });
      const audit = await this.db.configChange.create({ data: { deviceId: id, before: JSON.stringify(before.snapshot.settings), requested: JSON.stringify({ ...profile, ...(limits.configuredFrequencyAcknowledged === true ? { configuredFrequencyAcknowledged: true } : {}), ...(!device.demo ? { physicalTuningAcknowledged: true } : {}) }), result: 'unknown' } });
      await this.db.tuningCheckpoint.update({ where: { id: checkpoint.id }, data: { auditId: audit.id } });
      if (attemptId) await this.db.tuningAttempt.update({ where: { id: attemptId }, data: { auditId: audit.id } });
      let acknowledged = false;
      try { await adapter.patchTuning(device.address, profile, before); acknowledged = true; } catch { /* Never replay uncertain candidate writes. */ }
      let result: ActionResult['result'] = 'unknown';
      let after: Reading | null = null;
      try {
        after = await adapter.read(device.address);
        const matches = Object.entries(profile).every(([key, value]) => after!.snapshot.settings[key as keyof TuningProfile] === value);
        result = matches ? 'verified' : acknowledged ? 'unverified' : 'unknown';
        await persistReading(this.db, device, after.snapshot);
      } catch { /* Unknown remains unknown until a separate recovery action. */ }
      await this.db.$transaction([
        this.db.configChange.update({ where: { id: audit.id }, data: { result, after: after ? JSON.stringify(after.snapshot.settings) : null } }),
        this.db.tuningCheckpoint.update({ where: { id: checkpoint.id }, data: { status: result } }),
      ]);
      return { result, auditId: audit.id, snapshot: after?.snapshot ?? null };
    });
  }
  async batch(ids: string[], action: 'refresh' | 'configure', settings?: Settings, customValuesAcknowledged = false) {
    return Promise.all(ids.map(async id => {
      try { return action === 'refresh' ? await this.poll(id) : await this.configure(id, settings!, customValuesAcknowledged); }
      catch (error) { return { id, result: 'rejected', reason: error instanceof AppError ? error.code : 'operationFailed' } as ActionResult; }
    }));
  }
}
