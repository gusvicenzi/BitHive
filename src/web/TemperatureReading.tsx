import { useTranslation } from 'react-i18next';
import { temperatureAppearance, temperatureScales, type TemperatureSensor } from './temperature-scale';
export function TemperatureReading({ value, sensor, stale = false, showUnit = true }: {
  value?: number | null; sensor: TemperatureSensor; stale?: boolean; showUnit?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const appearance = temperatureAppearance(value, sensor);
  if (!appearance) return <span className="temperature-unavailable">—</span>;
  const [low, mid, high, danger] = temperatureScales[sensor];
  const title = t('temperatureScaleHint', { sensor: t(sensor === 'chip' ? 'temperature' : 'regulatorTemp'), low, mid, high, danger });
  return <span className={`temperature-reading${stale ? ' temperature-stale' : ''}`} data-band={appearance.band}
    style={{ color: appearance.color, backgroundColor: appearance.tint, borderColor: appearance.color }} title={title}>
    {new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value!)}{showUnit && ' °C'}
    <span className="sr-only"> · {t(`temperatureBands.${appearance.band}`)}{stale && ` · ${t('temperatureStale')}`}</span>
  </span>;
}
