CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state_blob JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS sessions_user_last_active_idx
  ON sessions (user_id, last_active DESC);
