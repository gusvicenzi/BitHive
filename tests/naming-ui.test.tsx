// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import '../src/web/i18n';
import { DeviceNaming } from '../src/web/DeviceNaming';
import { App } from '../src/web/App';
import { DemoAdapter } from '../src/server/demo';
import type { DeviceView } from '../src/shared/domain';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
async function device(): Promise<DeviceView> {
  return { id: 'a', address: 'demo-1', name: 'Desk miner', demo: true, status: 'online', lastSeen: new Date().toISOString(), snapshot: (await new DemoAdapter().read('demo-1')).snapshot };
}
describe('miner name controls', () => {
  it('allows registration with just an address', async () => {
    const fetch = vi.fn(() => response([])); vi.stubGlobal('fetch', fetch);
    render(<App />); await screen.findByText('Your hive starts with one miner.');
    await userEvent.click(screen.getByRole('button', { name: 'Add miner' }));
    expect(screen.getByLabelText('BitHive display name (optional)')).not.toBeRequired();
    await userEvent.type(screen.getByLabelText('Local IP or hostname'), '192.168.1.42');
    await userEvent.click(screen.getByRole('button', { name: 'Connect miner' }));
    const calls = fetch.mock.calls as unknown as [string, RequestInit?][];
    expect(JSON.parse(calls.find(([url, options]) => url === '/api/devices' && options?.method === 'POST')![1]!.body as string)).toEqual({ address: '192.168.1.42' });
  });
  it('saves a local display name without issuing a miner configuration action', async () => {
    const fetch = vi.fn(() => response({})); vi.stubGlobal('fetch', fetch); const updated = vi.fn(async () => {});
    render(<DeviceNaming device={await device()} busy={false} onUpdated={updated} />);
    await userEvent.clear(screen.getByLabelText('BitHive display name'));
    await userEvent.type(screen.getByLabelText('BitHive display name'), 'Office miner');
    await userEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Display name saved');
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('/api/devices/a/name');
    expect(updated).toHaveBeenCalledTimes(1);
  });
  it('sends a distinct per-miner AxeOS name change and clears uncertain drafts', async () => {
    const fetch = vi.fn(() => response([{ id: 'a', result: 'unknown' }])); vi.stubGlobal('fetch', fetch);
    render(<DeviceNaming device={await device()} busy={false} onUpdated={vi.fn(async () => {})} />);
    await userEvent.clear(screen.getByLabelText('AxeOS name (hostname)'));
    await userEvent.type(screen.getByLabelText('AxeOS name (hostname)'), 'office-gamma');
    await userEvent.click(screen.getByRole('button', { name: 'Change AxeOS name & verify' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Outcome unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ ids: ['a'], action: 'configure', settings: { hostname: 'office-gamma' } });
    expect(screen.getByRole('button', { name: 'Change AxeOS name & verify' })).toBeDisabled();
  });
  it('blocks invalid hostnames and unavailable miner writes but allows local names', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const d = await device();
    const { rerender } = render(<DeviceNaming device={d} busy={false} onUpdated={vi.fn(async () => {})} />);
    await userEvent.clear(screen.getByLabelText('AxeOS name (hostname)'));
    await userEvent.type(screen.getByLabelText('AxeOS name (hostname)'), 'bad.local');
    await userEvent.click(screen.getByRole('button', { name: 'Change AxeOS name & verify' }));
    expect(fetch).not.toHaveBeenCalled();
    rerender(<DeviceNaming device={{ ...d, status: 'offline' }} busy={false} onUpdated={vi.fn(async () => {})} />);
    expect(screen.getByLabelText('AxeOS name (hostname)')).toBeDisabled();
    expect(screen.getByLabelText('BitHive display name')).not.toBeDisabled();
  });
  it('reports failed rename commands without claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response([{ id: 'a', result: 'rejected', reason: 'unsupported' }])));
    render(<DeviceNaming device={await device()} busy={false} onUpdated={vi.fn(async () => {})} />);
    await userEvent.clear(screen.getByLabelText('AxeOS name (hostname)'));
    await userEvent.type(screen.getByLabelText('AxeOS name (hostname)'), 'office-gamma');
    await userEvent.click(screen.getByRole('button', { name: 'Change AxeOS name & verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not support');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
