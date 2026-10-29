import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetMetric as MetricView, MetricField } from '../shared/fleet';
import { nearestSample, valueScale, hashRateScale } from './chart-data';

export function Chart({ metrics, field, unit, label, bucketMinutes, expectedCount, series }: { series?: { id: string; name: string; color: string; metrics: MetricView[] }[]; expectedCount?: number; bucketMinutes?: number; metrics: MetricView[]; field: MetricField; unit: string; label: string }) {
  const { t, i18n } = useTranslation();
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const tooltipId = useId();
  const ordered = (series ? series.flatMap(s => s.metrics) : metrics).filter(m => Number.isFinite(new Date(m.timestamp).getTime())).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const usable = ordered.filter(m => m[field] != null && Number.isFinite(m[field]));
  if (usable.length < 2) return <figure className="chart"><figcaption>{label}</figcaption><div className="chart-empty">{t('chartWaiting')}</div></figure>;
  const values = usable.map(m => m[field]!);
  const { min, max, step, ticks } = valueScale(values);
  const display = field === 'hashRate' ? hashRateScale(values) : { unit, divisor: 1 };
  const scaleUnit = display.unit;
  const times = [...new Set(usable.map(m => Date.parse(m.timestamp)))];
  const start = times[0];
  const end = times.at(-1)!;
  const fraction = (timestamp: number) => end === start ? 0.5 : (timestamp - start) / (end - start);
  const x = (m: MetricView) => fraction(Date.parse(m.timestamp)) * 800;
  const y = (v: number) => 150 - (v - min) / (max - min || 1) * 140;
  // Select actual samples; do not interpolate across missing observations.
  const paths = (input: MetricView[]) => {
  const segments: MetricView[][] = [];
  for (const m of input) {
    if (m[field] == null || !Number.isFinite(m[field])) { segments.push([]); continue; }
    let segment = segments.at(-1);
    if (!segment || (segment.length && Date.parse(m.timestamp) - Date.parse(segment.at(-1)!.timestamp) > (bucketMinutes ? bucketMinutes * 60000 * 2 : 90000))) {
      segment = []; segments.push(segment);
    }
    segment.push(m);
  }
  return segments.filter(segment => segment.length);
  };
  const lines = series ?? [{ id: field, name: label, color: 'currentColor', metrics: ordered }];
  const activeIndex = activeTime === null ? -1 : times.indexOf(activeTime);
  const active = usable.find(m => Date.parse(m.timestamp) === activeTime);
  const number = (n: number, exact = false) => new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: exact ? (field === 'hashRate' ? (display.divisor === 1000 ? 3 : 0) : 1) : 0,
    maximumFractionDigits: exact ? (field === 'hashRate' ? (display.divisor === 1000 ? 3 : 6) : 1) : Math.min(12, Math.max(1, -Math.floor(Math.log10(step / display.divisor)) + 1)),
  }).format(n / display.divisor);
  const time = (timestamp: string, seconds = false) => new Date(timestamp).toLocaleString(i18n.language, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
  });
  function point(event: PointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('[role=tooltip]')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    setActiveTime(times[nearestSample(times, start + ratio * (end - start))]);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { setActiveTime(null); return; }
    const current = activeIndex < 0 ? times.length - 1 : activeIndex;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? times.length - 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, current - 1)
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(times.length - 1, current + 1) : null;
    if (index !== null) { event.preventDefault(); setActiveTime(times[index]); }
  }
  return <figure className={`chart chart-${field}${series ? ' chart-multi' : ''}`}>
    <figcaption><span>{label}</span>{!series && <strong>{number(values.at(-1)!, display.divisor === 1000)} <small>{scaleUnit}</small></strong>}</figcaption>
    <div className="chart-plot">
      <div className="chart-axis" aria-label={t('chartValueScale', { label, unit: scaleUnit })}>
        {ticks.map(value => <span className="chart-tick" key={value} style={{ top: `${y(value) / 160 * 100}%` }}>{number(value)} <small>{scaleUnit}</small></span>)}
      </div>
      <div className="chart-interaction" tabIndex={0} role="slider" aria-label={t('inspectChart', { label })}
        aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={times.length - 1} aria-valuenow={activeIndex < 0 ? times.length - 1 : activeIndex}
        aria-valuetext={active ? `${series ? series.map(line => { const value = line.metrics.find(m => m.timestamp === active.timestamp)?.[field]; return `${line.name}: ${value == null ? '—' : number(value, true)} ${scaleUnit}`; }).join(', ') : `${number(active[field]!, true)} ${scaleUnit}`}, ${time(active.timestamp, true)}` : t('chartKeyboardHint')}
        aria-describedby={active ? tooltipId : undefined}
        onPointerMove={point} onPointerDown={event => { event.currentTarget.focus(); point(event); }}
        onPointerLeave={event => { if (event.pointerType !== 'touch') setActiveTime(null); }}
        onFocus={() => setActiveTime(times.at(-1)!)} onBlur={() => setActiveTime(null)} onKeyDown={key}>
        <svg viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label={t('chartDescription', { label, min: number(values.reduce((min, value) => Math.min(min, value), Infinity)), max: number(values.reduce((max, value) => Math.max(max, value), -Infinity)), unit: scaleUnit })}>
          {ticks.map(value => <line key={value} x1="0" y1={y(value)} x2="800" y2={y(value)} className="grid-line" />)}
          {lines.map(line => paths(line.metrics.filter(m => Number.isFinite(Date.parse(m.timestamp))).toSorted((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))).map((segment, index) => <polyline key={`${line.id}-${index}`} data-series-id={line.id} fill="none" stroke={line.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={segment.map(m => `${x(m)},${y(m[field]!)}`).join(' ')} />))}
          {active && <line className="chart-cursor" x1={x(active)} x2={x(active)} y1="10" y2="150" vectorEffect="non-scaling-stroke" />}
        </svg>
        {active && <>
          {!series && <span className="chart-point" aria-hidden="true" style={{ left: `${fraction(activeTime!) * 100}%`, top: `${y(active[field]!) / 160 * 100}%` }} />}
          <div id={tooltipId} role="tooltip" className="chart-tooltip" style={{ left: `clamp(0px, ${fraction(activeTime!) * 100}%, max(0px, calc(100% - 180px)))` }}>
            <span>{label}</span>{series ? series.map(line => {
              const sample = line.metrics.find(m => m.timestamp === active.timestamp);
              const value = sample?.[field];
              return <div className="chart-series-value" key={line.id}><span style={{ color: line.color }}>●</span><span>{line.name}</span><strong>{value == null || !Number.isFinite(value) ? '—' : number(value, true)} <small>{scaleUnit}</small></strong></div>;
            }) : <strong>{number(active[field]!, true)} <small>{scaleUnit}</small></strong>}{expectedCount !== undefined && <span>{t('chartCoverage', { count: active.contributors?.[field] ?? 0, total: expectedCount })}</span>}<time dateTime={active.timestamp}>{time(active.timestamp, true)}</time>
          </div>
        </>}
      </div>
    </div>
    <div className="chart-times"><span>{time(usable[0].timestamp)}</span><span>{time(usable.at(-1)!.timestamp)}</span></div>
    <span className="sr-only">{t('chartKeyboardHint')}</span>
  </figure>;
}
