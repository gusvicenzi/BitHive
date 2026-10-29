// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { Schedules } from '../src/web/Schedules';
import { DemoAdapter } from '../src/server/demo';
import type { DeviceView } from '../src/shared/domain';
import type { ScheduleInput, ScheduleView } from '../src/shared/schedules';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); void i18n.changeLanguage('en'); });
async function setup(custom = false) {
  await i18n.changeLanguage('en');
  const snapshot = (await new DemoAdapter().read('demo-1')).snapshot;
  const devices: DeviceView[] = ['a', 'b'].map(id => ({ id, name: `Miner ${id.toUpperCase()}`, address: `demo-${id}`, demo: true, status: 'online', snapshot, lastSeen: null }));
  let saved: ScheduleView | undefined;
  const fetch = vi.fn(async (url: string, options?: RequestInit) => {
    let data: unknown;
    if (url.endsWith('/profiles')) {
      const miner = url.includes('/a/') ? 'a' : 'b';
      data = [{ id: `${miner}-fast`, name: `${miner} Fast`, settings: { frequency: custom ? 537 : 550 } }, { id: `${miner}-quiet`, name: `${miner} Quiet`, settings: { frequency: 400 } }];
    } else if (options?.method === 'POST') {
      const body: ScheduleInput = JSON.parse(String(options.body));
      if (url.endsWith('/enable')) saved = { ...saved!, enabled: true };
      else saved = { ...body, id: 'schedule-1', enabled: false, revision: 1, current: { pointId: 'day', name: 'Day', at: '2026-10-26T08:00:00Z' }, next: { pointId: 'night', name: 'Night', at: '2026-10-26T22:00:00Z' }, results: [] };
      data = saved;
    } else data = saved ? [saved] : [];
    return { ok: true, json: async () => data };
  });
  vi.stubGlobal('fetch', fetch); render(<Schedules devices={devices} />);
  await screen.findByText('Create a weekly timetable, then choose a profile for each miner at each change time.');
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith('/profiles'))).toHaveLength(2));
  return fetch;
}
describe('schedule editor', () => {
  it('assigns device-owned profiles to a shared timetable and previews exact settings before enabling', async () => {
    const fetch = await setup(); const user = userEvent.setup();
    await user.type(screen.getByLabelText('Schedule name'), 'Home');
    for (const miner of ['A', 'B']) {
      await user.click(screen.getByLabelText(`Schedule Miner ${miner}`));
      await user.selectOptions(screen.getByLabelText(`Miner ${miner} · Day profile`), `${miner.toLowerCase()}-fast`);
      await user.selectOptions(screen.getByLabelText(`Miner ${miner} · Night profile`), `${miner.toLowerCase()}-quiet`);
    }
    await user.click(screen.getByRole('button', { name: 'Save schedule', exact: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Schedule saved.');
    const body = JSON.parse(String(fetch.mock.calls.find(([url, options]) => url === '/api/schedules' && options?.method === 'POST')?.[1]?.body));
    expect(body.members.map((m: { assignments: unknown }) => m.assignments)).toEqual([{ day: 'a-fast', night: 'a-quiet' }, { day: 'b-fast', night: 'b-quiet' }]);
    await user.click(screen.getByRole('button', { name: 'Enable schedule', exact: true }));
    const preview = screen.getByRole('region', { name: 'Review profile settings' });
    expect(within(preview).getAllByText('Frequency (MHz): 550')).toHaveLength(2);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/enable'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Schedule enabled.');
    expect(fetch.mock.calls.some(([url, options]) => url.endsWith('/enable') && (options?.headers as Record<string, string>)['X-BitHive'] === '1')).toBe(true);
  });
  it('clears custom acknowledgment when profile assignments change and localizes controls', async () => {
    await setup(true); const user = userEvent.setup();
    await user.click(screen.getByLabelText('Schedule Miner A'));
    await user.selectOptions(screen.getByLabelText('Miner A · Day profile'), 'a-fast');
    const ack = screen.getByRole('checkbox', { name: /I acknowledge.*Miner A/ });
    await user.click(ack); expect(ack).toBeChecked();
    await user.selectOptions(screen.getByLabelText('Miner A · Night profile'), 'a-quiet'); expect(ack).not.toBeChecked();
    await i18n.changeLanguage('pt-BR'); expect(await screen.findByLabelText('Nome do agendamento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar agendamento' })).toBeInTheDocument();
  });
  it('rejects overlapping times before saving and displays useful recovery guidance', async () => {
    const fetch = await setup(); const user = userEvent.setup();
    await user.type(screen.getByLabelText('Schedule name'), 'Home');
    await user.clear(screen.getByLabelText('Change time 2')); await user.type(screen.getByLabelText('Change time 2'), '08:00');
    await user.click(screen.getByRole('button', { name: 'Save schedule', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Change times cannot overlap');
    expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
});
