import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionResult, DeviceView } from '../shared/domain';
import { api } from './api';

export function DeviceNaming({ device, busy, onUpdated }: { device: DeviceView; busy: boolean; onUpdated: () => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(device.name);
  const [hostname, setHostname] = useState(device.snapshot?.hostname ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setName(device.name); }, [device.name]);
  useEffect(() => { setHostname(device.snapshot?.hostname ?? ''); }, [device.snapshot?.hostname]);
  const supportsHostname = device.snapshot?.capabilities.writable.includes('hostname');
  async function save(event: FormEvent, target: 'display' | 'axeos') {
    event.preventDefault(); setPending(true); setError(''); setMessage('');
    try {
      if (target === 'display') {
        await api(`/devices/${device.id}/name`, { name });
        setMessage('displayNameSaved');
      } else {
        const [result] = await api<ActionResult[]>('/batch', { ids: [device.id], action: 'configure', settings: { hostname } });
        if (result.result === 'rejected') throw new Error(result.reason ?? 'operationFailed');
        setMessage(`results.${result.result}`);
        // Clear the attempted change even when uncertain; never offer an automatic replay.
        setHostname(device.snapshot?.hostname ?? '');
      }
      await onUpdated();
    } catch (error) { setError(error instanceof Error ? error.message : 'operationFailed'); }
    finally { setPending(false); }
  }
  return <section className="device-naming" aria-label={t('minerNames')}>
    <h3>{t('minerNames')}</h3>
    <div className="form-grid">
      <form onSubmit={event => void save(event, 'display')}>
        <label>{t('displayName')}<input required maxLength={80} value={name} disabled={busy || pending} onChange={event => setName(event.target.value)} /></label>
        <p className="muted">{t('displayNameHint')}</p>
        <button disabled={busy || pending || !name.trim() || name.trim() === device.name}>{t('saveDisplayName')}</button>
      </form>
      <form onSubmit={event => void save(event, 'axeos')}>
        <label>{t('hostname')}<input required minLength={1} maxLength={63} pattern="[a-zA-Z0-9](([a-zA-Z0-9]|-)*[a-zA-Z0-9])?" value={hostname}
          disabled={busy || pending || !supportsHostname || device.status !== 'online'} onChange={event => setHostname(event.target.value)} /></label>
        <p className="muted">{t('hostnameHint')}</p>
        <button disabled={busy || pending || !supportsHostname || device.status !== 'online' || !hostname.trim() || hostname.trim().toLowerCase() === device.snapshot?.hostname}>{t('saveHostname')}</button>
        {!supportsHostname && <p className="muted">{t('hostnameUnavailable')}</p>}
      </form>
    </div>
    {message && <p role="status">{t(message)}</p>}
    {error && <p role="alert">{t(`errors.${error}`, { defaultValue: t('errors.operationFailed') })}</p>}
  </section>;
}
