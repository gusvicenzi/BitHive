// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import '../src/web/i18n';
import { App } from '../src/web/App';
afterEach(() => { cleanup(); location.hash = ''; vi.unstubAllGlobals(); });
it('defers activity until a miner is chosen, pages on demand and clears stale data on filter failures', async () => {
  location.hash = '#activity';
  const fetch = vi.fn((url: string) => Promise.resolve({ ok: !url.includes('section=changes'), json: async () =>
    url === '/api/devices' ? [{ id: 'a', name: 'Miner A' }] : url.includes('section=changes') ? { error: 'deviceUnavailable' } : {
      metrics: [], changes: [], limit: 1000, hasMore: !url.includes('offset=20'), events: [{ id: 1, kind: 'connected', timestamp: new Date().toISOString() }],
    } }));
  vi.stubGlobal('fetch', fetch); render(<App />);
  await screen.findByRole('option', { name: 'Miner A' });
  expect(fetch.mock.calls.filter(([url]) => url.includes('/history'))).toHaveLength(0);
  await userEvent.selectOptions(screen.getByLabelText('Miner'), 'a');
  await screen.findByRole('button', { name: 'Next' });
  expect(fetch.mock.calls.at(-1)![0]).toContain('hours=1&section=events&offset=0&pageSize=20');
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
  expect(fetch.mock.calls.at(-1)![0]).toContain('offset=20');
  await userEvent.selectOptions(screen.getByLabelText('Activity type'), 'changes');
  expect(await screen.findByRole('alert')).toHaveTextContent('Check its address');
  expect(fetch.mock.calls.at(-1)![0]).toContain('section=changes&offset=0');
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
});
