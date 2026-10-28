import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceView, RestartResult } from '../shared/domain';
import { api } from './api';

export function RestartMiner({ device, disabled, unsaved, onUpdated }: {
  device: DeviceView; disabled: boolean; unsaved: boolean; onUpdated?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [result, setResult] = useState<RestartResult | null>(null);
  const [error, setError] = useState('');
  const [previousUptime, setPreviousUptime] = useState<number>();
  useEffect(() => {
    if (result && result.result !== 'rejected' && result.result !== 'restarted' && previousUptime !== undefined && device.snapshot?.uptime !== undefined && device.snapshot.uptime < previousUptime) {
      setResult({ ...result, result: 'restarted', reachable: true });
    }
  }, [device.snapshot?.uptime, previousUptime, result]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 30000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function restart() {
    setPending(true); setPreviousUptime(device.snapshot?.uptime); setResult(null); setError('');
    try {
      const response = await api<RestartResult>(`/devices/${device.id}/restart`, {});
      setResult(response); setCooldown(true);
      try { await onUpdated?.(); } catch { /* The request outcome remains visible if refreshing the fleet fails. */ }
    } catch (e) { setError(e instanceof Error ? e.message : 'operationFailed'); setCooldown(true); }
    finally { setPending(false); }
  }
  return <section className="configuration-restart" aria-label={t('restartMiner')}>
    <div><h4>{t('restartToApply')}</h4><p>{t('restartScope', { name: device.name })}</p><p className="muted">{t(unsaved ? 'restartUnsaved' : 'restartHint')}</p></div>
    <button type="button" disabled={disabled || pending || cooldown || unsaved || device.status !== 'online'} onClick={() => void restart()}><span aria-hidden="true">↻</span> {t(pending ? 'working' : 'restartMiner')}</button>
    {result && <p className="restart-result" role="status">{t(`restartResults.${result.result}`)} {!result.reachable && t('restartUnreachable')}</p>}
    {cooldown && <p className="muted restart-result">{t('restartCooldownHint')}</p>}
    {error && <p className="restart-result" role="alert">{t(`errors.${error}`, { defaultValue: t('restartRequestUnknown') })}</p>}
  </section>;
}
