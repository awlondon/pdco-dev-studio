ALTER TABLE usage_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS source_hash TEXT;

UPDATE usage_events
SET event_timestamp = COALESCE(created_at, NOW())
WHERE event_timestamp IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usage_events_source_hash_unique
  ON usage_events (source_hash)
  WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_user_timestamp_idx
  ON usage_events (user_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS artifacts_owner_created_idx
  ON artifacts (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS agent_runs_user_created_idx
  ON agent_runs (user_id, created_at DESC);
