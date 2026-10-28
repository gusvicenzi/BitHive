// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { moveMiner, orderedMiners, readMinerOrder, saveMinerOrder } from '../src/web/miner-order';
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('persists order, ignores removed miners and appends newly discovered miners', () => {
  expect(saveMinerOrder(['b', 'removed', 'a'])).toBe(true);
  expect(orderedMiners([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], readMinerOrder()).map(d => d.id)).toEqual(['b', 'a', 'c', 'd']);
});
it('moves a miner in both directions and preserves hidden slots', () => {
  const ids = ['a', 'hidden', 'b', 'c'];
  expect(moveMiner(ids, ['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'hidden', 'c', 'a']);
  expect(moveMiner(ids, ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'hidden', 'a', 'b']);
  expect(moveMiner(ids, ['a', 'b', 'c'], 'hidden', 'a')).toBe(ids);
  expect(moveMiner(ids, ['a', 'b', 'c'], 'a', 'a')).toBe(ids);
});
it('recovers from corrupt or inaccessible storage and reports save failures', () => {
  for (const value of ['oops', '{}', '[1]', '["a", null]', '[""]']) {
    localStorage.setItem('bithive.minerOrder', value); expect(readMinerOrder()).toEqual([]);
  }
  localStorage.setItem('bithive.minerOrder', '["a","a"]'); expect(readMinerOrder()).toEqual(['a']);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
  expect(readMinerOrder()).toEqual([]);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(saveMinerOrder(['a'])).toBe(false);
});
