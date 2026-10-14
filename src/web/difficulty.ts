const units = [{ suffix: 'M', exponent: 6 }, { suffix: 'G', exponent: 9 }, { suffix: 'T', exponent: 12 }];

function decimal(coefficient: bigint, places: number, locale: string) {
  const digits = coefficient.toString().padStart(places + 1, '0');
  const whole = places ? digits.slice(0, -places) : digits;
  const fraction = places ? digits.slice(-places) : '';
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  return new Intl.NumberFormat(locale).format(BigInt(whole)) + (places ? separator + fraction : '');
}

export function formatDifficulty(value: string | undefined, locale: string) {
  const match = value?.trim().match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?\s*([KMGT])?$/i);
  if (!match || value!.length > 64) return { compact: '—', full: null, expanded: false };
  const exponent = Number(match[3] ?? 0);
  if (Math.abs(exponent) > 308) return { compact: '—', full: null, expanded: false };
  const suffix = match[4]?.toUpperCase();
  const shift = suffix === 'K' ? 3 : units.find(unit => unit.suffix === suffix)?.exponent ?? 0;
  let coefficient = BigInt(match[1] + (match[2] ?? ''));
  let places = (match[2]?.length ?? 0) - exponent - shift;
  if (places < 0) { coefficient *= 10n ** BigInt(-places); places = 0; }
  while (places > 0 && coefficient % 10n === 0n) { coefficient /= 10n; places--; }
  const full = decimal(coefficient, places, locale);
  let unitIndex = units.findLastIndex(unit => coefficient >= 10n ** BigInt(places + unit.exponent));
  if (unitIndex < 0) return { compact: full, full, expanded: Boolean(suffix) };
  let rounded: bigint;
  while (true) {
    const denominator = 10n ** BigInt(places + units[unitIndex].exponent);
    rounded = (coefficient * 1000n + denominator / 2n) / denominator;
    if (rounded < 1000000n || unitIndex === units.length - 1) break;
    unitIndex++;
  }
  return { compact: decimal(rounded, 3, locale) + units[unitIndex].suffix, full, expanded: Boolean(suffix) };
}
