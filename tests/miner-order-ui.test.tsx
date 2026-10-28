// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import '../src/web/i18n';
import { App } from '../src/web/App';
afterEach(() => { cleanup(); localStorage.clear(); location.hash = ''; vi.unstubAllGlobals(); });
const ids = () => [...document.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(row => row.dataset.minerId);
function setup() {
  const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(() => Promise.resolve({ ok: true, json: async () => ['a', 'b', 'c'].map(id => ({ id, name: `Miner ${id}`, address: id, status: id === 'b' ? 'offline' : 'online', demo: false })) }));
  vi.stubGlobal('fetch', fetch); return fetch;
}
it('supports keyboard order, retains selection and saves order across remounts without device commands', async () => {
  const fetch = setup(); const { unmount } = render(<App />);
  await screen.findByRole('button', { name: 'Reorder Miner a' });
  await userEvent.click(screen.getByLabelText('Select Miner a'));
  screen.getByRole('button', { name: 'Reorder Miner a' }).focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(ids()).toEqual(['b', 'a', 'c']);
  expect(screen.getByLabelText('Select Miner a')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Reorder Miner a' })).toHaveFocus();
  unmount(); render(<App />); await screen.findByRole('button', { name: 'Reorder Miner a' });
  expect(ids()).toEqual(['b', 'a', 'c']); expect(fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true);
});
it('drops only internal drags and reorders filtered rows without moving hidden miners', async () => {
  setup(); render(<App />); await screen.findByRole('button', { name: 'Reorder Miner a' });
  await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'online');
  const source = screen.getByRole('button', { name: 'Reorder Miner a' });
  const target = screen.getByRole('button', { name: 'Miner c', exact: true }).closest('tr')!;
  fireEvent.drop(target); expect(ids()).toEqual(['a', 'c']);
  fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn(), setDragImage: vi.fn() } });
  fireEvent.dragOver(target, { dataTransfer: {} }); fireEvent.drop(target);
  expect(ids()).toEqual(['c', 'a']);
  await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'all');
  await waitFor(() => expect(ids()).toEqual(['c', 'b', 'a']));
});
