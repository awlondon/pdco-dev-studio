# Usage analytics & cost accounting (PostgreSQL)

This document captures the production-ready SQL for usage tracking, aggregation, cost attribution, plan normalization, routing policy, and anomaly alerts. It is intended for internal reference.

## Usage events (source of truth)

```sql
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,

  intent TEXT CHECK (intent IN ('code', 'text')) NOT NULL,
  model TEXT NOT NULL,

  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  credits_used INTEGER NOT NULL,
  credit_norm_factor NUMERIC(6,3) NOT NULL,
  model_cost_usd NUMERIC(10,6) NOT NULL,

  latency_ms INTEGER NOT NULL,
  success BOOLEAN NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_user_time
  ON usage_events (user_id, created_at);

CREATE INDEX idx_usage_events_session
  ON usage_events (session_id);
```

## LLM turn logs (diagnostics)

```sql
CREATE TABLE llm_turn_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL,
  session_id UUID NOT NULL,
  turn_index INTEGER NOT NULL,

  intent TEXT CHECK (intent IN ('code','text','mixed')) NOT NULL,
  model TEXT NOT NULL,

  glyph_surface TEXT,
  glyph_json JSONB,

  prompt_text TEXT,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,

  total_tokens INTEGER GENERATED ALWAYS AS
    (prompt_tokens + completion_tokens) STORED,

  credits_charged INTEGER,
  latency_ms INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_turn_logs_session
  ON llm_turn_logs (session_id, turn_index);

CREATE INDEX idx_llm_turn_logs_user_time
  ON llm_turn_logs (user_id, created_at);
```

## Daily aggregation (per user, per day)

```sql
CREATE VIEW usage_daily_summary AS
SELECT
  user_id,
  DATE(created_at) AS day,

  COUNT(*) AS requests,
  SUM(credits_used) AS credits_used,

  SUM(CASE WHEN intent = 'code' THEN 1 ELSE 0 END) AS code_requests,
  SUM(CASE WHEN intent = 'text' THEN 1 ELSE 0 END) AS text_requests,

  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate

FROM usage_events
GROUP BY user_id, DATE(created_at);
```

## Rolling overview (last 30 days)

```sql
SELECT
  COUNT(*) AS requests,
  SUM(credits_used) AS credits_used,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate
FROM usage_events
WHERE user_id = $1
  AND created_at >= now() - INTERVAL '30 days';
```

## Credit burn chart (last N days)

```sql
SELECT
  day,
  credits_used
FROM usage_daily_summary
WHERE user_id = $1
  AND day >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY day ASC;
```

## Requests per day (stacked: code vs text)

```sql
SELECT
  day,
  code_requests,
  text_requests
FROM usage_daily_summary
WHERE user_id = $1
  AND day >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY day ASC;
```

## Latency trend (per day)

```sql
SELECT
  day,
  avg_latency_ms
FROM usage_daily_summary
WHERE user_id = $1
  AND day >= CURRENT_DATE - INTERVAL '14 days'
ORDER BY day ASC;
```

## Session history (Account → Usage History)

```sql
SELECT
  session_id,
  MIN(created_at) AS session_start,
  MAX(created_at) - MIN(created_at) AS duration,
  COUNT(*) AS turns,
  SUM(credits_used) AS credits_used
FROM usage_events
WHERE user_id = $1
GROUP BY session_id
ORDER BY session_start DESC
LIMIT 50;
```

## Drill-down: requests inside a session

```sql
SELECT
  created_at,
  intent,
  model,
  input_tokens,
  output_tokens,
  credits_used,
  latency_ms,
  success
FROM usage_events
WHERE user_id = $1
  AND session_id = $2
ORDER BY created_at ASC;
```

## Optional: materialized daily summary (for scale)

```sql
CREATE MATERIALIZED VIEW usage_daily_summary_mv AS
SELECT
  user_id,
  DATE(created_at) AS day,
  COUNT(*) AS requests,
  SUM(credits_used) AS credits_used,
  SUM(CASE WHEN intent = 'code' THEN 1 ELSE 0 END) AS code_requests,
  SUM(CASE WHEN intent = 'text' THEN 1 ELSE 0 END) AS text_requests,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate
FROM usage_events
GROUP BY user_id, DATE(created_at);

REFRESH MATERIALIZED VIEW CONCURRENTLY usage_daily_summary_mv;
```

## Guardrails

- Always aggregate with a `user_id` filter.
- Do not compute credits client-side.
- Treat events as append-only (no updates).

## Model pricing (single source of truth)

```sql
CREATE TABLE model_pricing (
  model TEXT PRIMARY KEY,

  cost_per_1k_input_tokens NUMERIC(10,6) NOT NULL,
  cost_per_1k_output_tokens NUMERIC(10,6) NOT NULL,

  credit_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO model_pricing VALUES
('gpt-4.1', 0.010, 0.030, 1.0, true),
('gpt-4.1-mini', 0.003, 0.006, 0.6, true),
('claude-3-opus', 0.015, 0.045, 1.2, true);
```

## Cost attribution per event

```sql
SELECT
  e.id,
  e.user_id,
  e.session_id,
  e.model,

  e.input_tokens,
  e.output_tokens,
  e.model_cost_usd AS cost_usd,

  e.credits_used,
  e.created_at

FROM usage_events e;
```

## Per-model cost summary (user)

```sql
SELECT
  e.model,
  COUNT(*) AS requests,
  SUM(e.credits_used) AS credits_used,

  ROUND(SUM(e.model_cost_usd), 4) AS total_cost_usd

FROM usage_events e
WHERE e.user_id = $1
GROUP BY e.model
ORDER BY total_cost_usd DESC;
```

## Daily per-model burn

```sql
SELECT
  DATE(e.created_at) AS day,
  e.model,

  COUNT(*) AS requests,
  SUM(e.credits_used) AS credits_used,

  ROUND(SUM(e.model_cost_usd), 4) AS cost_usd

FROM usage_events e
WHERE e.user_id = $1
GROUP BY day, e.model
ORDER BY day DESC, cost_usd DESC;
```

## Credits → cost reconciliation (sanity check)

```sql
SELECT
  e.model,
  ROUND(
    SUM(e.model_cost_usd) / NULLIF(SUM(e.credits_used), 0),
    4
  ) AS usd_per_credit
FROM usage_events e
GROUP BY e.model;
```

## Optional: materialized model-cost view (dashboards)

```sql
CREATE MATERIALIZED VIEW usage_model_cost_mv AS
SELECT
  e.user_id,
  DATE(e.created_at) AS day,
  e.model,

  COUNT(*) AS requests,
  SUM(e.credits_used) AS credits_used,

  SUM(e.model_cost_usd) AS cost_usd

FROM usage_events e
GROUP BY e.user_id, day, e.model;
```

## Plan-tier credit normalization

```sql
CREATE TABLE plan_tiers (
  plan TEXT PRIMARY KEY,

  monthly_credits INTEGER NOT NULL,
  credit_normalization_factor NUMERIC(6,3) NOT NULL,

  description TEXT
);

INSERT INTO plan_tiers VALUES
('free',        500,  1.00, 'Entry tier'),
('pro',        5000,  0.85, 'Power users'),
('team',      20000,  0.70, 'Shared org usage'),
('enterprise', 999999,0.55, 'Volume optimized');

ALTER TABLE users
ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'
REFERENCES plan_tiers(plan);
```

### Normalize credits per usage event

```sql
SELECT
  e.id,
  e.user_id,
  u.plan,
  e.credits_used,

  (e.credits_used * e.credit_norm_factor)
    AS normalized_credits_used,

  e.created_at

FROM usage_events e
JOIN users u ON u.id = e.user_id
;
```

### Plan-aware cost attribution

```sql
SELECT
  e.user_id,
  u.plan,
  e.model,

  SUM(e.credits_used) AS raw_credits,
  SUM(e.credits_used * e.credit_norm_factor) AS normalized_credits,

  ROUND(SUM(e.model_cost_usd * e.credit_norm_factor), 4) AS effective_cost_usd

FROM usage_events e
JOIN users u ON u.id = e.user_id
GROUP BY e.user_id, u.plan, e.model;
```

### Monthly allowance enforcement (plan-correct)

```sql
SELECT
  e.user_id,
  u.plan,

  SUM(e.credits_used * p.credit_normalization_factor)
    AS normalized_credits_used,

  p.monthly_credits
FROM usage_events e
JOIN users u ON u.id = e.user_id
JOIN plan_tiers p ON p.plan = u.plan
WHERE DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', NOW())
GROUP BY e.user_id, u.plan, p.monthly_credits;
```

### Analytics-safe aggregation (cross-plan)

```sql
SELECT
  DATE(e.created_at) AS day,
  e.model,

  COUNT(*) AS requests,
  SUM(e.credits_used * p.credit_normalization_factor)
    AS normalized_credits_used

FROM usage_events e
JOIN users u ON u.id = e.user_id
JOIN plan_tiers p ON p.plan = u.plan
GROUP BY day, e.model
ORDER BY day DESC;
```

### Optional: lock normalization at event time

```sql
ALTER TABLE usage_events
ADD COLUMN input_tokens INTEGER,
ADD COLUMN output_tokens INTEGER,
ADD COLUMN credit_norm_factor NUMERIC(6,3),
ADD COLUMN model_cost_usd NUMERIC(10,6);

INSERT INTO usage_events (...)
VALUES (..., current_plan.credit_normalization_factor, model_cost_usd);
```

## Plan-aware routing policy

```sql
CREATE TABLE plan_model_policy (
  plan TEXT NOT NULL REFERENCES plan_tiers(plan),
  intent TEXT NOT NULL CHECK (intent IN ('code','text','any')),

  preferred_models TEXT[] NOT NULL,
  allowed_models TEXT[] NOT NULL,

  allow_fallback BOOLEAN NOT NULL DEFAULT true,
  premium_allowed BOOLEAN NOT NULL DEFAULT false,

  PRIMARY KEY (plan, intent)
);

INSERT INTO plan_model_policy
(plan, intent, preferred_models, allowed_models, allow_fallback, premium_allowed)
VALUES
('free', 'any',
 ARRAY['gpt-4.1-mini'],
 ARRAY['gpt-4.1-mini'],
 true, false),

('pro', 'any',
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 true, true),

('team', 'any',
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 true, true),

('enterprise', 'any',
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 ARRAY['gpt-4.1', 'gpt-4.1-mini'],
 true, true);
```

### Router decision log

```sql
CREATE TABLE model_route_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID,
  intent TEXT NOT NULL CHECK (intent IN ('code','text')),

  requested_model TEXT,
  routed_model TEXT NOT NULL,

  reason TEXT NOT NULL,
  plan TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_route_decisions_user_time
  ON model_route_decisions(user_id, created_at);
```

### Quota state query (monthly normalized credits)

```sql
SELECT
  u.plan,
  p.monthly_credits,
  COALESCE(SUM(e.credits_used * p.credit_normalization_factor), 0) AS normalized_credits_used
FROM users u
JOIN plan_tiers p ON p.plan = u.plan
LEFT JOIN usage_events e
  ON e.user_id = u.id
 AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', NOW())
WHERE u.id = $1
GROUP BY u.plan, p.monthly_credits, p.credit_normalization_factor;
```

### Policy fetch (per plan + intent)

```sql
SELECT
  preferred_models,
  allowed_models,
  allow_fallback,
  premium_allowed
FROM plan_model_policy
WHERE plan = $1 AND (intent = $2 OR intent = 'any')
ORDER BY (intent = $2) DESC
LIMIT 1;
```

### Premium model flag

```sql
ALTER TABLE model_pricing
ADD COLUMN is_premium BOOLEAN NOT NULL DEFAULT false;

UPDATE model_pricing SET is_premium = true WHERE model IN ('gpt-4.1');
UPDATE model_pricing SET is_premium = false WHERE model IN ('gpt-4.1-mini');
```

### Cheapest allowed model (cost-based)

```sql
SELECT model
FROM model_pricing
WHERE model = ANY($1)
  AND active = true
ORDER BY
  (cost_per_1k_input_tokens + cost_per_1k_output_tokens) ASC
LIMIT 1;
```

### Route decision insert

```sql
INSERT INTO model_route_decisions
(user_id, session_id, intent, requested_model, routed_model, reason, plan)
VALUES
($1, $2, $3, $4, $5, $6, $7);
```

## Cost anomaly alerts

```sql
CREATE TABLE cost_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID,
  plan TEXT,
  model TEXT,

  anomaly_type TEXT NOT NULL
    CHECK (anomaly_type IN ('spike','drift','runaway_session')),

  severity TEXT NOT NULL
    CHECK (severity IN ('warning','critical')),

  baseline_value NUMERIC,
  observed_value NUMERIC,

  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,

  context JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_cost_anomalies_time
  ON cost_anomalies(created_at);

CREATE INDEX idx_cost_anomalies_user
  ON cost_anomalies(user_id);
```

### Baseline: rolling daily cost per user

```sql
WITH daily_cost AS (
  SELECT
    user_id,
    DATE(created_at) AS day,
    SUM(model_cost_usd) AS cost_usd
  FROM usage_events e
  GROUP BY user_id, DATE(created_at)
)
SELECT * FROM daily_cost;
```

### Spike detection (z-score based)

```sql
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
```

### Sustained drift detection (trend slope)

```sql
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
```

### Runaway session detection (fast burn)

```sql
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
```

### Alert consumption (ops/admin)

```sql
SELECT *
FROM cost_anomalies
WHERE acknowledged = false
ORDER BY
  severity DESC,
  created_at DESC;

UPDATE cost_anomalies
SET acknowledged = true
WHERE id = $1;
```

## Routing pseudocode (implementation note)

```text
function routeModel({ user, intent, requestedModel }) {
  const quota = getMonthlyQuota(user.id)  // normalized_credits_used, monthly_credits
  const policy = getPolicy(user.plan, intent)

  // 1) start with requested model if allowed
  let candidate = requestedModel && policy.allowed_models.includes(requestedModel)
    ? requestedModel
    : policy.preferred_models[0]

  // 2) premium gate
  if (isPremium(candidate) && !policy.premium_allowed) {
    candidate = firstNonPremium(policy.preferred_models, policy.allowed_models)
    reason = 'premium_blocked'
  }

  // 3) quota-based fallback (soft)
  const usageRatio = quota.normalized_credits_used / quota.monthly_credits

  if (policy.allow_fallback && usageRatio >= 0.9) {
    // push to cheaper model near limit
    candidate = cheapestAllowedModel(policy.allowed_models, intent)
    reason = 'quota_fallback'
  }

  // 4) safety: must be allowed
  if (!policy.allowed_models.includes(candidate)) {
    candidate = policy.allowed_models[policy.allowed_models.length - 1]
    reason = 'policy_default'
  }

  logRouteDecision(...)
  return candidate
}
```

## Design notes

- Credits are policy; cost is physics.
- Credits ≠ USD (multiplier lets you tune margins).
- Pricing tables are versionable (future-proof).
- Token-level attribution prevents hallucinated billing.
- Normalize analytics across Free / Pro / Team / Enterprise.
```
