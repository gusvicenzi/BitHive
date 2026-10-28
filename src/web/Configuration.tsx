import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView, Settings } from '../shared/domain';
import { api } from './api';
import { poolFields, poolSettingsFor, type PoolProfile, type PoolTarget } from '../shared/pool-profiles';

type SavedProfile = { id: string; name: string; settings: Settings };
export function Configuration({ device, count, busy, onApply }: { device: DeviceView; count: number; busy: boolean; onApply: (settings: Settings, customValuesAcknowledged?: boolean) => void }) {
  const { t } = useTranslation();
  const snapshot = device.snapshot!;
  const [customValuesAcknowledged, setCustomValuesAcknowledged] = useState(false);
  const [values, setValues] = useState<Settings>({});
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [poolProfiles, setPoolProfiles] = useState<PoolProfile[]>([]);
  const [poolProfileId, setPoolProfileId] = useState('');
  const [poolError, setPoolError] = useState('');
  const [fallbackProfileId, setFallbackProfileId] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void api<PoolProfile[]>('/pool-profiles', undefined, abort.signal).then(setPoolProfiles)
      .catch(e => { if (!abort.signal.aborted) setPoolError(e.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setValues({}); setCustomValuesAcknowledged(false); setProfileError(''); setProfiles([]);
    const abort = new AbortController();
    void api<SavedProfile[]>(`/devices/${device.id}/profiles`, undefined, abort.signal).then(setProfiles).catch(error => { if (!abort.signal.aborted) setProfileError(error.message); });
    return () => abort.abort();
  }, [device.id]);
  const supported = (key: keyof Settings) => snapshot.capabilities.writable.includes(key);
  const profileSettings = Object.fromEntries(
    (['frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed'] as const)
      .filter(key => supported(key) && (values[key] ?? snapshot.settings[key]) !== undefined
        && (key !== 'manualFanSpeed' || (values.autofanspeed ?? snapshot.settings.autofanspeed) === 0))
      .map(key => [key, values[key] ?? snapshot.settings[key]]),
  );
  const set = (key: keyof Settings, value: string, numeric = false) => setValues(previous => {
    const next = { ...previous };
    if (value === '') delete next[key];
    else Object.assign(next, { [key]: numeric ? Number(value) : value });
    return next;
  });
  const options = (key: 'frequency' | 'coreVoltage') => key === 'frequency' ? snapshot.capabilities.frequencies : snapshot.capabilities.voltages;
  const needsAcknowledgement = (['frequency', 'coreVoltage'] as const).some(key => values[key] !== undefined && !options(key).includes(values[key]!));
  function toggleCustom(enabled: boolean) {
    setCustomValuesAcknowledged(enabled);
    if (!enabled) setValues(previous => {
      const next = { ...previous };
      for (const key of ['frequency', 'coreVoltage'] as const) if (next[key] !== undefined && !options(key).includes(next[key]!)) delete next[key];
      return next;
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (needsAcknowledgement && !customValuesAcknowledged) return;
    if (customValuesAcknowledged) onApply(values, true); else onApply(values);
    // Clear the submitted draft so an uncertain write cannot be casually replayed.
    setValues({}); setPoolProfileId(''); setFallbackProfileId('');
  }
  function loadPoolProfile(id: string, target: PoolTarget) {
    if (target === 'primary') setPoolProfileId(id); else setFallbackProfileId(id);
    const profile = poolProfiles.find(p => p.id === id);
    if (profile) setValues(current => {
      const next = { ...current, ...poolSettingsFor(profile.settings, target) };
      delete next[poolFields[target][3]];
      return next;
    });
  }
  async function saveProfile() {
    setSaving(true); setProfileError('');
    try {
      const profile = await api<SavedProfile>(`/devices/${device.id}/profiles`, { name: profileName.trim(), settings: profileSettings });
      setProfiles(current => [...current, profile]); setProfileName('');
    } catch (error) { setProfileError(error instanceof Error ? error.message : 'operationFailed'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="configuration">
    <div className="section-title"><div><p className="eyebrow">{t('manualControl')}</p><h3>{t('configuration')}</h3></div><span className="tag">{t('targetCount', { count })}</span></div>
    <p className="muted">{t('configureHint')}</p>
    {count > 1 && <p className="notice">{t('batchHint')}</p>}
    <fieldset disabled={busy || device.status !== 'online'}><legend>{t('operatingProfile')}</legend>
      <div className="custom-values-control">
        <label className="custom-values-switch"><input type="checkbox" role="switch" checked={customValuesAcknowledged} onChange={event => toggleCustom(event.target.checked)} aria-describedby={`custom-values-${device.id}`} />{t('customValuesAcknowledgement')}</label>
        <p id={`custom-values-${device.id}`} className="muted">{t('customValuesHint')}</p>
      </div>
      <div className="form-grid">
        {(['frequency', 'coreVoltage'] as const).map(key => <label key={key}>{t(key)}
          {customValuesAcknowledged ? <input type="number" min="1" max="65535" step="1" disabled={!supported(key)} placeholder={String(snapshot.settings[key] ?? '')} value={values[key] ?? ''} onChange={event => set(key, event.target.value, true)} /> : <select disabled={!supported(key)} value={values[key] ?? ''} onChange={event => set(key, event.target.value, true)}>
            <option value="">{t('keepCurrent', { value: snapshot.settings[key] ?? '—' })}</option>
            {values[key] !== undefined && !options(key).includes(values[key]!) && <option value={values[key]}>{t('customValueRequiresAcknowledgement', { value: values[key] })}</option>}
            {options(key).map(value => <option key={value} value={value}>{value}</option>)}
          </select>}
        </label>)}
        <label>{t('autofanspeed')}<select disabled={!supported('autofanspeed')} value={values.autofanspeed ?? ''} onChange={event => set('autofanspeed', event.target.value, true)}>
          <option value="">{t('keepCurrent', { value: snapshot.settings.autofanspeed === 1 ? t('automatic') : t('manual') })}</option>
          <option value="1">{t('automatic')}</option><option value="0">{t('manual')}</option>
        </select></label>
        <label>{t('manualFanSpeed')}<input type="number" min="0" max="100" step="1" disabled={!supported('manualFanSpeed') || (values.autofanspeed ?? snapshot.settings.autofanspeed) !== 0}
          placeholder={String(snapshot.settings.manualFanSpeed ?? '')} value={values.manualFanSpeed ?? ''} onChange={event => set('manualFanSpeed', event.target.value, true)} /></label>
      </div>
      {(!supported('frequency') || !supported('coreVoltage')) && <p className="notice">{t('unsupportedTuning')}</p>}
    </fieldset>
    {(['primary', 'fallback'] as const).map(target => {
      const fields = poolFields[target];
      const fallback = target === 'fallback';
      const mode = fallback ? snapshot.capabilities.fallbackPoolMode ?? 'none' : snapshot.capabilities.poolMode;
      const profileId = fallback ? fallbackProfileId : poolProfileId;
      return <fieldset key={target} disabled={busy || device.status !== 'online' || mode === 'none'}><legend>{t(fallback ? 'fallbackPool' : 'poolPayout')}</legend>
        <div className="pool-load"><label>{t(fallback ? 'loadFallbackPoolProfile' : 'loadPoolProfile')}<select value={profileId} onChange={event => {
          loadPoolProfile(event.target.value, target);
        }}><option value="">{t('choosePoolProfile')}</option>{poolProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><a href="#pool-profiles">{t('managePoolProfiles')}</a></div>
        {poolError && <p role="alert">{t(`errors.${poolError}`, { defaultValue: t('errors.operationFailed') })}</p>}
        {profileId && <p className="notice">{t(fallback ? 'fallbackProfileReview' : 'poolProfileReview')}</p>}
        <p className="muted">{t(fallback ? mode === 'none' ? 'fallbackUnavailable' : 'fallbackPayoutHint' : 'payoutHint')}</p><div className="form-grid">
          {fields.map((key, index) => <label key={key}>{t(key)}
            <input type={index === 1 ? 'number' : index === 3 ? 'password' : 'text'} autoComplete="off"
              min={index === 1 ? 1 : undefined} max={index === 1 ? 65535 : undefined} maxLength={255}
              placeholder={index === 3 ? t('passwordPlaceholder') : String(snapshot.settings[key as keyof typeof snapshot.settings] ?? '')}
              value={values[key] ?? ''} onChange={event => set(key, event.target.value, index === 1)} />
          </label>)}
        </div>
      </fieldset>;
    })}
    <div className="form-actions"><button className="primary" disabled={busy || device.status !== 'online' || !Object.keys(values).length || (needsAcknowledgement && !customValuesAcknowledged)}>{busy ? t('working') : t('applyVerify')}</button><span className="muted">{t('writeVerification')}</span></div>
    <details><summary>{t('savedProfiles')}</summary><p className="muted">{t('saveProfileHint')}</p><div className="profile-controls">
      <label>{t('loadProfile')}<select aria-label={t('loadProfile')} defaultValue="" onChange={event => { const profile = profiles.find(p => p.id === event.target.value); if (profile) setValues(profile.settings); }}>
        <option value="">{t('chooseProfile')}</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <label>{t('profileName')}<input maxLength={80} value={profileName} onChange={event => setProfileName(event.target.value)} /></label>
      <button type="button" disabled={saving || !profileName.trim() || !Object.keys(profileSettings).length} onClick={() => void saveProfile()}>{t('saveProfile')}</button>
    </div>{profileError && <p role="alert">{t(`errors.${profileError}`, { defaultValue: t('errors.operationFailed') })}</p>}</details>
  </form>;
}
