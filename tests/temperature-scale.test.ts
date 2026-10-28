import { expect, it } from 'vitest';
import { temperatureAppearance, temperatureScales } from '../src/web/temperature-scale';
it('uses independent chip and VRM anchors and interpolates between them', () => {
  expect(temperatureScales.chip).toEqual([40, 55, 65, 75]);
  expect(temperatureScales.vrm).toEqual([45, 65, 85, 105]);
  expect(temperatureAppearance(40, 'chip')).toMatchObject({ color: 'rgb(35, 116, 91)', band: 'low' });
  expect(temperatureAppearance(55, 'chip')).toMatchObject({ color: 'rgb(138, 107, 8)', band: 'mid' });
  expect(temperatureAppearance(60, 'chip')?.color).toBe('rgb(159, 95, 9)');
  expect(temperatureAppearance(65, 'chip')?.band).toBe('high');
  expect(temperatureAppearance(75, 'chip')?.band).toBe('danger');
  expect(temperatureAppearance(75, 'vrm')?.band).toBe('mid');
  expect(temperatureAppearance(85, 'vrm')?.band).toBe('high');
  expect(temperatureAppearance(105, 'vrm')?.band).toBe('danger');
});
it('clamps the palette while preserving extreme readings and rejects invalid sensors', () => {
  expect(temperatureAppearance(200, 'chip')).toEqual(temperatureAppearance(75, 'chip'));
  expect(temperatureAppearance(0, 'chip')).toEqual(temperatureAppearance(40, 'chip'));
  for (const value of [null, undefined, NaN, Infinity, -1]) expect(temperatureAppearance(value, 'vrm')).toBeNull();
});
