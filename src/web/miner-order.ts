const storageKey = 'bithive.minerOrder';
export function readMinerOrder(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) && value.length <= 500 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64)
      ? [...new Set(value)] : [];
  } catch { return []; }
}
export function saveMinerOrder(ids: string[]): boolean {
  try { localStorage.setItem(storageKey, JSON.stringify(ids)); return true; } catch { return false; }
}
export function orderedMiners<T extends { id: string }>(devices: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return devices.toSorted((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
// Reorder visible slots only, keeping filtered-out miners in place.
export function moveMiner(ids: string[], visible: string[], source: string, target: string): string[] {
  const from = visible.indexOf(source), to = visible.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const moved = [...visible]; moved.splice(from, 1); moved.splice(to, 0, source);
  const shown = new Set(visible); let next = 0;
  return ids.map(id => shown.has(id) ? moved[next++] : id);
}
