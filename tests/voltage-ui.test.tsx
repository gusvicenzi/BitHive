// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { App } from '../src/web/App';

afterEach(() => { cleanup(); window.location.hash = ''; vi.unstubAllGlobals(); localStorage.clear(); void i18n.changeLanguage('en'); });
describe('input voltage in miner views', () => {
  it.each([
    { voltage: 5.21, status: 'online', language: 'en', label: 'Input voltage', cell: '5.21V', fact: '5.21 V' },
    { voltage: 12.08, status: 'stale', language: 'pt-BR', label: 'Tensão de entrada', cell: '12,08V', fact: '12,08 V' },
    { voltage: 0, status: 'online', language: 'en', label: 'Input voltage', cell: '0V', fact: '0 V' },
    { voltage: undefined, status: 'offline', language: 'en', label: 'Input voltage', cell: '—V', fact: '—' },
  ])('shows $voltage V for $status miners in $language', async ({ voltage, status, language, label, cell, fact }) => {
    await i18n.changeLanguage(language);
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url === '/api/devices' ? [{
      id: 'a', name: 'Office miner', address: '192.168.1.42', demo: false, status, lastSeen: null,
      snapshot: { inputVoltage: voltage, settings: {}, capabilities: { writable: [], frequencies: [], voltages: [], poolMode: 'none' } },
    }] : url.includes('/history') ? { metrics: [], events: [], changes: [], limit: 1000 } : [] })));
    render(<App />);
    const header = await screen.findByRole('columnheader', { name: label, exact: true });
    const columns = within(header.closest('tr')!).getAllByRole('columnheader');
    const button = screen.getByRole('button', { name: 'Office miner', exact: true });
    const row = button.closest('tr')!;
    expect(within(row).getAllByRole('cell')[columns.indexOf(header)]).toHaveTextContent(cell);
    if (status !== 'online') expect(row).toHaveClass('stale-row');
    await userEvent.click(button);
    const term = await screen.findByText(label, { selector: 'dt', exact: true });
    expect(term.nextElementSibling).toHaveTextContent(fact);
  });
});
