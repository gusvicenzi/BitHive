// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { PowerCard } from '../src/web/PowerCard';
import { App } from '../src/web/App';
import { DemoAdapter } from '../src/server/demo';

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage('en'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); void i18n.changeLanguage('en'); });
describe('power draw card', () => {
  it('calibrates by clicking total power, saves the efficiency and estimates future readings', async () => {
    const { rerender, unmount } = render(<PowerCard power={56.7} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Enter actual wall power' }));
    await userEvent.clear(screen.getByLabelText('Measured wall power (W)'));
    await userEvent.type(screen.getByLabelText('Measured wall power (W)'), '70');
    await userEvent.click(screen.getByRole('button', { name: 'Use reading' }));
    expect(screen.getByLabelText('Power supply efficiency (%)')).toHaveValue(81);
    expect(screen.getByLabelText(/Miner power 56.7 W/)).toHaveTextContent('56.7+13.3=70.0 W');
    rerender(<PowerCard power={81} />);
    expect(screen.getByLabelText(/Miner power 81.0 W/)).toHaveTextContent('81.0+19.0=100.0 W');
    unmount(); render(<PowerCard power={81} />);
    expect(screen.getByLabelText('Power supply efficiency (%)')).toHaveValue(81);
  });
  it('rejects wall readings below reported power and allows cancellation', async () => {
    render(<PowerCard power={56.7} />); await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Enter actual wall power' }));
    await userEvent.clear(screen.getByLabelText('Measured wall power (W)'));
    await userEvent.type(screen.getByLabelText('Measured wall power (W)'), '50');
    // Submit directly to also exercise validation independently of native form constraints.
    fireEvent.submit(screen.getByLabelText('Measured wall power (W)').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('at least as large as miner power');
    expect(screen.getByLabelText('Power supply efficiency (%)')).toHaveValue(85);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Measured wall power (W)')).not.toBeInTheDocument();
  });
  it('does not infer efficiency from a zero-power fleet', async () => {
    render(<PowerCard power={0} />); await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Enter actual wall power' }));
    await userEvent.clear(screen.getByLabelText('Measured wall power (W)'));
    await userEvent.type(screen.getByLabelText('Measured wall power (W)'), '10{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('must be greater than zero');
  });
  it('defaults to miner power and enables a colored loss/total equation with the default assumption', async () => {
    render(<PowerCard power={56.7} />);
    expect(screen.getByText('Online miners only · excludes power supply losses')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include power supply losses' }));
    expect(screen.getByLabelText('Power supply efficiency (%)')).toHaveValue(85);
    const equation = screen.getByLabelText(/Miner power 56.7 W/);
    expect(equation).toHaveTextContent('56.7+10.0=66.7 W');
    expect(equation.querySelector('.supply-loss')).toHaveTextContent('10.0');
    expect(equation.querySelector('.wall-power')).toHaveTextContent('66.7');
    expect(screen.getByText(/wall estimate · 85% efficiency/)).toBeInTheDocument();
  });
  it('updates the estimate, persists settings, and restores them after remount', async () => {
    const { unmount } = render(<PowerCard power={56.7} />);
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.clear(screen.getByRole('spinbutton'));
    await userEvent.type(screen.getByRole('spinbutton'), '90');
    expect(screen.getByLabelText(/Miner power 56.7 W/)).toHaveTextContent('56.7+6.3=63.0 W');
    unmount(); render(<PowerCard power={56.7} />);
    expect(screen.getByRole('checkbox')).toBeChecked(); expect(screen.getByRole('spinbutton')).toHaveValue(90);
  });
  it('does not show invalid estimates and can revert to reported power', async () => {
    render(<PowerCard power={56.7} />); await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.clear(screen.getByRole('spinbutton')); await userEvent.type(screen.getByRole('spinbutton'), '0');
    expect(screen.getByRole('alert')).toHaveTextContent('greater than 0%');
    expect(screen.queryByLabelText(/Miner power .* estimated supply loss/)).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(screen.getByRole('checkbox')); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps the displayed rounded components additive and signals missing power readings', async () => {
    render(<PowerCard power={56.74} partial />); await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText(/Miner power 56.7 W/)).toHaveTextContent('56.7+10.1=66.8 W');
    expect(screen.getByText(/totals and estimates are partial/)).toBeInTheDocument();
  });
  it('localizes the controls and equation and works when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    await i18n.changeLanguage('pt-BR'); render(<PowerCard power={56.7} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Incluir perdas da fonte' }));
    expect(screen.getByLabelText(/Potência dos mineradores 56,7 W/)).toHaveTextContent('56,7+10,0=66,7 W');
    await userEvent.click(screen.getByRole('button', { name: 'Informar consumo real da tomada' }));
    await userEvent.clear(screen.getByLabelText('Consumo medido da tomada (W)'));
    await userEvent.type(screen.getByLabelText('Consumo medido da tomada (W)'), '70{Enter}');
    expect(screen.getByLabelText(/Potência dos mineradores 56,7 W/)).toHaveTextContent('56,7+13,3=70,0 W');
  });
});
describe('fleet error column', () => {
  it('shows current hash error percentages, missing values, and stale state', async () => {
    const snapshot = (await new DemoAdapter().read('demo-1')).snapshot;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [
      { id: 'a', address: 'demo-1', name: 'Current miner', demo: true, status: 'online', lastSeen: null, snapshot: { ...snapshot, errorRate: 0.93 } },
      { id: 'b', address: 'demo-2', name: 'Missing miner', demo: true, status: 'online', lastSeen: null, snapshot: { ...snapshot, errorRate: undefined } },
      { id: 'c', address: 'demo-3', name: 'Stale miner', demo: true, status: 'stale', lastSeen: null, snapshot: { ...snapshot, errorRate: 2.45 } },
    ] })));
    render(<App />); expect(await screen.findByRole('columnheader', { name: 'Hash error (%)' })).toBeInTheDocument();
    const current = screen.getByRole('button', { name: 'Current miner' }).closest('tr')!;
    expect(within(current).getAllByRole('cell')[8]).toHaveTextContent('0.93%');
    const missing = screen.getByRole('button', { name: 'Missing miner' }).closest('tr')!;
    expect(within(missing).getAllByRole('cell')[8]).toHaveTextContent('—%');
    const stale = screen.getByRole('button', { name: 'Stale miner' }).closest('tr')!;
    expect(stale).toHaveClass('stale-row'); expect(within(stale).getAllByRole('cell')[8]).toHaveTextContent('2.45%');
  });
});

describe('loss-adjusted fleet efficiency', () => {
  it('updates J/TH with the toggle, calibration and invalid efficiency, using paired real readings', async () => {
    const snapshot = (await new DemoAdapter().read('demo-1')).snapshot;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [
      { id: 'a', address: 'a', name: 'Real', demo: false, status: 'online', lastSeen: null, snapshot: { ...snapshot, power: 56.7, hashRate: 1000 } },
      { id: 'b', address: 'b', name: 'Missing', demo: false, status: 'online', lastSeen: null, snapshot: { ...snapshot, power: 10, hashRate: undefined } },
      { id: 'c', address: 'c', name: 'Demo', demo: true, status: 'online', lastSeen: null, snapshot },
      { id: 'd', address: 'd', name: 'Offline', demo: false, status: 'offline', lastSeen: null, snapshot },
    ] })));
    render(<App />); await screen.findByRole('button', { name: 'Real' });
    const card = screen.getAllByText('Efficiency', { exact: true }).find(node => node.closest('.summary'))!.closest('article')!;
    expect(card.querySelector('strong')).toHaveTextContent('56.7 J/TH');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include power supply losses' }));
    expect(card.querySelector('strong')).toHaveTextContent('66.71 J/TH');
    expect(card).toHaveTextContent('Includes power supply losses');
    expect(card).toHaveTextContent('paired readings');
    await userEvent.click(screen.getByRole('button', { name: 'Enter actual wall power' }));
    await userEvent.clear(screen.getByLabelText('Measured wall power (W)'));
    await userEvent.type(screen.getByLabelText('Measured wall power (W)'), '83.375{Enter}');
    expect(screen.getByLabelText('Power supply efficiency (%)')).toHaveValue(80);
    expect(card.querySelector('strong')).toHaveTextContent('70.88 J/TH');
    await userEvent.clear(screen.getByLabelText('Power supply efficiency (%)'));
    expect(card.querySelector('strong')).toHaveTextContent('— J/TH');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include power supply losses' }));
    expect(card.querySelector('strong')).toHaveTextContent('56.7 J/TH');
  });
});
