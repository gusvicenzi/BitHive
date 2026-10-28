// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import '../src/web/i18n';
import { PoolProfiles } from '../src/web/PoolProfiles';
import { Configuration } from '../src/web/Configuration';
import { DemoAdapter } from '../src/server/demo';
import type { DeviceView } from '../src/shared/domain';
const settings = { stratumURL: 'pool.example.com', stratumPort: 3333, stratumAccount: 'wallet' };
const profile = { id: 'p', name: 'Main', settings };
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function miner(): Promise<DeviceView> { return { id: 'a', name: 'Gamma', address: 'demo-1', demo: true, status: 'online', lastSeen: new Date().toISOString(), snapshot: (await new DemoAdapter().read('demo-1')).snapshot }; }
it('copies a miner into an editable draft and saves public fields without dispatching configuration', async () => {
  const fetch = vi.fn((url: string, options?: RequestInit) => response(options?.method === 'POST' ? { ...profile, ...JSON.parse(String(options.body)) } : []));
  vi.stubGlobal('fetch', fetch);
  render(<PoolProfiles devices={[await miner()]} />);
  await userEvent.selectOptions(await screen.findByLabelText('Copy from a Bitaxe'), 'a');
  expect(screen.getByLabelText('Pool profile name')).toHaveValue('Gamma');
  expect(screen.getByLabelText('Payout address / account (without worker)')).toHaveValue('demo');
  await userEvent.click(screen.getByRole('button', { name: 'Save pool profile' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Pool profile saved');
  const writes = fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(writes).toHaveLength(1); expect(writes[0][0]).toBe('/api/pool-profiles');
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ name: 'Gamma', settings: { ...settings, stratumAccount: 'demo' } });
});
it('keeps a failed save draft and a failed deletion available for recovery', async () => {
  vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => options?.method === 'POST' ? response({ error: 'operationFailed' }, false) : response([profile])));
  render(<PoolProfiles devices={[]} />);
  await userEvent.click(await screen.findByRole('button', { name: /Main/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Save pool profile' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByLabelText('Pool profile name')).toHaveValue('Main');
  await userEvent.click(screen.getByRole('button', { name: 'Delete profile' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: /Main/ })).toBeVisible();
});
it('loads pool fields without applying, preserves operating drafts, clears a prior password and requires explicit apply', async () => {
  const apply = vi.fn();
  vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/pool-profiles' ? [profile] : [])));
  render(<Configuration device={await miner()} count={1} busy={false} onApply={apply} />);
  await screen.findAllByRole('option', { name: 'Main' });
  await userEvent.selectOptions(screen.getByLabelText('Frequency (MHz)'), '550');
  await userEvent.type(screen.getByLabelText('Pool password'), 'old-secret');
  await userEvent.selectOptions(screen.getByLabelText('Load pool profile'), 'p');
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Pool password')).toHaveValue('');
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveValue('wallet.demo-1');
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveAttribute('readonly');
  await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
  expect(apply).toHaveBeenCalledWith({ frequency: 550 }, undefined, { primary: 'wallet' });
  expect(screen.getByLabelText('Load pool profile')).toHaveValue('');
});


it('derives workers from the AxeOS name rather than the local label and follows refreshed names', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/pool-profiles' ? [profile] : [])));
  const device = await miner(); device.snapshot!.hostname = ' Living Room AXE ';
  const apply = vi.fn();
  const { rerender } = render(<Configuration device={device} count={2} busy={false} onApply={apply} />);
  await screen.findAllByRole('option', { name: 'Main' });
  await userEvent.selectOptions(screen.getByLabelText('Load pool profile'), 'p');
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveValue('wallet.livingroomaxe');
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveAttribute('readonly');
  const refreshed = { ...device, snapshot: { ...device.snapshot!, hostname: 'Office AXE' } };
  rerender(<Configuration device={refreshed} count={2} busy={false} onApply={apply} />);
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveValue('wallet.officeaxe');
  await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
  expect(apply).toHaveBeenCalledWith({ stratumURL: 'pool.example.com', stratumPort: 3333 }, undefined, { primary: 'wallet' });
});
it('does not substitute a display label when the AxeOS hostname is missing', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/pool-profiles' ? [profile] : [])));
  const device = await miner(); delete device.snapshot!.hostname;
  render(<Configuration device={device} count={1} busy={false} onApply={vi.fn()} />);
  expect(screen.getByLabelText('Load pool profile')).toBeDisabled();
  expect(screen.getByLabelText('Load fallback pool profile')).toBeDisabled();
  expect(screen.getAllByText('Set a name in AxeOS and refresh this miner before using a pool profile.')).toHaveLength(2);
});
