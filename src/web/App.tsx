import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { aggregate, efficiency, type ActionResult, type DeviceView, type MetricView, type Settings } from '../shared/domain';
import { api } from './api';
import { Chart } from './Chart';
import { Configuration } from './Configuration';
import { DeviceNaming } from './DeviceNaming';
import { PowerCard } from './PowerCard';

type History = { metrics: MetricView[]; events: { id: number; kind: string; timestamp: string }[]; changes: { id: number; result: string; timestamp: string; requested: string; before: string; after: string | null }[]; limit: number };
export function App() {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [hours, setHours] = useState(24);
  const [results, setResults] = useState<ActionResult[]>([]);
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  const reload = useCallback(async (signal?: AbortSignal) => {
    const data = await api<DeviceView[]>('/devices', undefined, signal);
    setDevices(data); setRevision(n => n + 1); setLoading(false);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try { await reload(controller.signal); setError(''); }
      catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'operationFailed'); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(() => void update(), 10000);
    };
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [reload]);
  useEffect(() => {
    if (!detailId) return;
    const controller = new AbortController();
    setHistoryError('');
    void api<History>(`/devices/${detailId}/history?hours=${hours}`, undefined, controller.signal).then(setHistory)
      .catch(e => { if (!controller.signal.aborted) setHistoryError(e.message); });
    return () => controller.abort();
  }, [detailId, hours, revision]);
  const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t('never');
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'operationFailed');
  async function mutation(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    void mutation(async () => { await api('/devices', { address, ...(name.trim() ? { name } : {}) }); setAdding(false); setAddress(''); setName(''); });
  }
  const batch = (ids: string[], settings?: Settings) => void mutation(async () => {
    setResults(await api<ActionResult[]>('/batch', { ids, action: settings ? 'configure' : 'refresh', ...(settings ? { settings } : {}) }));
  });
  const detail = devices.find(d => d.id === detailId);
  const totals = aggregate(devices.filter(d => !d.demo));
  const demoTotals = aggregate(devices.filter(d => d.demo));
  const shown = devices.filter(d => filter === 'all' || d.status === filter);
  const showDetail = (device: DeviceView) => { setHistory(null); setDetailId(device.id); };
  return <div className="app-shell">
    <aside className="sidebar"><a href="#fleet" className="brand"><svg aria-hidden="true" viewBox="0 0 40 44"><path d="M20 2 37 12v20L20 42 3 32V12Z" fill="currentColor"/><path d="M13 13h9c8 0 9 8 3 10 7 3 4 10-3 10h-9Zm5 5v4h4c3 0 3-4 0-4Zm0 8v3h4c3 0 3-3 0-3Z" fill="#123c50"/></svg>BitHive</a>
      <p className="sidebar-caption">{t('localFleet')}</p><nav aria-label={t('navigation')}><a className="nav-active" href="#fleet"><span aria-hidden="true">▦</span>{t('fleet')}</a><a href="#activity"><span aria-hidden="true">≋</span>{t('activity')}</a></nav>
      <div className="sidebar-bottom"><span className="local-dot" />{t('localOnly')}<small>{t('collectionHint')}</small></div>
    </aside>
    <main id="fleet"><header><div><p className="eyebrow">{t('workspace')}</p><h1>{t('fleetOverview')}</h1><p className="muted">{t('subtitle')}</p></div>
      <div className="toolbar"><label className="language"><span className="sr-only">{t('language')}</span><select value={i18n.resolvedLanguage} onChange={event => void i18n.changeLanguage(event.target.value)}><option value="en">English</option><option value="pt-BR">Português (BR)</option></select></label>
        <button disabled={busy} onClick={() => void mutation(() => api('/demo', {}))}>{t('tryDemo')}</button><button className="primary" onClick={() => setAdding(!adding)}>{t('addDevice')}</button></div>
    </header>
    {error && <div className="error-banner" role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</div>}
    {adding && <form className="add-form panel" onSubmit={add}><h2>{t('addDevice')}</h2><div className="form-grid"><label>{t('optionalDisplayName')}<input placeholder={t('nameFromAxeos')} maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label>{t('deviceAddress')}<input required maxLength={253} placeholder={t('addressPlaceholder')} value={address} onChange={event => setAddress(event.target.value)} /></label></div><p className="muted">{t('registrationHint')}</p><div className="form-actions"><button disabled={busy} className="primary">{busy ? t('working') : t('connectDevice')}</button><button type="button" onClick={() => setAdding(false)}>{t('cancel')}</button></div></form>}
    <section className="summary" aria-label={t('fleetSummary')}>
      <article><span>{t('totalHashrate')}</span><strong>{number(totals.hashRate / 1000)} <small>TH/s</small></strong><p>{t('currentReadings')}</p></article>
      <PowerCard power={totals.power} partial={devices.some(d => !d.demo && d.status === 'online' && d.snapshot?.power == null)} />
      <article><span>{t('efficiency')}</span><strong>{number(totals.efficiency)} <small>J/TH</small></strong><p>{totals.incomplete ? t('partialMetrics') : t('weightedEfficiency')}</p></article>
      <article className="availability"><span>{t('availability')}</span><strong>{totals.online}<small> / {totals.total}</small></strong><p><span className="local-dot" />{t('onlineDevices')}</p></article>
    </section>
    {!!demoTotals.total && <div className="demo-banner"><strong>{t('demoMode')}</strong><span>{t('demoSummary', { count: demoTotals.total, hash: number(demoTotals.hashRate / 1000), power: number(demoTotals.power) })}</span></div>}
    <section className="panel fleet-panel"><div className="section-title"><div><h2>{t('yourMiners')} <span className="count">{devices.length}</span></h2><p className="muted">{t('tableHint')}</p></div><label><span className="sr-only">{t('filterStatus')}</span><select value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'online', 'stale', 'offline'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div>
      {!!selected.length && <div className="batch-bar"><span>{t('selectedCount', { count: selected.length })}</span><button disabled={busy} onClick={() => batch(selected)}>{t('refreshSelected')}</button><button onClick={() => { const d = devices.find(d => d.id === selected[0]); if (d) showDetail(d); }}>{t('configureSelected')}</button><button onClick={() => setSelected([])}>{t('clearSelection')}</button></div>}
      {loading ? <p className="empty" role="status">{t('loading')}</p> : !devices.length ? <div className="empty"><div className="hive-mark" aria-hidden="true">⬡</div><h3>{t('emptyTitle')}</h3><p>{t('emptyHint')}</p><button onClick={() => setAdding(true)} className="primary">{t('addFirst')}</button><button disabled={busy} onClick={() => void mutation(() => api('/demo', {}))}>{t('tryDemo')}</button></div> : <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label={t('selectAll')} checked={!!shown.length && shown.every(d => selected.includes(d.id))} onChange={event => setSelected(event.target.checked ? shown.slice(0, 50).map(d => d.id) : [])} /></th>{['device', 'status', 'hashrate', 'power', 'efficiency', 'temperature', 'hashErrorPercent', 'lastUpdate'].map(key => <th key={key}>{t(key)}</th>)}</tr></thead><tbody>{shown.map(device => <tr key={device.id} className={device.status !== 'online' ? 'stale-row' : ''}><td><input type="checkbox" aria-label={t('selectDevice', { name: device.name })} checked={selected.includes(device.id)} disabled={!selected.includes(device.id) && selected.length >= 50} onChange={event => setSelected(current => event.target.checked ? [...current, device.id] : current.filter(id => id !== device.id))} /></td>
        <td><button className="device-link" onClick={() => showDetail(device)}>{device.name}</button><small>{device.address} {device.demo && <span className="tag">{t('simulated')}</span>}</small><small>{device.snapshot?.model ?? t('unknownModel')}</small></td>
        <td><span className={`status status-${device.status}`}>{t(device.status)}</span></td><td className="numeric">{number(device.snapshot?.hashRate == null ? null : device.snapshot.hashRate / 1000)}<small>TH/s</small></td><td className="numeric">{number(device.snapshot?.power)}<small>W</small></td><td className="numeric">{number(efficiency(device.snapshot?.hashRate, device.snapshot?.power))}<small>J/TH</small></td><td className="numeric">{number(device.snapshot?.temp, 1)}<small>°C</small></td><td className="numeric">{number(device.snapshot?.errorRate)}<small>%</small></td><td className="last-update">{date(device.lastSeen)}</td>
      </tr>)}</tbody></table>{!shown.length && <p className="empty">{t('noMatchingDevices')}</p>}</div>}
      <div className="panel-footer"><span className="local-dot" />{t('refreshHint')}<span>{t('staleHint')}</span></div>
    </section>
    {!!results.length && <section className="panel results" aria-live="polite"><h2>{t('actionResults')}</h2>{results.map(result => <p key={result.id}><strong>{devices.find(d => d.id === result.id)?.name ?? result.id}</strong><span className={`status status-${result.result === 'verified' || result.result === 'refreshed' ? 'online' : 'stale'}`}>{t(`results.${result.result}`)}</span>{result.reason && <span>{t(`errors.${result.reason}`, { defaultValue: t('errors.operationFailed') })}</span>}</p>)}<p className="muted">{t('uncertainHint')}</p></section>}
    {detail?.snapshot && <section className="detail panel" aria-label={t('deviceDetail')}><div className="section-title"><div><p className="eyebrow">{t('deviceDetail')}</p><h2>{detail.name}</h2><p className="muted">{detail.snapshot.model} · {detail.address}</p></div><button onClick={() => setDetailId(null)}>{t('closeDetails')}</button></div>
      {detail.status !== 'online' && <p className="notice">{t('staleDeviceHint')}</p>}
      <dl className="device-facts">{([['firmware', detail.snapshot.firmware], ['board', detail.snapshot.board], ['mac', detail.snapshot.mac], ['accepted', number(detail.snapshot.accepted, 0)], ['rejected', number(detail.snapshot.rejected, 0)], ['errorRate', `${number(detail.snapshot.errorRate)} %`], ['fanRpm', number(detail.snapshot.fanRpm, 0)], ['regulatorTemp', `${number(detail.snapshot.vrTemp)} °C`], ['uptime', detail.snapshot.uptime === undefined ? '—' : t('uptimeHours', { value: number(detail.snapshot.uptime / 3600) })], ['bestDiff', detail.snapshot.bestDiff]] as const).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value ?? '—'}</dd></div>)}</dl>
      <div className="section-title"><h3>{t('history')}</h3><label>{t('timeRange')}<select value={hours} onChange={event => { setHours(Number(event.target.value)); setHistory(null); }}><option value="1">{t('oneHour')}</option><option value="24">{t('oneDay')}</option><option value="168">{t('oneWeek')}</option></select></label></div>
      {historyError ? <p role="alert">{t(`errors.${historyError}`, { defaultValue: t('errors.operationFailed') })}</p> : !history ? <p role="status">{t('loading')}</p> : <><div className="charts"><Chart metrics={history.metrics} field="hashRate" unit="GH/s" label={t('hashrate')} /><Chart metrics={history.metrics} field="power" unit="W" label={t('power')} /><Chart metrics={history.metrics} field="temp" unit="°C" label={t('temperature')} /></div><p className="muted">{t('historyLimit', { count: history.limit })}</p></>}
      <DeviceNaming key={`names-${detail.id}`} device={detail} busy={busy} onUpdated={() => reload()} />
      <Configuration key={detail.id} device={detail} count={selected.includes(detail.id) ? selected.length : 1} busy={busy} onApply={settings => batch(selected.includes(detail.id) ? selected : [detail.id], settings)} />
      <div className="audit-grid"><div><h3>{t('deviceEvents')}</h3>{history?.events.length ? history.events.map(event => <p key={event.id}><time>{date(event.timestamp)}</time> {t(`events.${event.kind}`, { defaultValue: t('events.observed') })}</p>) : <p className="muted">{t('noEvents')}</p>}</div><div><h3>{t('configurationHistory')}</h3>{history?.changes.length ? history.changes.map(change => <details key={change.id}><summary>{date(change.timestamp)} · {t(`results.${change.result}`, { defaultValue: t('results.observed') })}</summary><dl>{Object.entries(JSON.parse(change.result === 'observed' ? change.after ?? '{}' : change.requested)).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{typeof value === 'number' ? number(value) : typeof value === 'boolean' ? t('changed') : String(value)}</dd></div>)}</dl></details>) : <p className="muted">{t('noChanges')}</p>}</div></div>
    </section>}
    <footer id="activity"><span>BitHive <span className="tag">v0.1.0</span></span><span>{t('footer')}</span></footer>
    </main>
  </div>;
}
