import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView } from '../shared/domain';
import { scheduleSchema, type ScheduleInput, type ScheduleView, type SavedOperatingProfile, type OperatingSettings } from '../shared/schedules';
import { api } from './api';

export function Schedules({ devices }: { devices: DeviceView[] }) {
  const { t, i18n } = useTranslation();
  const empty = (): ScheduleInput => ({ name: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', points: [
    { id: 'day', name: t('schedule.day'), days: [0, 1, 2, 3, 4, 5, 6], time: '08:00' },
    { id: 'night', name: t('schedule.night'), days: [0, 1, 2, 3, 4, 5, 6], time: '22:00' },
  ], members: [] });
  const [schedules, setSchedules] = useState<ScheduleView[]>([]), [loaded, setLoaded] = useState(false);
  const [id, setId] = useState<string | null>(null), [draft, setDraft] = useState<ScheduleInput>(empty);
  const [baseline, setBaseline] = useState('');
  const [profiles, setProfiles] = useState<Record<string, SavedOperatingProfile[]>>({});
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [review, setReview] = useState<'enable' | 'save' | null>(null), [deleting, setDeleting] = useState(false);
  const selected = schedules.find(s => s.id === id);
  const dirty = JSON.stringify(draft) !== baseline;
  const reload = useCallback(async (signal?: AbortSignal) => {
    const data = await api<ScheduleView[]>('/schedules', undefined, signal);
    if (!signal?.aborted) { setSchedules(data); setLoaded(true); }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const update = () => void reload(abort.signal).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    update(); const timer = setInterval(update, 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [reload]);
  const deviceIds = devices.map(d => d.id).join(',');
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(devices.map(async device => [device.id, await api<SavedOperatingProfile[]>(`/devices/${device.id}/profiles`, undefined, abort.signal)] as const))
      .then(entries => { if (!abort.signal.aborted) setProfiles(Object.fromEntries(entries)); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
    // Reload libraries when fleet membership changes, not on telemetry updates.
  }, [deviceIds]);
  function open(schedule?: ScheduleView) {
    const next = schedule ? { name: schedule.name, timeZone: schedule.timeZone, points: schedule.points, members: schedule.members } : empty();
    setId(schedule?.id ?? null); setDraft(next); setBaseline(JSON.stringify(next)); setError(''); setNotice(''); setReview(null); setDeleting(false);
  }
  function change(next: ScheduleInput) { setDraft(next); setReview(null); setNotice(''); }
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'operationFailed'); }
    finally { setBusy(false); }
  }
  async function save() {
    const parsed = scheduleSchema.safeParse(draft);
    if (!parsed.success) { setError('scheduleInvalid'); return; }
    await run(async () => {
      const saved = await api<ScheduleView>(id ? `/schedules/${id}` : '/schedules', parsed.data);
      await reload(); open(saved); setNotice('schedule.saved');
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected?.enabled) setReview('save'); else void save();
  }
  async function action(kind: 'enable' | 'disable' | 'delete') {
    if (!id) return;
    await run(async () => {
      const saved = await api<ScheduleView>(`/schedules/${id}/${kind}`, {});
      await reload(); open(kind === 'delete' ? undefined : saved); setNotice(`schedule.${kind}Done`);
    });
  }
  const date = (at: string, timeZone: string) => new Date(at).toLocaleString(i18n.language, { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const profileFor = (deviceId: string, profileId: string) => profiles[deviceId]?.find(p => p.id === profileId);
  const custom = (device: DeviceView, settings: OperatingSettings) =>
    (settings.frequency !== undefined && !device.snapshot?.capabilities.frequencies.includes(settings.frequency))
      || (settings.coreVoltage !== undefined && !device.snapshot?.capabilities.voltages.includes(settings.coreVoltage));
  const settingsText = (settings: OperatingSettings) => Object.entries(settings).map(([key, value]) => `${t(key)}: ${key === 'autofanspeed' ? t(value === 1 ? 'schedule.auto' : 'schedule.manual') : value}`).join(' · ');
  return <section className="schedules" aria-label={t('schedule.title')}>
    <div className="pool-workflow"><span aria-hidden="true">◷</span><p>{t('schedule.hostHint')}</p></div>
    {error && <p className="error-banner" role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</p>}
    {notice && <p className="notice" role="status">{t(notice)}</p>}
    <section className="panel schedule-library"><div className="section-title"><h2>{t('schedule.library')} <span className="count">{schedules.length}</span></h2><button disabled={busy} onClick={() => open()}>{t('schedule.new')}</button></div>
      {!loaded ? <p role="status">{t('loading')}</p> : !schedules.length ? <p className="muted">{t('schedule.empty')}</p> : <div className="schedule-cards">{schedules.map(s => <button key={s.id} className={`schedule-card${s.id === id ? ' is-selected' : ''}`} aria-pressed={s.id === id} disabled={busy} onClick={() => open(s)}><strong>{s.name}</strong><span>{t(s.enabled ? 'schedule.enabled' : 'schedule.disabled')} · {s.timeZone}</span><small>{t('schedule.current')}: {s.current.name} · {t('schedule.next')}: {s.next.name} {date(s.next.at, s.timeZone)}</small></button>)}</div>}
    </section>
    <form className="panel schedule-editor" onSubmit={submit}><fieldset disabled={busy || !loaded}><legend><h2>{t(id ? 'schedule.edit' : 'schedule.new')}</h2></legend>
      <div className="form-grid"><label>{t('schedule.name')}<input required maxLength={80} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })} /></label><label>{t('schedule.timeZone')}<input required maxLength={100} placeholder="America/Sao_Paulo" value={draft.timeZone} onChange={e => change({ ...draft, timeZone: e.target.value })} /></label></div>
      <p className="muted">{t('schedule.periodHint')}</p>
      <div className="section-title"><h3>{t('schedule.points')}</h3><button type="button" disabled={draft.points.length >= 32} onClick={() => change({ ...draft, points: [...draft.points, { id: crypto.randomUUID(), name: '', days: [0, 1, 2, 3, 4, 5, 6], time: '12:00' }] })}>{t('schedule.addPoint')}</button></div>
      <div className="schedule-timeline">{draft.points.map((point, index) => <div className="schedule-point" key={point.id}>
        <label>{t('schedule.pointName', { index: index + 1 })}<input required maxLength={80} value={point.name} onChange={e => change({ ...draft, points: draft.points.map(p => p.id === point.id ? { ...p, name: e.target.value } : p) })} /></label>
        <label>{t('schedule.changeTime', { index: index + 1 })}<input required type="time" value={point.time} onChange={e => change({ ...draft, points: draft.points.map(p => p.id === point.id ? { ...p, time: e.target.value } : p) })} /></label>
        <fieldset className="schedule-days"><legend>{t('schedule.days')}</legend>{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day}><input type="checkbox" aria-label={t('schedule.weekday', { day: t(`schedule.weekdays.${day}`), index: index + 1 })} checked={point.days.includes(day)} onChange={e => change({ ...draft, points: draft.points.map(p => p.id === point.id ? { ...p, days: e.target.checked ? [...p.days, day] : p.days.filter(d => d !== day) } : p) })} /><span>{t(`schedule.weekdays.${day}`)}</span></label>)}</fieldset>
        <button type="button" disabled={draft.points.length === 1} aria-label={t('schedule.removePoint', { index: index + 1 })} onClick={() => change({ ...draft, points: draft.points.filter(p => p.id !== point.id), members: draft.members.map(m => ({ ...m, assignments: Object.fromEntries(Object.entries(m.assignments).filter(([key]) => key !== point.id)) })) })}>×</button>
      </div>)}</div>
      <h3>{t('schedule.assignments')}</h3><p className="muted">{t('schedule.assignmentHint')}</p>
      {!devices.length && <p className="muted">{t('schedule.noMiners')}</p>}
      <p className="muted schedule-scroll-hint">{t('schedule.scrollHint')}</p>
      <div className="table-scroll schedule-matrix" tabIndex={0} role="region" aria-label={t('schedule.assignments')}><table><thead><tr><th>{t('device')}</th>{draft.points.map(p => <th key={p.id}>{p.time}<small>{p.name}</small></th>)}</tr></thead><tbody>{devices.map(device => {
        const member = draft.members.find(m => m.deviceId === device.id);
        const needsAcknowledgment = !!member && draft.points.some(p => { const profile = profileFor(device.id, member.assignments[p.id]); return profile && custom(device, profile.settings); });
        return <tr key={device.id}><td><label className="schedule-miner"><input type="checkbox" aria-label={t('schedule.selectMiner', { name: device.name })} checked={!!member} onChange={e => change({ ...draft, members: e.target.checked ? [...draft.members, { deviceId: device.id, assignments: {}, customValuesAcknowledged: false }] : draft.members.filter(m => m.deviceId !== device.id) })} /><strong>{device.name}</strong></label><a href={`#miner/${device.id}`}>{t('schedule.manageProfiles')}</a>{needsAcknowledgment && <label className="schedule-ack"><input type="checkbox" checked={member.customValuesAcknowledged} onChange={e => change({ ...draft, members: draft.members.map(m => m.deviceId === device.id ? { ...m, customValuesAcknowledged: e.target.checked } : m) })} />{t('schedule.acknowledge', { name: device.name })}</label>}</td>
          {draft.points.map(point => { const profile = member && profileFor(device.id, member.assignments[point.id]); return <td key={point.id}><select aria-label={t('schedule.profileFor', { miner: device.name, period: point.name || point.time })} disabled={!member} value={member?.assignments[point.id] ?? ''} onChange={e => change({ ...draft, members: draft.members.map(m => m.deviceId === device.id ? { ...m, customValuesAcknowledged: false, assignments: e.target.value ? { ...m.assignments, [point.id]: e.target.value } : Object.fromEntries(Object.entries(m.assignments).filter(([key]) => key !== point.id)) } : m) })}><option value="">{t('chooseProfile')}</option>{profiles[device.id]?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{profile && <small className="schedule-settings">{settingsText(profile.settings)}</small>}{member && profiles[device.id]?.length === 0 && <small>{t('schedule.noProfiles')}</small>}</td>; })}</tr>;
      })}</tbody></table></div>
      <div className="form-actions"><button className="primary">{t(selected?.enabled ? 'schedule.reviewChanges' : 'schedule.save')}</button>{id && <><button type="button" disabled={dirty} onClick={() => selected?.enabled ? void action('disable') : setReview('enable')}>{t(selected?.enabled ? 'schedule.disable' : 'schedule.enable')}</button><button type="button" onClick={() => setDeleting(true)}>{t('schedule.delete')}</button></>}{id && dirty && <span className="muted">{t('schedule.saveFirst')}</span>}</div>
      {review && <section className="schedule-review" aria-label={t('schedule.preview')}><h3>{t('schedule.preview')}</h3><p>{t('schedule.enableHint')}</p>{draft.members.map(m => <div key={m.deviceId}><h4>{devices.find(d => d.id === m.deviceId)?.name}</h4>{draft.points.map(p => { const profile = profileFor(m.deviceId, m.assignments[p.id]); return <p key={p.id}><strong>{p.time} · {p.name} → {profile?.name ?? t('chooseProfile')}</strong><small className="schedule-settings">{profile && settingsText(profile.settings)}</small></p>; })}</div>)}<div className="form-actions"><button className="primary" type="button" onClick={() => review === 'save' ? void save() : void action('enable')}>{t(review === 'save' ? 'schedule.confirmSave' : 'schedule.confirmEnable')}</button><button type="button" onClick={() => setReview(null)}>{t('cancel')}</button></div></section>}
      {deleting && <div className="schedule-review"><p>{t('schedule.deleteHint')}</p><button type="button" onClick={() => void action('delete')}>{t('schedule.confirmDelete')}</button><button type="button" onClick={() => setDeleting(false)}>{t('cancel')}</button></div>}
    </fieldset></form>
    {selected && <section className="panel schedule-status"><h2>{t('schedule.execution')}</h2><p className="muted">{selected.timeZone} · {t('schedule.current')}: {selected.current.name} · {t('schedule.next')}: {selected.next.name} {date(selected.next.at, selected.timeZone)}</p>{selected.results.map(result => <div key={result.deviceId}><strong>{devices.find(d => d.id === result.deviceId)?.name} → {result.profileName ?? '—'}</strong><span className={`schedule-result result-${result.status}`}>{t(`schedule.status.${result.status}`)}</span>{result.reason && <small>{t(`errors.${result.reason}`, { defaultValue: t('errors.operationFailed') })}</small>}{result.overrideUntil && result.status === 'manual' && <small>{t('schedule.overrideUntil', { time: date(result.overrideUntil, selected.timeZone) })}</small>}</div>)}</section>}
  </section>;
}
