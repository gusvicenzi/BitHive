// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { Chart } from '../src/web/Chart';
import type { MetricView } from '../src/shared/domain';

const sample = (seconds: number, hashRate: number | null, power = 27.6, temp = 54.25): MetricView => ({ timestamp: new Date(seconds * 1000).toISOString(), hashRate, power, temp, vrTemp: 60, errorRate: 0 });
const metrics = [sample(0, 1000), sample(15, 1500.1234), sample(60, 1200)];
class Pointer extends MouseEvent {
  pointerType: string;
  constructor(type: string, options: MouseEventInit & { pointerType?: string } = {}) { super(type, options); this.pointerType = options.pointerType ?? 'mouse'; }
}
beforeEach(() => { vi.stubGlobal('PointerEvent', Pointer); void i18n.changeLanguage('en'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); void i18n.changeLanguage('en'); });
function bounds(element: HTMLElement) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 500, top: 0, bottom: 160, width: 400, height: 160, x: 100, y: 0, toJSON: () => ({}) });
}
describe('interactive history charts', () => {
  it.each([['hashRate', 'GH/s', 'Hashrate'], ['power', 'W', 'Power'], ['temp', '°C', 'Temperature']] as const)('shows a labeled %s scale and matching grid lines', (field, unit, label) => {
    const { container } = render(<Chart metrics={metrics} field={field} unit={unit} label={label} />);
    const axis = screen.getByLabelText(`${label} scale (${unit})`);
    expect(within(axis).getAllByText(unit).length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.chart-tick')).toHaveLength(container.querySelectorAll('.grid-line').length);
  });
  it('shows the nearest real reading, unit, and timestamp on hover, then hides on leave', () => {
    render(<Chart metrics={metrics} field="hashRate" unit="GH/s" label="Hashrate" />);
    const plot = screen.getByRole('slider'); bounds(plot);
    fireEvent.pointerMove(plot, { clientX: 200 });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('1,500.1234 GH/s');
    expect(tooltip.querySelector('time')).toHaveAttribute('dateTime', metrics[1].timestamp);
    fireEvent.pointerLeave(plot);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('supports keyboard navigation, boundaries, and dismissing the tooltip', async () => {
    render(<Chart metrics={metrics} field="hashRate" unit="GH/s" label="Hashrate" />);
    const plot = screen.getByRole('slider');
    await userEvent.tab(); expect(plot).toHaveFocus(); expect(plot).toHaveAttribute('aria-valuenow', '2');
    await userEvent.keyboard('{ArrowLeft}'); expect(screen.getByRole('tooltip')).toHaveTextContent('1,500.1234');
    await userEvent.keyboard('{Home}{ArrowLeft}'); expect(plot).toHaveAttribute('aria-valuenow', '0');
    await userEvent.keyboard('{End}{ArrowRight}'); expect(plot).toHaveAttribute('aria-valuenow', '2');
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.blur(plot); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('supports touch selection without losing the tooltip on touch leave', () => {
    render(<Chart metrics={metrics} field="power" unit="W" label="Power" />);
    const plot = screen.getByRole('slider'); bounds(plot);
    fireEvent.pointerDown(plot, { clientX: 100, pointerType: 'touch' });
    fireEvent.pointerLeave(plot, { pointerType: 'touch' });
    expect(screen.getByRole('tooltip')).toHaveTextContent('27.6 W');
    fireEvent.blur(plot); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('retains collection gaps and missing readings, without fabricating tooltip values', () => {
    const { container } = render(<Chart metrics={[sample(0, 1000), sample(15, null), sample(30, 1100), sample(180, 1300)]} field="hashRate" unit="GH/s" label="Hashrate" />);
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
    const plot = screen.getByRole('slider'); bounds(plot);
    fireEvent.pointerMove(plot, { clientX: 300 });
    expect(screen.getByRole('tooltip').querySelector('time')).toHaveAttribute('dateTime', sample(30, 1100).timestamp);
  });
  it('localizes tooltip numbers and labels', async () => {
    await i18n.changeLanguage('pt-BR');
    render(<Chart metrics={metrics} field="hashRate" unit="GH/s" label="Hashrate" />);
    const plot = screen.getByRole('slider'); bounds(plot); fireEvent.pointerMove(plot, { clientX: 200 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('1.500,1234 GH/s');
    expect(screen.getByLabelText('Escala de Hashrate (GH/s)')).toBeInTheDocument();
  });
  it('handles duplicate timestamps, invalid values, and a refresh removing the active reading', () => {
    const { container, rerender } = render(<Chart metrics={[sample(0, 1000), sample(0, 1200), sample(1, NaN)]} field="hashRate" unit="GH/s" label="Hashrate" />);
    const plot = screen.getByRole('slider'); bounds(plot); fireEvent.pointerMove(plot, { clientX: 500 });
    expect(container.querySelector('polyline')!.getAttribute('points')).not.toMatch(/NaN|Infinity/);
    rerender(<Chart metrics={[sample(60, 1100), sample(75, 1200)]} field="hashRate" unit="GH/s" label="Hashrate" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
