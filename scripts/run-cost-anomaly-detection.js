import { getUsageAnalyticsPool } from '../utils/usageAnalytics.js';

const spikeDetectionQuery = `
WITH stats AS (
  SELECT
    user_id,
    AVG(cost_usd) AS mean_cost,
    STDDEV(cost_usd) AS std_cost
  FROM (
    SELECT
      user_id,
      DATE(created_at) AS day,
      SUM(model_cost_usd) AS cost_usd
    FROM usage_events e
    WHERE created_at >= NOW() - INTERVAL '14 days'
    GROUP BY user_id, DATE(created_at)
  ) d
  GROUP BY user_id
),
today AS (
  SELECT
    e.user_id,
    SUM(e.model_cost_usd) AS cost_usd
  FROM usage_events e
  WHERE DATE(e.created_at) = CURRENT_DATE
  GROUP BY e.user_id
)
INSERT INTO cost_anomalies (
  user_id,
  anomaly_type,
  severity,
  baseline_value,
  observed_value,
  window_start,
  window_end,
  context
)
SELECT
  t.user_id,
  'spike',
  CASE WHEN t.cost_usd > s.mean_cost + 4*s.std_cost THEN 'critical' ELSE 'warning' END,
  s.mean_cost,
  t.cost_usd,
  CURRENT_DATE,
  CURRENT_DATE,
  jsonb_build_object('std_dev', s.std_cost)
FROM today t
JOIN stats s ON s.user_id = t.user_id
WHERE t.cost_usd > s.mean_cost + 3*s.std_cost;
`;

const driftDetectionQuery = `
WITH daily AS (
  SELECT
    user_id,
    DATE(created_at) AS day,
    SUM(model_cost_usd) AS cost_usd
  FROM usage_events e
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY user_id, DATE(created_at)
),
trend AS (
  SELECT
    user_id,
    REGR_SLOPE(cost_usd, EXTRACT(EPOCH FROM day)) AS slope
  FROM daily
  GROUP BY user_id
)
INSERT INTO cost_anomalies (
  user_id,
  anomaly_type,
  severity,
  observed_value,
  window_start,
  window_end,
  context
)
SELECT
  user_id,
  'drift',
  'warning',
  slope,
  NOW() - INTERVAL '7 days',
  NOW(),
  jsonb_build_object('slope_usd_per_day', slope)
FROM trend
WHERE slope > 0.25;
`;

const runawaySessionQuery = `
INSERT INTO cost_anomalies (
  user_id,
  anomaly_type,
  severity,
  observed_value,
  window_start,
  window_end,
  context
)
SELECT
  e.user_id,
  'runaway_session',
  'critical',
  SUM(e.model_cost_usd) AS cost_usd,
  MIN(e.created_at),
  MAX(e.created_at),
  jsonb_build_object('session_id', e.session_id)
FROM usage_events e
GROUP BY e.user_id, e.session_id
HAVING
  SUM(e.model_cost_usd) > 5.00;
`;

async function run() {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    console.error('Missing DATABASE_URL. Unable to run anomaly detection.');
    process.exit(1);
  }
  await pool.query(spikeDetectionQuery);
  await pool.query(driftDetectionQuery);
  await pool.query(runawaySessionQuery);
  process.exit(0);
}

run().catch((error) => {
  console.error('Cost anomaly detection failed.', error);
  process.exit(1);
});
