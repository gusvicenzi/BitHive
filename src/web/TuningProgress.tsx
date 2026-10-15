import { useTranslation } from 'react-i18next';
import { efficiency } from '../shared/domain';
import { grid, type TuningRunView } from '../shared/tuning';

export function TuningWindow({ run }: { run: TuningRunView }) {
  const { t, i18n } = useTranslation();
  const frequencies = grid(run.config.frequency), voltages = grid(run.config.voltage);
  const fmin = frequencies[0], fmax = frequencies.at(-1)!, vmin = voltages[0], vmax = voltages.at(-1)!;
  const profile = run.state.profile;
  const inside = profile.frequency >= fmin && profile.frequency <= fmax && profile.coreVoltage >= vmin && profile.coreVoltage <= vmax;
  const x = 62 + (fmax === fmin ? 0.5 : (profile.frequency - fmin) / (fmax - fmin)) * 226;
  const y = 141 - (vmax === vmin ? 0.5 : (profile.coreVoltage - vmin) / (vmax - vmin)) * 104;
  const number = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(value);
  return <aside className="tuning-window">
    <div className="tuning-window-title"><h5>{t('tuner.design.window')}</h5><span>{t(`tuner.${run.config.mode}`)}</span></div>
    <svg viewBox="0 0 324 195" role="img" aria-label={t('tuner.design.windowDescription', { frequency: profile.frequency, voltage: profile.coreVoltage, fmin, fmax, vmin, vmax })}>
      <rect className="tuning-window-area" x="62" y="37" width="226" height="104" rx="4" />
      {[0, 0.25, 0.5, 0.75, 1].map(n => <g key={n} className="tuning-window-grid"><path d={`M ${62 + n * 226} 37 V 141`} /><path d={`M 62 ${37 + n * 104} H 288`} /></g>)}
      <text x="17" y="19" className="tuning-axis-unit">mV</text><text x="288" y="184" textAnchor="end" className="tuning-axis-unit">MHz</text>
      <text x="52" y="41" textAnchor="end">{number(vmax)}</text><text x="52" y="145" textAnchor="end">{number(vmin)}</text>
      <text x="62" y="163">{number(fmin)}</text><text x="288" y="163" textAnchor="end">{number(fmax)}</text>
      {inside && <g className="tuning-window-candidate"><path d={`M 62 ${y} H 288 M ${x} 37 V 141`} /><circle cx={x} cy={y} r="10" className="tuning-window-halo" /><circle cx={x} cy={y} r="4" /></g>}
    </svg>
    <p><span className={`tuning-window-key ${inside ? '' : 'is-outside'}`} />{t(inside ? 'tuner.design.currentPoint' : 'tuner.design.outsideWindow')}</p>
  </aside>;
}

export function TuningProgress({ run, clock, busy, active, onControl }: { run: TuningRunView; clock: number; busy: boolean; active: boolean; onControl: (action: 'pause' | 'resume' | 'stop') => void }) {
  const { t, i18n } = useTranslation();
  const s = run.state;
  const number = (value?: number | null, digits = 2) => value == null ? '—' : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value);
  const remaining = s.deadline ? Math.max(0, Math.ceil((s.deadline - clock) / 1000)) : null;
  const timed = ['baseline', 'stabilizing', 'measuring', 'confirming'].includes(s.phase);
  const seconds = s.phase === 'baseline' || s.phase === 'stabilizing' ? run.config.stabilizationSeconds : run.config.measurementSeconds * (s.kind === 'confirmation' ? 3 : 1);
  const stage = ['restoring', 'completed', 'stopped', 'failed'].includes(s.phase) ? 3 : s.kind === 'confirmation' ? 2 : s.kind === 'baseline' ? 0 : 1;
  const stages = ['baseline', 'search', 'confirmation', 'restore'];
  const running = active && !['paused', 'recovery_required'].includes(s.phase);
  const fault = s.phase === 'recovery_required' || s.safetyStop;
  const metrics = [
    { label: 'ths', value: s.live?.ths, unit: 'TH/s' }, { label: 'watts', value: s.live?.watts, unit: 'W' },
    { label: 'efficiency', value: efficiency(s.live ? s.live.ths * 1000 : null, s.live?.watts), unit: 'J/TH' },
    { label: 'asic', value: s.live?.asic, unit: '°C', limit: run.config.maxAsicTemperature },
    { label: 'vrm', value: s.live?.vrm, unit: '°C', limit: run.config.maxVrmTemperature },
    { label: 'error', value: s.live?.error, unit: '%', limit: run.config.maxErrorPercentage },
  ];
  return <div className={`tuning-console ${fault ? 'has-fault' : ''}`}>
    <ol className="tuning-workflow" aria-label={t('tuner.design.workflow')}>{stages.map((name, index) => <li key={name} aria-current={index === stage ? 'step' : undefined} className={index < stage || s.phase === 'completed' ? 'is-done' : index === stage ? 'is-current' : ''}><span className="tuning-stage-dot" aria-hidden="true">{index < stage || s.phase === 'completed' ? '✓' : ''}</span>{t(`tuner.design.stages.${name}`)}</li>)}</ol>
    <div className="tuning-console-body"><div className="tuning-progress">
      <div className="tuning-phase-heading"><div><p className="tuning-label">{t('tuner.design.currentPhase')}</p><h4 aria-live="polite">{t(`tuner.phases.${s.phase}`)}</h4></div><span className={`tuning-phase-badge ${running ? 'is-running' : ''}`}><span aria-hidden="true" />{t(running ? 'tuner.design.runningOnServer' : active ? 'tuner.design.savedOnServer' : 'tuner.design.runSaved')}</span></div>
      <div className="tuning-candidate"><div><p className="tuning-label">{t('tuner.design.currentProfile')}</p><div className="tuning-profile-values"><strong>{number(s.profile.frequency, 0)}<small>MHz</small></strong><span aria-hidden="true">/</span><strong>{number(s.profile.coreVoltage, 0)}<small>mV</small></strong></div><p className="tuning-fan">{t('tuner.fan')}: {s.profile.autofanspeed ? t('automatic') : `${s.profile.manualFanSpeed}%`}</p></div>
        {remaining !== null && timed && <div className="tuning-countdown"><span className="tuning-label">{t('tuner.design.phaseRemaining')}</span><strong aria-hidden="true">{Math.floor(remaining / 60).toString().padStart(2, '0')}<span>:</span>{(remaining % 60).toString().padStart(2, '0')}</strong><span className="sr-only">{t('tuner.remaining', { seconds: remaining })}</span><progress max={seconds} value={Math.max(0, Math.min(seconds, seconds - remaining))} aria-label={t('tuner.design.phaseProgress')} /></div>}
      </div>
      <dl className="tuning-live" aria-label={t('tuner.design.liveReadings')}>{metrics.map(metric => <div key={metric.label} className={metric.limit !== undefined && metric.value !== undefined && metric.value >= metric.limit ? 'is-at-limit' : ''}><dt>{t(`tuner.design.metrics.${metric.label}`)}</dt><dd>{number(metric.value)}<small>{metric.unit}</small></dd>{metric.limit !== undefined && <span>{t('tuner.design.limit', { value: number(metric.limit), unit: metric.unit })}</span>}</div>)}</dl>
      <div className={`tuning-recovery ${fault ? 'is-critical' : ''}`} role={fault ? 'alert' : undefined}><span className="tuning-recovery-symbol" aria-hidden="true">{fault ? '!' : s.recovery.status === 'verified' ? '✓' : '↶'}</span><div><strong>{t('tuner.recovery')}: {t(`tuner.recoveryStates.${s.recovery.status}`)}</strong>{s.reason && <p>{t(`tuner.reasons.${s.reason}`, { defaultValue: t('errors.operationFailed') })}</p>}</div></div>
      <div className="tuning-controls"><button type="button" disabled={busy || !active || ['paused', 'recovery_required'].includes(s.phase)} onClick={() => onControl('pause')}><span aria-hidden="true">Ⅱ</span>{t('tuner.pause')}</button><button type="button" className={s.phase === 'paused' ? 'primary' : ''} disabled={busy || s.phase !== 'paused' || s.safetyStop} onClick={() => onControl('resume')}><span aria-hidden="true">▷</span>{t('tuner.resume')}</button><button type="button" className="tuning-stop" disabled={busy || !active} onClick={() => onControl('stop')}><span aria-hidden="true">□</span>{t('tuner.stop')}</button></div>
    </div><TuningWindow run={run} /></div>
  </div>;
}
