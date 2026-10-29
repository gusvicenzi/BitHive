import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AxeAdapter, type Reading } from '../src/server/adapter.js';
import { DemoAdapter } from '../src/server/demo.js';
import { FleetService } from '../src/server/service.js';
import { Tuner } from '../src/server/tuning.js';
import { createApp } from '../src/server/app.js';
import { tuningConfigSchema, type TuningRunView } from '../src/shared/tuning.js';
import { testDatabase } from './helpers.js';

// Exercise the actual hardware adapter with an injected in-memory transport.
// No network requests or user databases are used.
const config = tuningConfigSchema.parse({ physicalTuningAcknowledged: true,
  frequency: { minimum: 437, maximum: 462, step: 25 }, voltage: { minimum: 1110, maximum: 1120, step: 10 },
  maxAsicTemperature: 65, maxVrmTemperature: 85, maxErrorPercentage: 2,
  fan: { mode: 'fixed', percentage: 70 }, expected: { source: 'firmware' }, stabilizationSeconds: 5, measurementSeconds: 10 });
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let now: number, miner: DemoAdapter, adapter: AxeAdapter, fleet: FleetService, tuner: Tuner, deviceId: string;
let mutate: (raw: Reading['raw']) => void;
let offline: boolean, failNextWrite: boolean, ignoreNextWrite: boolean;
let writes: Record<string, unknown>[];
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await fixture?.close(); });
beforeEach(async () => {
  await fixture.db.device.deleteMany(); now = 1000000; miner = new DemoAdapter(); writes = [];
  mutate = () => {}; offline = false; failNextWrite = false; ignoreNextWrite = false;
  adapter = new AxeAdapter(async (_address, path, method, body) => {
    if (offline) throw new Error('offline');
    if (method === 'PATCH') {
      writes.push(body as Record<string, unknown>);
      if (failNextWrite) { failNextWrite = false; throw new Error('timeout'); }
      if (ignoreNextWrite) { ignoreNextWrite = false; return {}; }
      const reading = await miner.read('demo-1');
      miner.restore('demo-1', { ...reading.snapshot.settings, ...body as object });
      return {};
    }
    if (path.endsWith('/asic')) return { deviceModel: 'Gamma', frequencyOptions: [400, 525, 575], voltageOptions: [1100, 1150, 1200] };
    const reading = await miner.read('demo-1');
    const raw = { ...reading.raw, uptimeSeconds: now / 1000, sharesAccepted: now / 5000, hashRate: reading.raw.expectedHashrate };
    mutate(raw); return raw;
  });
  fleet = new FleetService(fixture.db, adapter);
  deviceId = (await fleet.register('192.168.1.42')).id; tuner = new Tuner(fleet, () => now);
});
const create = (overrides = {}) => tuner.create(deviceId, 'physical', { ...config, ...overrides });
async function step(run: TuningRunView) { await tuner.tick(); now += 5000; return tuner.get(deviceId, run.id); }
async function until(run: TuningRunView, predicate: (r: TuningRunView) => boolean) {
  for (let n = 0; n < 150; n++) { run = await step(run); if (predicate(run)) return run; }
  throw new Error(`Unexpected phase: ${run.state.phase}`);
}
const inSearch = (r: TuningRunView) => r.state.kind === 'search' && r.state.phase === 'measuring';

// Full tuning lifecycles perform many real SQLite transactions. Windows CI
// needs more headroom than the default 15-second budget; keep ordinary tests bounded.
describe('acknowledged physical tuning through the hardware adapter', { timeout: 60000 }, () => {
  it('requires strict per-run acknowledgement in the API and persists it without writing at creation', async () => {
    const app = await createApp(fixture.db, { service: fleet, tuner });
    const request = (input: unknown) => app.inject({ method: 'POST', url: `/api/devices/${deviceId}/tuning`,
      headers: { host: 'localhost:3080', 'x-bithive': '1' }, payload: { requestKey: 'physical', config: input } });
    try {
      for (const acknowledgement of [undefined, false]) {
        const response = await request({ ...config, physicalTuningAcknowledged: acknowledgement });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('physicalTuningAcknowledgementRequired');
      }
      expect((await request({ ...config, physicalTuningAcknowledged: 'true' })).statusCode).toBe(400);
      expect((await request({ ...config, voltage: { minimum: 1110, maximum: 65536, step: 1000 } })).statusCode).toBe(400);
      expect(await fixture.db.tuningRun.count()).toBe(0);
      const response = await request(config); expect(response.statusCode).toBe(200);
      expect(response.json().config.physicalTuningAcknowledged).toBe(true);
      expect((await request(config)).json().id).toBe(response.json().id);
      expect(writes).toHaveLength(0);
    } finally { await app.close(); }
  });
  it('runs a custom grid, confirms winners, restores the complete original profile and applies a winner explicitly', async () => {
    let run = await until(await create(), r => r.state.phase === 'completed');
    expect(run.state.original).toEqual({ frequency: 525, coreVoltage: 1150, autofanspeed: 1, manualFanSpeed: 60 });
    expect(writes.at(-1)).toEqual(run.state.original);
    const results = await tuner.results(deviceId, run.id);
    expect(results.attempts.filter(a => a.kind === 'search')).toHaveLength(4);
    expect(results.winners).toHaveLength(1);
    expect(results.winners[0].summary?.duration).toBe(30);
    expect((await fleet.list())[0]).toMatchObject({ demo: false, snapshot: { settings: run.state.original } });
    expect(writes.every(write => Object.keys(write).sort().join(',') === 'autofanspeed,coreVoltage,frequency,manualFanSpeed')).toBe(true);
    const audits = await fixture.db.configChange.findMany({ where: { result: { not: 'observed' } } });
    expect(audits.every(a => JSON.parse(a.requested).physicalTuningAcknowledged === true && a.result === 'verified')).toBe(true);
    expect(await tuner.applyWinner(deviceId, run.id, 'hashrate')).toMatchObject({ result: 'verified' });
    expect(writes.at(-1)).toEqual(results.winners[0].profile);
    run = await tuner.get(deviceId, run.id); expect(run.state.phase).toBe('completed');
  });
  it('restores on pause/stop and after restart without replaying the interrupted candidate', async () => {
    let run = await until(await create(), inSearch); const candidate = run.state.profile;
    run = await tuner.control(deviceId, run.id, 'pause');
    expect(run.state.phase).toBe('paused'); expect(writes.at(-1)).toEqual(run.state.original);
    run = await tuner.control(deviceId, run.id, 'resume'); expect(run.state.profile).toEqual(candidate);
    run = await until(run, inSearch); const count = writes.length;
    tuner = new Tuner(new FleetService(fixture.db, adapter), () => now); await tuner.restartRecovery();
    run = await tuner.get(deviceId, run.id); expect(run.state.phase).toBe('paused');
    expect(writes).toHaveLength(count + 1); expect(writes.at(-1)).toEqual(run.state.original);
    run = await tuner.control(deviceId, run.id, 'stop'); expect(run.state.phase).toBe('stopped');
    expect(await fixture.db.tuningRun.count({ where: { activeSlot: 1 } })).toBe(0);
  });
  it('checks persisted acknowledgement and selected limits again immediately before dispatch', async () => {
    const run = await create();
    const candidate = { ...run.state.original, frequency: 437, coreVoltage: 1110, autofanspeed: 0 as const, manualFanSpeed: 70 };
    await expect(fleet.tuningWrite(deviceId, run.id, { ...candidate, frequency: 500 }, 'search')).rejects.toThrow('unsupportedProfile');
    await expect(fleet.tuningWrite(deviceId, run.id, { ...candidate, manualFanSpeed: 80 }, 'search')).rejects.toThrow('unsupportedProfile');
    await expect(fleet.tuningWrite(deviceId, run.id, candidate, 'recovery')).rejects.toThrow('unsupportedProfile');
    await fixture.db.tuningRun.update({ where: { id: run.id }, data: { config: JSON.stringify({ ...config, physicalTuningAcknowledged: false }) } });
    await expect(fleet.tuningWrite(deviceId, run.id, candidate, 'search')).rejects.toThrow('physicalTuningAcknowledgementRequired');
    expect(writes).toHaveLength(0); expect(await fixture.db.configChange.count()).toBe(0);
  });
  it('blocks missing telemetry and unsupported fan writes before creating a run', async () => {
    mutate = raw => { delete raw.actualFrequency; };
    await expect(create()).rejects.toThrow('missingActualFrequency');
    mutate = raw => { delete raw.manualFanSpeed; };
    await expect(create()).rejects.toThrow();
    expect(writes).toHaveLength(0); expect(await fixture.db.tuningRun.count()).toBe(0);
  });
  it('uses explicitly acknowledged configured frequency throughout a reference-based run and records the source', async () => {
    mutate = raw => { delete raw.actualFrequency; delete raw.expectedHashrate; };
    const run = await until(await create({ configuredFrequencyAcknowledged: true, expected: { source: 'reference', ths: 1.2, frequency: 525 } }), r => r.state.phase === 'completed');
    expect(run.config.configuredFrequencyAcknowledged).toBe(true);
    expect(writes.at(-1)).toEqual(run.state.original);
    const rows = await fixture.db.tuningSample.findMany({ include: { attempt: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const sample = JSON.parse(row.data), profile = JSON.parse(row.attempt.profile);
      expect(sample.frequencySource).toBe('configured'); expect(sample.frequency).toBe(profile.frequency);
      expect(sample.expected).toBeCloseTo(1.2 * profile.frequency / 525);
    }
    expect((await fixture.db.configChange.findMany({ where: { result: { not: 'observed' } } })).every(a => JSON.parse(a.requested).configuredFrequencyAcknowledged === true)).toBe(true);
  });
  it('keeps the acknowledged frequency source through pause, resume and server restart', async () => {
    // A reported actual frequency must not silently change the selected source.
    mutate = raw => { raw.actualFrequency = 50; };
    let run = await until(await create({ configuredFrequencyAcknowledged: true }), inSearch);
    run = await tuner.control(deviceId, run.id, 'pause'); expect(run.state.phase).toBe('paused');
    run = await tuner.control(deviceId, run.id, 'resume'); run = await until(run, inSearch);
    tuner = new Tuner(new FleetService(fixture.db, adapter), () => now); await tuner.restartRecovery();
    run = await tuner.get(deviceId, run.id); expect(run.state.phase).toBe('paused');
    expect(run.config.configuredFrequencyAcknowledged).toBe(true);
    run = await tuner.control(deviceId, run.id, 'resume'); run = await until(run, r => r.state.phase === 'completed');
    expect(run.state.reason).not.toBe('frequencyMismatch');
  });
  it('cannot use configured frequency without acknowledgement or bypass missing safety telemetry', async () => {
    mutate = raw => { delete raw.actualFrequency; };
    await expect(create()).rejects.toThrow('missingActualFrequency');
    mutate = raw => { delete raw.actualFrequency; delete raw.vrTemp; };
    await expect(create({ configuredFrequencyAcknowledged: true })).rejects.toThrow('missingTelemetry');
    expect(writes).toHaveLength(0);
  });
  it('tolerates absent optional reset reason instead of falsely detecting a reboot', async () => {
    mutate = raw => { delete raw.resetReason; };
    const run = await until(await create(), inSearch);
    expect(run.state.reason).toBeNull(); expect(writes).toHaveLength(1);
  });
  it('does not replay uncertain candidates and restores through a separately audited command', async () => {
    let run = await until(await create(), r => r.state.phase === 'applying');
    failNextWrite = true; run = await step(run);
    expect(run.state.reason).toBe('uncertainWrite'); expect(writes).toHaveLength(1);
    run = await step(run); expect(writes).toHaveLength(2); expect(writes.at(-1)).toEqual(run.state.original);
    const audits = await fixture.db.configChange.findMany({ orderBy: { timestamp: 'asc' } });
    expect(audits[0].result).toBe('unknown'); expect(audits[1].result).toBe('verified');
  });
  it('rejects acknowledged-but-unapplied settings and reports unreachable restoration', async () => {
    let run = await until(await create(), r => r.state.phase === 'applying');
    ignoreNextWrite = true; run = await step(run);
    expect(run.state.reason).toBe('uncertainWrite'); expect(writes).toHaveLength(1);
    expect((await fixture.db.configChange.findFirstOrThrow()).result).toBe('unverified');
    offline = true; now += 121000; run = await step(run);
    expect(run.state.phase).toBe('recovery_required');
    expect(await fixture.db.tuningRun.count({ where: { activeSlot: 1 } })).toBe(1);
  });
  it('never increases voltage after overheating, retaining recovery ownership', async () => {
    let run = await until(await create(), inSearch); const count = writes.length;
    mutate = raw => { raw.temp = 65; }; run = await step(run);
    expect(run.state.safetyStop).toBe(true); expect(run.state.reason).toBe('temperature');
    run = await step(run); expect(writes).toHaveLength(count);
    now += 121000; run = await step(run); expect(run.state.phase).toBe('recovery_required');
    await expect(tuner.control(deviceId, run.id, 'resume')).rejects.toThrow('tuningCannotResume');
  });
  it('blocks all physical writes after a firmware change, including attempted restoration', async () => {
    let run = await until(await create(), inSearch); const count = writes.length;
    mutate = raw => { raw.version = 'different-firmware'; }; run = await step(run);
    expect(run.state.reason).toBe('firmwareChanged'); run = await step(run);
    expect(writes).toHaveLength(count);
    now += 121000; run = await step(run); expect(run.state.phase).toBe('recovery_required');
  });
});
