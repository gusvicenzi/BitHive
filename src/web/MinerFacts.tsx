import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { averageHashrates, efficiency, type DeviceView } from '../shared/domain';
import { HashrateAverages } from './HashrateAverages';
import { BestDifficulty } from './BestDifficulty';
import { TemperatureReading } from './TemperatureReading';
export function MinerFacts({ device }: { device: DeviceView }) {
  const { t, i18n } = useTranslation();
  const snapshot = device.snapshot!;
  const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const measured = (value: number | null | undefined, unit: string, digits = 2) => <>{number(value, digits)} <small>{unit}</small></>;
  const headline: [string, ReactNode][] = [
    ['status', <span className={`status status-${device.status}`}>{t(device.status)}</span>],
    ['hashrate', <>{measured(snapshot.hashRate == null ? null : snapshot.hashRate / 1000, 'TH/s')}<HashrateAverages averages={averageHashrates([snapshot])} total={1} collapsible /></>],
    ['power', measured(snapshot.power, 'W')],
    ['efficiency', measured(efficiency(snapshot.hashRate, snapshot.power), 'J/TH')],
    ['temperature', <TemperatureReading value={snapshot.temp} sensor="chip" stale={device.status !== 'online'} />],
    ['regulatorTemp', <TemperatureReading value={snapshot.vrTemp} sensor="vrm" stale={device.status !== 'online'} />],
    ['hashErrorPercent', measured(snapshot.errorRate, '%')],
  ];
  const facts: [string, ReactNode][] = [
    ['inputVoltage', measured(snapshot.inputVoltage, 'V')],
    ['lastUpdate', device.lastSeen ? <time dateTime={device.lastSeen}>{new Date(device.lastSeen).toLocaleString(i18n.language)}</time> : t('never')],
    ['uptime', snapshot.uptime == null ? '—' : t('uptimeHours', { value: number(snapshot.uptime / 3600) })],
    ['fanSpeed', <span className="fan-readings"><span>{number(snapshot.fanRpm, 0)} <small>RPM</small></span><span aria-hidden="true"> · </span><span aria-label={t('fanPercentage')}>{number(snapshot.fanPercent, 1)} <small>%</small></span></span>], ['bestDiff', <BestDifficulty value={snapshot.bestDiff} />],
    ['accepted', number(snapshot.accepted, 0)], ['rejected', number(snapshot.rejected, 0)],
    ['firmware', snapshot.firmware], ['board', snapshot.board], ['mac', snapshot.mac],
  ];
  const fields = (values: [string, ReactNode][]) => values.map(([key, value]) => <div key={key} data-fact={key}><dt>{t(key)}</dt><dd>{value ?? '—'}</dd></div>);
  return <>
    <dl className="device-facts miner-headline" aria-label={t('minerLiveReadings')}>{fields(headline)}</dl>
    <dl className="device-facts miner-secondary">{fields(facts)}</dl>
    <details className="temperature-guide"><summary>{t('temperatureGuide')}</summary><p>{t('temperatureReference')}</p>
      <div className="temperature-guide-scales">{(['chip', 'vrm'] as const).map(sensor => <div key={sensor}><strong>{t(sensor === 'chip' ? 'temperature' : 'regulatorTemp')}</strong><span className="temperature-gradient" aria-hidden="true" /><span>{t(sensor === 'chip' ? 'chipTemperatureAnchors' : 'vrmTemperatureAnchors')}</span></div>)}</div>
    </details>
  </>;
}
