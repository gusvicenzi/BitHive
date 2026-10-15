import type { TuningAttempt as StoredAttempt, TuningRun as StoredRun } from '@prisma/client';
import { tuningConfigSchema, tuningStateSchema, tuningAttemptSchema, type TuningAttempt, type TuningRunView } from '../shared/tuning.js';

export function runView(run: StoredRun): TuningRunView {
  return { id: run.id, deviceId: run.deviceId, config: tuningConfigSchema.parse(JSON.parse(run.config)), state: tuningStateSchema.parse(JSON.parse(run.state)),
    createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString() };
}
export function attemptView(attempt: StoredAttempt): TuningAttempt {
  return tuningAttemptSchema.parse({ id: attempt.id, kind: attempt.kind as TuningAttempt['kind'], profile: JSON.parse(attempt.profile),
    outcome: attempt.outcome as TuningAttempt['outcome'], reason: attempt.reason,
    summary: attempt.summary ? JSON.parse(attempt.summary) : null, candidateId: attempt.candidateId,
    startedAt: attempt.startedAt.toISOString(), completedAt: attempt.completedAt?.toISOString() ?? null });
}
