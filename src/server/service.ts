import { Prisma, type PrismaClient } from '@prisma/client';
import { type Settings, type ActionResult, addressSchema, settingsSchema, displayNameSchema } from '../shared/domain.js';
import { AxeAdapter, type MinerAdapter, validateCapabilities } from './adapter.js';
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
  async configure(id: string, input: Settings): Promise<ActionResult> {
    const settings = settingsSchema.parse(input);
    return this.locks.run(id, () => this.limiter.run(async () => {
      let device = await this.device(id);
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
      validateCapabilities(settings, before.snapshot);
      const { stratumPassword, ...publicSettings } = settings;
      const audit = await this.db.configChange.create({ data: { deviceId: id, before: JSON.stringify(before.snapshot.settings),
        requested: JSON.stringify({ ...publicSettings, ...(stratumPassword !== undefined ? { passwordChanged: true } : {}) }), result: 'unknown' } });
      let result: ActionResult['result'];
      let after: string | undefined;
      let acknowledged = false;
      try { await adapter.patch(device.address, settings, before); acknowledged = true; } catch { /* Never replay a write with an unknown outcome. */ }
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
  async batch(ids: string[], action: 'refresh' | 'configure', settings?: Settings) {
    return Promise.all(ids.map(async id => {
      try { return action === 'refresh' ? await this.poll(id) : await this.configure(id, settings!); }
      catch (error) { return { id, result: 'rejected', reason: error instanceof AppError ? error.code : 'operationFailed' } as ActionResult; }
    }));
  }
}
