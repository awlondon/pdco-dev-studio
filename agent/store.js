import { requireDbPool, withTransaction } from '../utils/queryLayer.js';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    active: row.active || null,
    phase: row.phase || null,
    started_at: toMillis(row.started_at),
    updated_at: toMillis(row.updated_at),
    last_event_id: Number(row.last_event_id || 0),
    partial_output: null,
    target: row.target,
    finished_at: row.finished_at || row.completed_at || null,
    config_json: row.config_json || {},
    created_at: row.created_at
  };
}

function mapFinding(row) {
  if (!row) return null;
  return {
    id: row.id,
    run_id: row.run_id,
    severity: row.severity,
    title: row.title,
    evidence_json: row.evidence_json || {},
    repro_steps: row.repro_steps || '',
    suggested_fix: row.suggested_fix || '',
    created_at: row.created_at
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    run_id: row.run_id,
    user_id: row.user_id,
    type: row.type,
    ts: Number(row.ts),
    payload: row.payload_json || {}
  };
}

function reduceRunState(current, type) {
  const next = {
    status: current?.status || 'IDLE',
    active: current?.active || null,
    phase: current?.phase || null
  };

  switch (type) {
    case 'AGENT_START':
      next.status = 'PREPARING';
      break;
    case 'AGENT_READY':
      next.status = 'ACTIVE';
      next.active = 'RUNNING';
      next.phase = null;
      break;
    case 'AGENT_STREAM':
      next.status = 'ACTIVE';
      next.active = 'STREAMING';
      next.phase = 'TOKENIZING';
      break;
    case 'STREAM_TOKEN':
      next.phase = 'TOKENIZING';
      break;
    case 'STREAM_CHUNK':
      next.phase = 'RECEIVING';
      break;
    case 'STREAM_RENDER':
      next.phase = 'RENDERING';
      break;
    case 'STREAM_DONE':
      next.phase = 'FINALIZING';
      break;
    case 'AGENT_COMPLETE':
      next.status = 'COMPLETED';
      next.active = null;
      next.phase = null;
      break;
    case 'AGENT_FAIL':
      next.status = 'FAILED';
      next.active = null;
      next.phase = null;
      break;
    case 'AGENT_CANCEL':
      next.status = 'CANCELLED';
      next.active = null;
      next.phase = null;
      break;
    default:
      break;
  }

  return next;
}

export async function createAgentRun({ userId, target = 'api', configJson = {} }) {
  const pool = requireDbPool();
  const startedAt = Date.now();
  const result = await pool.query(
    `INSERT INTO agent_runs (user_id, target, status, active, phase, started_at, updated_at, config_json, metadata)
     VALUES ($1, $2, 'PREPARING', NULL, NULL, $3, $3, $4::jsonb, $5::jsonb)
     RETURNING *`,
    [userId || null, target, startedAt, JSON.stringify(configJson || {}), JSON.stringify(configJson || {})]
  );
  return mapRun(result.rows[0]);
}

export async function listAgentRunsByUserId({ userId, limit = 100 }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM agent_runs
     WHERE user_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(mapRun);
}

export async function markAgentRunFinished({ runId, status = 'COMPLETED' }) {
  const pool = requireDbPool();
  const now = Date.now();
  const result = await pool.query(
    `UPDATE agent_runs
     SET status = $2,
         finished_at = NOW(),
         completed_at = NOW(),
         updated_at = $3
     WHERE id = $1
     RETURNING *`,
    [runId, status, now]
  );
  return mapRun(result.rows[0]);
}

export async function getAgentRunById({ runId, userId }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM agent_runs
     WHERE id = $1
       AND ($2::uuid IS NULL OR user_id = $2::uuid)
     LIMIT 1`,
    [runId, userId || null]
  );
  return mapRun(result.rows[0]);
}

export async function getAgentRunByIdAny({ runId }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM agent_runs
     WHERE id = $1
     LIMIT 1`,
    [runId]
  );
  return mapRun(result.rows[0]);
}

export async function appendAgentEvent({ runId, userId, type, payload = {} }) {
  const now = Date.now();
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, user_id, status, active, phase
       FROM agent_runs
       WHERE id = $1
       LIMIT 1`,
      [runId]
    );
    const run = existing.rows[0];
    if (!run) {
      throw new Error('Run not found');
    }

    if (userId && run.user_id && run.user_id !== userId) {
      throw new Error('Forbidden');
    }

    if (TERMINAL_STATUSES.has(String(run.status || '').toUpperCase()) && type !== 'AGENT_CANCEL') {
      // still append event for audit trails but do not regress status
    }

    const inserted = await client.query(
      `INSERT INTO agent_events (run_id, user_id, type, ts, payload_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [runId, run.user_id || userId || null, type, now, JSON.stringify(payload || {})]
    );

    const event = inserted.rows[0];
    const next = reduceRunState(run, type);

    await client.query(
      `UPDATE agent_runs
       SET status = $2,
           active = $3,
           phase = $4,
           last_event_id = $5,
           updated_at = $6
       WHERE id = $1`,
      [runId, next.status, next.active, next.phase, event.id, now]
    );

    return mapEvent(event);
  });
}

export async function listAgentEventsAfter({ runId, after = 0, limit = 500 }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT *
     FROM agent_events
     WHERE run_id = $1
       AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [runId, after, limit]
  );
  return result.rows.map(mapEvent);
}

export async function insertAgentFindings({ runId, findings = [] }) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }
  const pool = requireDbPool();
  const inserted = [];
  for (const finding of findings) {
    const result = await pool.query(
      `INSERT INTO agent_findings (run_id, severity, title, evidence_json, repro_steps, suggested_fix)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        runId,
        String(finding.severity || 'low'),
        String(finding.title || 'Untitled finding'),
        JSON.stringify(finding.evidence_json || {}),
        String(finding.repro_steps || ''),
        String(finding.suggested_fix || '')
      ]
    );
    inserted.push(mapFinding(result.rows[0]));
  }
  return inserted;
}

export async function getFindingsByRunId({ runId, userId }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT f.*
     FROM agent_findings f
     JOIN agent_runs r ON r.id = f.run_id
     WHERE f.run_id = $1
       AND ($2::uuid IS NULL OR r.user_id = $2::uuid)
     ORDER BY f.created_at DESC`,
    [runId, userId || null]
  );
  return result.rows.map(mapFinding);
}

export async function getFindingById({ findingId, userId }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `SELECT f.*
     FROM agent_findings f
     JOIN agent_runs r ON r.id = f.run_id
     WHERE f.id = $1
       AND ($2::uuid IS NULL OR r.user_id = $2::uuid)
     LIMIT 1`,
    [findingId, userId || null]
  );
  return mapFinding(result.rows[0]);
}
