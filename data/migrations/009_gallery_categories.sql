ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS artifacts_public_category_updated_idx
  ON artifacts (visibility, category, updated_at DESC);
