import { requireDbPool } from '../utils/queryLayer.js';

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    target: row.target,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at || row.completed_at || null,
    config_json: row.config_json || {},
    created_at: row.created_at,
    updated_at: row.updated_at
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

export async function createAgentRun({ userId, target = 'api', configJson = {} }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `INSERT INTO agent_runs (user_id, target, status, started_at, config_json, metadata)
     VALUES ($1, $2, 'running', NOW(), $3::jsonb, $4::jsonb)
     RETURNING *`,
    [userId || null, target, JSON.stringify(configJson || {}), JSON.stringify(configJson || {})]
  );
  return mapRun(result.rows[0]);
}

export async function markAgentRunFinished({ runId, status = 'completed' }) {
  const pool = requireDbPool();
  const result = await pool.query(
    `UPDATE agent_runs
     SET status = $2,
         finished_at = NOW(),
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [runId, status]
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
