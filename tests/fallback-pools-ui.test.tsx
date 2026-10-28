// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import '../src/web/i18n';
import { PoolProfiles } from '../src/web/PoolProfiles';
import { Configuration } from '../src/web/Configuration';
import { DemoAdapter } from '../src/server/demo';
import type { DeviceView } from '../src/shared/domain';
const profile = { id: 'p', name: 'Backup', settings: { stratumURL: 'backup.example.com', stratumPort: 4444, stratumUser: 'wallet.backup' } };
const response = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function miner(): Promise<DeviceView> { return { id: 'a', name: 'Gamma', address: 'demo-1', demo: true, status: 'online', lastSeen: new Date().toISOString(), snapshot: (await new DemoAdapter().read('demo-1')).snapshot }; }
it('copies a fallback into a portable profile draft without writing a miner', async () => {
  const fetch = vi.fn(() => response([])); vi.stubGlobal('fetch', fetch);
  render(<PoolProfiles devices={[await miner()]} />);
  await waitFor(() => expect(screen.getByLabelText('Pool to copy')).toBeEnabled());
  await userEvent.selectOptions(screen.getByLabelText('Pool to copy'), 'fallback');
  await userEvent.selectOptions(screen.getByLabelText('Copy from a Bitaxe'), 'a');
  expect(screen.getByLabelText('Pool hostname')).toHaveValue('backup.example.com');
  expect(screen.getByLabelText('Pool port')).toHaveValue(3334);
  expect(screen.getByLabelText('Payout address / account.worker')).toHaveValue('demo.backup1');
  expect(fetch.mock.calls).toHaveLength(1);
});
it('loads a profile into fallback only, preserves primary drafts and requires explicit application', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => response(url === '/api/pool-profiles' ? [profile] : [])));
  const apply = vi.fn(); render(<Configuration device={await miner()} count={1} busy={false} onApply={apply} />);
  await screen.findAllByRole('option', { name: 'Backup' });
  await userEvent.type(screen.getByLabelText('Pool hostname'), 'primary.example.com');
  await userEvent.type(screen.getByLabelText('Pool password'), 'primary-draft');
  await userEvent.type(screen.getByLabelText('Fallback pool password'), 'old-fallback');
  await userEvent.selectOptions(screen.getByLabelText('Load fallback pool profile'), 'p');
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Pool hostname')).toHaveValue('primary.example.com');
  expect(screen.getByLabelText('Pool password')).toHaveValue('primary-draft');
  expect(screen.getByLabelText('Fallback pool password')).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Apply & verify' }));
  expect(apply).toHaveBeenCalledWith({ stratumURL: 'primary.example.com', stratumPassword: 'primary-draft', fallbackStratumURL: 'backup.example.com', fallbackStratumPort: 4444, fallbackStratumUser: 'wallet.backup' });
});
it('keeps unavailable fallback controls disabled', async () => {
  vi.stubGlobal('fetch', vi.fn(() => response([])));
  const device = await miner(); device.snapshot!.capabilities.fallbackPoolMode = 'none';
  render(<Configuration device={device} count={1} busy={false} onApply={vi.fn()} />);
  expect(screen.getByLabelText('Load fallback pool profile')).toBeDisabled();
  expect(screen.getByLabelText('Fallback pool hostname')).toBeDisabled();
  expect(screen.getByText(/Fallback configuration is unavailable/)).toBeVisible();
});
