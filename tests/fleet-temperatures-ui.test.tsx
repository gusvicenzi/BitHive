// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { App } from '../src/web/App';
afterEach(() => { cleanup(); localStorage.clear(); location.hash = ''; vi.unstubAllGlobals(); void i18n.changeLanguage('en'); });
it('pairs chip and VRM readings in one fleet column with independent scales, labels and stale/missing states', async () => {
  const devices = [
    { id: 'a', name: 'Online miner', status: 'online', snapshot: { temp: 65, vrTemp: 65 } },
    { id: 'b', name: 'Offline miner', status: 'offline', snapshot: { temp: 59, vrTemp: 75 } },
    { id: 'c', name: 'Missing VRM', status: 'online', snapshot: { temp: 60 } },
    { id: 'd', name: 'Invalid readings', status: 'online', snapshot: { temp: -1, vrTemp: -1 } },
    { id: 'e', name: 'No snapshot', status: 'offline' },
  ].map(d => ({ address: d.id, demo: false, ...d }));
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url === '/api/devices' ? devices : [] })));
  render(<App />);
  await screen.findByRole('button', { name: 'Online miner', exact: true });
  expect(screen.getAllByRole('columnheader', { name: 'Temperatures' })).toHaveLength(1);
  const row = (name: string) => screen.getByRole('button', { name, exact: true }).closest('tr')!;
  const online = row('Online miner').querySelector('.fleet-temperatures')!;
  const chip = within(online as HTMLElement).getByTitle(/^Chip:/);
  const vrm = within(online as HTMLElement).getByTitle(/^VRM:/);
  expect(chip).toHaveTextContent('65'); expect(vrm).toHaveTextContent('65');
  expect(chip).toHaveAttribute('data-band', 'high'); expect(vrm).toHaveAttribute('data-band', 'mid');
  expect(chip.parentElement).toBe(vrm.parentElement);
  expect(row('Offline miner').querySelectorAll('.temperature-stale')).toHaveLength(2);
  expect(within(row('Missing VRM')).getByTitle('VRM')).toHaveTextContent('—');
  for (const name of ['Invalid readings', 'No snapshot']) {
    expect(row(name).querySelectorAll('.temperature-unavailable')).toHaveLength(2);
    expect(row(name).querySelectorAll('[data-band]')).toHaveLength(0);
  }
  await i18n.changeLanguage('pt-BR');
  expect(await screen.findByRole('columnheader', { name: 'Temperaturas' })).toBeInTheDocument();
});
