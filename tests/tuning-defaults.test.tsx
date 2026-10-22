// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { tuningDefaults } from '../src/web/tuning-defaults';
import { Tuning } from '../src/web/Tuning';
import type { DeviceView, Snapshot } from '../src/shared/domain';

const snapshot: Snapshot = { settings: { frequency: 825, coreVoltage: 1180 }, expectedHashrate: 1200,
  capabilities: { frequencies: [550, 400, 625, 525], voltages: [1150, 1000, 1200, 1060, 1100], writable: [], poolMode: 'none' } };
const device: DeviceView = { id: 'demo', name: 'Demo', address: 'demo-1', demo: true, status: 'online', lastSeen: null, snapshot };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); void i18n.changeLanguage('en'); });
const mockApi = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
describe('configured frequency acknowledgement', () => {
  it('offers the acknowledgement only after the specific missing-frequency error, then sends an explicit per-run choice', async () => {
    let posts = 0;
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method !== 'POST') return { ok: true, json: async () => [] };
      posts++; return posts === 1 ? { ok: false, json: async () => ({ error: 'missingActualFrequency' }) } : { ok: true, json: async () => ({ id: 'run' }) };
    });
    vi.stubGlobal('fetch', fetch);
    render(<Tuning device={{ ...device, demo: false }} />);
    expect(screen.queryByRole('button', { name: /I acknowledge this limitation/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch'));
    await userEvent.click(screen.getByRole('button', { name: 'Start tuning' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('actualFrequency');
    await userEvent.click(await screen.findByRole('button', { name: /I acknowledge this limitation/ }));
    expect(screen.getByText(/Frequency source: configured setting/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start tuning' }));
    await waitFor(() => expect(posts).toBe(2));
    const requests = fetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options!.body as string));
    expect(requests[0].config).not.toHaveProperty('configuredFrequencyAcknowledged');
    expect(requests[1].config.configuredFrequencyAcknowledged).toBe(true);
    expect(requests[1].requestKey).not.toBe(requests[0].requestKey);
  });
  it('does not offer a bypass for other missing telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method === 'POST' ? { ok: false, json: async () => ({ error: 'missingTelemetry' }) } : { ok: true, json: async () => [] }));
    render(<Tuning device={device} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start tuning' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /I acknowledge this limitation/ })).not.toBeInTheDocument();
  });
});
describe('physical tuning acknowledgement', () => {
  it('requires acknowledgement for each physical run and includes it in the start request', async () => {
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.method === 'POST' ? { id: 'run' } : [] }));
    vi.stubGlobal('fetch', fetch);
    render(<Tuning device={{ ...device, demo: false }} />);
    const start = screen.getByRole('button', { name: 'Start tuning' });
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked(); expect(start).toBeDisabled();
    expect(screen.getByLabelText('Minimum frequency (MHz)')).toBeDisabled();
    await userEvent.click(toggle); expect(start).toBeEnabled();
    expect(screen.getByLabelText('Minimum frequency (MHz)')).toBeEnabled();
    await userEvent.click(start);
    await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
    const request = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1]!;
    expect(JSON.parse(request.body as string).config.physicalTuningAcknowledged).toBe(true);
    await waitFor(() => expect(toggle).not.toBeChecked()); expect(start).toBeDisabled();
  });
  it('keeps offline physical miners locked and never requires hardware acknowledgement in demo mode', () => {
    mockApi(); const { rerender } = render(<Tuning device={{ ...device, demo: false, status: 'offline' }} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start tuning' })).toBeDisabled();
    rerender(<Tuning device={device} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start tuning' })).toBeEnabled();
  });
});
describe('tuning setup prefills', () => {
  it('uses extrema of unsorted AxeOS options, excluding custom current settings', () => {
    expect(tuningDefaults(snapshot)).toMatchObject({ frequencyMin: '400', frequencyMax: '625', voltageMin: '1000', voltageMax: '1200',
      frequencyStep: '25', voltageStep: '10', maxErrorPercentage: '2', maxAsicTemperature: '65', maxVrmTemperature: '85' });
    expect(snapshot.settings).toEqual({ frequency: 825, coreVoltage: 1180 });
  });
  it('leaves unavailable bounds empty instead of inventing operating ranges', () => {
    expect(tuningDefaults(null)).toMatchObject({ frequencyMin: '', frequencyMax: '', voltageMin: '', voltageMax: '' });
    expect(tuningDefaults({ ...snapshot, capabilities: { ...snapshot.capabilities, frequencies: [] } })).toMatchObject({ frequencyMin: '', frequencyMax: '', voltageMin: '1000', voltageMax: '1200' });
  });
  it('handles a single reported frequency or voltage option', () => {
    expect(tuningDefaults({ ...snapshot, capabilities: { ...snapshot.capabilities, frequencies: [500], voltages: [1150] } })).toMatchObject({ frequencyMin: '500', frequencyMax: '500', voltageMin: '1150', voltageMax: '1150' });
  });
  it('renders editable defaults, previews the actual endpoints, and preserves edits across fleet refreshes', async () => {
    mockApi(); const { rerender } = render(<Tuning device={device} />);
    expect(screen.getByLabelText('Minimum frequency (MHz)')).toHaveValue(400);
    expect(screen.getByLabelText('Maximum frequency (MHz)')).toHaveValue(625);
    expect(screen.getByLabelText('Voltage step (mV)')).toHaveValue(10);
    expect(screen.getByLabelText('Maximum hash error (%)')).toHaveValue(2);
    expect(screen.getByLabelText('ASIC temperature limit (°C)')).toHaveValue(65);
    expect(screen.getByLabelText('VRM temperature limit (°C)')).toHaveValue(85);
    expect(screen.getByRole('status')).toHaveTextContent('400–625 MHz · 1000–1200 mV');
    const user = userEvent.setup(); await user.clear(screen.getByLabelText('Minimum frequency (MHz)'));
    await user.type(screen.getByLabelText('Minimum frequency (MHz)'), '450');
    rerender(<Tuning device={{ ...device, snapshot: { ...snapshot, capabilities: { ...snapshot.capabilities, frequencies: [300, 700] } } }} />);
    expect(screen.getByLabelText('Minimum frequency (MHz)')).toHaveValue(450);
    expect(screen.getByLabelText('Maximum frequency (MHz)')).toHaveValue(625);
  });
  it('fills newly available options without restoring a deliberately cleared bound', async () => {
    mockApi(); const empty = { ...snapshot, capabilities: { ...snapshot.capabilities, frequencies: [], voltages: [] } };
    const { rerender } = render(<Tuning device={{ ...device, snapshot: empty }} />);
    expect(screen.getByLabelText('Minimum frequency (MHz)')).toHaveValue(null);
    await userEvent.type(screen.getByLabelText('Minimum voltage (mV)'), '900');
    await userEvent.clear(screen.getByLabelText('Minimum voltage (mV)'));
    rerender(<Tuning device={device} />);
    await waitFor(() => expect(screen.getByLabelText('Minimum frequency (MHz)')).toHaveValue(400));
    expect(screen.getByLabelText('Minimum voltage (mV)')).toHaveValue(null);
    expect(screen.getByLabelText('Maximum voltage (mV)')).toHaveValue(1200);
    expect(screen.getByRole('button', { name: 'Start tuning' })).toBeDisabled();
  });
});
