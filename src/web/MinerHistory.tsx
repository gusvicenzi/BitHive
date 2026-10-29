import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetricView } from '../shared/domain';
import { api } from './api';
import { Chart } from './Chart';
type History = { scheduleChanges?: { id: string; timestamp: string; scheduleName: string; periodName: string; profileName: string; status: string; reason: string | null }[]; bucketMinutes?: number; metrics: MetricView[]; events: { id: number; kind: string; timestamp: string }[]; changes: { id: number; result: string; timestamp: string; requested: string; after: string | null }[]; limit: number; hasMore?: boolean };
export function MinerHistory({ id, revision, activity = false }: { id: string; revision: number; activity?: boolean }) {
  const { t, i18n } = useTranslation();
  const [hours, setHours] = useState(1), [section, setSection] = useState(activity ? 'events' : 'metrics');
  const [field, setField] = useState<'hashRate' | 'power' | 'temp' | 'vrTemp'>('hashRate');
  const [offset, setOffset] = useState(0), [history, setHistory] = useState<History | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void api<History>(`/devices/${id}/history?hours=${hours}&section=${section}&offset=${offset}&pageSize=20`, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setHistory(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, hours, section, offset, revision]);
  const reset = () => { setHistory(null); setOffset(0); };
  const label = field === 'hashRate' ? 'hashrate' : field === 'temp' ? 'temperature' : field === 'vrTemp' ? 'vrTemp' : 'power';
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  return <section className="miner-history" aria-label={t(activity ? 'activity' : 'history')}>
    <div className="history-controls"><h3>{t(activity ? 'activity' : 'history')}</h3>
      {activity && <label>{t('activityType')}<select value={section} onChange={e => { reset(); setSection(e.target.value); }}><option value="events">{t('deviceEvents')}</option><option value="schedules">{t('schedule.activityType')}</option><option value="changes">{t('configurationHistory')}</option><option value="metrics">{t('history')}</option></select></label>}
      <label>{t('timeRange')}<select value={hours} onChange={e => { reset(); setHours(Number(e.target.value)); }}><option value="1">{t('oneHour')}</option><option value="24">{t('oneDay')}</option><option value="168">{t('oneWeek')}</option></select></label>
      {section === 'metrics' && <label>{t('chartMetric')}<select value={field} onChange={e => setField(e.target.value as typeof field)}><option value="hashRate">{t('hashrate')}</option><option value="power">{t('power')}</option><option value="temp">{t('temperature')}</option><option value="vrTemp">{t('vrTemp')}</option></select></label>}
    </div>
    {error ? <p role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</p> : !history ? <p role="status">{t('loading')}</p> : <>
      {section === 'metrics' && <><div className="charts single-chart"><Chart bucketMinutes={history.bucketMinutes} key={field} metrics={history.metrics} field={field} unit={field === 'hashRate' ? 'GH/s' : field === 'power' ? 'W' : '°C'} label={t(label)} /></div><p className="muted">{history.bucketMinutes ? t('historyAverages', { minutes: history.bucketMinutes }) : t('historyLimit', { count: history.limit })}</p></>}
      {section === 'schedules' && history.scheduleChanges?.map(change => <p key={change.id}><time>{date(change.timestamp)}</time> · {t('schedule.activity', { schedule: change.scheduleName, period: change.periodName, profile: change.profileName })} · {t(`schedule.status.${change.status}`)}{change.reason && <small> · {t(`errors.${change.reason}`, { defaultValue: t('errors.operationFailed') })}</small>}</p>)}
      {section === 'events' && (history.events.length ? history.events.map(event => <p key={event.id}><time>{date(event.timestamp)}</time> · {t(`events.${event.kind}`, { defaultValue: t('events.observed') })}</p>) : <p className="muted">{t('noEvents')}</p>)}
      {section === 'schedules' && !history.scheduleChanges?.length && <p className="muted">{t('noEvents')}</p>}
      {section === 'changes' && (history.changes.length ? history.changes.map(change => <details key={change.id}><summary>{date(change.timestamp)} · {t(`results.${change.result}`, { defaultValue: t('results.observed') })}</summary><dl>{Object.entries(JSON.parse(change.result === 'observed' ? change.after ?? '{}' : change.requested)).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{typeof value === 'boolean' ? t('changed') : String(value)}</dd></div>)}</dl></details>) : <p className="muted">{t('noChanges')}</p>)}
      {section !== 'metrics' && <div className="form-actions"><button disabled={offset === 0} onClick={() => { setHistory(null); setOffset(n => Math.max(0, n - 20)); }}>{t('previousPage')}</button><span>{t('activityPage', { page: offset / 20 + 1 })}</span><button disabled={!history.hasMore} onClick={() => { setHistory(null); setOffset(n => n + 20); }}>{t('nextPage')}</button></div>}
    </>}
  </section>;
}
