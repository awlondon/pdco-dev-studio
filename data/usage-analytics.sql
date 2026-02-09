-- Usage analytics & cost accounting (PostgreSQL)

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID NOT NULL,

  intent TEXT CHECK (intent IN ('code', 'text')) NOT NULL,
  model TEXT NOT NULL,

  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  credits_used INTEGER NOT NULL,

  latency_ms INTEGER NOT NULL,
  success BOOLEAN NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_user_time
  ON usage_events (user_id, created_at);

CREATE INDEX idx_usage_events_session
  ON usage_events (session_id);

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

CREATE MATERIALIZED VIEW usage_model_cost_mv AS
SELECT
  e.user_id,
  DATE(e.created_at) AS day,
  e.model,

  COUNT(*) AS requests,
  SUM(e.credits_used) AS credits_used,

  SUM(
    (
      (e.tokens_in  / 1000.0) * p.cost_per_1k_input_tokens +
      (e.tokens_out / 1000.0) * p.cost_per_1k_output_tokens
    ) * p.credit_multiplier
  ) AS cost_usd

FROM usage_events e
JOIN model_pricing p ON p.model = e.model
GROUP BY e.user_id, day, e.model;

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

ALTER TABLE usage_events
ADD COLUMN credit_norm_factor NUMERIC(6,3);

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

ALTER TABLE model_pricing
ADD COLUMN is_premium BOOLEAN NOT NULL DEFAULT false;

UPDATE model_pricing SET is_premium = true WHERE model IN ('gpt-4.1');
UPDATE model_pricing SET is_premium = false WHERE model IN ('gpt-4.1-mini');

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
