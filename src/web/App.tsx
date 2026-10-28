import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { aggregate, averageHashrates, efficiency, type ActionResult, type DeviceView, type Settings } from '../shared/domain';
import { api } from './api';
import { MinerDragHandle } from './MinerDragHandle';
import { moveMiner, orderedMiners, readMinerOrder, saveMinerOrder } from './miner-order';
import { Tuning } from './Tuning';
import { MinerHistory } from './MinerHistory';
import { Disclosure } from './Disclosure';
import { Configuration } from './Configuration';
import { DeviceNaming } from './DeviceNaming';
import { PowerCard } from './PowerCard';
import { readPowerPreferences } from './power-estimate';
import { MinerFacts } from './MinerFacts';
import { TemperatureReading } from './TemperatureReading';
import { HashrateAverages } from './HashrateAverages';
import { PoolProfiles } from './PoolProfiles';
import type { PoolAccounts } from '../shared/pool-profiles';

function route() {
  const hash = location.hash;
  return { page: hash === '#pool-profiles' ? 'pools' : hash === '#activity' ? 'activity' : hash.startsWith('#miner/') ? 'miner' : 'fleet',
    id: hash.startsWith('#miner/') ? hash.slice(7) : null };
}
export function App() {
  const { t, i18n } = useTranslation();
  const [{ page, id: detailId }, setRoute] = useState(route);
  useEffect(() => {
    const navigate = () => { setRoute(route()); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const [batchOpen, setBatchOpen] = useState(false);
  const [activityId, setActivityId] = useState('');
  const [powerBasis, setPowerBasis] = useState<{ enabled: boolean; efficiency: number | null }>(readPowerPreferences);
  const onPowerBasisChange = useCallback((enabled: boolean, value: number | null) => {
    setPowerBasis({ enabled, efficiency: value });
  }, []);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [minerOrder, setMinerOrder] = useState(readMinerOrder);
  const [orderMessage, setOrderMessage] = useState('');
  const draggedMiner = useRef<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
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
  const number = (value: number | null | undefined, digits = 2) => value == null ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t('never');
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'operationFailed');
  async function mutation(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    void mutation(async () => { const device = await api<DeviceView>('/devices', { address, ...(name.trim() ? { name } : {}) }); location.hash = `miner/${device.id}`; setAdding(false); setAddress(''); setName(''); });
  }
  const batch = async (ids: string[], settings?: Settings, customValuesAcknowledged = false, poolAccounts?: PoolAccounts) => {
    setBusy(true); setError('');
    try {
      const results = await api<ActionResult[]>('/batch', { ids, action: settings ? 'configure' : 'refresh', ...(settings && Object.keys(settings).length ? { settings } : {}), ...(poolAccounts ? { poolAccounts } : {}), ...(customValuesAcknowledged ? { customValuesAcknowledged: true } : {}) });
      setResults(results);
      try { await reload(); } catch (error) { fail(error); }
      return results;
    } catch (error) { fail(error); throw error; }
    finally { setBusy(false); }
  };
  const detail = devices.find(d => d.id === detailId);
  const totals = aggregate(devices.filter(d => !d.demo));
  const fleetEfficiency = powerBasis.enabled
    ? powerBasis.efficiency === null || totals.efficiency === null ? null : totals.efficiency / (powerBasis.efficiency / 100)
    : totals.efficiency;
  const demoTotals = aggregate(devices.filter(d => d.demo));
  const ordered = orderedMiners(devices, minerOrder);
  const shown = ordered.filter(d => filter === 'all' || d.status === filter);
  const cancelDrag = () => { draggedMiner.current = null; setDragTarget(null); };
  const reorder = (source: string, target: string) => {
    const ids = ordered.map(d => d.id);
    const next = moveMiner(ids, shown.map(d => d.id), source, target);
    cancelDrag();
    if (next === ids) return;
    setMinerOrder(next);
    setOrderMessage(saveMinerOrder(next) ? 'minerOrderSaved' : 'minerOrderUnsaved');
  };
  const finishDrag = (target: string) => { if (draggedMiner.current) reorder(draggedMiner.current, target); };

  const showDetail = (device: DeviceView) => { location.hash = `miner/${device.id}`; };
  const batchDevice = devices.find(d => selected.includes(d.id) && d.snapshot);
  return <div className="app-shell">
    <aside className="sidebar"><a href="#fleet" className="brand"><svg aria-hidden="true" viewBox="0 0 40 44"><path d="M20 2 37 12v20L20 42 3 32V12Z" fill="currentColor"/><path d="M13 13h9c8 0 9 8 3 10 7 3 4 10-3 10h-9Zm5 5v4h4c3 0 3-4 0-4Zm0 8v3h4c3 0 3-3 0-3Z" fill="#123c50"/></svg>BitHive</a>
      <p className="sidebar-caption">{t('localFleet')}</p><nav aria-label={t('navigation')}><a className={page === 'fleet' ? 'nav-active' : ''} aria-current={page === 'fleet' ? 'page' : undefined} href="#fleet"><span aria-hidden="true">▦</span>{t('fleet')}</a><a className={page === 'pools' ? 'nav-active' : ''} aria-current={page === 'pools' ? 'page' : undefined} href="#pool-profiles"><span aria-hidden="true">⇢</span>{t('poolProfiles')}</a><a className={page === 'activity' ? 'nav-active' : ''} aria-current={page === 'activity' ? 'page' : undefined} href="#activity"><span aria-hidden="true">≋</span>{t('activity')}</a></nav>
      <div className="sidebar-bottom"><span className="local-dot" />{t('localOnly')}<small>{t('collectionHint')}</small></div>
    </aside>
    <main id="fleet"><header><div><p className="eyebrow">{t('workspace')}</p><h1>{page === 'miner' ? detail?.name ?? t('deviceDetail') : t(page === 'pools' ? 'poolProfiles' : page === 'activity' ? 'activity' : 'fleetOverview')}</h1><p className="muted">{t(page === 'pools' ? 'poolProfilesSubtitle' : page === 'miner' ? 'minerPageHint' : page === 'activity' ? 'activityHint' : 'subtitle')}</p></div>
      <div className="toolbar"><label className="language"><span className="sr-only">{t('language')}</span><select value={i18n.resolvedLanguage} onChange={event => void i18n.changeLanguage(event.target.value)}><option value="en">English</option><option value="pt-BR">Português (BR)</option></select></label>
        {page === 'fleet' && <><button disabled={busy} onClick={() => void mutation(() => api('/demo', {}))}>{t('tryDemo')}</button><button className="primary" onClick={() => setAdding(!adding)}>{t('addDevice')}</button></>}</div>
    </header>
    {error && <div className="error-banner" role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</div>}
    {page === 'pools' && <PoolProfiles devices={devices} />}
    {page === 'activity' && <section className="panel activity-panel"><label>{t('device')}<select value={activityId} onChange={event => setActivityId(event.target.value)}><option value="">{t('chooseActivityMiner')}</option>{devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{activityId ? <MinerHistory key={activityId} id={activityId} revision={revision} activity /> : <p className="empty">{t('chooseActivityMiner')}</p>}</section>}
    {page === 'fleet' && <>
    {adding && <form className="add-form panel" onSubmit={add}><h2>{t('addDevice')}</h2><div className="form-grid"><label>{t('optionalDisplayName')}<input placeholder={t('nameFromAxeos')} maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label>{t('deviceAddress')}<input required maxLength={253} placeholder={t('addressPlaceholder')} value={address} onChange={event => setAddress(event.target.value)} /></label></div><p className="muted">{t('registrationHint')}</p><div className="form-actions"><button disabled={busy} className="primary">{busy ? t('working') : t('connectDevice')}</button><button type="button" onClick={() => setAdding(false)}>{t('cancel')}</button></div></form>}
    <section className="summary" aria-label={t('fleetSummary')}>
      <article><span>{t('totalHashrate')}</span><strong>{number(totals.hashRate / 1000)} <small>TH/s</small></strong><p>{t('currentReadings')}</p><HashrateAverages averages={totals.averageHashrates} total={totals.online} /></article>
      <PowerCard power={totals.power} onPowerBasisChange={onPowerBasisChange} partial={devices.some(d => !d.demo && d.status === 'online' && d.snapshot?.power == null)} />
      <article><span>{t('efficiency')}</span><strong>{number(fleetEfficiency)} <small>J/TH</small></strong><p>{powerBasis.enabled ? t('efficiencyWithSupplyLoss') : t('weightedEfficiency')}</p>{totals.incomplete && <p>{t('partialMetrics')}</p>}</article>
      <article className="availability"><span>{t('availability')}</span><strong>{totals.online}<small> / {totals.total}</small></strong><p><span className="local-dot" />{t('onlineDevices')}</p></article>
    </section>
    {!!demoTotals.total && <div className="demo-banner"><strong>{t('demoMode')}</strong><span>{t('demoSummary', { count: demoTotals.total, hash: number(demoTotals.hashRate / 1000), power: number(demoTotals.power) })}</span></div>}
    <section className="panel fleet-panel"><div className="section-title"><div><h2>{t('yourMiners')} <span className="count">{devices.length}</span></h2><p className="muted">{t('tableHint')}</p><p id="miner-order-hint" className="muted miner-order-hint">{t('minerOrderHint')}</p><span className={orderMessage === 'minerOrderUnsaved' ? 'notice' : 'sr-only'} role="status">{orderMessage && t(orderMessage)}</span></div><label><span className="sr-only">{t('filterStatus')}</span><select value={filter} onChange={event => { cancelDrag(); setFilter(event.target.value); }}>{['all', 'online', 'stale', 'offline'].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div>
      {!!selected.length && <div className="batch-bar"><span>{t('selectedCount', { count: selected.length })}</span><button disabled={busy} onClick={() => void batch(selected).catch(() => {})}>{t('refreshSelected')}</button><button onClick={() => setBatchOpen(value => !value)}>{t('configureSelected')}</button><button onClick={() => setSelected([])}>{t('clearSelection')}</button></div>}
      {loading ? <p className="empty" role="status">{t('loading')}</p> : !devices.length ? <div className="empty"><div className="hive-mark" aria-hidden="true">⬡</div><h3>{t('emptyTitle')}</h3><p>{t('emptyHint')}</p><button onClick={() => setAdding(true)} className="primary">{t('addFirst')}</button><button disabled={busy} onClick={() => void mutation(() => api('/demo', {}))}>{t('tryDemo')}</button></div> : <div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label={t('selectAll')} checked={!!shown.length && shown.every(d => selected.includes(d.id))} onChange={event => setSelected(event.target.checked ? shown.slice(0, 50).map(d => d.id) : [])} /></th>{['device', 'status', 'hashrate', 'power', 'inputVoltage', 'efficiency', 'temperature', 'hashErrorPercent', 'lastUpdate'].map(key => <th key={key}>{t(key)}</th>)}</tr></thead><tbody>{shown.map((device, index) => <tr key={device.id} data-miner-id={device.id}
        className={[device.status !== 'online' ? 'stale-row' : '', dragTarget === device.id ? 'miner-drop-target' : ''].join(' ')}
        onDragEnter={event => { if (draggedMiner.current) { event.preventDefault(); setDragTarget(device.id); } }}
        onDragOver={event => { if (draggedMiner.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTarget(device.id); } }}
        onDrop={event => { if (draggedMiner.current) { event.preventDefault(); finishDrag(device.id); } }}><td><div className="miner-row-controls"><MinerDragHandle id={device.id} name={device.name} disabled={shown.length < 2}
          onStart={id => { draggedMiner.current = id; setDragTarget(id); }} onTarget={setDragTarget} onFinish={finishDrag} onCancel={cancelDrag}
          onStep={direction => { const target = shown[index + direction]; if (target) reorder(device.id, target.id); }} /><input type="checkbox" aria-label={t('selectDevice', { name: device.name })} checked={selected.includes(device.id)} disabled={!selected.includes(device.id) && selected.length >= 50} onChange={event => setSelected(current => event.target.checked ? [...current, device.id] : current.filter(id => id !== device.id))} /></div></td>
        <td><button className="device-link" onClick={() => showDetail(device)}>{device.name}</button><small>{device.address} {device.demo && <span className="tag">{t('simulated')}</span>}</small><small>{device.snapshot?.model ?? t('unknownModel')}</small></td>
        <td><span className={`status status-${device.status}`}>{t(device.status)}</span></td><td className="numeric">{number(device.snapshot?.hashRate == null ? null : device.snapshot.hashRate / 1000)}<small>TH/s</small><HashrateAverages averages={averageHashrates([device.snapshot])} total={1} collapsible /></td><td className="numeric">{number(device.snapshot?.power)}<small>W</small></td><td className="numeric">{number(device.snapshot?.inputVoltage)}<small>V</small></td><td className="numeric">{number(efficiency(device.snapshot?.hashRate, device.snapshot?.power))}<small>J/TH</small></td><td className="numeric"><TemperatureReading value={device.snapshot?.temp} sensor="chip" stale={device.status !== 'online'} showUnit={false} /><small>°C</small></td><td className="numeric">{number(device.snapshot?.errorRate)}<small>%</small></td><td className="last-update">{date(device.lastSeen)}</td>
      </tr>)}</tbody></table>{!shown.length && <p className="empty">{t('noMatchingDevices')}</p>}</div>}
      <div className="panel-footer"><span className="local-dot" />{t('refreshHint')}<span>{t('staleHint')}</span></div>
    </section>
    {batchOpen && batchDevice && <section className="panel"><h2>{t('configureSelected')}</h2><p className="muted">{t('batchConfigHint')}</p><Configuration key={`batch-${selected.join(',')}`} device={batchDevice} showRestart={false} count={selected.length} busy={busy} onApply={(settings, acknowledged, accounts) => batch(selected, settings, acknowledged, accounts)} /></section>}
    </>}
    {(page === 'fleet' || page === 'miner') && !!results.length && <section className="panel results" aria-live="polite"><h2>{t('actionResults')}</h2>{results.filter(result => page !== 'miner' || result.id === detailId).map(result => <p key={result.id}><strong>{devices.find(d => d.id === result.id)?.name ?? result.id}</strong><span className={`status status-${result.result === 'verified' || result.result === 'refreshed' ? 'online' : 'stale'}`}>{t(`results.${result.result}`)}</span>{result.reason && <span>{t(`errors.${result.reason}`, { defaultValue: t('errors.operationFailed') })}</span>}</p>)}<p className="muted">{t('uncertainHint')}</p></section>}
    {page === 'miner' && detail && <a className="back-link" href="#fleet">← {t('backToFleet')}</a>}
    {page === 'miner' && !loading && !detail && <p className="notice">{t('errors.notFound')} <a href="#fleet">{t('backToFleet')}</a></p>}
    {page === 'miner' && detail && !detail.snapshot && <p className="notice">{t('staleDeviceHint')}</p>}
    {page === 'miner' && detail?.snapshot && <section className="detail panel" aria-label={t('deviceDetail')}><div className="section-title"><div><p className="eyebrow">{t('deviceDetail')}</p><p className="muted">{detail.snapshot.model} · {detail.address}</p></div></div>
      {detail.status !== 'online' && <p className="notice">{t('staleDeviceHint')}</p>}
      <MinerFacts device={detail} />
      <MinerHistory key={`history-${detail.id}`} id={detail.id} revision={revision} />
      <Disclosure key={`config-${detail.id}`} label={t('configuration')}>
        <DeviceNaming device={detail} busy={busy} onUpdated={() => reload()} />
        <Configuration device={detail} count={1} busy={busy} onUpdated={() => reload()} onApply={(settings, acknowledged, accounts) => batch([detail.id], settings, acknowledged, accounts)} />
      </Disclosure>
      <Disclosure key={`tuning-${detail.id}`} label={t('automaticTuning')}><Tuning device={detail} /></Disclosure>
    </section>}
    <footer><span>BitHive <span className="tag">v0.1.0</span></span><span>{t('footer')}</span></footer>
    </main>
  </div>;
}
