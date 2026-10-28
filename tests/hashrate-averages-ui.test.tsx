// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import i18n from '../src/web/i18n';
import { App } from '../src/web/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); void i18n.changeLanguage('en'); });
it.each(['en', 'pt-BR'])('shows summed and per-miner averages in %s with missing periods hidden', async language => {
  await i18n.changeLanguage(language);
  const device = (id: string, snapshot: object, status = 'online') => ({ id, name: id, address: 'fixture.local', demo: false, status, lastSeen: null, snapshot });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [
    device('Gamma A', { hashRate: 1700, hashRate_1m: 1600, hashRate_10m: 1500, hashRate_1h: 1400 }),
    device('Gamma B', { hashRate: 1800, hashRate_1m: 1700, hashRate_1h: 0 }),
    device('Legacy', { hashRate: 1000 }),
    device('Stale', { hashRate: 9000, hashRate_1m: 9000 }, 'stale'),
  ] })));
  render(<App />);
  const button = await screen.findByRole('button', { name: 'Gamma A', exact: true });
  const fleet = screen.getByText(language === 'en' ? 'Fleet hashrate' : 'Hashrate da frota').closest('article')!;
  expect(fleet.querySelector('strong')).toHaveTextContent(language === 'en' ? '4.5' : '4,5');
  expect(fleet.querySelector('.hashrate-averages')).toHaveTextContent(language === 'en' ? '3.3' : '3,3');
  expect(fleet.querySelector('.hashrate-averages')).toHaveTextContent('2/3');
  expect(fleet.querySelector('.hashrate-averages')).toHaveTextContent('1/3');
  const row = button.closest('tr')!;
  expect(row.querySelector('.hashrate-averages')).toHaveTextContent(language === 'en' ? '1.6' : '1,6');
  const disclosure = row.querySelector('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  const summary = row.querySelector('summary')!;
  await userEvent.click(summary);
  expect(disclosure).toHaveAttribute('open');
  expect(row.querySelector('.hashrate-averages')).not.toHaveTextContent('TH/s');
  expect(row.querySelector('.hashrate-averages')).toHaveAccessibleName(`${language === 'en' ? 'Average hashrates' : 'Hashrates médios'} (TH/s)`);
  await userEvent.click(summary);
  expect(disclosure).not.toHaveAttribute('open');
  const second = screen.getByRole('button', { name: 'Gamma B', exact: true }).closest('tr')!;
  expect(second.querySelectorAll('.hashrate-averages>div')).toHaveLength(2);
  expect(second.querySelector('.hashrate-averages')).toHaveTextContent('0');
  expect(screen.getByRole('button', { name: 'Legacy', exact: true }).closest('tr')!.querySelector('.hashrate-averages')).toBeNull();
});
