import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView } from '../shared/domain';
import { poolProfileSchema, poolSettingsFrom, type PoolProfile, type PoolTarget } from '../shared/pool-profiles';
import { api } from './api';

export function PoolProfiles({ devices }: { devices: DeviceView[] }) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<PoolProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [port, setPort] = useState('3333');
  const [user, setUser] = useState('');
  const [source, setSource] = useState('');
  const [copyTarget, setCopyTarget] = useState<PoolTarget>('primary');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void api<PoolProfile[]>('/pool-profiles', undefined, abort.signal).then(data => { setProfiles(data); setLoaded(true); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, []);
  const eligible = devices.filter(d => d.snapshot && poolSettingsFrom(d.snapshot.settings, copyTarget));
  function open(profile?: PoolProfile) {
    setId(profile?.id ?? null); setName(profile?.name ?? '');
    setUrl(profile?.settings.stratumURL ?? ''); setPort(String(profile?.settings.stratumPort ?? 3333));
    setUser(profile?.settings.stratumUser ?? ''); setSource(''); setError(''); setNotice(''); setDeleting(false);
  }
  function copy(deviceId: string) {
    setSource(deviceId); setError(''); setNotice('');
    const device = eligible.find(d => d.id === deviceId);
    if (!device?.snapshot) return;
    const settings = poolSettingsFrom(device.snapshot.settings, copyTarget)!;
    setUrl(settings.stratumURL); setPort(String(settings.stratumPort)); setUser(settings.stratumUser);
    if (!name.trim()) setName(device.name);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    const parsed = poolProfileSchema.safeParse({ name, settings: { stratumURL: url, stratumPort: Number(port), stratumUser: user } });
    if (!parsed.success) { setError('invalidInput'); return; }
    setBusy(true);
    try {
      const profile = await api<PoolProfile>(id ? `/pool-profiles/${id}` : '/pool-profiles', parsed.data);
      setProfiles(current => id ? current.map(p => p.id === id ? profile : p) : [...current, profile]);
      setId(profile.id); setName(profile.name); setNotice('poolProfileSaved'); setSource(''); setDeleting(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'operationFailed'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!id) return;
    setBusy(true); setError('');
    try { await api(`/pool-profiles/${id}/delete`, {}); setProfiles(current => current.filter(p => p.id !== id)); open(); setNotice('poolProfileDeleted'); }
    catch (e) { setError(e instanceof Error ? e.message : 'operationFailed'); }
    finally { setBusy(false); }
  }
  return <section className="pool-profiles" aria-label={t('poolProfiles')}>
    <div className="pool-workflow"><span aria-hidden="true">⇢</span><p>{t('poolProfilesWorkflow')}</p><a href="#fleet">{t('viewFleet')} →</a></div>
    {error && <p className="error-banner" role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</p>}
    {notice && <p className="notice" role="status">{t(notice)}</p>}
    <div className="pool-layout"><section className="panel pool-library"><div className="section-title"><h2>{t('poolLibrary')} <span className="count">{profiles.length}</span></h2><button type="button" disabled={busy} onClick={() => open()}>{t('newPoolProfile')}</button></div>
      {!loaded && !error ? <p className="empty" role="status">{t('loading')}</p> : !profiles.length ? <div className="empty"><h3>{t('noPoolProfiles')}</h3><p>{t('noPoolProfilesHint')}</p></div> : <div className="pool-profile-list">{profiles.map(p => <button type="button" key={p.id} className={id === p.id ? 'pool-profile is-selected' : 'pool-profile'} aria-pressed={id === p.id} disabled={busy} onClick={() => open(p)}><strong>{p.name}</strong><span className="pool-endpoint">{p.settings.stratumURL}<span>:{p.settings.stratumPort}</span></span><small>{p.settings.stratumUser}</small></button>)}</div>}
    </section>
    <form className="panel pool-editor" onSubmit={event => void save(event)}><fieldset disabled={busy || !loaded}><legend><h2>{t(id ? 'editPoolProfile' : 'newPoolProfile')}</h2></legend>
      <label>{t('copyPoolSource')}<select value={copyTarget} onChange={event => { setCopyTarget(event.target.value as PoolTarget); setSource(''); setNotice(''); }}><option value="primary">{t('primaryPool')}</option><option value="fallback">{t('fallbackPool')}</option></select></label>
      <label>{t('copyFromBitaxe')}<select value={source} onChange={event => copy(event.target.value)}><option value="">{t('chooseBitaxe')}</option>{eligible.map(d => <option key={d.id} value={d.id}>{d.name} · {d.address}{d.status !== 'online' ? ` · ${t(d.status)}` : ''}</option>)}</select></label>
      <p className="muted">{t('poolCopyHint')}</p>{source && <p className="notice">{t('poolCopiedHint')}</p>}
      <label>{t('poolProfileName')}<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="pool-fields"><label>{t('stratumURL')}<input required maxLength={255} value={url} onChange={e => setUrl(e.target.value)} placeholder="pool.example.com" /></label><label>{t('stratumPort')}<input required type="number" min="1" max="65535" step="1" value={port} onChange={e => setPort(e.target.value)} /></label></div>
      <label>{t('stratumUser')}<input required maxLength={255} value={user} onChange={e => setUser(e.target.value)} /></label>
      <p className="muted">{t('poolCredentialsHint')}</p>
      <div className="form-actions"><button className="primary" disabled={!name.trim() || !url.trim() || !user.trim()}>{busy ? t('working') : t('savePoolProfile')}</button>{id && <button type="button" onClick={() => setDeleting(true)}>{t('deletePoolProfile')}</button>}</div>
      {deleting && <div className="pool-delete"><p>{t('deletePoolProfileConfirm', { name })}</p><div className="form-actions"><button type="button" onClick={() => void remove()}>{t('confirmDeletePoolProfile')}</button><button type="button" onClick={() => setDeleting(false)}>{t('cancel')}</button></div></div>}
    </fieldset></form></div>
  </section>;
}
