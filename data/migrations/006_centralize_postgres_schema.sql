CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users: centralize auth + billing + credit state on one row.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS credits_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_remaining INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_idx
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_subscription_idx
  ON users (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> '';

-- Backfill consolidated user columns from legacy billing/credits split tables.
UPDATE users u
SET
  plan_tier = COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, u.plan_tier, 'free'),
  credits_total = COALESCE(c.monthly_quota, u.credits_total, 0),
  credits_remaining = COALESCE(c.balance, u.credits_remaining, 0),
  billing_status = COALESCE(b.status, u.billing_status, 'active'),
  stripe_customer_id = COALESCE(NULLIF(b.stripe_customer_id, ''), u.stripe_customer_id),
  stripe_subscription_id = COALESCE(NULLIF(b.stripe_subscription_id, ''), u.stripe_subscription_id),
  updated_at = NOW()
FROM billing b
LEFT JOIN credits c ON c.user_id = b.user_id
WHERE u.id = b.user_id;

-- Profiles requested schema guarantees.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_unique
  ON profiles (LOWER(handle));

-- Artifacts requested schema guarantees.
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS current_version_id UUID,
  ADD COLUMN IF NOT EXISTS forked_from_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forks_count INTEGER NOT NULL DEFAULT 0;

-- Artifact versions requested schema guarantees.
ALTER TABLE artifact_versions
  ADD COLUMN IF NOT EXISTS version_number INTEGER,
  ADD COLUMN IF NOT EXISTS code_blob_ref TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE artifact_versions
SET version_number = COALESCE(version_number, version_index)
WHERE version_number IS NULL;

ALTER TABLE artifact_versions
  ALTER COLUMN version_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS artifact_versions_artifact_version_number_unique
  ON artifact_versions (artifact_id, version_number);

-- Usage events minimal centralized schema while preserving existing analytics columns.
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  tokens_requested INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS intent TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS credits_used NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS credit_norm_factor NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS model_cost_usd NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
  ADD COLUMN IF NOT EXISTS success BOOLEAN;

CREATE INDEX IF NOT EXISTS usage_events_user_created_idx
  ON usage_events (user_id, created_at DESC);
