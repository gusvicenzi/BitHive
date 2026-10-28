import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionResult, DeviceView, Settings } from '../shared/domain';
import { api } from './api';
import { poolFields, poolSettingsFor, poolWorkerName, type PoolAccounts, type PoolProfile, type PoolTarget } from '../shared/pool-profiles';

import { RestartMiner } from './RestartMiner';
import { draftChanges, draftFrom, isSecret, type ConfigurationDraft } from './configuration-draft';

type SavedProfile = { id: string; name: string; settings: Settings };
export function Configuration({ device, count, busy, onApply, onUpdated, showRestart = true }: { device: DeviceView; count: number; busy: boolean; onApply: (settings: Settings, customValuesAcknowledged?: boolean, poolAccounts?: PoolAccounts) => void | Promise<ActionResult[]>; onUpdated?: () => Promise<void>; showRestart?: boolean }) {
  const { t } = useTranslation();
  const snapshot = device.snapshot!;
  const [customValuesAcknowledged, setCustomValuesAcknowledged] = useState(false);
  const [draft, setDraft] = useState<ConfigurationDraft>({});
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState('');
  const locked = busy || applying;
  const [profiles, setProfiles] = useState<SavedProfile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [poolProfiles, setPoolProfiles] = useState<PoolProfile[]>([]);
  const [poolProfileId, setPoolProfileId] = useState('');
  const [poolError, setPoolError] = useState('');
  const [fallbackProfileId, setFallbackProfileId] = useState('');
  const poolAccounts: PoolAccounts = {};
  const activeDraft = { ...draft };
  let workerError = '';
  for (const target of ['primary', 'fallback'] as const) {
    const id = target === 'primary' ? poolProfileId : fallbackProfileId;
    const profile = poolProfiles.find(p => p.id === id);
    if (!profile) continue;
    try {
      const generated = poolSettingsFor(profile.settings, target, snapshot.hostname ?? '');
      const userKey = poolFields[target][2];
      activeDraft[userKey] = String(generated[userKey]);
      poolAccounts[target] = profile.settings.stratumAccount;
    } catch (error) { workerError = error instanceof Error ? error.message : 'poolWorkerInvalid'; }
  }
  const changes = draftChanges(activeDraft, snapshot.settings, count > 1);
  const values = Object.fromEntries(Object.entries(activeDraft).map(([key, value]) => [key, ['frequency', 'coreVoltage', 'autofanspeed', 'manualFanSpeed', 'stratumPort', 'fallbackStratumPort'].includes(key) ? Number(value) : value])) as Settings;
  const inputValue = (key: keyof Settings) => activeDraft[key] ?? (isSecret(key) ? '' : String(snapshot.settings[key as keyof typeof snapshot.settings] ?? ''));
  const inputState = (key: keyof Settings) => ({ className: changes.dirty.includes(key) ? 'config-input is-dirty' : 'config-input', 'aria-describedby': changes.dirty.includes(key) ? `unsaved-${device.id}` : undefined });
  useEffect(() => {
    const abort = new AbortController();
    void api<PoolProfile[]>('/pool-profiles', undefined, abort.signal).then(setPoolProfiles)
      .catch(e => { if (!abort.signal.aborted) setPoolError(e.message); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setDraft({}); setCustomValuesAcknowledged(false); setProfileError(''); setProfiles([]);
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
  const set = (key: keyof Settings, value: string) => { setApplyMessage(''); setDraft(previous => {
    const next = { ...previous, [key]: value };
    if (value === String(snapshot.settings[key as keyof typeof snapshot.settings] ?? '') || (isSecret(key) && value === '')) delete next[key];
    if (key === 'autofanspeed' && value === '1') delete next.manualFanSpeed;
    return next;
  }); };
  const options = (key: 'frequency' | 'coreVoltage') => key === 'frequency' ? snapshot.capabilities.frequencies : snapshot.capabilities.voltages;
  const needsAcknowledgement = (['frequency', 'coreVoltage'] as const).some(key => changes.settings[key] !== undefined && !options(key).includes(changes.settings[key]!));
  function toggleCustom(enabled: boolean) {
    setCustomValuesAcknowledged(enabled);
    if (!enabled) setDraft(previous => {
      const next = { ...previous };
      for (const key of ['frequency', 'coreVoltage'] as const) if (next[key] !== undefined && !options(key).includes(Number(next[key]))) delete next[key];
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (workerError || !changes.valid || !!workerError || locked || (needsAcknowledgement && !customValuesAcknowledged)) return;
    setApplying(true); setApplyMessage('');
    try {
      const requested = { ...changes.settings };
      if (poolAccounts.primary !== undefined) delete requested.stratumUser;
      if (poolAccounts.fallback !== undefined) delete requested.fallbackStratumUser;
      const results = Object.keys(poolAccounts).length
        ? await onApply(requested, customValuesAcknowledged || undefined, poolAccounts)
        : customValuesAcknowledged ? await onApply(requested, true) : await onApply(requested);
      const result = results?.find(result => result.id === device.id);
      if (result?.result === 'rejected') { setApplyMessage('configurationRejected'); return; }
      setApplyMessage(result && result.result !== 'verified' ? 'configurationUncertain' : 'configurationSavedRestart');
      // Discard the attempted draft and secrets after dispatch; uncertain commands are never casually replayed.
      setDraft({}); setPoolProfileId(''); setFallbackProfileId('');
    } catch { setDraft({}); setPoolProfileId(''); setFallbackProfileId(''); setApplyMessage('configurationUncertain'); }
    finally { setApplying(false); }
  }
  function loadPoolProfile(id: string, target: PoolTarget) {
    setApplyMessage('');
    if (target === 'primary') setPoolProfileId(id); else setFallbackProfileId(id);
    const profile = poolProfiles.find(p => p.id === id);
    if (!profile) {
      setDraft(current => { const next = { ...current }; delete next[poolFields[target][2]]; return next; });
      return;
    }
    let generated: Settings;
    try { generated = poolSettingsFor(profile.settings, target, snapshot.hostname ?? ''); }
    catch (error) { setPoolError(error instanceof Error ? error.message : 'poolWorkerInvalid'); return; }
    setPoolError('');
    setDraft(current => {
      const next = { ...current, ...draftFrom(generated) };
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
  return <form noValidate onSubmit={event => void submit(event)} className="configuration">
    <div className="section-title"><div><p className="eyebrow">{t('manualControl')}</p><h3>{t('configuration')}</h3></div><span className="tag">{t('targetCount', { count })}</span></div>
    <p className="muted">{t('configureHint')}</p>
    {count > 1 && <p className="notice">{t('batchHint')}</p>}
    <fieldset disabled={locked || device.status !== 'online'}><legend>{t('operatingProfile')}</legend>
      <div className="custom-values-control">
        <label className="custom-values-switch"><input type="checkbox" role="switch" checked={customValuesAcknowledged} onChange={event => toggleCustom(event.target.checked)} aria-describedby={`custom-values-${device.id}`} />{t('customValuesAcknowledgement')}</label>
        <p id={`custom-values-${device.id}`} className="muted">{t('customValuesHint')}</p>
      </div>
      <div className="form-grid">
        {(['frequency', 'coreVoltage'] as const).map(key => <label key={key}>{t(key)}
          {customValuesAcknowledged ? <input type="number" min="1" max="65535" step="1" disabled={!supported(key)} {...inputState(key)} value={inputValue(key)} onChange={event => set(key, event.target.value)} /> : <select disabled={!supported(key)} {...inputState(key)} value={inputValue(key)} onChange={event => set(key, event.target.value)}>
            {!inputValue(key) && <option value="">{t('unavailable')}</option>}
            {inputValue(key) && !options(key).includes(Number(inputValue(key))) && <option value={inputValue(key)}>{inputValue(key)}</option>}
            {options(key).map(value => <option key={value} value={value}>{value}</option>)}
          </select>}
        </label>)}
        <label>{t('autofanspeed')}<select {...inputState('autofanspeed')} disabled={!supported('autofanspeed')} value={inputValue('autofanspeed')} onChange={event => set('autofanspeed', event.target.value)}>
          {!inputValue('autofanspeed') && <option value="">{t('unavailable')}</option>}
          <option value="1">{t('automatic')}</option><option value="0">{t('manual')}</option>
        </select></label>
        <label>{t('manualFanSpeed')}<input type="number" min="0" max="100" step="1" disabled={!supported('manualFanSpeed') || (values.autofanspeed ?? snapshot.settings.autofanspeed) !== 0}
          {...inputState('manualFanSpeed')} value={inputValue('manualFanSpeed')} onChange={event => set('manualFanSpeed', event.target.value)} /></label>
      </div>
      {(!supported('frequency') || !supported('coreVoltage')) && <p className="notice">{t('unsupportedTuning')}</p>}
    </fieldset>
    {(['primary', 'fallback'] as const).map(target => {
      const fields = poolFields[target];
      const fallback = target === 'fallback';
      const mode = fallback ? snapshot.capabilities.fallbackPoolMode ?? 'none' : snapshot.capabilities.poolMode;
      const profileId = fallback ? fallbackProfileId : poolProfileId;
      return <fieldset key={target} disabled={locked || device.status !== 'online' || mode === 'none'}><legend>{t(fallback ? 'fallbackPool' : 'poolPayout')}</legend>
        <div className="pool-load"><label>{t(fallback ? 'loadFallbackPoolProfile' : 'loadPoolProfile')}<select disabled={!poolWorkerName(snapshot.hostname)} value={profileId} onChange={event => {
          loadPoolProfile(event.target.value, target);
        }}><option value="">{t('choosePoolProfile')}</option>{poolProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><a href="#pool-profiles">{t('managePoolProfiles')}</a></div>
        {poolError && <p role="alert">{t(`errors.${poolError}`, { defaultValue: t('errors.operationFailed') })}</p>}
        {!poolWorkerName(snapshot.hostname) && <p className="notice">{t('errors.axeosNameRequired')}</p>}
        {profileId && <p className="muted">{t('poolWorkerPreview', { worker: poolWorkerName(snapshot.hostname) ?? '—' })}</p>}
        {profileId && <p className="notice">{t(fallback ? 'fallbackProfileReview' : 'poolProfileReview')}</p>}
        <p className="muted">{t(fallback ? mode === 'none' ? 'fallbackUnavailable' : 'fallbackPayoutHint' : 'payoutHint')}</p><div className="form-grid">
          {fields.map((key, index) => <label key={key}>{t(key)}
            <input readOnly={index === 2 && !!profileId} type={index === 1 ? 'number' : index === 3 ? 'password' : 'text'} autoComplete="off"
              min={index === 1 ? 1 : undefined} max={index === 1 ? 65535 : undefined} maxLength={255}
              {...inputState(key)} placeholder={index === 3 ? t('passwordPlaceholder') : undefined}
              value={inputValue(key)} onChange={event => set(key, event.target.value)} />
          </label>)}
        </div>
      </fieldset>;
    })}
    {workerError && <p role="alert">{t(`errors.${workerError}`, { defaultValue: t('errors.poolWorkerInvalid') })}</p>}
    <div className="configuration-draft-status" id={`unsaved-${device.id}`} aria-live="polite">{changes.dirty.length > 0 && <span><span className="draft-dot" aria-hidden="true" />{t('unsavedFields', { count: changes.dirty.length })}</span>}{!changes.valid && changes.dirty.length > 0 && <span>{t('completeChangedFields')}</span>}</div>
    <div className="form-actions"><button className="primary" disabled={locked || device.status !== 'online' || !changes.valid || !!workerError || (needsAcknowledgement && !customValuesAcknowledged)}>{locked ? t('working') : t('applyVerify')}</button>{Object.keys(draft).length > 0 && <button type="button" disabled={locked} onClick={() => { setDraft({}); setPoolProfileId(''); setFallbackProfileId(''); }}>{t('discardEdits')}</button>}<span className="muted">{t('writeVerification')}</span></div>
    {applyMessage && <p className="notice" role="status">{t(applyMessage)}</p>}
    {showRestart && <RestartMiner device={device} disabled={locked} unsaved={Object.keys(changes.settings).length > 0} onUpdated={onUpdated} />}
    <details><summary>{t('savedProfiles')}</summary><p className="muted">{t('saveProfileHint')}</p><div className="profile-controls">
      <label>{t('loadProfile')}<select disabled={locked || saving} aria-label={t('loadProfile')} defaultValue="" onChange={event => { const profile = profiles.find(p => p.id === event.target.value); if (profile) setDraft(current => ({ ...current, ...draftFrom(profile.settings) })); }}>
        <option value="">{t('chooseProfile')}</option>{profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
      </select></label>
      <label>{t('profileName')}<input disabled={locked || saving} maxLength={80} value={profileName} onChange={event => setProfileName(event.target.value)} /></label>
      <button type="button" disabled={locked || saving || !profileName.trim() || !Object.keys(profileSettings).length} onClick={() => void saveProfile()}>{t('saveProfile')}</button>
    </div>{profileError && <p role="alert">{t(`errors.${profileError}`, { defaultValue: t('errors.operationFailed') })}</p>}</details>
  </form>;
}
