import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetricView } from '../shared/domain';
import { nearestSample, valueScale, hashRateScale } from './chart-data';

export function Chart({ metrics, field, unit, label }: { metrics: MetricView[]; field: 'hashRate' | 'temp' | 'power'; unit: string; label: string }) {
  const { t, i18n } = useTranslation();
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const tooltipId = useId();
  const ordered = metrics.filter(m => Number.isFinite(new Date(m.timestamp).getTime())).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const usable = ordered.filter(m => m[field] != null && Number.isFinite(m[field]));
  if (usable.length < 2) return <div className="chart-empty">{t('chartWaiting')}</div>;
  const values = usable.map(m => m[field]!);
  const { min, max, step, ticks } = valueScale(values);
  const display = field === 'hashRate' ? hashRateScale(values) : { unit, divisor: 1 };
  const scaleUnit = display.unit;
  const times = usable.map(m => Date.parse(m.timestamp));
  const start = times[0];
  const end = times.at(-1)!;
  const fraction = (timestamp: number) => end === start ? 0.5 : (timestamp - start) / (end - start);
  const x = (m: MetricView) => fraction(Date.parse(m.timestamp)) * 800;
  const y = (v: number) => 150 - (v - min) / (max - min || 1) * 140;
  // Select actual samples; do not interpolate across missing observations.
  const segments: MetricView[][] = [];
  for (const m of ordered) {
    if (m[field] == null || !Number.isFinite(m[field])) { segments.push([]); continue; }
    let segment = segments.at(-1);
    if (!segment || (segment.length && Date.parse(m.timestamp) - Date.parse(segment.at(-1)!.timestamp) > 90000)) {
      segment = []; segments.push(segment);
    }
    segment.push(m);
  }
  const activeIndex = activeTime === null ? -1 : times.indexOf(activeTime);
  const active = usable[activeIndex];
  const number = (n: number, exact = false) => new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: exact && display.divisor === 1000 ? 3 : 0,
    maximumFractionDigits: exact ? (display.divisor === 1000 ? 3 : 6) : Math.min(12, Math.max(1, -Math.floor(Math.log10(step / display.divisor)) + 1)),
  }).format(n / display.divisor);
  const time = (timestamp: string, seconds = false) => new Date(timestamp).toLocaleString(i18n.language, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActiveTime(times[nearestSample(times, start + ratio * (end - start))]);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { setActiveTime(null); return; }
    const current = activeIndex < 0 ? usable.length - 1 : activeIndex;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? usable.length - 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, current - 1)
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(usable.length - 1, current + 1) : null;
    if (index !== null) { event.preventDefault(); setActiveTime(times[index]); }
  }
  return <figure className={`chart chart-${field}`}>
    <figcaption><span>{label}</span><strong>{number(values.at(-1)!, display.divisor === 1000)} <small>{scaleUnit}</small></strong></figcaption>
    <div className="chart-plot">
      <div className="chart-axis" aria-label={t('chartValueScale', { label, unit: scaleUnit })}>
        {ticks.map(value => <span className="chart-tick" key={value} style={{ top: `${y(value) / 160 * 100}%` }}>{number(value)} <small>{scaleUnit}</small></span>)}
      </div>
      <div className="chart-interaction" tabIndex={0} role="slider" aria-label={t('inspectChart', { label })}
        aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={usable.length - 1} aria-valuenow={activeIndex < 0 ? usable.length - 1 : activeIndex}
        aria-valuetext={active ? `${number(active[field]!, true)} ${scaleUnit}, ${time(active.timestamp, true)}` : t('chartKeyboardHint')}
        aria-describedby={active ? tooltipId : undefined}
        onPointerMove={point} onPointerDown={event => { event.currentTarget.focus(); point(event); }}
        onPointerLeave={event => { if (event.pointerType !== 'touch') setActiveTime(null); }}
        onFocus={() => setActiveTime(times.at(-1)!)} onBlur={() => setActiveTime(null)} onKeyDown={key}>
        <svg viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label={t('chartDescription', { label, min: number(Math.min(...values)), max: number(Math.max(...values)), unit: scaleUnit })}>
          {ticks.map(value => <line key={value} x1="0" y1={y(value)} x2="800" y2={y(value)} className="grid-line" />)}
          {segments.filter(segment => segment.length).map((segment, index) => <polyline key={index} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={segment.map(m => `${x(m)},${y(m[field]!)}`).join(' ')} />)}
          {active && <line className="chart-cursor" x1={x(active)} x2={x(active)} y1="10" y2="150" vectorEffect="non-scaling-stroke" />}
        </svg>
        {active && <>
          <span className="chart-point" aria-hidden="true" style={{ left: `${fraction(activeTime!) * 100}%`, top: `${y(active[field]!) / 160 * 100}%` }} />
          <div id={tooltipId} role="tooltip" className="chart-tooltip" style={{ left: `clamp(0px, ${fraction(activeTime!) * 100}%, max(0px, calc(100% - 180px)))` }}>
            <span>{label}</span><strong>{number(active[field]!, true)} <small>{scaleUnit}</small></strong><time dateTime={active.timestamp}>{time(active.timestamp, true)}</time>
          </div>
        </>}
      </div>
    </div>
    <div className="chart-times"><span>{time(usable[0].timestamp)}</span><span>{time(usable.at(-1)!.timestamp)}</span></div>
    <span className="sr-only">{t('chartKeyboardHint')}</span>
  </figure>;
}
