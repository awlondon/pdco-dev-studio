import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migrationsDir = join(process.cwd(), 'data/migrations');

function readMigrations() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(migrationsDir, file), 'utf8')
    }));
}

test('migration files are sequentially numbered with no gaps', () => {
  const files = readMigrations().map(({ file }) => file);
  const sequence = files.map((file) => Number(file.split('_')[0]));
  const expected = Array.from({ length: sequence.length }, (_, index) => index + 1);
  assert.deepEqual(sequence, expected);
});

test('baseline migration defines core user and credit tables', () => {
  const first = readMigrations().find(({ file }) => file.startsWith('001_'));
  assert.ok(first);
  assert.match(first.sql, /CREATE TABLE IF NOT EXISTS users/i);
  assert.match(first.sql, /CREATE TABLE IF NOT EXISTS billing/i);
  assert.match(first.sql, /CREATE TABLE IF NOT EXISTS credits/i);
  assert.match(first.sql, /CREATE TABLE IF NOT EXISTS credit_ledger/i);
});

test('artifact migration introduces artifact + version + media schema', () => {
  const artifactMigration = readMigrations().find(({ file }) => file.startsWith('002_'));
  assert.ok(artifactMigration);
  assert.match(artifactMigration.sql, /CREATE TABLE IF NOT EXISTS artifacts/i);
  assert.match(artifactMigration.sql, /CREATE TABLE IF NOT EXISTS artifact_versions/i);
  assert.match(artifactMigration.sql, /CREATE TABLE IF NOT EXISTS artifact_media/i);
  assert.match(artifactMigration.sql, /CREATE UNIQUE INDEX IF NOT EXISTS artifact_versions_unique_idx/i);
});

test('centralized schema migration backfills users and keeps usage_events indexed', () => {
  const migration = readMigrations().find(({ file }) => file.startsWith('006_'));
  assert.ok(migration);
  assert.match(migration.sql, /UPDATE users u\s+SET/s);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS usage_events/i);
  assert.match(migration.sql, /CREATE INDEX IF NOT EXISTS usage_events_user_created_idx/i);
});

test('latest gallery migration preserves category column and index', () => {
  const last = readMigrations().at(-1);
  assert.ok(last);
  assert.equal(last.file, '010_transactional_usage_and_agent_runs.sql');
  assert.match(last.sql, /CREATE TABLE IF NOT EXISTS agent_runs/i);
  assert.match(last.sql, /CREATE INDEX IF NOT EXISTS usage_events_user_timestamp_idx/i);
});
