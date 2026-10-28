import { useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
export function MinerDragHandle({ id, name, disabled, onStart, onTarget, onFinish, onCancel, onStep }: {
  id: string; name: string; disabled: boolean;
  onStart: (id: string) => void; onTarget: (id: string) => void; onFinish: (id: string) => void; onCancel: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const ghost = useRef<HTMLTableElement | null>(null);
  const clearGhost = () => { ghost.current?.remove(); ghost.current = null; };
  const touchPointer = useRef<number | null>(null);
  const targetAt = (event: PointerEvent<HTMLButtonElement>) => document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLTableRowElement>('tr[data-miner-id]')?.dataset.minerId;
  return <button type="button" className="miner-drag-handle" disabled={disabled} draggable={false}
    aria-label={t('reorderMiner', { name })} aria-describedby="miner-order-hint" title={t('reorderMiner', { name })}
    onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); const row = event.currentTarget.closest('tr'); if (row) event.dataTransfer.setDragImage(row, 20, row.clientHeight / 2); onStart(id); }}
    onDragEnd={onCancel}
    onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onStep(event.key === 'ArrowUp' ? -1 : 1); } }}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      touchPointer.current = event.pointerId; onStart(id);
      clearGhost();
      const row = event.currentTarget.closest('tr');
      if (row) {
        const preview = document.createElement('table'); preview.className = 'miner-drag-preview'; preview.setAttribute('aria-hidden', 'true');
        preview.style.width = `${row.getBoundingClientRect().width}px`; preview.style.top = `${event.clientY + 12}px`;
        preview.append(row.cloneNode(true)); document.body.append(preview); ghost.current = preview;
      }
    }}
    onPointerMove={event => {
      if (touchPointer.current !== event.pointerId) return;
      const target = targetAt(event);
      if (ghost.current) ghost.current.style.top = `${event.clientY + 12}px`;
      if (event.clientY < 70) window.scrollBy(0, -18);
      else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 18);
      if (target) onTarget(target);
    }}
    onPointerUp={event => {
      if (touchPointer.current !== event.pointerId) return;
      const target = targetAt(event);
      touchPointer.current = null; clearGhost();
      if (target) onFinish(target); else onCancel();
    }}
    onPointerCancel={() => { touchPointer.current = null; clearGhost(); onCancel(); }}>
    <span aria-hidden="true">⠿</span>
  </button>;
}
