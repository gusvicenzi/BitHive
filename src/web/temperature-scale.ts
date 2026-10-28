export type TemperatureSensor = 'chip' | 'vrm';
// Display reference anchors, not asserted device limits. Danger anchors follow upstream
// ESP-Miner THROTTLE_TEMP / TPS546_THROTTLE_TEMP in main/tasks/power_management_task.c.
export const temperatureScales = { chip: [40, 55, 65, 75], vrm: [45, 65, 85, 105] } as const;
const colors = [[35, 116, 91], [138, 107, 8], [180, 83, 9], [180, 35, 50]];
const bands = ['low', 'mid', 'high', 'danger'] as const;
export function temperatureAppearance(value: number | null | undefined, sensor: TemperatureSensor) {
  // AxeOS can return -1 when a sensor is unavailable (e.g. ASIC powered down).
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const anchors = temperatureScales[sensor];
  const clamped = Math.max(anchors[0], Math.min(anchors[3], value));
  let segment = 0;
  while (segment < 2 && clamped > anchors[segment + 1]) segment++;
  const ratio = (clamped - anchors[segment]) / (anchors[segment + 1] - anchors[segment]);
  const rgb = colors[segment].map((start, index) => Math.round(start + (colors[segment + 1][index] - start) * ratio));
  const band = value >= anchors[3] ? 3 : value >= anchors[2] ? 2 : value >= anchors[1] ? 1 : 0;
  return { color: `rgb(${rgb.join(', ')})`, tint: `rgba(${rgb.join(', ')}, 0.08)`, band: bands[band] };
}
