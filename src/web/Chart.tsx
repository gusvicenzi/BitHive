import { useTranslation } from 'react-i18next';
import type { MetricView } from '../shared/domain';

export function Chart({ metrics, field, unit, label }: { metrics: MetricView[]; field: 'hashRate' | 'temp' | 'power'; unit: string; label: string }) {
  const { t, i18n } = useTranslation();
  const usable = metrics.filter(m => m[field] != null);
  if (usable.length < 2) return <div className="chart-empty">{t('chartWaiting')}</div>;
  const values = usable.map(m => m[field]!);
  const max = Math.max(...values) * 1.08 || 1;
  const min = Math.max(0, Math.min(...values) * 0.9);
  const start = new Date(usable[0].timestamp).getTime();
  const end = new Date(usable.at(-1)!.timestamp).getTime();
  const x = (m: MetricView) => 10 + (new Date(m.timestamp).getTime() - start) / (end - start || 1) * 780;
  const y = (v: number) => 130 - (v - min) / (max - min || 1) * 115;
  // Split paths on missing observations and collection gaps instead of implying uninterrupted data.
  const segments: MetricView[][] = [];
  for (const m of metrics) {
    if (m[field] == null) { segments.push([]); continue; }
    let segment = segments.at(-1);
    if (!segment || (segment.length && new Date(m.timestamp).getTime() - new Date(segment.at(-1)!.timestamp).getTime() > 90000)) {
      segment = []; segments.push(segment);
    }
    segment.push(m);
  }
  const number = (n: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(n);
  const time = (timestamp: string) => new Date(timestamp).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <figure className={`chart chart-${field}`}>
    <figcaption><span>{label}</span><strong>{number(values.at(-1)!)} <small>{unit}</small></strong></figcaption>
    <svg viewBox="0 0 800 150" role="img" aria-label={t('chartDescription', { label, min: number(Math.min(...values)), max: number(Math.max(...values)), unit })}>
      {[35, 80, 130].map(v => <line key={v} x1="10" y1={v} x2="790" y2={v} className="grid-line" />)}
      {segments.filter(segment => segment.length).map((segment, index) => <polyline key={index} fill="none" stroke="currentColor" strokeWidth="2.5" points={segment.map(m => `${x(m)},${y(m[field]!)}`).join(' ')} />)}
    </svg>
    <div className="chart-times"><span>{time(usable[0].timestamp)}</span><span>{time(usable.at(-1)!.timestamp)}</span></div>
  </figure>;
}
