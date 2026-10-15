import type { Snapshot } from '../shared/domain';

export const tuningBoundFields = ['frequencyMin', 'frequencyMax', 'voltageMin', 'voltageMax'] as const;
export function tuningDefaults(snapshot: Snapshot | null) {
  const endpoints = (options: number[]) => options.length ? [String(Math.min(...options)), String(Math.max(...options))] : ['', ''];
  const [frequencyMin, frequencyMax] = endpoints(snapshot?.capabilities.frequencies ?? []);
  const [voltageMin, voltageMax] = endpoints(snapshot?.capabilities.voltages ?? []);
  return {
    frequencyMin, frequencyMax, frequencyStep: '25', voltageMin, voltageMax, voltageStep: '10',
    maxAsicTemperature: '65', maxVrmTemperature: '85', maxErrorPercentage: '2',
    tolerance: '5', stabilizationSeconds: '120', measurementSeconds: '300',
  };
}
