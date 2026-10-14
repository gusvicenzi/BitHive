export function hashRateScale(values: number[]) {
  return values.some(value => Number.isFinite(value) && value > 1000) ? { unit: 'TH/s', divisor: 1000 } : { unit: 'GH/s', divisor: 1 };
}

export function valueScale(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const low = minimum >= 0 ? Math.max(0, minimum * 0.9) : minimum * 1.1;
  const high = maximum > 0 ? maximum * 1.08 : maximum < 0 ? maximum * 0.9 : 1;
  const target = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= target)! * magnitude;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step);
  return { min, max, step, ticks };
}

export function nearestSample(times: number[], target: number) {
  let left = 0;
  let right = times.length - 1;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (times[middle] < target) left = middle + 1;
    else right = middle;
  }
  return left > 0 && Math.abs(times[left - 1] - target) <= Math.abs(times[left] - target) ? left - 1 : left;
}
