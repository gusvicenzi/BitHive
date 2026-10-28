// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { MinerFacts } from '../src/web/MinerFacts';
import { TemperatureReading } from '../src/web/TemperatureReading';
import type { DeviceView } from '../src/shared/domain';
const device: DeviceView = { id: 'a', name: 'Bitaxe03', address: '192.168.0.223', status: 'online', demo: false, lastSeen: '2026-10-28T17:11:50Z', snapshot: {
  model: 'GammaV2', firmware: 'v2', hashRate: 1210, hashRate_1m: 1200, power: 19.4, inputVoltage: 12.03, temp: 59.9, vrTemp: 75, errorRate: .07,
  settings: {}, capabilities: { frequencies: [], voltages: [], writable: [], poolMode: 'none' },
} };
afterEach(() => { cleanup(); void i18n.changeLanguage('en'); });
it('places all primary fleet readings first and adds averages and last successful update', () => {
  const { container } = render(<MinerFacts device={device} />);
  expect([...container.querySelectorAll('.miner-headline > div')].map(div => div.getAttribute('data-fact'))).toEqual(['status', 'hashrate', 'power', 'efficiency', 'temperature', 'regulatorTemp', 'hashErrorPercent']);
  const readings = screen.getByLabelText('Miner live readings');
  expect(readings).toHaveTextContent('Online'); expect(readings).toHaveTextContent('1.21 TH/s'); expect(readings).toHaveTextContent('19.4 W'); expect(readings).toHaveTextContent('16.03 J/TH');
  expect(readings).toHaveTextContent('59.9 °C'); expect(readings).toHaveTextContent('0.07 %');
  expect(within(readings).getByText('1.2')).toBeInTheDocument();
  expect(container.querySelector('[data-fact="inputVoltage"]')).toHaveTextContent('12.03 V');
  expect(container.querySelector('time')).toHaveAttribute('datetime', device.lastSeen);
});
it('shows independent temperature colors with accessible bands and stale markers', () => {
  const { container, rerender } = render(<TemperatureReading value={75} sensor="chip" />);
  expect(container.querySelector('[data-band]')).toHaveAttribute('data-band', 'danger');
  expect(container).toHaveTextContent('Danger');
  expect(container.querySelector('[title]')).toHaveAttribute('title', expect.stringContaining('danger ≥75°C'));
  rerender(<TemperatureReading value={75} sensor="vrm" stale />);
  expect(container.querySelector('[data-band]')).toHaveAttribute('data-band', 'mid');
  expect(container.querySelector('.temperature-reading')).toHaveClass('temperature-stale');
  expect(container).toHaveTextContent('reading is stale');
  rerender(<TemperatureReading value={-1} sensor="chip" />);
  expect(container).toHaveTextContent('—'); expect(container.querySelector('[data-band]')).toBeNull();
});
it('localizes numbers and temperature bands and keeps missing telemetry neutral', async () => {
  await i18n.changeLanguage('pt-BR');
  const { container } = render(<MinerFacts device={{ ...device, lastSeen: null, snapshot: { ...device.snapshot!, temp: 65, vrTemp: undefined } }} />);
  expect(container.querySelector('[data-fact="hashrate"]')).toHaveTextContent('1,21 TH/s');
  expect(container.querySelector('[data-fact="temperature"]')).toHaveTextContent('Alta');
  expect(container.querySelector('[data-fact="regulatorTemp"]')).toHaveTextContent('—');
  expect(container.querySelector('[data-fact="regulatorTemp"] .temperature-reading')).toBeNull();
});
it('groups live fan duty with RPM and does not display the manual setting as telemetry', () => {
  const { container, rerender } = render(<MinerFacts device={{ ...device, snapshot: { ...device.snapshot!, fanRpm: 4000, fanPercent: 42.5, settings: { autofanspeed: 1, manualFanSpeed: 80 } } }} />);
  expect(container.querySelector('[data-fact="fanSpeed"]')).toHaveTextContent('4,000 RPM · 42.5 %');
  rerender(<MinerFacts device={{ ...device, snapshot: { ...device.snapshot!, fanRpm: 0, fanPercent: 0 } }} />);
  expect(container.querySelector('[data-fact="fanSpeed"]')).toHaveTextContent('0 RPM · 0 %');
  rerender(<MinerFacts device={{ ...device, snapshot: { ...device.snapshot!, fanRpm: 4000, settings: { manualFanSpeed: 80 } } }} />);
  expect(screen.getByLabelText('Live fan speed (%)')).toHaveTextContent('— %');
  expect(container.querySelector('[data-fact="fanSpeed"]')).not.toHaveTextContent('80');
});
