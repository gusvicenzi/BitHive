import type { PrismaClient } from '@prisma/client';
import type { MetricView } from '../shared/domain.js';
export function historyBucketMinutes(hours: number) { return hours <= 1 ? 1 : hours <= 24 ? 5 : hours <= 168 ? 30 : 120; }
export async function metricHistory(db: PrismaClient, id: string, hours: number, now = Date.now()) {
  const bucketMinutes = historyBucketMinutes(hours), width = bucketMinutes * 60000;
  const since = now - hours * 3600000;
  // Aggregate in SQLite, so the entire interval is included without transferring raw samples.
  const rows = await db.$queryRaw<(MetricView & { bucket: number; first: bigint; last: bigint })[]>`
    WITH readings AS (
      SELECT *, CASE WHEN timestamp - LAG(timestamp) OVER (ORDER BY timestamp, id) > 90000 THEN 1 ELSE 0 END AS gap
      FROM Metric WHERE deviceId = ${id} AND timestamp >= ${new Date(since)} AND timestamp <= ${new Date(now)}
    ), runs AS (
      SELECT *, SUM(gap) OVER (ORDER BY timestamp, id) AS run FROM readings
    )
    SELECT CAST(timestamp / ${width} AS INTEGER) AS bucket,
      MIN(timestamp) AS first, MAX(timestamp) AS last,
      AVG(hashRate) AS hashRate, AVG(power) AS power, AVG(temp) AS temp,
      AVG(vrTemp) AS vrTemp, AVG(errorRate) AS errorRate
    FROM runs GROUP BY bucket, run ORDER BY MIN(timestamp) ASC`;
  const metrics: MetricView[] = [];
  let previous: number | undefined;
  for (const row of rows) {
    const first = Number(row.first), last = Number(row.last);
    if (previous !== undefined && first - previous > 90000) metrics.push({ timestamp: new Date(previous + 1).toISOString(), hashRate: null, power: null, temp: null, vrTemp: null, errorRate: null });
    metrics.push({ timestamp: new Date((first + last) / 2).toISOString(), hashRate: row.hashRate, power: row.power, temp: row.temp, vrTemp: row.vrTemp, errorRate: row.errorRate });
    previous = last;
  }
  return { metrics, bucketMinutes };
}
