// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { PowerCard } from '../src/web/PowerCard';
import { App } from '../src/web/App';
import { DemoAdapter } from '../src/server/demo';

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage('en'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); void i18n.changeLanguage('en'); });
describe('power draw card', () => {
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
    expect(within(current).getAllByRole('cell')[7]).toHaveTextContent('0.93%');
    const missing = screen.getByRole('button', { name: 'Missing miner' }).closest('tr')!;
    expect(within(missing).getAllByRole('cell')[7]).toHaveTextContent('—%');
    const stale = screen.getByRole('button', { name: 'Stale miner' }).closest('tr')!;
    expect(stale).toHaveClass('stale-row'); expect(within(stale).getAllByRole('cell')[7]).toHaveTextContent('2.45%');
  });
});
