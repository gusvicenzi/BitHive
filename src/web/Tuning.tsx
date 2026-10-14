import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView } from '../shared/domain';
import { preview, tuningConfigSchema, type TuningRunView, type TuningAttempt, type WinnerCategory } from '../shared/tuning';
import { api } from './api';

type Results = { winners?: TuningAttempt[]; attempts: TuningAttempt[]; total: number; offset: number; limit: number };
const fields = ['frequencyMin', 'frequencyMax', 'frequencyStep', 'voltageMin', 'voltageMax', 'voltageStep',
  'maxAsicTemperature', 'maxVrmTemperature', 'maxErrorPercentage', 'tolerance', 'stabilizationSeconds', 'measurementSeconds'] as const;
type Field = typeof fields[number];
export function Tuning({ device }: { device: DeviceView }) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<Field, string>>({ frequencyMin: '', frequencyMax: '', frequencyStep: '', voltageMin: '', voltageMax: '', voltageStep: '',
    maxAsicTemperature: '', maxVrmTemperature: '', maxErrorPercentage: '', tolerance: '5', stabilizationSeconds: '120', measurementSeconds: '300' });
  const [mode, setMode] = useState('complete'), [fanMode, setFanMode] = useState('automatic'), [fan, setFan] = useState('');
  const [source, setSource] = useState(device.snapshot?.expectedHashrate ? 'firmware' : 'reference');
  const [reference, setReference] = useState(''), [referenceFrequency, setReferenceFrequency] = useState('');
  const [runs, setRuns] = useState<TuningRunView[]>([]), [selected, setSelected] = useState('');
  const [results, setResults] = useState<Results>({ attempts: [], total: 0, offset: 0, limit: 100 });
  const [offset, setOffset] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const requestKey = useRef<string | null>(null);
  const run = runs.find(r => r.id === selected) ?? runs[0];
  const active = !!run && !['completed', 'stopped', 'failed'].includes(run.state.phase);
  const config = tuningConfigSchema.safeParse({
    frequency: { minimum: Number(values.frequencyMin), maximum: Number(values.frequencyMax), step: Number(values.frequencyStep) },
    voltage: { minimum: Number(values.voltageMin), maximum: Number(values.voltageMax), step: Number(values.voltageStep) },
    ...Object.fromEntries(fields.slice(6).map(key => [key, values[key].trim() ? Number(values[key]) : undefined])), mode,
    fan: fanMode === 'automatic' ? { mode: 'automatic' } : { mode: 'fixed', percentage: fan.trim() ? Number(fan) : undefined },
    expected: source === 'firmware' ? { source } : { source, ths: Number(reference), frequency: Number(referenceFrequency) },
  });
  const range = config.success ? preview(config.data) : null;
  const number = (value?: number | null, digits = 2) => value == null ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const reason = (value: string | null) => value ? t(`tuner.reasons.${value}`, { defaultValue: t('errors.operationFailed') }) : '—';
  async function refresh() {
    const data = await api<TuningRunView[]>(`/devices/${device.id}/tuning`);
    setRuns(data);
    const current = data.find(r => r.id === selected) ?? data[0];
    if (current) setResults(await api<Results>(`/devices/${device.id}/tuning/${current.id}/results?offset=${offset}`));
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await api<TuningRunView[]>(`/devices/${device.id}/tuning`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setRuns(data);
        const current = data.find(r => r.id === selected) ?? data[0];
        if (current) setResults(await api<Results>(`/devices/${device.id}/tuning/${current.id}/results?offset=${offset}`, undefined, controller.signal));
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'operationFailed'); }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2000);
    };
    void load();
    const clockTimer = setInterval(() => setClock(Date.now()), 1000);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clockTimer); };
  }, [device.id, selected, offset]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'operationFailed'); } finally { setBusy(false); }
  }
  function start(event: FormEvent) {
    event.preventDefault();
    if (!config.success) { setError('invalidInput'); return; }
    requestKey.current ??= crypto.randomUUID();
    void action(async () => {
      const created = await api<TuningRunView>(`/devices/${device.id}/tuning`, { requestKey: requestKey.current, config: config.data });
      setSelected(created.id); setOffset(0); requestKey.current = null;
    });
  }
  function control(control: 'pause' | 'resume' | 'stop') { if (run) void action(() => api(`/devices/${device.id}/tuning/${run.id}/${control}`, {})); }
  const winner = (category: WinnerCategory) => {
    const id = run?.state.winners[category];
    const attempt = (results.winners ?? results.attempts).find(a => a.id === id);
    return <article className="tuning-winner" key={category}><h4>{t(`tuner.${category}`)}</h4>
      {id ? <><p>{attempt ? `${number(attempt.summary?.ths)} TH/s · ${number(attempt.summary?.efficiency)} J/TH` : t('tuner.confirmed')}</p>
        {attempt && <p>{attempt.profile.frequency} MHz · {attempt.profile.coreVoltage} mV</p>}
        <button type="button" disabled={busy || active || run?.state.safetyStop} onClick={() => void action(() => api(`/devices/${device.id}/tuning/${run!.id}/apply`, { category }))}>{t('tuner.applyWinner')}</button></> : <p>{t('tuner.noWinner')}</p>}
    </article>;
  };
  return <section className="tuning" aria-label={t('automaticTuning')}>
    <div className="section-title"><h3>{t('automaticTuning')}</h3><span className="tag">{t('tuner.oneMiner')}</span></div>
    <p className="muted">{t('tuner.hostRequired')}</p>
    {!device.demo && <p className="notice">{t('tuner.physicalGate')}</p>}
    {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t(`tuner.reasons.${error}`, { defaultValue: t('errors.operationFailed') }) })}</p>}
    <details open={!run}><summary>{t('tuner.setup')}</summary><form onSubmit={start}>
      <fieldset disabled={busy || active || !device.demo}><legend>{t('tuner.bounds')}</legend><div className="form-grid">
        {fields.map(key => <label key={key}>{t(`tuner.fields.${key}`)}<input type="number" required min={key === 'maxErrorPercentage' || key === 'tolerance' ? 0 : key.endsWith('Seconds') ? 5 : key.includes('Temperature') ? 0.001 : 1}
          max={key === 'maxErrorPercentage' || key === 'tolerance' ? 100 : undefined}
          step={key.endsWith('Seconds') ? 5 : key.includes('Temperature') || key === 'maxErrorPercentage' || key === 'tolerance' ? 'any' : 1}
          value={values[key]} onChange={event => { requestKey.current = null; setValues(v => ({ ...v, [key]: event.target.value })); }} /></label>)}
        <label>{t('tuner.mode')}<select value={mode} onChange={e => setMode(e.target.value)}><option value="complete">{t('tuner.complete')}</option><option value="fast">{t('tuner.fast')}</option></select></label>
        <label>{t('tuner.fan')}<select value={fanMode} onChange={e => setFanMode(e.target.value)}><option value="automatic">{t('automatic')}</option><option value="fixed">{t('manual')}</option></select></label>
        {fanMode === 'fixed' && <label>{t('manualFanSpeed')}<input required type="number" min="0" max="100" step="1" value={fan} onChange={e => setFan(e.target.value)} /></label>}
        <label>{t('tuner.expected')}<select value={source} onChange={e => setSource(e.target.value)}><option value="firmware" disabled={!device.snapshot?.expectedHashrate}>{t('tuner.firmware')}</option><option value="reference">{t('tuner.reference')}</option></select></label>
        {source === 'reference' && <><label>{t('tuner.referenceThs')}<input required type="number" min="0.001" step="any" value={reference} onChange={e => setReference(e.target.value)} /></label><label>{t('tuner.referenceFrequency')}<input required type="number" min="1" step="1" value={referenceFrequency} onChange={e => setReferenceFrequency(e.target.value)} /></label></>}
      </div></fieldset>
      {range && <p className="notice" role="status">{t('tuner.preview', { fmin: range.frequencies[0], fmax: range.frequencies.at(-1), vmin: range.voltages[0], vmax: range.voltages.at(-1), count: range.count, minutes: number(Math.ceil(range.seconds / 60), 0) })}</p>}
      <button className="primary" disabled={busy || active || !device.demo || !config.success}>{t('tuner.start')}</button>
    </form></details>
    {!!runs.length && <label>{t('tuner.runs')}<select value={run?.id ?? ''} onChange={e => { setSelected(e.target.value); setOffset(0); }}>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString(i18n.language)} · {t(`tuner.phases.${r.state.phase}`)}</option>)}</select></label>}
    {run && <><div className={`tuning-progress ${run.state.phase === 'recovery_required' ? 'notice' : ''}`} aria-live="polite">
      <h4>{t(`tuner.phases.${run.state.phase}`)}</h4>
      <p>{run.state.profile.frequency} MHz · {run.state.profile.coreVoltage} mV · {run.state.profile.autofanspeed ? t('automatic') : `${run.state.profile.manualFanSpeed}%`}</p>
      {run.state.deadline && <p>{t('tuner.remaining', { seconds: Math.max(0, Math.ceil((run.state.deadline - clock) / 1000)) })}</p>}
      <p>{number(run.state.live?.ths)} TH/s · {number(run.state.live?.watts)} W · {number(run.state.live?.asic)} °C ASIC · {number(run.state.live?.vrm)} °C VRM · {number(run.state.live?.error)} %</p>
      <p>{t('tuner.recovery')}: {t(`tuner.recoveryStates.${run.state.recovery.status}`)} · {reason(run.state.reason)}</p>
      <div className="form-actions"><button type="button" disabled={busy || !active || ['paused', 'recovery_required'].includes(run.state.phase)} onClick={() => control('pause')}>{t('tuner.pause')}</button>
        <button type="button" disabled={busy || run.state.phase !== 'paused' || run.state.safetyStop} onClick={() => control('resume')}>{t('tuner.resume')}</button>
        <button type="button" disabled={busy || !active} onClick={() => control('stop')}>{t('tuner.stop')}</button></div>
    </div><p className="muted">{t(run.config.mode === 'fast' ? 'tuner.fastClaim' : 'tuner.completeClaim')}</p>
      <div className="tuning-winners">{winner('hashrate')}{winner('efficiency')}</div>
      <div className="table-scroll"><table><caption>{t('tuner.attempts')}</caption><thead><tr>{['kind', 'profile', 'duration', 'ths', 'attainment', 'watts', 'efficiency', 'error', 'rejects', 'asic', 'vrm', 'outcome', 'reason'].map(key => <th key={key}>{t(`tuner.columns.${key}`)}</th>)}</tr></thead>
        <tbody>{results.attempts.map(a => <tr key={a.id}><td>{t(`tuner.kinds.${a.kind}`)}<small>{t(`tuner.${run.config.expected.source}`)}</small></td>
          <td>{a.profile.frequency} MHz / {a.profile.coreVoltage} mV<small>{a.profile.autofanspeed ? t('automatic') : `${a.profile.manualFanSpeed}%`}</small></td>
          <td>{number(a.summary?.duration, 0)} s</td><td>{number(a.summary?.ths)}</td><td>{number(a.summary?.attainment)} %</td><td>{number(a.summary?.watts)}</td><td>{number(a.summary?.efficiency)}</td>
          <td>{number(a.summary?.error)} / {number(a.summary?.peakError)} %</td><td>{number(a.summary?.rejects)}{a.summary?.rejects != null ? ' %' : ''}</td>
          <td>{number(a.summary?.asic)} / {number(a.summary?.peakAsic)} °C</td><td>{number(a.summary?.vrm)} / {number(a.summary?.peakVrm)} °C</td>
          <td>{t(`tuner.outcomes.${a.outcome}`)}{a.outcome === 'invalid' || a.outcome === 'pending' ? <small>{t('tuner.incomplete')}</small> : null}</td><td>{reason(a.reason)}</td></tr>)}</tbody></table></div>
      <div className="form-actions"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('tuner.previous')}</button><span>{t('tuner.resultCount', { count: results.total })}</span><button disabled={offset + 100 >= results.total} onClick={() => setOffset(offset + 100)}>{t('tuner.next')}</button></div>
    </>}
  </section>;
}
