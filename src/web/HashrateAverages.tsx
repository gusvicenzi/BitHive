import { useTranslation } from 'react-i18next';
import type { averageHashrates } from '../shared/domain';

export function HashrateAverages({ averages, total, collapsible = false }: {
  averages: ReturnType<typeof averageHashrates>; total: number; collapsible?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const available = averages.filter(average => average.value !== null);
  if (!available.length) return null;
  const readings = <dl className="hashrate-averages" aria-label={`${t('averageHashrates')} (TH/s)`}>
    {available.map(({ period, value, count }) => <div key={period}>
      <dt>{t(`hashratePeriods.${period}`)}</dt>
      <dd>{new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value! / 1000)}
        {count < total && <span className="average-coverage">{t('averageCoverage', { count, total })}</span>}
      </dd>
    </div>)}
  </dl>;
  return collapsible ? <details className="hashrate-disclosure">
    <summary>{t('averages')}</summary>
    {readings}
  </details> : <div className="hashrate-history-strip"><span className="hashrate-averages-label">{t('averages')}</span>{readings}</div>;
}
