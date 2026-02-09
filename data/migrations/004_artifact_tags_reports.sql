CREATE TABLE IF NOT EXISTS artifact_tags (
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (artifact_id, tag)
);

CREATE INDEX IF NOT EXISTS artifact_tags_tag_idx ON artifact_tags (tag);

CREATE TABLE IF NOT EXISTS artifact_reports (
  id uuid PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  status text NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS artifact_reports_artifact_idx ON artifact_reports (artifact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_reports_status_idx ON artifact_reports (status, created_at DESC);
