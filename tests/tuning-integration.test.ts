import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetService } from '../src/server/service.js';
import { DemoAdapter } from '../src/server/demo.js';
import { Tuner } from '../src/server/tuning.js';
import { createApp } from '../src/server/app.js';
import { retention } from '../src/server/repository.js';
import { tuningConfigSchema, type TuningRunView } from '../src/shared/tuning.js';
import { testDatabase } from './helpers.js';

const config = tuningConfigSchema.parse({ frequency: { minimum: 400, maximum: 450, step: 50 }, voltage: { minimum: 1100, maximum: 1150, step: 50 },
  maxAsicTemperature: 70, maxVrmTemperature: 80, maxErrorPercentage: 1, fan: { mode: 'fixed', percentage: 70 }, expected: { source: 'firmware' }, stabilizationSeconds: 5, measurementSeconds: 15 });
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let adapter: DemoAdapter, fleet: FleetService, tuner: Tuner, deviceId: string, now: number;
let modify: (snapshot: Awaited<ReturnType<DemoAdapter['read']>>['snapshot']) => void;
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await fixture?.close(); });
beforeEach(async () => {
  await fixture.db.device.deleteMany(); now = 1000000; modify = () => {};
  adapter = new DemoAdapter();
  const read = adapter.read.bind(adapter);
  vi.spyOn(adapter, 'read').mockImplementation(async address => { const r = await read(address); r.snapshot.uptime = now / 1000;
    r.snapshot.hashRate = r.snapshot.expectedHashrate!; r.snapshot.accepted = now / 5000; modify(r.snapshot); return r; });
  fleet = new FleetService(fixture.db, undefined, adapter);
  await fleet.enableDemo(); deviceId = (await fleet.list())[0].id; tuner = new Tuner(fleet, () => now);
});
async function create(overrides = {}) { return tuner.create(deviceId, 'request', { ...config, ...overrides }); }
async function step(run: TuningRunView) { await tuner.tick(); now += 5000; return tuner.get(deviceId, run.id); }
async function until(run: TuningRunView, predicate: (r: TuningRunView) => boolean, maximum = 300) {
  for (let n = 0; n < maximum; n++) { run = await step(run); if (predicate(run)) return run; }
  throw new Error(`Did not reach state: ${run.state.phase}`);
}
const inSearch = (r: TuningRunView) => r.state.kind === 'search' && r.state.phase === 'measuring';

describe('persistent tuning lifecycle', () => {
  it('migrates idempotently, preserves runs across connections and isolates results from retention', async () => {
    const run = await create(); fixture.migrate();
    expect((await new Tuner(fleet).get(deviceId, run.id)).config).toEqual(config);
    await step(run); await retention(fixture.db, Date.now() + 400 * 86400000);
    expect((await tuner.results(deviceId, run.id)).total).toBe(1);
    expect(await fixture.db.tuningSample.count()).toBe(1);
  });
  it('makes starts idempotent, rejects key reuse and enforces a global database tuning slot', async () => {
    const run = await create(); expect((await create()).id).toBe(run.id);
    await expect(create({ mode: 'fast' })).rejects.toThrow('idempotencyConflict');
    const second = (await fleet.list())[1].id;
    await expect(new Tuner(fleet).create(second, 'other', config)).rejects.toThrow('tuningAlreadyActive');
    expect(await fixture.db.tuningRun.count()).toBe(1);
  });
  it('blocks conflicting writes and leaves normal monitoring available', async () => {
    await create(); await expect(fleet.configure(deviceId, { frequency: 500 })).rejects.toThrow('tuningOwnsDevice');
    expect((await fleet.poll(deviceId)).result).toBe('refreshed');
    expect((await fleet.configure((await fleet.list())[1].id, { frequency: 500 })).result).toBe('verified');
  });
  it('completes the grid, confirms each distinct winner for triple duration, restores originals and requires explicit winner apply', async () => {
    let run = await create(); const patch = vi.spyOn(adapter, 'patchTuning');
    run = await until(run, r => r.state.phase === 'completed');
    const results = await tuner.results(deviceId, run.id);
    expect(results.attempts.filter(a => a.kind === 'search')).toHaveLength(4);
    expect(results.attempts.filter(a => a.kind === 'confirmation')).toHaveLength(1);
    expect(results.attempts.find(a => a.kind === 'confirmation')?.summary?.duration).toBe(45);
    expect(run.state.winners.hashrate).toBe(run.state.winners.efficiency);
    expect((await fleet.list())[0].snapshot?.settings).toMatchObject(run.state.original);
    expect(await fixture.db.tuningRun.count({ where: { activeSlot: 1 } })).toBe(0);
    const writesBefore = patch.mock.calls.length;
    expect(await tuner.applyWinner(deviceId, run.id, 'hashrate')).toMatchObject({ result: 'verified' });
    expect(patch.mock.calls.length).toBe(writesBefore + 1);
    const audits = await fixture.db.tuningCheckpoint.findMany({ where: { purpose: 'search' } });
    expect(audits.every(a => a.auditId !== null && a.status === 'verified')).toBe(true);
  });
  it('keeps measurement samples aligned when the clock advances within a polling tick', async () => {
    tuner = new Tuner(fleet, () => now++);
    const run = await until(await create(), r => r.state.phase === 'completed');
    const results = await tuner.results(deviceId, run.id);
    expect(results.attempts.every(attempt => attempt.outcome === 'passed')).toBe(true);
    expect(results.attempts.some(attempt => attempt.kind === 'confirmation')).toBe(true);
    expect(run.state.winners.hashrate).not.toBeNull();
  });
  it('pauses with verified original restoration and resumes the same interrupted candidate', async () => {
    let run = await until(await create(), inSearch); const profile = run.state.profile;
    run = await tuner.control(deviceId, run.id, 'pause');
    expect(run.state.phase).toBe('paused'); expect(run.state.recovery.status).toBe('verified');
    expect((await fleet.list())[0].snapshot?.settings).toMatchObject(run.state.original);
    run = await tuner.control(deviceId, run.id, 'resume'); expect(run.state.profile).toEqual(profile);
    expect(run.state.phase).toBe('applying');
    run = await until(run, r => r.state.phase === 'completed');
    expect((await tuner.results(deviceId, run.id)).attempts.filter(a => a.reason === 'userPause')).toHaveLength(1);
  });
  it('stops and preserves partial invalid results without overwriting completed attempts', async () => {
    let run = await until(await create(), inSearch);
    run = await tuner.control(deviceId, run.id, 'stop'); expect(run.state.phase).toBe('stopped');
    const rows = (await tuner.results(deviceId, run.id)).attempts;
    expect(rows[0].outcome).toBe('passed'); expect(rows[1].outcome).toBe('invalid');
    await expect(tuner.control(deviceId, run.id, 'resume')).rejects.toThrow('tuningNotActive');
  });
  it('restores originals and pauses after server restart without replaying candidate commands', async () => {
    let run = await until(await create(), inSearch); const patch = vi.spyOn(adapter, 'patchTuning');
    tuner = new Tuner(new FleetService(fixture.db, undefined, adapter), () => now); await tuner.restartRecovery();
    run = await tuner.get(deviceId, run.id); expect(run.state.phase).toBe('paused');
    expect(patch).toHaveBeenCalledTimes(1); expect(patch.mock.calls[0][1]).toMatchObject(run.state.original);
    expect((await tuner.results(deviceId, run.id)).attempts.at(-1)?.reason).toBe('serverRestart');
  });
});
describe('candidate failures and recovery', () => {
  it('requires three consecutive errors and resets streak at equality; failures stop a voltage sweep', async () => {
    let run = await until(await create({ measurementSeconds: 30 }), inSearch);
    modify = s => { s.errorRate = 2; }; run = await step(run); run = await step(run);
    expect(run.state.phase).toBe('measuring');
    modify = s => { s.errorRate = 1; }; run = await step(run); expect(run.state.streak).toBe(0);
    modify = s => { s.errorRate = 2; }; run = await step(run); run = await step(run); run = await step(run);
    expect(run.state.phase).toBe('recovering'); expect(run.state.voltageIndex).toBe(1); expect(run.state.frequencyIndex).toBe(0);
    modify = () => {}; run = await until(run, inSearch);
    expect(run.state.profile.coreVoltage).toBe(1150);
  });
  it('fails completed average errors even without a sustained streak and fails low hashrate', async () => {
    let run = await until(await create(), inSearch);
    modify = s => { s.errorRate = now % 10000 === 0 ? 4 : 0; };
    run = await until(run, r => r.state.phase === 'recovering');
    expect((await tuner.results(deviceId, run.id)).attempts.at(-1)?.reason).toBe('hashError');
    modify = () => {}; run = await until(run, inSearch);
    modify = s => { s.hashRate = s.expectedHashrate! * 0.5; };
    run = await until(run, r => r.state.phase === 'recovering');
    expect((await tuner.results(deviceId, run.id)).attempts.at(-1)?.reason).toBe('hashrate');
  });
  it('refuses missing baseline telemetry and prevents sweeping a failed baseline', async () => {
    modify = s => { s.vrTemp = undefined; }; await expect(create()).rejects.toThrow('missingTelemetry');
    modify = () => {}; let run = await create(); modify = s => { s.hashRate = 0; };
    run = await until(run, r => r.state.phase === 'restoring'); run = await step(run);
    expect(run.state.phase).toBe('paused'); expect(run.state.baselinePassed).toBe(false);
    expect((await tuner.results(deviceId, run.id)).attempts.every(a => a.kind === 'baseline')).toBe(true);
  });
  it('invalidates a reboot, restores verified stable settings, stabilizes and continues at next voltage', async () => {
    let run = await until(await create(), inSearch); modify = s => { s.uptime = 0; };
    run = await step(run); expect(run.state.reason).toBe('reboot'); expect(run.state.phase).toBe('recovering');
    modify = () => {}; run = await until(run, inSearch); expect(run.state.voltageIndex).toBe(1);
    expect(run.state.recovery.status).toBe('verified');
  });
  it('pauses external configuration changes for review', async () => {
    let run = await until(await create(), inSearch); modify = s => { s.settings.frequency = 999; };
    run = await step(run); expect(run.state.reason).toBe('externalChange'); expect(run.state.phase).toBe('restoring');
    modify = () => {}; run = await step(run); expect(run.state.phase).toBe('paused');
  });
  it('stops at temperature equality and never increases voltage during safety recovery', async () => {
    let run = await until(await create(), inSearch); const patch = vi.spyOn(adapter, 'patchTuning');
    modify = s => { s.temp = 70; }; run = await step(run); expect(run.state.safetyStop).toBe(true);
    // Original 1150 mV is above the current 1100 mV: report recovery required.
    run = await step(run); expect(patch).not.toHaveBeenCalled();
    now += 121000; run = await step(run); expect(run.state.phase).toBe('recovery_required'); expect(patch).not.toHaveBeenCalled();
    await expect(tuner.control(deviceId, run.id, 'resume')).rejects.toThrow('tuningCannotResume');
  });
  it('keeps a failed recovery prominent and retains ownership of the miner', async () => {
    let run = await until(await create(), inSearch);
    vi.spyOn(adapter, 'read').mockRejectedValue(new Error('offline'));
    run = await step(run); expect(run.state.reason).toBe('connectionLoss');
    now += 115000; run = await step(run); expect(run.state.phase).toBe('recovering');
    run = await step(run); expect(run.state.phase).toBe('recovery_required');
    await expect(fleet.configure(deviceId, { frequency: 500 })).rejects.toThrow('tuningOwnsDevice');
  });
  it('does not replay uncertain candidate writes and uses a separately audited recovery', async () => {
    let run = await create(); run = await until(run, r => r.state.kind === 'search' && r.state.phase === 'applying');
    const patch = vi.spyOn(adapter, 'patchTuning').mockRejectedValueOnce(new Error('timeout'));
    run = await step(run); expect(run.state.phase).toBe('recovering'); expect(patch).toHaveBeenCalledTimes(1);
    run = await step(run); expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][1]).toEqual(run.state.stable);
    expect(await fixture.db.configChange.count({ where: { result: 'unknown' } })).toBe(1);
  });
  it('invalidates missing telemetry, monitoring gaps and share-counter resets', async () => {
    let run = await until(await create(), inSearch); modify = s => { s.actualFrequency = undefined; };
    run = await step(run); expect(run.state.reason).toBe('missingActualFrequency');
    modify = () => {}; run = await until(run, inSearch); now += 20000; run = await step(run); expect(run.state.reason).toBe('monitoringGap');
    await tuner.control(deviceId, run.id, 'stop');
    run = await tuner.create(deviceId, 'second', config); run = await until(run, inSearch);
    modify = s => { s.accepted = 0; }; run = await step(run); expect(run.state.reason).toBe('counterReset');
  });
  it('resumes safely when paused between a failed final sweep and confirmation', async () => {
    let run = await until(await create({ frequency: { minimum: 400, maximum: 400, step: 50 }, voltage: { minimum: 1100, maximum: 1100, step: 50 } }), inSearch);
    modify = s => { s.hashRate = 0; }; run = await until(run, r => r.state.phase === 'recovering'); modify = () => {};
    run = await tuner.control(deviceId, run.id, 'pause'); expect(run.state.phase).toBe('paused');
    run = await tuner.control(deviceId, run.id, 'resume');
    run = await until(run, r => r.state.phase === 'completed'); expect(run.state.winners.hashrate).toBeNull();
  });
  it('blocks dispatch when a fault or external change is detected immediately before writing', async () => {
    let run = await until(await create(), r => r.state.phase === 'applying');
    const patch = vi.spyOn(adapter, 'patchTuning'); modify = s => { s.hardwareFault = true; };
    run = await step(run); expect(run.state.safetyStop).toBe(true); expect(run.state.reason).toBe('hardwareFault');
    expect(patch).not.toHaveBeenCalled();
  });
  it('recognizes a durable pre-dispatch audit and never sends that uncertain candidate again', async () => {
    let run = await until(await create(), r => r.state.phase === 'applying');
    const audit = await fixture.db.configChange.create({ data: { deviceId, before: '{}', requested: JSON.stringify(run.state.profile), result: 'unknown' } });
    await fixture.db.tuningAttempt.update({ where: { id: run.state.attemptId! }, data: { auditId: audit.id } });
    const patch = vi.spyOn(adapter, 'patchTuning'); run = await step(run);
    expect(run.state.reason).toBe('uncertainWrite'); expect(patch).not.toHaveBeenCalled();
  });
  it('bounds a second outage after verified recovery while stabilizing', async () => {
    let run = await until(await create(), inSearch); modify = s => { s.uptime = 0; }; run = await step(run);
    modify = () => {}; run = await step(run); expect(run.state.recovery.status).toBe('verified');
    vi.spyOn(adapter, 'read').mockRejectedValue(new Error('second outage')); run = await step(run);
    expect(run.state.recovery.status).toBe('pending'); now += 121000; run = await step(run);
    expect(run.state.phase).toBe('recovery_required');
  });
  it('keeps tuning command evidence when ordinary audits expire', async () => {
    let run = await until(await create(), inSearch); run = await tuner.control(deviceId, run.id, 'stop');
    const count = await fixture.db.configChange.count({ where: { requested: { not: '{}' } } });
    await retention(fixture.db, Date.now() + 400 * 86400000);
    expect(await fixture.db.configChange.count()).toBe(count);
    expect((await tuner.results(deviceId, run.id)).attempts[0].outcome).toBe('passed');
  });
  it('confirms distinct category winners and falls back after a failed top confirmation', async () => {
    modify = s => { s.power = s.settings.frequency === 450 ? 40 : 10; };
    let run = await until(await create(), r => r.state.kind === 'confirmation' && r.state.phase === 'confirming');
    const top = run.state.profile.frequency; expect(top).toBe(450);
    modify = s => { s.power = s.settings.frequency === 450 ? 40 : 10; if (s.settings.frequency === top) s.hashRate = 0; };
    run = await until(run, r => r.state.kind === 'confirmation' && r.state.profile.frequency === 400 && r.state.phase === 'confirming');
    run = await until(run, r => r.state.phase === 'completed');
    const winners = (await tuner.results(deviceId, run.id)).winners;
    expect(winners).toHaveLength(1); expect(winners[0].profile.frequency).toBe(400);
    expect((await tuner.results(deviceId, run.id)).attempts.filter(a => a.kind === 'confirmation' && a.outcome === 'failed').length).toBeGreaterThan(0);
  });
  it('tries the next ranked candidate when confirmation fails, and reports no winner if all fail', async () => {
    let run = await until(await create(), r => r.state.kind === 'confirmation' && r.state.phase === 'confirming');
    modify = s => { s.hashRate = 0; };
    run = await until(run, r => r.state.phase === 'completed', 500);
    const results = await tuner.results(deviceId, run.id);
    expect(results.attempts.filter(a => a.kind === 'confirmation')).toHaveLength(4);
    expect(run.state.winners).toEqual({ hashrate: null, efficiency: null });
  });
});
describe('tuning API and physical capability boundary', () => {
  it('validates requests and scopes progress/results/actions to the device', async () => {
    const app = await createApp(fixture.db, { service: fleet, tuner });
    const headers = { host: 'localhost:3080', 'x-bithive': '1' };
    const base = `/api/devices/${deviceId}/tuning`;
    expect((await app.inject({ method: 'POST', url: base, headers, payload: { requestKey: 'key', config: {} } })).statusCode).toBe(400);
    const run = await create();
    expect((await app.inject({ url: `${base}/${run.id}/results?limit=201`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/devices/missing/tuning/${run.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${base}/${run.id}/apply`, headers, payload: { category: 'hashrate' } })).statusCode).toBe(409);
    expect((await app.inject({ url: `${base}/${run.id}/results?limit=1`, headers })).json()).toMatchObject({ total: 0, limit: 1 });
    await app.close();
  });
  it('requires acknowledgement even when a physical adapter supports tuning', async () => {
    const physical = await new FleetService(fixture.db, adapter).register('192.168.1.42');
    const physicalTuner = new Tuner(new FleetService(fixture.db, adapter), () => now);
    await expect(physicalTuner.create(physical.id, 'physical', config)).rejects.toThrow('physicalTuningAcknowledgementRequired');
  });
});
