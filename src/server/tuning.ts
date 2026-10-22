import { Prisma } from '@prisma/client';
import type { Snapshot } from '../shared/domain.js';
import { grid, nextPosition, measurementFailure, tuningFrequency, tuningTelemetryFailure, profileSchema, rank, summarize, tuningConfigSchema,
  type TuningConfig, type TuningState, type TuningRunView, type TuningSample, type TuningProfile, type WinnerCategory } from '../shared/tuning.js';
import { AppError } from './errors.js';
import { validateTuningCapabilities } from './adapter.js';
import { DeviceLocks } from './concurrency.js';
import type { FleetService } from './service.js';
import { attemptView, runView } from './tuning-repository.js';

const terminal = new Set(['completed', 'stopped', 'failed']);
export class Tuner {
  private lock = new DeviceLocks();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running?: Promise<void>;
  constructor(private fleet: FleetService, private now = Date.now, private report: (error: unknown) => void = () => {}) {}
  private get db() { return this.fleet.db; }
  private async load(deviceId: string, id: string) {
    const run = await this.db.tuningRun.findFirst({ where: { id, deviceId } });
    if (!run) throw new AppError('notFound', 404);
    return runView(run);
  }
  async list(deviceId: string) {
    if (!await this.db.device.findUnique({ where: { id: deviceId } })) throw new AppError('notFound', 404);
    return (await this.db.tuningRun.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: 50 })).map(runView);
  }
  get(deviceId: string, id: string) { return this.load(deviceId, id); }
  async results(deviceId: string, id: string, offset = 0, limit = 100) {
    const run = await this.load(deviceId, id);
    const winnerIds = Object.values(run.state.winners).filter((id): id is string => id !== null);
    const winners = (await this.db.tuningAttempt.findMany({ where: { runId: id, id: { in: winnerIds } } })).map(attemptView);
    const where = { runId: id };
    return { winners, attempts: (await this.db.tuningAttempt.findMany({ where, orderBy: [{ startedAt: 'asc' }, { id: 'asc' }], skip: offset, take: limit })).map(attemptView),
      total: await this.db.tuningAttempt.count({ where }), offset, limit };
  }
  create(deviceId: string, requestKey: string, input: unknown) {
    const config = tuningConfigSchema.parse(input);
    return this.lock.run('scheduler', async () => {
      const previous = await this.db.tuningRun.findUnique({ where: { deviceId_requestKey: { deviceId, requestKey } } });
      if (previous) {
        if (JSON.stringify(tuningConfigSchema.parse(JSON.parse(previous.config))) !== JSON.stringify(config)) throw new AppError('idempotencyConflict', 409);
        return runView(previous);
      }
      return this.fleet.withTuningDevice(deviceId, async (device, adapter, reading) => {
        if (!adapter.patchTuning) throw new AppError('tuningNotValidated');
        if (!device.demo && config.physicalTuningAcknowledged !== true) throw new AppError('physicalTuningAcknowledgementRequired');
        if (!device.demo && !reading.snapshot.firmware) throw new AppError('missingTelemetry');
        const original = profileSchema.parse(Object.fromEntries(Object.keys(profileSchema.shape).map(k => [k, reading.snapshot.settings[k as keyof TuningProfile]])));
        if (!device.demo) validateTuningCapabilities(original, reading.snapshot);
        const reason = this.telemetryFailure(reading.snapshot, config);
        if (reason) throw new AppError(reason);
        if (this.safetyFailure(reading.snapshot, config)) throw new AppError('hardwareFault');
        const state: TuningState = { phase: 'baseline', kind: 'baseline', frequencyIndex: 0, voltageIndex: 0, lastPassIndex: null,
          original, stable: null, observedProfile: original, profile: original, attemptId: null, deadline: null, nextTick: this.now(), measurementStart: null,
          streak: 0, lastObserved: null, uptime: null, firmware: reading.snapshot.firmware ?? null, resetReason: reading.snapshot.resetReason ?? null,
          recovery: { status: 'none', reason: null, deadline: null }, afterRecovery: 'pause', recoveryWritten: false,
          safetyStop: false, baselinePassed: false, winners: { hashrate: null, efficiency: null }, confirmationCategory: 'hashrate', reason: null, live: null };
        try { return runView(await this.db.tuningRun.create({ data: { deviceId, requestKey, activeSlot: 1, config: JSON.stringify(config), state: JSON.stringify(state) } })); }
        catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('tuningAlreadyActive', 409);
          throw error;
        }
      });
    });
  }
  private async save(run: TuningRunView) {
    const release = terminal.has(run.state.phase);
    await this.db.tuningRun.update({ where: { id: run.id }, data: { state: JSON.stringify(run.state), ...(release ? { activeSlot: null } : {}) } });
  }
  private telemetryFailure(s: Snapshot, c: TuningConfig) {
    return tuningTelemetryFailure(s, c);
  }
  private safetyFailure(s: Snapshot, c: TuningConfig) {
    if ((s.temp ?? 0) >= c.maxAsicTemperature || (s.vrTemp ?? 0) >= c.maxVrmTemperature) return 'temperature';
    if (s.hardwareFault || s.firmwareProtection) return 'hardwareFault';
    return null;
  }
  private sample(s: Snapshot, c: TuningConfig, at: number): TuningSample {
    return { at, frequency: tuningFrequency(s, c), frequencySource: c.configuredFrequencyAcknowledged === true ? 'configured' : 'actual', ths: s.hashRate! / 1000, watts: s.power!, error: s.errorRate!, asic: s.temp!, vrm: s.vrTemp!,
      expected: c.expected.source === 'firmware' ? s.expectedHashrate! / 1000 : c.expected.ths * tuningFrequency(s, c)! / c.expected.frequency,
      accepted: s.accepted, rejected: s.rejected };
  }
  private candidate(run: TuningRunView): TuningProfile {
    return { frequency: grid(run.config.frequency)[run.state.frequencyIndex], coreVoltage: grid(run.config.voltage)[run.state.voltageIndex],
      autofanspeed: run.config.fan.mode === 'automatic' ? 1 : 0,
      manualFanSpeed: run.config.fan.mode === 'fixed' ? run.config.fan.percentage : run.state.original.manualFanSpeed };
  }
  private async begin(run: TuningRunView, candidateId?: string) {
    const s = run.state;
    await this.db.$transaction(async tx => {
      const attempt = await tx.tuningAttempt.create({ data: { runId: run.id, kind: s.kind, profile: JSON.stringify(s.profile),
        candidateId, startedAt: new Date(this.now()) } });
      s.attemptId = attempt.id; s.measurementStart = null; s.streak = 0; s.lastObserved = null;
      s.phase = s.kind === 'baseline' ? 'baseline' : 'applying'; s.deadline = null; s.nextTick = this.now();
      await tx.tuningRun.update({ where: { id: run.id }, data: { state: JSON.stringify(s) } });
    });
  }

  private async finishAttempt(run: TuningRunView, outcome: 'passed' | 'failed' | 'invalid', reason: string | null) {
    const s = run.state;
    if (!s.attemptId) return;
    const rows = await this.db.tuningSample.findMany({ where: { attemptId: s.attemptId, phase: 'measuring' }, orderBy: { timestamp: 'asc' } });
    const points: TuningSample[] = rows.map(row => JSON.parse(row.data));
    const end = Math.min(points.at(-1)?.at ?? s.measurementStart ?? 0, s.deadline ?? Infinity);
    const summary = s.measurementStart !== null ? summarize(points, s.measurementStart, end, run.config.expected.source) : null;
    await this.db.tuningAttempt.updateMany({ where: { id: s.attemptId, outcome: 'pending' }, data: { outcome, reason, summary: summary ? JSON.stringify(summary) : null, completedAt: new Date(this.now()) } });
  }
  private async recover(run: TuningRunView, reason: string, after: TuningState['afterRecovery']) {
    const s = run.state;
    s.reason = reason; s.phase = after === 'sweep' ? 'recovering' : 'restoring'; s.afterRecovery = after;
    s.recovery = { status: 'pending', reason, deadline: this.now() + 120000 }; s.recoveryWritten = false; s.deadline = null; s.nextTick = this.now();
    await this.save(run);
  }
  private async advance(run: TuningRunView, passed: boolean) {
    const s = run.state;
    const position = nextPosition(run.config, s.frequencyIndex, s.voltageIndex, s.lastPassIndex, passed);
    if (!position) { await this.chooseConfirmation(run); return; }
    const voltageChanged = position.voltageIndex !== s.voltageIndex;
    Object.assign(s, position);
    s.kind = 'search'; s.profile = this.candidate(run);
    if (voltageChanged && !passed) await this.recover(run, s.reason ?? 'candidateFailed', 'sweep');
    else await this.begin(run);
  }
  private async attempts(run: TuningRunView) {
    return (await this.db.tuningAttempt.findMany({ where: { runId: run.id }, orderBy: { startedAt: 'asc' } })).map(attemptView);
  }
  private async chooseConfirmation(run: TuningRunView) {
    const s = run.state;
    const attempts = await this.attempts(run);
    const ordered: WinnerCategory[] = ['hashrate', 'efficiency'];
    for (const category of ordered) {
      if (s.winners[category]) continue;
      for (const candidate of rank(attempts, category)) {
        const tried = attempts.filter(a => a.kind === 'confirmation' && a.candidateId === candidate.id);
        const confirmed = tried.find(a => a.outcome === 'passed');
        if (confirmed) { s.winners[category] = confirmed.id; break; }
        if (tried.some(a => a.outcome === 'failed' || a.outcome === 'invalid' && !['userPause', 'serverRestart'].includes(a.reason ?? ''))) continue;
        s.kind = 'confirmation'; s.confirmationCategory = category; s.profile = candidate.profile;
        await this.begin(run, candidate.id); return;
      }
    }
    await this.recover(run, 'searchComplete', 'complete');
  }
  private async fail(run: TuningRunView, reason: string, invalid = true) {
    const s = run.state;
    await this.finishAttempt(run, invalid ? 'invalid' : 'failed', reason);
    s.reason = reason;
    if (['temperature', 'hardwareFault'].includes(reason)) {
      s.safetyStop = true; await this.recover(run, reason, 'fail');
    } else if (reason === 'externalChange' || reason === 'firmwareChanged' || !s.baselinePassed) await this.recover(run, reason, 'pause');
    else if (s.kind === 'confirmation') {
      // A fresh verified recovery and stabilization precedes any confirmation retry.
      await this.recover(run, reason, 'sweep');
    } else {
      // Recovery is required even when the final sweep fails.
      const position = nextPosition(run.config, s.frequencyIndex, s.voltageIndex, s.lastPassIndex, false);
      if (position) Object.assign(s, position); else s.voltageIndex = grid(run.config.voltage).length;
      await this.recover(run, reason, 'sweep');
    }
  }
  async tick() {
    return this.lock.run('scheduler', async () => {
      const stored = await this.db.tuningRun.findUnique({ where: { activeSlot: 1 } });
      if (!stored) return;
      const run = runView(stored), s = run.state;
      if (s.phase === 'paused' || s.phase === 'recovery_required' || s.nextTick > this.now()) return;
      if (s.phase === 'recovering' || s.phase === 'restoring') { await this.recoveryTick(run); return; }
      if (!s.attemptId || s.phase === 'baseline' && s.deadline === null) {
        if (!s.attemptId) await this.begin(run);
        s.deadline = this.now() + run.config.stabilizationSeconds * 1000;
      }
      if (s.phase === 'applying') {
        // Persisted phase precedes dispatch. Startup recovery never replays it.
        await this.save(run);
        try {
          const attempt = await this.db.tuningAttempt.findUniqueOrThrow({ where: { id: s.attemptId! } });
          if (attempt.auditId !== null) { await this.fail(run, 'uncertainWrite'); return; }
          const write = await this.fleet.tuningWrite(run.deviceId, run.id, s.profile, s.kind, false, s.observedProfile, s.attemptId!);
          await this.db.tuningAttempt.update({ where: { id: s.attemptId! }, data: { auditId: write.auditId } });
          if (write.result !== 'verified') { await this.fail(run, 'uncertainWrite'); return; }
          s.observedProfile = s.profile; s.phase = 'stabilizing'; s.deadline = this.now() + run.config.stabilizationSeconds * 1000;
        } catch (error) { await this.fail(run, error instanceof AppError && ['externalChange', 'temperature', 'hardwareFault', 'missingTelemetry', 'missingActualFrequency', 'missingConfiguredFrequency', 'firmwareChanged', 'reboot'].includes(error.code) ? error.code : 'connectionLoss'); return; }
      }
      let snapshot: Snapshot;
      try { snapshot = await this.fleet.withTuningDevice(run.deviceId, async (_device, _adapter, reading) => reading.snapshot); }
      catch { await this.fail(run, 'connectionLoss'); return; }
      const safety = this.safetyFailure(snapshot, run.config);
      if (safety) { await this.fail(run, safety, false); return; }
      const missing = this.telemetryFailure(snapshot, run.config);
      if (missing) { await this.fail(run, missing); return; }
      if (s.firmware !== (snapshot.firmware ?? null)) { await this.fail(run, 'firmwareChanged'); return; }
      if (s.uptime !== null && snapshot.uptime! < s.uptime || s.resetReason !== (snapshot.resetReason ?? null)) { await this.fail(run, 'reboot'); return; }
      if (!Object.entries(s.profile).every(([key, value]) => snapshot.settings[key as keyof TuningProfile] === value)) { await this.fail(run, 'externalChange'); return; }
      if (s.lastObserved !== null && this.now() - s.lastObserved > 10000) { await this.fail(run, 'monitoringGap'); return; }
      s.uptime = snapshot.uptime!; s.lastObserved = this.now();
      if ((s.phase === 'measuring' || s.phase === 'confirming') && Math.abs(tuningFrequency(snapshot, run.config)! - s.profile.frequency) > 1) { await this.fail(run, 'frequencyMismatch'); return; }
      const point = this.sample(snapshot, run.config, this.now()); s.live = point;
      const stabilization = s.phase === 'baseline' || s.phase === 'stabilizing';
      if (stabilization && point.at >= s.deadline!) {
        s.phase = s.kind === 'confirmation' ? 'confirming' : 'measuring';
        s.measurementStart = point.at; s.deadline = point.at + run.config.measurementSeconds * (s.kind === 'confirmation' ? 3 : 1) * 1000;
      }
      const measuring = s.phase === 'measuring' || s.phase === 'confirming';
      if (measuring) {
        const previous = await this.db.tuningSample.findFirst({ where: { attemptId: s.attemptId!, phase: 'measuring' }, orderBy: { timestamp: 'desc' } });
        const last: TuningSample | null = previous ? JSON.parse(previous.data) : null;
        if (last && (point.accepted !== undefined && last.accepted !== undefined && point.accepted < last.accepted || point.rejected !== undefined && last.rejected !== undefined && point.rejected < last.rejected)) { await this.fail(run, 'counterReset'); return; }
      }
      await this.db.tuningSample.create({ data: { attemptId: s.attemptId!, timestamp: new Date(point.at), phase: measuring ? 'measuring' : 'stabilizing', data: JSON.stringify(point) } });
      if (measuring) {
        s.streak = point.error > run.config.maxErrorPercentage ? s.streak + 1 : 0;
        if (s.streak >= 3 && point.at <= s.deadline!) { await this.fail(run, 'hashError', false); return; }
        if (point.at >= s.deadline!) {
          const rows = await this.db.tuningSample.findMany({ where: { attemptId: s.attemptId!, phase: 'measuring' } });
          const summary = summarize(rows.map(row => JSON.parse(row.data)), s.measurementStart!, s.deadline!, run.config.expected.source);
          const reason = measurementFailure(summary, run.config);
          if (reason) { await this.fail(run, reason, reason === 'incomplete'); return; }
          await this.finishAttempt(run, 'passed', null);
          s.stable = s.profile;
          await this.db.tuningCheckpoint.create({ data: { runId: run.id, profile: JSON.stringify(s.stable), purpose: 'stable', status: 'verified' } });
          if (s.kind === 'baseline') { s.baselinePassed = true; s.kind = 'search'; s.profile = this.candidate(run); await this.begin(run); }
          else if (s.kind === 'confirmation') { s.winners[s.confirmationCategory] = s.attemptId; await this.chooseConfirmation(run); }
          else await this.advance(run, true);
          return;
        }
      }
      s.nextTick = this.now() + 5000; await this.save(run);
    });
  }
  private async recoveryTick(run: TuningRunView) {
    const s = run.state;
    if (s.recovery.status !== 'verified' && this.now() > s.recovery.deadline!) { s.phase = 'recovery_required'; s.recovery.status = 'required'; s.reason = 'recoveryFailed'; await this.save(run); return; }
    try {
      let snapshot = await this.fleet.withTuningDevice(run.deviceId, async (_d, _a, r) => r.snapshot);
      const safety = this.safetyFailure(snapshot, run.config);
      if (safety && (!s.safetyStop || s.afterRecovery !== 'fail')) { s.safetyStop = true; await this.recover(run, safety, 'fail'); return; }
      const target = s.afterRecovery === 'sweep' ? s.stable ?? s.original : s.original;
      s.live = this.telemetryFailure(snapshot, run.config) ? null : this.sample(snapshot, run.config, this.now());
      if (!s.recoveryWritten) {
        s.recoveryWritten = true; await this.save(run);
        const write = await this.fleet.tuningWrite(run.deviceId, run.id, target, 'recovery', s.safetyStop);
        if (write.result !== 'verified' || !write.snapshot) { s.nextTick = this.now() + 5000; await this.save(run); return; }
        snapshot = write.snapshot;
      }
      const matches = Object.entries(target).every(([key, value]) => snapshot.settings[key as keyof TuningProfile] === value);
      if (!matches && s.recovery.status === 'verified') { await this.recover(run, 'externalChange', 'pause'); return; }
      if (!matches) { s.nextTick = this.now() + 5000; await this.save(run); return; }
      s.observedProfile = target;
      const wasVerified = s.recovery.status === 'verified';
      s.recovery.status = 'verified';
      if (!wasVerified) await this.db.tuningCheckpoint.create({ data: { runId: run.id, profile: JSON.stringify(target), purpose: 'recoveryReadback', status: 'verified' } });
      if (s.afterRecovery !== 'sweep') {
        s.phase = s.afterRecovery === 'pause' ? 'paused' : s.afterRecovery === 'stop' ? 'stopped' : s.afterRecovery === 'complete' ? 'completed' : 'failed';
        s.deadline = null; await this.save(run); return;
      }
      if (this.telemetryFailure(snapshot, run.config)) {
        s.recovery.status = 'pending';
        if (wasVerified) s.recovery.deadline = this.now() + 120000;
        s.deadline = null; s.nextTick = this.now() + 5000; await this.save(run); return;
      }
      if (s.lastObserved !== null && this.now() - s.lastObserved > 10000) s.deadline = null;
      s.lastObserved = this.now();
      if (s.deadline === null) s.deadline = this.now() + run.config.stabilizationSeconds * 1000;
      if (this.now() >= s.deadline) {
        s.uptime = snapshot.uptime!; s.resetReason = snapshot.resetReason ?? null; s.lastObserved = null;
        if (s.kind === 'confirmation' || s.voltageIndex >= grid(run.config.voltage).length) await this.chooseConfirmation(run);
        else { s.profile = this.candidate(run); await this.begin(run); }
        return;
      }
    } catch {
      // A second outage during recovery stabilization gets its own reconnect
      // deadline; a previously verified profile is not proof of current reachability.
      if (s.recovery.status === 'verified') { s.recovery.status = 'pending'; s.recovery.deadline = this.now() + 120000; s.deadline = null; s.lastObserved = null; }
    }
    s.nextTick = this.now() + 5000; await this.save(run);
  }
  control(deviceId: string, id: string, action: 'pause' | 'resume' | 'stop') {
    return this.lock.run('scheduler', async () => {
      const run = await this.load(deviceId, id), s = run.state;
      if (terminal.has(s.phase)) throw new AppError('tuningNotActive', 409);
      if (action === 'resume') {
        if (s.phase !== 'paused' || s.safetyStop || s.recovery.status !== 'verified') throw new AppError('tuningCannotResume', 409);
        s.reason = null; s.uptime = null; s.lastObserved = null;
        if (!s.baselinePassed) { s.kind = 'baseline'; s.profile = s.original; }
        else if (s.kind === 'search' && s.voltageIndex >= grid(run.config.voltage).length) { await this.chooseConfirmation(run); return this.load(deviceId, id); }
        else if (s.kind === 'search') s.profile = this.candidate(run);
        const interrupted = s.attemptId ? await this.db.tuningAttempt.findUnique({ where: { id: s.attemptId } }) : null;
        await this.begin(run, interrupted?.candidateId ?? undefined);
      } else {
        if (s.attemptId) await this.finishAttempt(run, 'invalid', action === 'pause' ? 'userPause' : 'userStop');
        await this.recover(run, action === 'pause' ? 'userPause' : 'userStop', action);
        await this.recoveryTick(run);
      }
      return this.load(deviceId, id);
    });
  }
  applyWinner(deviceId: string, id: string, category: WinnerCategory) {
    return this.lock.run('scheduler', async () => {
      const run = await this.load(deviceId, id);
      if (!terminal.has(run.state.phase) || run.state.safetyStop) throw new AppError('tuningNotActive', 409);
      const attemptId = run.state.winners[category];
      const winner = attemptId ? await this.db.tuningAttempt.findFirst({ where: { id: attemptId, runId: id, kind: 'confirmation', outcome: 'passed' } }) : null;
      if (!winner) throw new AppError('noConfirmedWinner', 409);
      try { await this.db.tuningRun.update({ where: { id }, data: { activeSlot: 1 } }); }
      catch { throw new AppError('tuningAlreadyActive', 409); }
      const previous = run.state.phase;
      run.state.profile = JSON.parse(winner.profile);
      run.state.phase = 'applying'; run.state.reason = 'applyWinner'; await this.save(run);
      try {
        const snapshot = await this.fleet.withTuningDevice(deviceId, async (_d, _a, r) => r.snapshot);
        if (this.safetyFailure(snapshot, run.config) || this.telemetryFailure(snapshot, run.config) || snapshot.firmware !== run.state.firmware) throw new AppError('hardwareFault');
        const result = await this.fleet.tuningWrite(deviceId, id, JSON.parse(winner.profile), 'applyWinner');
        if (result.result !== 'verified') { await this.recover(run, 'uncertainWrite', 'pause'); return this.load(deviceId, id); }
        run.state.phase = previous; await this.save(run);
        return result;
      } catch {
        await this.recover(run, 'winnerApplyFailed', 'pause'); return this.load(deviceId, id);
      }
    });
  }
  async restartRecovery() {
    return this.lock.run('scheduler', async () => {
      const stored = await this.db.tuningRun.findUnique({ where: { activeSlot: 1 } });
      if (!stored) return;
      const run = runView(stored);
      if (run.state.phase === 'paused' && run.state.recovery.status === 'verified') return;
      if (run.state.attemptId) await this.finishAttempt(run, 'invalid', 'serverRestart');
      await this.recover(run, 'serverRestart', 'pause'); await this.recoveryTick(run);
    });
  }
  async start() {
    if (!this.stopped) return;
    await this.restartRecovery(); this.stopped = false;
    const loop = () => { this.running = this.tick().catch(this.report).finally(() => { if (!this.stopped) this.timer = setTimeout(loop, 1000); }); };
    loop();
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.running; }
}
