import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { efficiencyFromWallPower, powerEstimate, readPowerPreferences, validEfficiency, POWER_PREFERENCE_KEY } from './power-estimate';

export function PowerCard({ power, partial = false, onPowerBasisChange }: { power: number; partial?: boolean; onPowerBasisChange?: (enabled: boolean, efficiency: number | null) => void }) {
  const { t, i18n } = useTranslation();
  const [preferences] = useState(readPowerPreferences);
  const [enabled, setEnabled] = useState(preferences.enabled);
  const [efficiency, setEfficiency] = useState(String(preferences.efficiency));
  const [editing, setEditing] = useState(false);
  const [measured, setMeasured] = useState('');
  const [measurementError, setMeasurementError] = useState(false);
  useEffect(() => {
    onPowerBasisChange?.(enabled, efficiency.trim() && validEfficiency(Number(efficiency)) ? Number(efficiency) : null);
  }, [enabled, efficiency, onPowerBasisChange]);
  const estimate = efficiency.trim() ? powerEstimate(power, Number(efficiency)) : null;
  useEffect(() => {
    if (!estimate) return;
    try { localStorage.setItem(POWER_PREFERENCE_KEY, JSON.stringify({ enabled, efficiency: Number(efficiency) })); }
    catch { /* Estimation still works when browser storage is unavailable. */ }
  }, [enabled, efficiency, estimate !== null]);
  const number = (n: number) => new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  const reported = Math.round(power * 10) / 10;
  const total = estimate ? Math.round(estimate.total * 10) / 10 : reported;
  // Reconcile displayed rounding so the visible addition always adds up.
  const loss = Math.round((total - reported) * 10) / 10;
  function saveMeasurement() {
    const calculated = measured.trim() ? efficiencyFromWallPower(power, Number(measured)) : null;
    if (calculated === null) { setMeasurementError(true); return; }
    setEfficiency(String(Number(calculated.toPrecision(10)))); setEditing(false); setMeasurementError(false);
  }
  return <article className="power-card" aria-label={t('totalPower')}>
    <span>{t('totalPower')}</span>
    {enabled && estimate ? <div className="power-equation" aria-label={t('powerEquation', { reported: number(reported), loss: number(loss), total: number(total) })}>
      <strong title={t('minerPower')}>{number(reported)}</strong>
      <span aria-hidden="true">+</span><strong className="supply-loss" title={t('supplyLoss')}>{number(loss)}</strong>
      <span aria-hidden="true">=</span><strong className="wall-power"><button type="button" className="wall-power-edit" title={t('editWallPower')} aria-label={t('editWallPower')} onClick={() => { setMeasured(String(total)); setMeasurementError(false); setEditing(true); }}>{number(total)} <small>W</small></button></strong>
    </div> : <strong>{number(power)} <small>W</small></strong>}
    <p>{enabled && estimate ? t('powerEstimateSubtitle', { efficiency: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(Number(efficiency)) }) : t('powerReportedSubtitle')}</p>
    <label className="power-toggle"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setEditing(false); }} />{t('includeSupplyLoss')}</label>
    {enabled && editing && <form className="power-measurement" onSubmit={event => { event.preventDefault(); saveMeasurement(); }}>
      <label>{t('measuredWallPower')}<input autoFocus type="number" step="any" min={power || undefined} inputMode="decimal" value={measured} aria-invalid={measurementError} onChange={event => { setMeasured(event.target.value); setMeasurementError(false); }} onKeyDown={event => { if (event.key === 'Escape') setEditing(false); }} /></label>
      <p>{t('measurementHint')}</p>
      <div className="form-actions"><button type="submit">{t('useMeasurement')}</button><button type="button" onClick={() => setEditing(false)}>{t('cancel')}</button></div>
      {measurementError && <p role="alert">{t('invalidWallPower')}</p>}
    </form>}
    {enabled && <div className="power-settings"><label>{t('psuEfficiency')}<input type="number" min="0.1" max="100" step="any" inputMode="decimal" value={efficiency}
      aria-invalid={!estimate} onChange={event => setEfficiency(event.target.value)} /></label>
      <p className="power-assumption">{t('psuAssumption')}</p>
      {!estimate && <p role="alert">{t('invalidEfficiency')}</p>}
    </div>}
    {partial && <p className="power-partial">{t('partialPower')}</p>}
  </article>;
}
