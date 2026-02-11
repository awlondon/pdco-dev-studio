import { getDbPool } from './queryLayer.js';

export function getUsageAnalyticsPool() {
  return getDbPool();
}

async function queryUsageAnalytics(text, params) {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    return null;
  }
  return pool.query(text, params);
}

function normalizeIntent(intentType) {
  if (intentType === 'code') {
    return 'code';
  }
  return 'text';
}

export async function insertUsageEvent({
  userId,
  sessionId,
  intentType,
  model,
  inputTokens,
  outputTokens,
  creditsUsed,
  creditNormFactor,
  modelCostUsd,
  latencyMs,
  success,
  status,
  timestamp,
  sourceHash
}) {
  const normalizedStatus = status || (success ? 'success' : 'error');
  const result = await queryUsageAnalytics(
    `INSERT INTO usage_events
      (user_id, session_id, intent, model, input_tokens, output_tokens, tokens_requested, tokens_used,
       credits_used, credit_norm_factor, model_cost_usd, cost, latency_ms, success, status, event_timestamp, source_hash)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (source_hash)
     DO NOTHING`,
    [
      userId,
      sessionId,
      normalizeIntent(intentType),
      model,
      inputTokens,
      outputTokens,
      Number(inputTokens || 0) + Number(outputTokens || 0),
      Number(outputTokens || 0),
      creditsUsed,
      creditNormFactor,
      modelCostUsd,
      modelCostUsd,
      latencyMs,
      success,
      normalizedStatus,
      timestamp || new Date(),
      sourceHash || null
    ]
  );
  return result;
}

function normalizeTurnIntent(intentType) {
  if (intentType === 'code') {
    return 'code';
  }
  if (intentType === 'mixed') {
    return 'mixed';
  }
  return 'text';
}

export async function fetchNextTurnIndex({ sessionId }) {
  if (!sessionId) {
    return null;
  }
  const result = await queryUsageAnalytics(
    `SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_index
     FROM llm_turn_logs
     WHERE session_id = $1`,
    [sessionId]
  );
  return result?.rows?.[0]?.next_index ?? null;
}

export async function insertLlmTurnLog({
  userId,
  sessionId,
  turnIndex,
  intent,
  model,
  glyphSurface,
  glyphJson,
  promptText,
  promptTokens,
  completionTokens,
  creditsCharged,
  latencyMs
}) {
  const result = await queryUsageAnalytics(
    `INSERT INTO llm_turn_logs
      (user_id, session_id, turn_index, intent, model, glyph_surface, glyph_json, prompt_text,
       prompt_tokens, completion_tokens, credits_charged, latency_ms)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      userId,
      sessionId,
      turnIndex,
      normalizeTurnIntent(intent),
      model,
      glyphSurface ?? null,
      glyphJson ?? null,
      promptText ?? null,
      promptTokens,
      completionTokens,
      creditsCharged ?? null,
      latencyMs ?? null
    ]
  );
  return result;
}

export async function fetchPlanPolicy({ plan, intentType }) {
  const result = await queryUsageAnalytics(
    `SELECT
      preferred_models,
      allowed_models,
      allow_fallback,
      premium_allowed
     FROM plan_model_policy
     WHERE plan = $1 AND (intent = $2 OR intent = 'any')
     ORDER BY (intent = $2) DESC
     LIMIT 1`,
    [plan, normalizeIntent(intentType)]
  );
  return result?.rows?.[0] || null;
}

export async function fetchMonthlyQuota({ userId, plan }) {
  const result = await queryUsageAnalytics(
    `SELECT
      p.monthly_credits,
      COALESCE(SUM(e.credits_used * p.credit_normalization_factor), 0) AS normalized_credits_used
     FROM plan_tiers p
     LEFT JOIN usage_events e
       ON e.user_id = $1
      AND DATE_TRUNC('month', e.created_at) = DATE_TRUNC('month', NOW())
     WHERE p.plan = $2
     GROUP BY p.monthly_credits, p.credit_normalization_factor`,
    [userId, plan]
  );
  return result?.rows?.[0] || null;
}

export async function fetchCheapestAllowedModel(allowedModels) {
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) {
    return null;
  }
  const result = await queryUsageAnalytics(
    `SELECT model
     FROM model_pricing
     WHERE model = ANY($1)
       AND active = true
     ORDER BY
       (cost_per_1k_input_tokens + cost_per_1k_output_tokens) ASC
     LIMIT 1`,
    [allowedModels]
  );
  return result?.rows?.[0]?.model || null;
}

export async function isPremiumModel(model) {
  if (!model) {
    return false;
  }
  const result = await queryUsageAnalytics(
    `SELECT is_premium
     FROM model_pricing
     WHERE model = $1
     LIMIT 1`,
    [model]
  );
  return Boolean(result?.rows?.[0]?.is_premium);
}

export async function fetchModelPricing({ model }) {
  if (!model) {
    return null;
  }
  const result = await queryUsageAnalytics(
    `SELECT
      cost_per_1k_input_tokens,
      cost_per_1k_output_tokens,
      credit_multiplier
     FROM model_pricing
     WHERE model = $1
     LIMIT 1`,
    [model]
  );
  return result?.rows?.[0] || null;
}

export async function fetchPlanNormalizationFactor({ plan }) {
  if (!plan) {
    return null;
  }
  const result = await queryUsageAnalytics(
    `SELECT credit_normalization_factor
     FROM plan_tiers
     WHERE plan = $1
     LIMIT 1`,
    [plan]
  );
  return result?.rows?.[0]?.credit_normalization_factor ?? null;
}

export async function fetchFirstNonPremiumModel(models) {
  if (!Array.isArray(models) || models.length === 0) {
    return null;
  }
  const result = await queryUsageAnalytics(
    `SELECT model
     FROM model_pricing
     WHERE model = ANY($1)
       AND is_premium = false
       AND active = true
     ORDER BY array_position($1, model)
     LIMIT 1`,
    [models]
  );
  return result?.rows?.[0]?.model || null;
}

export async function insertRouteDecision({
  userId,
  sessionId,
  intentType,
  requestedModel,
  routedModel,
  reason,
  plan
}) {
  await queryUsageAnalytics(
    `INSERT INTO model_route_decisions
      (user_id, session_id, intent, requested_model, routed_model, reason, plan)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      sessionId || null,
      normalizeIntent(intentType),
      requestedModel,
      routedModel,
      reason,
      plan
    ]
  );
}

export async function fetchUsageOverview({ userId }) {
  const result = await queryUsageAnalytics(
    `SELECT
      COUNT(*) AS requests,
      SUM(credits_used) AS credits_used,
      ROUND(AVG(latency_ms)) AS avg_latency_ms,
      ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) AS success_rate
     FROM usage_events
     WHERE user_id = $1
       AND created_at >= now() - INTERVAL '30 days'`,
    [userId]
  );
  return result?.rows?.[0] || null;
}

export async function fetchCreditsUsedToday({ userId }) {
  const result = await queryUsageAnalytics(
    `SELECT COALESCE(SUM(credits_used), 0) AS credits_used
     FROM usage_events
     WHERE user_id = $1
       AND created_at >= CURRENT_DATE`,
    [userId]
  );
  return Number(result?.rows?.[0]?.credits_used || 0);
}

export async function fetchUsageDailySummary({ userId, days }) {
  const result = await queryUsageAnalytics(
    `SELECT
      day,
      requests,
      credits_used,
      code_requests,
      text_requests,
      avg_latency_ms,
      success_rate
     FROM usage_daily_summary
     WHERE user_id = $1
       AND day >= CURRENT_DATE - ($2 || ' days')::interval
     ORDER BY day ASC`,
    [userId, `${days}`]
  );
  return result?.rows || null;
}

export async function fetchUsageEventsByRange({ userId, startDate, endDate, days }) {
  let clause = '';
  const params = [userId];
  if (startDate) {
    params.push(startDate);
    clause += ` AND DATE(created_at) >= $${params.length}`;
  }
  if (endDate) {
    params.push(endDate);
    clause += ` AND DATE(created_at) <= $${params.length}`;
  }
  if (Number.isFinite(days)) {
    params.push(days);
    clause += ` AND created_at >= NOW() - ($${params.length} || ' days')::interval`;
  }
  const result = await queryUsageAnalytics(
    `SELECT
      id,
      created_at,
      intent,
      model,
      input_tokens AS tokens_in,
      output_tokens AS tokens_out,
      credits_used,
      latency_ms,
      success,
      session_id
     FROM usage_events
     WHERE user_id = $1${clause}
     ORDER BY created_at ASC`,
    params
  );
  return result?.rows || null;
}

export async function fetchSessionSummary({ userId }) {
  const result = await queryUsageAnalytics(
    `SELECT
      session_id,
      MIN(created_at) AS session_start,
      MAX(created_at) AS session_end,
      MAX(created_at) - MIN(created_at) AS duration,
      COUNT(*) AS turns,
      SUM(credits_used) AS credits_used
     FROM usage_events
     WHERE user_id = $1
     GROUP BY session_id
     ORDER BY session_start DESC
     LIMIT 50`,
    [userId]
  );
  return result?.rows || null;
}

export async function fetchSessionEvents({ userId, sessionId }) {
  const result = await queryUsageAnalytics(
    `SELECT
      created_at,
      intent,
      model,
      input_tokens AS tokens_in,
      output_tokens AS tokens_out,
      credits_used,
      latency_ms,
      success
     FROM usage_events
     WHERE user_id = $1
       AND session_id = $2
     ORDER BY created_at ASC`,
    [userId, sessionId]
  );
  return result?.rows || null;
}

export async function fetchAdminUsageSummary({
  days,
  startDate,
  endDate,
  userId,
  limit = 12
} = {}) {
  const where = [];
  const params = [];

  if (userId) {
    params.push(userId);
    where.push(`user_id = $${params.length}`);
  }
  if (startDate) {
    params.push(startDate);
    where.push(`DATE(created_at) >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    where.push(`DATE(created_at) <= $${params.length}`);
  }
  if (Number.isFinite(days)) {
    params.push(days);
    where.push(`created_at >= NOW() - ($${params.length} || ' days')::interval`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(limit);
  const topModelsLimitParam = `$${params.length}`;

  const result = await queryUsageAnalytics(
    `WITH filtered AS (
      SELECT *
      FROM usage_events
      ${whereClause}
    ),
    top_models AS (
      SELECT
        model,
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
      FROM filtered
      GROUP BY model
      ORDER BY total_tokens DESC
      LIMIT ${topModelsLimitParam}
    )
    SELECT json_build_object(
      'total_requests', COALESCE((SELECT COUNT(*) FROM filtered), 0),
      'total_input_tokens', COALESCE((SELECT SUM(input_tokens) FROM filtered), 0),
      'total_output_tokens', COALESCE((SELECT SUM(output_tokens) FROM filtered), 0),
      'total_tokens', COALESCE((SELECT SUM(input_tokens + output_tokens) FROM filtered), 0),
      'avg_tokens_per_request', COALESCE((SELECT ROUND(AVG(input_tokens + output_tokens)) FROM filtered), 0),
      'models', COALESCE((SELECT json_agg(top_models ORDER BY top_models.total_tokens DESC) FROM top_models), '[]'::json)
    ) AS summary`,
    params
  );

  return result?.rows?.[0]?.summary || null;
}
