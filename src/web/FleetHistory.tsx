import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView } from '../shared/domain';
import { fleetTotals, type FleetHistory as History } from '../shared/fleet';
import { api } from './api';
import { Chart } from './Chart';
const colors = ['#176b91', '#bf5b28', '#26806a', '#8854a0', '#ac3663', '#687b21', '#3a5fc4', '#96620d'];
export function FleetHistory({ devices, revision }: { devices: DeviceView[]; revision: number }) {
  const { t } = useTranslation();
  const [hours, setHours] = useState(1), [history, setHistory] = useState<History | null>(null), [error, setError] = useState('');
  const [demo, setDemo] = useState(false), [hidden, setHidden] = useState<string[]>([]);
  const hasReal = devices.some(d => !d.demo), hasDemo = devices.some(d => d.demo);
  const simulated = hasDemo && (!hasReal || demo);
  useEffect(() => {
    if (!devices.length) return;
    const controller = new AbortController();
    void api<History>(`/fleet/history?hours=${hours}`, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setHistory(data); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [hours, revision, devices.length]);
  const miners = devices.filter(d => d.demo === simulated);
  const colorIds = devices.map(d => d.id).toSorted();
  const series = miners.map(device => ({ id: device.id, name: device.name, color: colors[colorIds.indexOf(device.id)] ?? `hsl(${colorIds.indexOf(device.id) * 137.508 % 360} 65% 38%)`, metrics: history?.series?.find(s => s.id === device.id)?.metrics ?? [] }));
  const visible = series.filter(s => !hidden.includes(s.id));
  const totals = fleetTotals(series);
  return <section className="panel fleet-history" aria-label={t('fleetHistory')}>
    <div className="section-title"><div><h2>{t('fleetHistory')}</h2><p className="muted">{t('fleetHistoryHint')}</p></div><div className="fleet-chart-controls">
      {hasReal && hasDemo && <label>{t('chartFleet')}<select value={simulated ? 'demo' : 'real'} onChange={e => setDemo(e.target.value === 'demo')}><option value="real">{t('realMiners')}</option><option value="demo">{t('simulated')}</option></select></label>}
      <label>{t('timeRange')}<select value={hours} onChange={e => { setHistory(null); setError(''); setHours(Number(e.target.value)); }}><option value="1">{t('oneHour')}</option><option value="24">{t('oneDay')}</option><option value="168">{t('oneWeek')}</option></select></label>
    </div></div>
    {simulated && <p className="notice">{t('demoChartHint')}</p>}
    {error ? <p className="notice" role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</p> : !history ? <p className="empty" role="status">{t(devices.length ? 'loading' : 'chartWaiting')}</p> : <>
      <div className="fleet-charts"><Chart metrics={totals} field="hashRate" unit="GH/s" label={t('fleetHashrateChart')} bucketMinutes={history.bucketMinutes} expectedCount={miners.length} />
        <Chart metrics={totals} field="power" unit="W" label={t('fleetPowerChart')} bucketMinutes={history.bucketMinutes} expectedCount={miners.length} />
        <Chart metrics={[]} series={visible} field="temp" unit="°C" label={t('chipTemperature')} bucketMinutes={history.bucketMinutes} />
        <Chart metrics={[]} series={visible} field="vrTemp" unit="°C" label={t('vrTemp')} bucketMinutes={history.bucketMinutes} />
      </div>
      <div className="miner-chart-legend" aria-label={t('temperatureLines')}>{series.map(s => <button key={s.id} type="button" aria-label={t('toggleMinerTemperature', { name: s.name })} aria-pressed={!hidden.includes(s.id)} onClick={() => setHidden(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])}><span aria-hidden="true" style={{ background: s.color }} />{s.name}</button>)}</div>
      <p className="muted fleet-chart-note">{t('fleetChartNote', { minutes: history.bucketMinutes })}</p>
    </>}
  </section>;
}
