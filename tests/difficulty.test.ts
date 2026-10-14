import { describe, expect, it } from 'vitest';
import { formatDifficulty } from '../src/web/difficulty';

describe('difficulty display', () => {
  it.each([
    ['1564123', '1.564M', '1,564,123'],
    ['1564123456', '1.564G', '1,564,123,456'],
    ['1564123456789', '1.564T', '1,564,123,456,789'],
    ['1000000', '1.000M', '1,000,000'],
    ['1000000000', '1.000G', '1,000,000,000'],
    ['1000000000000', '1.000T', '1,000,000,000,000'],
    ['999999999', '1.000G', '999,999,999'],
    ['999999999999', '1.000T', '999,999,999,999'],
  ])('formats %s with three decimals and preserves its full number', (input, compact, full) => {
    expect(formatDifficulty(input, 'en')).toEqual({ compact, full, expanded: false });
  });
  it('retains integer precision beyond the JavaScript safe integer range', () => {
    const value = formatDifficulty('1234567890123456789', 'en');
    expect(value.full).toBe('1,234,567,890,123,456,789');
    expect(value.compact).toBe('1,234,567.890T');
  });
  it('expands firmware abbreviations without claiming recovered precision', () => {
    expect(formatDifficulty('2.41G', 'en')).toEqual({ compact: '2.410G', full: '2,410,000,000', expanded: true });
    expect(formatDifficulty('1.564 T', 'en').full).toBe('1,564,000,000,000');
    expect(formatDifficulty('25K', 'en').full).toBe('25,000');
  });
  it('supports scientific notation, small values, and decimal numbers', () => {
    expect(formatDifficulty('1.564e12', 'en').compact).toBe('1.564T');
    expect(formatDifficulty('1564123.125', 'en').full).toBe('1,564,123.125');
    expect(formatDifficulty('123.45', 'en').compact).toBe('123.45');
    expect(formatDifficulty('0', 'en').full).toBe('0');
  });
  it('localizes decimal and thousands separators', () => {
    expect(formatDifficulty('1564123456789', 'pt-BR')).toEqual({ compact: '1,564T', full: '1.564.123.456.789', expanded: false });
  });
  it.each([undefined, '', 'no data', '<script>', '-1', 'Infinity', 'NaN', '1e999', '1'.repeat(65)])('handles unavailable or malformed data %s', value => {
    expect(formatDifficulty(value, 'en')).toEqual({ compact: '—', full: null, expanded: false });
  });
});
