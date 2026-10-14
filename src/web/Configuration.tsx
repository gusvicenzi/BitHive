import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView, Settings } from '../shared/domain';
import { api } from './api';

type SavedProfile = { id: string; name: string; settings: Settings };
export function Configuration({ device, count, busy, onApply }: { device: DeviceView; count: number; busy: boolean; onApply: (settings: Settings) => void }) {
  const { t } = useTranslation();
  const snapshot = device.snapshot!;
  const [values, setValues] = useState<Settings>({});
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValues({}); setProfileError(''); setProfiles([]);
    const abort = new AbortController();
    void api<SavedProfile[]>(`/devices/${device.id}/profiles`, undefined, abort.signal).then(setProfiles).catch(error => { if (!abort.signal.aborted) setProfileError(error.message); });
    return () => abort.abort();
  }, [device.id]);
  const supported = (key: keyof Settings) => snapshot.capabilities.writable.includes(key);
  const set = (key: keyof Settings, value: string, numeric = false) => setValues(previous => {
    const next = { ...previous };
    if (value === '') delete next[key];
    else Object.assign(next, { [key]: numeric ? Number(value) : value });
    return next;
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(values);
    // Clear the submitted draft so an uncertain write cannot be casually replayed.
    setValues({});
  }
  async function saveProfile() {
    setSaving(true); setProfileError('');
    try {
      const settings = Object.fromEntries(Object.entries(values).filter(([key]) => ['frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed'].includes(key)));
      const profile = await api<SavedProfile>(`/devices/${device.id}/profiles`, { name: profileName, settings });
      setProfiles(current => [...current, profile]); setProfileName('');
    } catch (error) { setProfileError(error instanceof Error ? error.message : 'operationFailed'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="configuration">
    <div className="section-title"><div><p className="eyebrow">{t('manualControl')}</p><h3>{t('configuration')}</h3></div><span className="tag">{t('targetCount', { count })}</span></div>
    <p className="muted">{t('configureHint')}</p>
    {count > 1 && <p className="notice">{t('batchHint')}</p>}
    <fieldset disabled={busy || device.status !== 'online'}><legend>{t('operatingProfile')}</legend>
      <div className="form-grid">
        {(['frequency', 'coreVoltage'] as const).map(key => <label key={key}>{t(key)}
          <select disabled={!supported(key)} value={values[key] ?? ''} onChange={event => set(key, event.target.value, true)}>
            <option value="">{t('keepCurrent', { value: snapshot.settings[key] ?? '—' })}</option>
            {(key === 'frequency' ? snapshot.capabilities.frequencies : snapshot.capabilities.voltages).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
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
    <fieldset disabled={busy || device.status !== 'online' || snapshot.capabilities.poolMode === 'none'}><legend>{t('poolPayout')}</legend>
      <p className="muted">{t('payoutHint')}</p><div className="form-grid">
        {(['stratumURL', 'stratumPort', 'stratumUser', 'stratumPassword'] as const).map(key => <label key={key}>{t(key)}
          <input type={key === 'stratumPort' ? 'number' : key === 'stratumPassword' ? 'password' : 'text'} autoComplete="off"
            min={key === 'stratumPort' ? 1 : undefined} max={key === 'stratumPort' ? 65535 : undefined} maxLength={255}
            placeholder={key === 'stratumPassword' ? t('passwordPlaceholder') : String(snapshot.settings[key as keyof typeof snapshot.settings] ?? '')}
            value={values[key] ?? ''} onChange={event => set(key, event.target.value, key === 'stratumPort')} />
        </label>)}
      </div>
    </fieldset>
    <div className="form-actions"><button className="primary" disabled={busy || device.status !== 'online' || !Object.keys(values).length}>{busy ? t('working') : t('applyVerify')}</button><span className="muted">{t('writeVerification')}</span></div>
    <details><summary>{t('savedProfiles')}</summary><div className="profile-controls">
      <label>{t('loadProfile')}<select aria-label={t('loadProfile')} defaultValue="" onChange={event => { const profile = profiles.find(p => p.id === event.target.value); if (profile) setValues(profile.settings); }}>
        <option value="">{t('chooseProfile')}</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <label>{t('profileName')}<input maxLength={80} value={profileName} onChange={event => setProfileName(event.target.value)} /></label>
      <button type="button" disabled={saving || !profileName.trim() || !Object.keys(values).some(key => ['frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed'].includes(key))} onClick={() => void saveProfile()}>{t('saveProfile')}</button>
    </div>{profileError && <p role="alert">{t(`errors.${profileError}`, { defaultValue: t('errors.operationFailed') })}</p>}</details>
    <details><summary>{t('automaticTuning')}</summary><p className="muted">{t('tuningPlanned')}</p></details>
  </form>;
}
