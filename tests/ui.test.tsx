// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { App } from '../src/web/App';
import { Chart } from '../src/web/Chart';
import { Configuration } from '../src/web/Configuration';
import { DemoAdapter } from '../src/server/demo';
import type { DeviceView } from '../src/shared/domain';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); void i18n.changeLanguage('en'); });
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
async function demoDevice(): Promise<DeviceView> {
  return { id: 'a', name: 'Gamma demo', address: 'demo-1', demo: true, status: 'online', lastSeen: new Date().toISOString(), snapshot: (await new DemoAdapter().read('demo-1')).snapshot };
}
describe('fleet interface', () => {
  it('guides an empty fleet and enables demo with no hardware', async () => {
    const device = await demoDevice(); let populated = false;
    const fetch = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') { populated = true; return response([device]); }
      return response(populated ? [device] : []);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    expect(await screen.findByText('Your hive starts with one miner.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Try demo' })[0]);
    expect(await screen.findByRole('button', { name: 'Gamma demo' })).toBeInTheDocument();
    expect(screen.getByText('Demonstration')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, options]) => (options?.headers as Record<string, string>)?.['X-BitHive'] === '1')).toBe(true);
  });
  it('changes language, persists the choice, and localizes the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response([])));
    render(<App />); await screen.findByText('Your hive starts with one miner.');
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'pt-BR');
    expect(await screen.findByText('Sua colmeia começa com um minerador.')).toBeInTheDocument();
    expect(localStorage.getItem('bithive.language')).toBe('pt-BR'); expect(document.documentElement.lang).toBe('pt-BR');
  });
  it('shows request failures with a useful recovery message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({ error: 'deviceUnavailable' }, false)));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Check its address, power, and network');
  });
  it('preserves loaded graphs when reselecting the open miner and clears them when switching miners', async () => {
    const first = await demoDevice();
    const second = { ...first, id: 'b', name: 'Second miner', address: 'demo-2' };
    const history = { metrics: [0, 15000].map(timestamp => ({
      timestamp: new Date(timestamp).toISOString(), hashRate: 1000, power: 15, temp: 50, vrTemp: 60, errorRate: 0,
    })), events: [], changes: [], limit: 1000 };
    const fetch = vi.fn((url: string) => {
      if (url === '/api/devices') return response([first, second]);
      if (url.includes('/a/history?')) return response(history);
      if (url.includes('/b/history?')) return response({ error: 'deviceUnavailable' }, false);
      return response([]);
    });
    vi.stubGlobal('fetch', fetch);
    render(<App />);
    const miner = await screen.findByRole('button', { name: first.name });
    await userEvent.click(miner);
    const graph = await screen.findByRole('img', { name: /Hashrate history/ });
    const historyRequests = () => fetch.mock.calls.filter(([url]) => url.includes('/history?'));
    expect(historyRequests()).toHaveLength(1);
    await userEvent.click(miner);
    expect(screen.getByRole('img', { name: /Hashrate history/ })).toBe(graph);
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(historyRequests()).toHaveLength(1);
    await userEvent.click(screen.getByRole('checkbox', { name: `Select ${first.name}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Configure selected' }));
    expect(screen.getByRole('img', { name: /Hashrate history/ })).toBe(graph);
    expect(historyRequests()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: second.name }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check its address, power, and network');
    expect(screen.queryByRole('img', { name: /Hashrate history/ })).not.toBeInTheDocument();
    expect(historyRequests()).toHaveLength(2);
  });
  it('provides accessible historical charts and a collecting state', () => {
    const { rerender } = render(<Chart metrics={[]} field="hashRate" label="Hashrate" unit="GH/s" />);
    expect(screen.getByText('Collecting history. At least two readings are needed.')).toBeInTheDocument();
    rerender(<Chart metrics={[{ timestamp: new Date(0).toISOString(), hashRate: 1000, power: 15, temp: 50, vrTemp: 60, errorRate: 0 }, { timestamp: new Date(15000).toISOString(), hashRate: 1100, power: 16, temp: 51, vrTemp: 61, errorRate: 0 }]} field="hashRate" label="Hashrate" unit="GH/s" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/Hashrate history/);
  });
  it('applies only changed fields and keeps unavailable device controls disabled', async () => {
    const device = await demoDevice(); const apply = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => response([])));
    const { rerender } = render(<Configuration device={device} count={1} busy={false} onApply={apply} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply & verify' })).toBeDisabled());
    await userEvent.selectOptions(screen.getByLabelText('Frequency (MHz)'), '550');
    await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
    expect(apply).toHaveBeenCalledWith({ frequency: 550 });
    expect(screen.getByRole('button', { name: 'Apply & verify' })).toBeDisabled();
    rerender(<Configuration device={{ ...device, status: 'stale' }} count={1} busy={false} onApply={apply} />);
    expect(screen.getByLabelText('Frequency (MHz)')).toBeDisabled();
  });
  it('unlocks custom inputs only after acknowledgement and discards custom drafts when switched off', async () => {
    const device = await demoDevice(); const apply = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => response([])));
    render(<Configuration device={device} count={1} busy={false} onApply={apply} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    const frequency = screen.getByLabelText('Frequency (MHz)');
    await userEvent.type(frequency, '537');
    await userEvent.type(screen.getByLabelText('Core voltage (mV)'), '1160');
    await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
    expect(apply).toHaveBeenCalledWith({ frequency: 537, coreVoltage: 1160 }, true);
    expect(frequency).toHaveValue(null);
    await userEvent.type(frequency, '538');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Apply & verify' })).toBeDisabled();
  });
  it('requires acknowledgement again when loading a saved custom profile', async () => {
    const device = await demoDevice(); const apply = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => response([{ id: 'custom', name: 'Custom', settings: { frequency: 537 } }])));
    render(<Configuration device={device} count={1} busy={false} onApply={apply} />);
    await userEvent.click(screen.getByText('Saved operating profiles'));
    await screen.findByRole('option', { name: 'Custom' });
    await userEvent.selectOptions(screen.getByLabelText('Load a profile'), 'custom');
    expect(screen.getByRole('button', { name: 'Apply & verify' })).toBeDisabled();
    await userEvent.click(screen.getByRole('switch'));
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue(537);
    await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
    expect(apply).toHaveBeenCalledWith({ frequency: 537 }, true);
  });
  it('loads a saved profile without sending a configuration command', async () => {
    const device = await demoDevice(); const apply = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => response([{ id: 'p', name: 'Quiet', settings: { frequency: 500 } }])));
    render(<Configuration device={device} count={1} busy={false} onApply={apply} />);
    await userEvent.click(screen.getByText('Saved operating profiles'));
    await screen.findByRole('option', { name: 'Quiet' });
    await userEvent.selectOptions(screen.getByLabelText('Load a profile'), 'p');
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue('500');
    expect(apply).not.toHaveBeenCalled();
  });
  it('saves current settings without edits and loads the saved profile without applying it', async () => {
    const device = await demoDevice(); const apply = vi.fn();
    const fetch = vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST'
      ? response({ id: 'current', ...JSON.parse(options.body as string) }) : response([]));
    vi.stubGlobal('fetch', fetch);
    render(<Configuration device={device} count={1} busy={false} onApply={apply} />);
    await userEvent.click(screen.getByText('Saved operating profiles'));
    const save = screen.getByRole('button', { name: 'Save operating fields' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Profile name'), '   ');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Profile name'), 'Current');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await screen.findByRole('option', { name: 'Current' });
    expect(screen.getByLabelText('Profile name')).toHaveValue('');
    expect(save).toBeDisabled();
    const options = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1];
    const current = device.snapshot!.settings;
    expect(JSON.parse(options!.body as string)).toEqual({ name: 'Current', settings: {
      frequency: current.frequency, coreVoltage: current.coreVoltage,
      autofanspeed: current.autofanspeed,
    } });
    await userEvent.selectOptions(screen.getByLabelText('Load a profile'), 'current');
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue(String(current.frequency));
    expect(apply).not.toHaveBeenCalled();
  });
  it('saves manual cooling with its current fan speed and pending operating edits', async () => {
    const device = await demoDevice();
    const fetch = vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST'
      ? response({ id: 'manual', ...JSON.parse(options.body as string) }) : response([]));
    vi.stubGlobal('fetch', fetch);
    render(<Configuration device={device} count={1} busy={false} onApply={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Cooling mode'), '0');
    await userEvent.selectOptions(screen.getByLabelText('Frequency (MHz)'), '500');
    await userEvent.click(screen.getByText('Saved operating profiles'));
    await userEvent.type(screen.getByLabelText('Profile name'), 'Manual profile');
    await userEvent.click(screen.getByRole('button', { name: 'Save operating fields' }));
    await screen.findByRole('option', { name: 'Manual profile' });
    const options = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1];
    expect(JSON.parse(options!.body as string)).toEqual({ name: 'Manual profile', settings: {
      frequency: 500, coreVoltage: device.snapshot!.settings.coreVoltage,
      autofanspeed: 0, manualFanSpeed: device.snapshot!.settings.manualFanSpeed,
    } });
  });
  it('keeps saving disabled when no supported operating settings are available', async () => {
    const device = await demoDevice();
    device.snapshot!.capabilities.writable = [];
    vi.stubGlobal('fetch', vi.fn(() => response([])));
    render(<Configuration device={device} count={1} busy={false} onApply={vi.fn()} />);
    await userEvent.click(screen.getByText('Saved operating profiles'));
    await userEvent.type(screen.getByLabelText('Profile name'), 'Unavailable');
    expect(screen.getByRole('button', { name: 'Save operating fields' })).toBeDisabled();
  });
  it('saves only operating fields and shows profile request errors', async () => {
    const device = await demoDevice();
    const fetch = vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST' ? response({ error: 'profileLimit' }, false) : response([]));
    vi.stubGlobal('fetch', fetch);
    render(<Configuration device={device} count={1} busy={false} onApply={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Frequency (MHz)'), '500');
    await userEvent.type(screen.getByLabelText('Pool password'), 'never-save-this');
    await userEvent.click(screen.getByText('Saved operating profiles'));
    await userEvent.type(screen.getByLabelText('Profile name'), 'Quiet');
    await userEvent.click(screen.getByRole('button', { name: 'Save operating fields' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('20 saved profiles');
    const options = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1];
    expect(JSON.parse(options!.body as string)).toEqual({ name: 'Quiet', settings: {
      frequency: 500, coreVoltage: device.snapshot!.settings.coreVoltage,
      autofanspeed: device.snapshot!.settings.autofanspeed,
    } });
  });
});
