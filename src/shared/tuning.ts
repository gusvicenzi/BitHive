import { z } from 'zod';

const integer = z.number().int().positive().max(100000);
export const rangeSchema = z.object({ minimum: integer, maximum: integer, step: integer }).strict()
  .refine(r => r.maximum >= r.minimum).refine(r => Math.floor((r.maximum - r.minimum) / r.step) < 1000);
export const profileSchema = z.object({ frequency: integer, coreVoltage: integer,
  autofanspeed: z.union([z.literal(0), z.literal(1)]), manualFanSpeed: z.number().int().min(0).max(100) }).strict();
export const tuningConfigSchema = z.object({
  frequency: rangeSchema, voltage: rangeSchema,
  maxAsicTemperature: z.number().finite().positive(), maxVrmTemperature: z.number().finite().positive(),
  maxErrorPercentage: z.number().finite().min(0).max(100),
  tolerance: z.number().finite().min(0).max(100).default(5),
  fan: z.discriminatedUnion('mode', [z.object({ mode: z.literal('automatic') }).strict(),
    z.object({ mode: z.literal('fixed'), percentage: z.number().int().min(0).max(100) }).strict()]),
  stabilizationSeconds: z.number().int().min(5).max(86400).multipleOf(5).default(120),
  measurementSeconds: z.number().int().min(5).max(86400).multipleOf(5).default(300),
  mode: z.enum(['fast', 'complete']).default('complete'),
  expected: z.discriminatedUnion('source', [z.object({ source: z.literal('firmware') }).strict(),
    z.object({ source: z.literal('reference'), ths: z.number().finite().positive(), frequency: integer }).strict()]),
}).strict().refine(c => (Math.floor((c.frequency.maximum - c.frequency.minimum) / c.frequency.step) + 1) * (Math.floor((c.voltage.maximum - c.voltage.minimum) / c.voltage.step) + 1) <= 10000);
export type TuningConfig = z.infer<typeof tuningConfigSchema>;
export type TuningProfile = z.infer<typeof profileSchema>;
export type TuningPhase = 'baseline' | 'applying' | 'stabilizing' | 'measuring' | 'recovering' | 'confirming' | 'restoring' | 'paused' | 'completed' | 'stopped' | 'failed' | 'recovery_required';
export type AttemptKind = 'baseline' | 'search' | 'confirmation';
export type WinnerCategory = 'hashrate' | 'efficiency';
export interface TuningSample {
  at: number; ths: number; watts: number; error: number; asic: number; vrm: number;
  expected: number; accepted?: number; rejected?: number;
}
export interface TuningSummary {
  duration: number; ths: number; watts: number; efficiency: number | null; attainment: number;
  error: number; peakError: number; asic: number; peakAsic: number; vrm: number; peakVrm: number;
  rejects: number | null; expectedSource: TuningConfig['expected']['source'];
}
export interface TuningAttempt {
  id: string; kind: AttemptKind; profile: TuningProfile; outcome: 'pending' | 'passed' | 'failed' | 'invalid';
  reason: string | null; summary: TuningSummary | null; startedAt: string; completedAt: string | null;
  candidateId: string | null;
}
export interface RecoveryStatus { status: 'none' | 'pending' | 'verified' | 'required'; reason: string | null; deadline: number | null }
export interface TuningState {
  phase: TuningPhase; kind: AttemptKind; frequencyIndex: number; voltageIndex: number;
  lastPassIndex: number | null; original: TuningProfile; stable: TuningProfile | null;
  observedProfile: TuningProfile; profile: TuningProfile; attemptId: string | null; deadline: number | null; nextTick: number;
  measurementStart: number | null; streak: number; lastObserved: number | null;
  uptime: number | null; firmware: string | null; resetReason: string | null;
  recovery: RecoveryStatus; afterRecovery: 'sweep' | 'pause' | 'stop' | 'complete' | 'fail';
  recoveryWritten: boolean; safetyStop: boolean; baselinePassed: boolean;
  winners: Record<WinnerCategory, string | null>; confirmationCategory: WinnerCategory;
  reason: string | null; live: TuningSample | null;
}
export interface TuningRunView { id: string; deviceId: string; config: TuningConfig; state: TuningState; createdAt: string; updatedAt: string }
export function grid(range: z.infer<typeof rangeSchema>): number[] {
  return Array.from({ length: Math.floor((range.maximum - range.minimum) / range.step) + 1 }, (_, n) => range.minimum + n * range.step);
}
export function preview(config: TuningConfig) {
  const frequencies = grid(config.frequency), voltages = grid(config.voltage);
  const count = frequencies.length * voltages.length;
  // Includes baseline, worst-case confirmation fallback for both categories,
  // verified writes, recovery/reconnection, and post-recovery stabilization.
  // Manual pauses and server downtime have no finite upper bound.
  const seconds = config.stabilizationSeconds + config.measurementSeconds + 10
    + count * (config.stabilizationSeconds + config.measurementSeconds + 10)
    + 2 * count * (config.stabilizationSeconds + 3 * config.measurementSeconds + 10)
    + (count + 2 * count + 2) * (120 + config.stabilizationSeconds + 10);
  return { frequencies, voltages, count, seconds };
}
export function nextPosition(config: TuningConfig, frequencyIndex: number, voltageIndex: number, lastPassIndex: number | null, passed: boolean) {
  const last = passed ? frequencyIndex : lastPassIndex;
  if (passed && frequencyIndex + 1 < grid(config.frequency).length) return { frequencyIndex: frequencyIndex + 1, voltageIndex, lastPassIndex: last };
  if (voltageIndex + 1 >= grid(config.voltage).length) return null;
  return { frequencyIndex: config.mode === 'fast' ? last ?? 0 : 0, voltageIndex: voltageIndex + 1, lastPassIndex: null };
}
export function summarize(samples: TuningSample[], start: number, end: number, source: TuningConfig['expected']['source']): TuningSummary | null {
  const observed = samples.filter(s => s.at >= start).sort((a, b) => a.at - b.at);
  if (end <= start || observed.length < 2 || observed[0].at !== start || observed.at(-1)!.at < end) return null;
  const points = observed.filter(s => s.at <= end);
  // Keep real sample timestamps. Interpolate a late poll at the measurement
  // boundary rather than extending the window or pretending it arrived earlier.
  if (points.at(-1)!.at < end) {
    const left = points.at(-1)!, right = observed.find(s => s.at > end)!;
    const fraction = (end - left.at) / (right.at - left.at);
    const boundary = { ...left, at: end };
    for (const key of ['ths', 'watts', 'error', 'asic', 'vrm', 'expected', 'accepted', 'rejected'] as const) {
      const a = left[key], b = right[key];
      Object.assign(boundary, { [key]: a === undefined || b === undefined ? undefined : a + (b - a) * fraction });
    }
    points.push(boundary);
  }
  const duration = (end - start) / 1000;
  const average = (field: 'ths' | 'watts' | 'error' | 'asic' | 'vrm' | 'expected') => {
    let integral = 0;
    for (let i = 1; i < points.length; i++) integral += (points[i - 1][field] + points[i][field]) / 2 * (points[i].at - points[i - 1].at);
    return integral / (end - start);
  };
  const peak = (field: 'error' | 'asic' | 'vrm') => Math.max(...points.map(p => p[field]));
  const first = points[0], last = points.at(-1)!;
  let rejects: number | null = null;
  const countersValid = points.every((p, i) => p.accepted !== undefined && p.rejected !== undefined
    && (i === 0 || (p.accepted >= points[i - 1].accepted! && p.rejected >= points[i - 1].rejected!)));
  if (countersValid) {
    const accepted = last.accepted! - first.accepted!, rejected = last.rejected! - first.rejected!;
    if (accepted + rejected > 0) rejects = 100 * rejected / (accepted + rejected);
  }
  const ths = average('ths'), watts = average('watts');
  return { duration, ths, watts, efficiency: ths > 0 ? watts / ths : null,
    attainment: 100 * ths / average('expected'), error: average('error'), peakError: peak('error'),
    asic: average('asic'), peakAsic: peak('asic'), vrm: average('vrm'), peakVrm: peak('vrm'), rejects, expectedSource: source };
}
export function rank(attempts: TuningAttempt[], category: WinnerCategory) {
  return attempts.filter(a => a.kind === 'search' && a.outcome === 'passed' && a.summary && (category !== 'efficiency' || a.summary.efficiency !== null))
    .sort((a, b) => (category === 'hashrate' ? b.summary!.ths - a.summary!.ths || (a.summary!.efficiency ?? Infinity) - (b.summary!.efficiency ?? Infinity)
      : (a.summary!.efficiency ?? Infinity) - (b.summary!.efficiency ?? Infinity) || b.summary!.ths - a.summary!.ths)
      || a.profile.coreVoltage - b.profile.coreVoltage || a.profile.frequency - b.profile.frequency);
}
export function measurementFailure(summary: TuningSummary | null, config: TuningConfig) {
  if (!summary) return 'incomplete';
  if (summary.error > config.maxErrorPercentage) return 'hashError';
  if (summary.attainment + 1e-9 < 100 - config.tolerance) return 'hashrate';
  return null;
}

const finite = z.number().finite();
export const recoveryStatusSchema: z.ZodType<RecoveryStatus> = z.object({ status: z.enum(['none', 'pending', 'verified', 'required']), reason: z.string().nullable(), deadline: finite.nullable() }).strict();
export const tuningSampleSchema: z.ZodType<TuningSample> = z.object({ at: finite, ths: finite.nonnegative(), watts: finite.nonnegative(), error: finite.nonnegative(), asic: finite, vrm: finite, expected: finite.positive(), accepted: finite.nonnegative().optional(), rejected: finite.nonnegative().optional() }).strict();
export const tuningSummarySchema: z.ZodType<TuningSummary> = z.object({ duration: finite.positive(), ths: finite.nonnegative(), watts: finite.nonnegative(), efficiency: finite.nonnegative().nullable(), attainment: finite.nonnegative(), error: finite.nonnegative(), peakError: finite.nonnegative(), asic: finite, peakAsic: finite, vrm: finite, peakVrm: finite, rejects: finite.min(0).max(100).nullable(), expectedSource: z.enum(['firmware', 'reference']) }).strict();
export const tuningAttemptSchema: z.ZodType<TuningAttempt> = z.object({ id: z.string(), kind: z.enum(['baseline', 'search', 'confirmation']), profile: profileSchema, outcome: z.enum(['pending', 'passed', 'failed', 'invalid']), reason: z.string().nullable(), summary: tuningSummarySchema.nullable(), startedAt: z.string(), completedAt: z.string().nullable(), candidateId: z.string().nullable() }).strict();
export const tuningStateSchema: z.ZodType<TuningState> = z.object({
  phase: z.enum(['baseline', 'applying', 'stabilizing', 'measuring', 'recovering', 'confirming', 'restoring', 'paused', 'completed', 'stopped', 'failed', 'recovery_required']),
  kind: z.enum(['baseline', 'search', 'confirmation']), frequencyIndex: z.number().int().nonnegative(), voltageIndex: z.number().int().nonnegative(), lastPassIndex: z.number().int().nonnegative().nullable(),
  original: profileSchema, stable: profileSchema.nullable(), observedProfile: profileSchema, profile: profileSchema, attemptId: z.string().nullable(), deadline: finite.nullable(), nextTick: finite,
  measurementStart: finite.nullable(), streak: z.number().int().nonnegative(), lastObserved: finite.nullable(), uptime: finite.nullable(), firmware: z.string().nullable(), resetReason: z.string().nullable(),
  recovery: recoveryStatusSchema, afterRecovery: z.enum(['sweep', 'pause', 'stop', 'complete', 'fail']), recoveryWritten: z.boolean(), safetyStop: z.boolean(), baselinePassed: z.boolean(),
  winners: z.object({ hashrate: z.string().nullable(), efficiency: z.string().nullable() }).strict(), confirmationCategory: z.enum(['hashrate', 'efficiency']), reason: z.string().nullable(), live: tuningSampleSchema.nullable(),
}).strict();
