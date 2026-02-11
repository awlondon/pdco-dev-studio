ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE agent_runs
SET finished_at = COALESCE(finished_at, completed_at)
WHERE completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  repro_steps TEXT NOT NULL,
  suggested_fix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_findings_run_created_idx
  ON agent_findings (run_id, created_at DESC);
