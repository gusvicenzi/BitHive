import type { Snapshot } from '../shared/domain.js';

// Deliberately has no scheduler or actuator until manual workflows have hardware validation.
export interface DeviceLimits {
  deviceId: string;
  frequencies: number[];
  voltages: number[];
  maxChipTemperature: number;
  maxRegulatorTemperature: number;
  maxErrorPercentage: number;
  minimumObservationSeconds: number;
}
export interface TuningExperiment {
  deviceId: string;
  startedAt: Date;
  profile: { frequency: number; coreVoltage: number };
  samples: Snapshot[];
  lastStableProfile: { frequency: number; coreVoltage: number };
  result: 'observing' | 'stable' | 'unstable' | 'unreachable';
}
export interface TuningStrategy {
  evaluate(experiment: TuningExperiment, limits: DeviceLimits): 'continue' | 'accept' | 'rollback-requested';
}
