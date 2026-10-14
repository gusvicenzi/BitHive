// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import i18n from '../src/web/i18n';
import { BestDifficulty } from '../src/web/BestDifficulty';
import { Chart } from '../src/web/Chart';

beforeEach(() => { void i18n.changeLanguage('en'); });
afterEach(() => { cleanup(); void i18n.changeLanguage('en'); });
describe('best difficulty readout', () => {
  it('shows the full number on hover and hides it when the pointer leaves', async () => {
    render(<BestDifficulty value="1564123456789" />);
    const value = screen.getByRole('button', { name: 'Show full best difficulty' });
    expect(value).toHaveTextContent('1.564T');
    await userEvent.hover(value); expect(screen.getByRole('tooltip')).toHaveTextContent('1,564,123,456,789');
    await userEvent.unhover(value); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('supports focus, touch/click, and Escape dismissal', async () => {
    render(<BestDifficulty value="1564123456" />);
    await userEvent.tab(); expect(screen.getByRole('tooltip')).toHaveTextContent('1,564,123,456');
    await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button')); expect(screen.getByRole('tooltip')).toHaveTextContent('1,564,123,456');
    fireEvent.blur(screen.getByRole('button')); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('identifies expanded firmware values and localizes the number', async () => {
    await i18n.changeLanguage('pt-BR'); render(<BestDifficulty value="2.41G" />);
    await userEvent.hover(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('2,410G');
    expect(screen.getByRole('tooltip')).toHaveTextContent('2.410.000.000');
    expect(screen.getByRole('tooltip')).toHaveTextContent('valor abreviado');
  });
  it('does not offer a misleading tooltip for missing data', () => {
    render(<BestDifficulty />); expect(screen.getByText('—')).toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
describe('power and temperature tooltip precision', () => {
  it.each([['power', 'W', '28.9 W', 28.8838], ['temp', '°C', '56.8 °C', 56.785], ['power', 'W', '28.0 W', 28], ['temp', '°C', '56.0 °C', 56]] as const)('formats %s tooltip as %s', (field, unit, expected, value) => {
    const metrics = [0, 15].map(seconds => ({ timestamp: new Date(seconds * 1000).toISOString(), hashRate: 1712, power: value, temp: value, vrTemp: 60, errorRate: 0 }));
    render(<Chart metrics={metrics} field={field} unit={unit} label={field} />);
    fireEvent.focus(screen.getByRole('slider'));
    expect(screen.getByRole('tooltip')).toHaveTextContent(expected);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', expect.stringContaining(expected));
  });
});
