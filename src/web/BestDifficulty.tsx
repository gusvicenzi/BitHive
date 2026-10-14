import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDifficulty } from './difficulty';

export function BestDifficulty({ value }: { value?: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const formatted = formatDifficulty(value, i18n.language);
  if (!formatted.full) return <span>—</span>;
  return <span className="difficulty-value" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button type="button" className="difficulty-button" aria-label={t('inspectDifficulty')} aria-describedby={open ? id : undefined}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
      {formatted.compact}
    </button>
    {open && <span id={id} role="tooltip" className="difficulty-tooltip"><strong>{formatted.full}</strong>
      {formatted.expanded && <small>{t('expandedDifficulty')}</small>}
    </span>}
  </span>;
}
