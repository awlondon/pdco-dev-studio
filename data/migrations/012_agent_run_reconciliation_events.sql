ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS active TEXT,
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS last_event_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE agent_runs
  ALTER COLUMN started_at TYPE BIGINT
  USING CASE
    WHEN started_at IS NULL THEN NULL
    ELSE (EXTRACT(EPOCH FROM started_at) * 1000)::BIGINT
  END;

ALTER TABLE agent_runs
  ALTER COLUMN updated_at TYPE BIGINT
  USING CASE
    WHEN updated_at IS NULL THEN (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    ELSE (EXTRACT(EPOCH FROM updated_at) * 1000)::BIGINT
  END;

ALTER TABLE agent_runs
  ALTER COLUMN updated_at SET DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;

CREATE TABLE IF NOT EXISTS agent_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id UUID,
  type TEXT NOT NULL,
  ts BIGINT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS agent_events_run_id_id_idx
  ON agent_events (run_id, id ASC);

CREATE INDEX IF NOT EXISTS agent_events_user_id_id_idx
  ON agent_events (user_id, id ASC);
