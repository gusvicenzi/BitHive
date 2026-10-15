// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { TuningProgress, TuningWindow } from '../src/web/TuningProgress';
import { tuningConfigSchema, type TuningRunView } from '../src/shared/tuning';

const original = { frequency: 525, coreVoltage: 1150, autofanspeed: 1 as const, manualFanSpeed: 60 };
const run: TuningRunView = { id: 'run', deviceId: 'demo', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  config: tuningConfigSchema.parse({ frequency: { minimum: 400, maximum: 575, step: 25 }, voltage: { minimum: 1100, maximum: 1200, step: 10 },
    maxAsicTemperature: 65, maxVrmTemperature: 85, maxErrorPercentage: 2, fan: { mode: 'automatic' }, expected: { source: 'firmware' } }),
  state: { phase: 'baseline', kind: 'baseline', frequencyIndex: 0, voltageIndex: 0, lastPassIndex: null, original, profile: original, observedProfile: original,
    stable: null, attemptId: 'attempt', deadline: 120000, nextTick: 0, measurementStart: null, streak: 0, lastObserved: 0, uptime: 100,
    firmware: 'demo', resetReason: null, recovery: { status: 'none', reason: null, deadline: null }, afterRecovery: 'pause', recoveryWritten: false,
    safetyStop: false, baselinePassed: false, winners: { hashrate: null, efficiency: null }, confirmationCategory: 'hashrate', reason: null,
    live: { at: 0, ths: 1.2, watts: 18, error: 0.2, asic: 50, vrm: 57, expected: 1.2 } } };
afterEach(() => { cleanup(); void i18n.changeLanguage('en'); });
describe('tuning console', () => {
  it('shows the active workflow, correctly calculated efficiency and an accessible countdown', () => {
    render(<TuningProgress run={run} clock={30000} active busy={false} onControl={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Tuning workflow' }).querySelector('[aria-current="step"]')).toHaveTextContent('Baseline');
    expect(screen.getByText('90 seconds remaining')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Current phase progress' })).toHaveAttribute('value', '30');
    const efficiency = screen.getByText('Efficiency').parentElement!;
    expect(within(efficiency).getByText(/15/)).toBeInTheDocument();
  });
  it('keeps actions consistent with paused and recovery states', async () => {
    const onControl = vi.fn(); const paused = { ...run, state: { ...run.state, phase: 'paused' as const, deadline: null } };
    const { rerender } = render(<TuningProgress run={paused} clock={0} active busy={false} onControl={onControl} />);
    expect(screen.getByText('Saved on server')).toBeInTheDocument();
    expect(screen.queryByText('Running on server')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Resume' })); expect(onControl).toHaveBeenCalledWith('resume');
    rerender(<TuningProgress run={{ ...run, state: { ...run.state, phase: 'recovery_required', recovery: { status: 'required', reason: 'recoveryFailed', deadline: 0 }, reason: 'recoveryFailed' } }} clock={0} active busy={false} onControl={onControl} />);
    expect(screen.getByRole('alert')).toHaveTextContent('manual recovery required');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled();
  });
  it('plots actual grid endpoints without showing a baseline outside the bounds as a candidate inside', () => {
    const outside = { ...run, state: { ...run.state, profile: { ...original, frequency: 825 } } };
    render(<TuningWindow run={outside} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/825 MHz.*400 to 575 MHz/);
    expect(screen.getByText('Current profile is outside the search bounds')).toBeInTheDocument();
    expect(document.querySelector('.tuning-window-candidate')).toBeNull();
  });
  it('marks reached limits and supports Portuguese labels', async () => {
    await i18n.changeLanguage('pt-BR');
    render(<TuningProgress run={{ ...run, state: { ...run.state, live: { ...run.state.live!, asic: 65 } } }} clock={0} active busy={false} onControl={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Etapas do ajuste' })).toBeInTheDocument();
    expect(screen.getByText('Temperatura ASIC').parentElement).toHaveClass('is-at-limit');
    const efficiency = screen.getByText('Eficiência').parentElement!;
    expect(within(efficiency).getByText(/15/)).toBeInTheDocument();
  });
});
