import { getUsageAnalyticsPool } from './usageAnalytics.js';

/**
 * @typedef {Object} AuthProvider
 * @property {string} provider
 * @property {string} provider_user_id
 */

/**
 * @typedef {Object} DbUser
 * @property {string} user_id
 * @property {string} email
 * @property {string} display_name
 * @property {string | null} created_at
 * @property {string | null} last_login_at
 * @property {string} plan_tier
 * @property {string} credits_total
 * @property {string} credits_remaining
 * @property {string} credits_balance
 * @property {string | null} daily_credit_limit
 * @property {string | null} monthly_reset_at
 * @property {string} billing_status
 * @property {string} stripe_customer_id
 * @property {string} stripe_subscription_id
 * @property {boolean} is_internal
 * @property {string | null} plan_override
 * @property {string} auth_provider
 * @property {string[] | null} auth_providers
 * @property {Record<string, unknown> | null} preferences
 * @property {string | null} deleted_at
 */

function getUserDbPool() {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    throw new Error('DATABASE_URL is required for user storage.');
  }
  return pool;
}

function logCreditEvent(level, message, context = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context
  };
  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

function addMonthsUtc(date, months) {
  const next = new Date(date.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function shouldResetDaily(lastResetAt, now) {
  if (!lastResetAt) return true;
  return now.toISOString().slice(0, 10) !== lastResetAt.toISOString().slice(0, 10);
}

function shouldResetMonthly({ lastResetAt, periodEndAt, now }) {
  if (periodEndAt) {
    return now.getTime() >= periodEndAt.getTime();
  }
  if (!lastResetAt) return true;
  const nextResetAt = addMonthsUtc(lastResetAt, 1);
  return now.getTime() >= nextResetAt.getTime();
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function normalizeAuthProviders(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mergeAuthProviders(existing, provider, providerUserId) {
  const normalized = normalizeAuthProviders(existing);
  const cleaned = normalized.filter(
    (entry) => entry && entry.provider !== provider
  );
  if (provider) {
    cleaned.unshift({ provider, provider_user_id: providerUserId || '' });
  }
  return cleaned;
}

function mapUserRow(row) {
  if (!row) return null;
  const authProviders = normalizeAuthProviders(row.auth_providers);
  const providerNames = authProviders.map((entry) => entry.provider).filter(Boolean);
  const primaryProvider = providerNames[0] || '';
  return {
    user_id: row.id,
    email: row.email || '',
    display_name: row.display_name || '',
    created_at: toIsoString(row.created_at),
    last_login_at: toIsoString(row.last_seen_at),
    plan_tier: row.effective_plan_tier || row.plan_tier || 'free',
    credits_total: String(row.monthly_quota ?? 0),
    credits_remaining: String(row.balance ?? 0),
    credits_balance: String(row.balance ?? 0),
    daily_credit_limit: row.daily_cap !== null && row.daily_cap !== undefined
      ? String(row.daily_cap)
      : null,
    monthly_reset_at: toIsoString(row.current_period_end || row.last_monthly_reset_at),
    billing_status: row.billing_status || 'active',
    stripe_customer_id: row.stripe_customer_id || '',
    stripe_subscription_id: row.stripe_subscription_id || '',
    is_internal: Boolean(row.is_internal),
    plan_override: row.plan_override || null,
    auth_provider: primaryProvider,
    auth_providers: providerNames.length ? providerNames : null,
    preferences: row.preferences || {},
    deleted_at: toIsoString(row.deleted_at)
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function computeResetState({ row, now }) {
  const nowValue = now instanceof Date ? now : new Date(now);
  const lastDailyResetAt = parseDate(row.last_daily_reset_at);
  const lastMonthlyResetAt = parseDate(row.last_monthly_reset_at);
  const currentPeriodEnd = parseDate(row.current_period_end);
  const dailyReset = shouldResetDaily(lastDailyResetAt, nowValue);
  const monthlyReset = shouldResetMonthly({
    lastResetAt: lastMonthlyResetAt,
    periodEndAt: currentPeriodEnd,
    now: nowValue
  });
  return {
    now: nowValue,
    dailyReset,
    monthlyReset,
    lastDailyResetAt,
    lastMonthlyResetAt,
    currentPeriodEnd
  };
}

function nextUtcMidnight(now = new Date()) {
  const midnight = new Date(now.getTime());
  midnight.setUTCHours(24, 0, 0, 0);
  return midnight;
}

export async function runScheduledCreditResets({ now = new Date(), pool } = {}) {
  const activePool = pool || getUserDbPool();
  const timestamp = now instanceof Date ? now : new Date(now);
  const nextPeriodEnd = addMonthsUtc(timestamp, 1);
  const dailyResult = await activePool.query(
    `UPDATE credits
     SET daily_used = 0,
         last_daily_reset_at = $1
     WHERE last_daily_reset_at IS NULL
        OR DATE(last_daily_reset_at AT TIME ZONE 'UTC') < DATE($1 AT TIME ZONE 'UTC')`,
    [timestamp]
  );

  const monthlyResult = await activePool.query(
    `WITH due AS (
      SELECT c.user_id
      FROM credits c
      JOIN users u ON u.id = c.user_id
      JOIN billing b ON b.user_id = c.user_id
      WHERE COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, 'free') = 'free'
        AND (
          (b.current_period_end IS NOT NULL AND b.current_period_end <= $1)
          OR (b.current_period_end IS NULL AND (c.last_monthly_reset_at IS NULL OR c.last_monthly_reset_at + INTERVAL '1 month' <= $1))
        )
      FOR UPDATE
    ),
    reset AS (
      UPDATE credits c
      SET balance = c.monthly_quota,
          last_monthly_reset_at = $1
      FROM due
      WHERE c.user_id = due.user_id
      RETURNING c.user_id
    )
    UPDATE billing b
    SET current_period_start = $1,
        current_period_end = $2
    FROM reset
    WHERE b.user_id = reset.user_id`,
    [timestamp, nextPeriodEnd]
  );

  return {
    now: timestamp,
    next_midnight_utc: nextUtcMidnight(timestamp).toISOString(),
    daily_reset_users: Number(dailyResult.rowCount || 0),
    monthly_reset_users: Number(monthlyResult.rowCount || 0)
  };
}

function buildCreditRowUpdate({
  balance,
  dailyUsed,
  lastDailyResetAt,
  lastMonthlyResetAt,
  userId
}) {
  return {
    text: `UPDATE credits
      SET balance = $1,
          daily_used = $2,
          last_daily_reset_at = $3,
          last_monthly_reset_at = $4
      WHERE user_id = $5`,
    params: [
      Number(balance ?? 0),
      Number(dailyUsed ?? 0),
      lastDailyResetAt,
      lastMonthlyResetAt,
      userId
    ]
  };
}

async function fetchUserRowById(queryable, userId) {
  const result = await queryable.query(
    `SELECT
      u.id,
      u.email,
      u.display_name,
      u.created_at,
      u.last_seen_at,
      u.auth_providers,
      u.preferences,
      u.is_internal,
      u.plan_override,
      u.deleted_at,
      b.plan_tier,
      COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, 'free') AS effective_plan_tier,
      b.stripe_customer_id,
      b.stripe_subscription_id,
      b.status AS billing_status,
      b.current_period_start,
      b.current_period_end,
      c.monthly_quota,
      c.balance,
      c.daily_cap,
      c.daily_used,
      c.last_daily_reset_at,
      c.last_monthly_reset_at
     FROM users u
     LEFT JOIN billing b ON b.user_id = u.id
     LEFT JOIN credits c ON c.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function fetchUserRowByProviderOrEmail(queryable, provider, providerUserId, email) {
  const providerMatch = provider && providerUserId
    ? JSON.stringify([{ provider, provider_user_id: providerUserId }])
    : null;
  const result = await queryable.query(
    `SELECT
      u.id,
      u.email,
      u.display_name,
      u.created_at,
      u.last_seen_at,
      u.auth_providers,
      u.preferences,
      u.is_internal,
      u.plan_override,
      u.deleted_at,
      b.plan_tier,
      COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, 'free') AS effective_plan_tier,
      b.stripe_customer_id,
      b.stripe_subscription_id,
      b.status AS billing_status,
      b.current_period_start,
      b.current_period_end,
      c.monthly_quota,
      c.balance,
      c.daily_cap,
      c.daily_used,
      c.last_daily_reset_at,
      c.last_monthly_reset_at
     FROM users u
     LEFT JOIN billing b ON b.user_id = u.id
     LEFT JOIN credits c ON c.user_id = u.id
     WHERE ($1::jsonb IS NOT NULL AND u.auth_providers @> $1::jsonb)
        OR ($2 <> '' AND u.email = $2)
     LIMIT 1`,
    [providerMatch, email || '']
  );
  return result.rows[0] || null;
}

async function ensureBillingRow(client, { userId, planTier, status, currentPeriodStart, currentPeriodEnd }) {
  await client.query(
    `INSERT INTO billing
      (user_id, plan_tier, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end)
     VALUES ($1, $2, '', '', $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      planTier,
      status,
      currentPeriodStart,
      currentPeriodEnd
    ]
  );
}

async function ensureCreditsRow(client, {
  userId,
  monthlyQuota,
  balance,
  dailyCap,
  lastDailyResetAt,
  lastMonthlyResetAt
}) {
  await client.query(
    `INSERT INTO credits
      (user_id, monthly_quota, balance, daily_cap, daily_used, last_daily_reset_at, last_monthly_reset_at)
     VALUES ($1, $2, $3, $4, 0, $5, $6)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      userId,
      monthlyQuota,
      balance,
      dailyCap,
      lastDailyResetAt,
      lastMonthlyResetAt
    ]
  );
}

export async function getUserById(userId, { pool, includeDeleted = false } = {}) {
  const activePool = pool || getUserDbPool();
  const row = await fetchUserRowById(activePool, userId);
  if (!row) return null;
  if (row.deleted_at && !includeDeleted) {
    return null;
  }
  return mapUserRow(row);
}

export async function resetUserCreditsIfNeeded({ userId, now = new Date(), pool } = {}) {
  const activePool = pool || getUserDbPool();
  const client = await activePool.connect();

  try {
    await client.query('BEGIN');
    const creditResult = await client.query(
      `SELECT
        c.balance,
        c.monthly_quota,
        c.daily_used,
        c.last_daily_reset_at,
        c.last_monthly_reset_at,
        b.current_period_end,
        COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, 'free') AS effective_plan_tier
       FROM credits c
       JOIN users u ON u.id = c.user_id
       JOIN billing b ON b.user_id = c.user_id
       WHERE c.user_id = $1
       FOR UPDATE OF c`,
      [userId]
    );
    const row = creditResult.rows[0];
    if (!row) {
      throw new Error(`Credits row missing for user ${userId}`);
    }

    const resetState = computeResetState({ row, now });
    const planTier = row.effective_plan_tier || 'free';
    const shouldResetMonthlyForPlan = planTier === 'free' && resetState.monthlyReset;
    let nextBalance = Number(row.balance ?? 0);
    let nextDailyUsed = Number(row.daily_used ?? 0);
    let nextLastDailyResetAt = resetState.lastDailyResetAt;
    let nextLastMonthlyResetAt = resetState.lastMonthlyResetAt;

    if (resetState.dailyReset) {
      nextDailyUsed = 0;
      nextLastDailyResetAt = resetState.now;
    }
    if (shouldResetMonthlyForPlan) {
      nextBalance = Number(row.monthly_quota ?? 0);
      nextLastMonthlyResetAt = resetState.now;
    }

    if (resetState.dailyReset || shouldResetMonthlyForPlan) {
      const update = buildCreditRowUpdate({
        balance: nextBalance,
        dailyUsed: nextDailyUsed,
        lastDailyResetAt: nextLastDailyResetAt,
        lastMonthlyResetAt: nextLastMonthlyResetAt,
        userId
      });
      await client.query(update.text, update.params);

      if (shouldResetMonthlyForPlan) {
        const nextPeriodEnd = addMonthsUtc(resetState.now, 1);
        await client.query(
          `UPDATE billing
           SET current_period_start = $1,
               current_period_end = $2
           WHERE user_id = $3`,
          [resetState.now, nextPeriodEnd, userId]
        );
      }
    }

    const updatedRow = await fetchUserRowById(client, userId);
    await client.query('COMMIT');
    return {
      user: mapUserRow(updatedRow),
      daily_used: nextDailyUsed
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findOrCreateUser({
  email,
  provider,
  providerUserId,
  displayName,
  planTier = 'free',
  monthlyCredits = 0,
  dailyCap = null
}) {
  const activePool = getUserDbPool();
  const client = await activePool.connect();
  const normalizedEmail = email?.toLowerCase() || '';
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  try {
    await client.query('BEGIN');
    let row = await fetchUserRowByProviderOrEmail(client, provider, providerUserId, normalizedEmail);

    if (!row) {
      const authProviders = mergeAuthProviders([], provider, providerUserId);
      const insert = await client.query(
        `INSERT INTO users (email, display_name, created_at, last_seen_at, auth_providers)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          normalizedEmail,
          displayName || normalizedEmail.split('@')[0] || 'User',
          now,
          now,
          JSON.stringify(authProviders)
        ]
      );
      const userId = insert.rows[0].id;
      await ensureBillingRow(client, {
        userId,
        planTier,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd
      });
      await ensureCreditsRow(client, {
        userId,
        monthlyQuota: monthlyCredits,
        balance: monthlyCredits,
        dailyCap,
        lastDailyResetAt: now,
        lastMonthlyResetAt: now
      });
      row = await fetchUserRowById(client, userId);
    } else {
      if (row.deleted_at) {
        throw new Error('USER_DELETED');
      }
      const updatedProviders = mergeAuthProviders(row.auth_providers, provider, providerUserId);
      await client.query(
        `UPDATE users
         SET email = COALESCE(NULLIF($1, ''), email),
             display_name = COALESCE(NULLIF($2, ''), display_name),
             last_seen_at = $3,
             auth_providers = $4
         WHERE id = $5`,
        [
          normalizedEmail,
          displayName || '',
          now,
          JSON.stringify(updatedProviders),
          row.id
        ]
      );
      await ensureBillingRow(client, {
        userId: row.id,
        planTier,
        status: row.billing_status || 'active',
        currentPeriodStart: row.current_period_start || now,
        currentPeriodEnd: row.current_period_end || periodEnd
      });
      await ensureCreditsRow(client, {
        userId: row.id,
        monthlyQuota: Number(row.monthly_quota ?? monthlyCredits),
        balance: Number(row.balance ?? monthlyCredits),
        dailyCap: row.daily_cap ?? dailyCap,
        lastDailyResetAt: row.last_daily_reset_at || now,
        lastMonthlyResetAt: row.last_monthly_reset_at || now
      });
      row = await fetchUserRowById(client, row.id);
    }

    await client.query('COMMIT');
    return mapUserRow(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUser(userId, patch, { pool } = {}) {
  const activePool = pool || getUserDbPool();
  const client = await activePool.connect();
  const now = new Date();

  try {
    await client.query('BEGIN');

    const userUpdates = [];
    const userValues = [];
    let index = 1;

    if (patch.email !== undefined) {
      userUpdates.push(`email = $${index++}`);
      userValues.push(patch.email);
    }
    if (patch.display_name !== undefined) {
      userUpdates.push(`display_name = $${index++}`);
      userValues.push(patch.display_name);
    }
    if (patch.auth_providers !== undefined) {
      userUpdates.push(`auth_providers = $${index++}`);
      userValues.push(JSON.stringify(patch.auth_providers));
    }
    if (patch.preferences !== undefined) {
      userUpdates.push(`preferences = $${index++}`);
      userValues.push(JSON.stringify(patch.preferences));
    }
    if (patch.is_internal !== undefined) {
      userUpdates.push(`is_internal = $${index++}`);
      userValues.push(Boolean(patch.is_internal));
    }
    if (patch.plan_override !== undefined) {
      userUpdates.push(`plan_override = $${index++}`);
      userValues.push(patch.plan_override || null);
    }
    if (patch.deleted_at !== undefined) {
      userUpdates.push(`deleted_at = $${index++}`);
      userValues.push(patch.deleted_at);
    }
    if (userUpdates.length) {
      userUpdates.push(`last_seen_at = $${index++}`);
      userValues.push(now);
      userValues.push(userId);
      await client.query(
        `UPDATE users SET ${userUpdates.join(', ')} WHERE id = $${index}`,
        userValues
      );
    }

    const billingUpdates = [];
    const billingValues = [];
    index = 1;
    if (patch.plan_tier !== undefined) {
      billingUpdates.push(`plan_tier = $${index++}`);
      billingValues.push(patch.plan_tier);
    }
    if (patch.stripe_customer_id !== undefined) {
      billingUpdates.push(`stripe_customer_id = $${index++}`);
      billingValues.push(patch.stripe_customer_id);
    }
    if (patch.stripe_subscription_id !== undefined) {
      billingUpdates.push(`stripe_subscription_id = $${index++}`);
      billingValues.push(patch.stripe_subscription_id);
    }
    if (patch.billing_status !== undefined) {
      billingUpdates.push(`status = $${index++}`);
      billingValues.push(patch.billing_status);
    }
    if (patch.monthly_reset_at !== undefined) {
      billingUpdates.push(`current_period_end = $${index++}`);
      billingValues.push(patch.monthly_reset_at);
      billingUpdates.push(`current_period_start = $${index++}`);
      billingValues.push(now);
    }
    if (billingUpdates.length) {
      billingValues.push(userId);
      await client.query(
        `UPDATE billing SET ${billingUpdates.join(', ')} WHERE user_id = $${index}`,
        billingValues
      );
    }

    const creditsUpdates = [];
    const creditsValues = [];
    index = 1;
    if (patch.credits_total !== undefined) {
      creditsUpdates.push(`monthly_quota = $${index++}`);
      creditsValues.push(Number(patch.credits_total));
    }
    const nextBalance = patch.credits_balance ?? patch.credits_remaining;
    if (nextBalance !== undefined) {
      creditsUpdates.push(`balance = $${index++}`);
      creditsValues.push(Number(nextBalance));
    }
    if (patch.daily_credit_limit !== undefined) {
      creditsUpdates.push(`daily_cap = $${index++}`);
      creditsValues.push(
        patch.daily_credit_limit === '' || patch.daily_credit_limit === null
          ? null
          : Number(patch.daily_credit_limit)
      );
    }
    if (patch.daily_used !== undefined) {
      creditsUpdates.push(`daily_used = $${index++}`);
      creditsValues.push(Number(patch.daily_used));
    }
    if (patch.monthly_reset_at !== undefined) {
      creditsUpdates.push(`last_monthly_reset_at = $${index++}`);
      creditsValues.push(now);
    }
    if (creditsUpdates.length) {
      creditsValues.push(userId);
      await client.query(
        `UPDATE credits SET ${creditsUpdates.join(', ')} WHERE user_id = $${index}`,
        creditsValues
      );
    }

    const row = await fetchUserRowById(client, userId);
    await client.query('COMMIT');
    return mapUserRow(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserByStripeCustomer(stripeCustomerId, { pool } = {}) {
  if (!stripeCustomerId) return null;
  const activePool = pool || getUserDbPool();
  const result = await activePool.query(
    `SELECT u.id
     FROM users u
     JOIN billing b ON b.user_id = u.id
     WHERE b.stripe_customer_id = $1
     LIMIT 1`,
    [stripeCustomerId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return getUserById(row.id, { pool: activePool });
}


export async function grantPlanOverrideByEmail({
  email,
  planTier,
  monthlyCredits,
  dailyCap,
  markInternal = true,
  pool
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPlan = String(planTier || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('EMAIL_REQUIRED');
  }
  if (!normalizedPlan) {
    throw new Error('PLAN_TIER_REQUIRED');
  }

  const activePool = pool || getUserDbPool();
  const client = await activePool.connect();

  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT id
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail]
    );
    const userId = userResult.rows[0]?.id;
    if (!userId) {
      throw new Error('USER_NOT_FOUND');
    }

    await client.query(
      `UPDATE users
       SET is_internal = $1,
           plan_override = $2,
           last_seen_at = $3
       WHERE id = $4`,
      [Boolean(markInternal), normalizedPlan, new Date(), userId]
    );

    await client.query(
      `UPDATE credits
       SET monthly_quota = $1,
           balance = GREATEST(balance, $1),
           daily_cap = $2,
           last_monthly_reset_at = $3
       WHERE user_id = $4`,
      [Number(monthlyCredits), dailyCap === null ? null : Number(dailyCap), new Date(), userId]
    );

    const row = await fetchUserRowById(client, userId);
    await client.query('COMMIT');
    return mapUserRow(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function applyCreditDeduction({
  userId,
  sessionId,
  turnId,
  creditsToCharge,
  creditsTotal,
  metadata,
  reason = 'llm_usage',
  pool
}) {
  if (!Number.isFinite(creditsToCharge) || creditsToCharge <= 0) {
    const user = await getUserById(userId, { pool });
    return { nextBalance: Number(user?.credits_balance ?? 0), alreadyCharged: false };
  }

  const activePool = pool || getUserDbPool();
  const client = await activePool.connect();
  try {
    await client.query('BEGIN');

    const creditsResult = await client.query(
      `SELECT
        c.balance,
        c.monthly_quota,
        c.daily_used,
        c.last_daily_reset_at,
        c.last_monthly_reset_at,
        b.current_period_end,
        COALESCE(NULLIF(u.plan_override, ''), b.plan_tier, 'free') AS effective_plan_tier
       FROM credits c
       JOIN users u ON u.id = c.user_id
       JOIN billing b ON b.user_id = c.user_id
       WHERE c.user_id = $1
       FOR UPDATE OF c`,
      [userId]
    );
    const creditsRow = creditsResult.rows[0];
    if (!creditsRow) {
      throw new Error(`Credits row missing for user ${userId}`);
    }

    const resetState = computeResetState({ row: creditsRow, now: new Date() });
    const planTier = creditsRow.effective_plan_tier || 'free';
    const monthlyResetApplied = planTier === 'free' && resetState.monthlyReset;
    let currentBalance = Number(creditsRow.balance ?? 0);
    let dailyUsed = Number(creditsRow.daily_used ?? 0);
    let lastDailyResetAt = resetState.lastDailyResetAt;
    let lastMonthlyResetAt = resetState.lastMonthlyResetAt;

    if (resetState.dailyReset) {
      dailyUsed = 0;
      lastDailyResetAt = resetState.now;
    }
    if (monthlyResetApplied) {
      currentBalance = Number(creditsRow.monthly_quota ?? 0);
      lastMonthlyResetAt = resetState.now;
    }

    if (turnId) {
      const ledgerResult = await client.query(
        `SELECT balance_after
         FROM credit_ledger
         WHERE user_id = $1 AND turn_id = $2 AND reason = $3
         LIMIT 1`,
        [userId, turnId, reason]
      );
      const existing = ledgerResult.rows[0];
      if (existing) {
        const balanceAfter = Number(existing.balance_after);
        if (Number.isFinite(balanceAfter)) {
          logCreditEvent('info', 'credit_deduction_duplicate', {
            user_id: userId,
            session_id: sessionId || '',
            request_id: turnId || '',
            reason,
            credits_to_charge: creditsToCharge,
            balance_before: currentBalance,
            balance_after: balanceAfter,
            outcome: 'duplicate'
          });
          const update = buildCreditRowUpdate({
            balance: monthlyResetApplied ? currentBalance : balanceAfter,
            dailyUsed,
            lastDailyResetAt,
            lastMonthlyResetAt,
            userId
          });
          await client.query(update.text, update.params);
          if (monthlyResetApplied) {
            const nextPeriodEnd = addMonthsUtc(resetState.now, 1);
            await client.query(
              `UPDATE billing
               SET current_period_start = $1,
                   current_period_end = $2
               WHERE user_id = $3`,
              [resetState.now, nextPeriodEnd, userId]
            );
          }
          await client.query('COMMIT');
          return {
            nextBalance: monthlyResetApplied ? currentBalance : balanceAfter,
            alreadyCharged: true
          };
        }
      }
    }

    const quota = Number.isFinite(creditsTotal)
      ? creditsTotal
      : Number(creditsRow.monthly_quota ?? 0);

    if (currentBalance < creditsToCharge) {
      logCreditEvent('warn', 'credit_deduction_insufficient', {
        user_id: userId,
        session_id: sessionId || '',
        request_id: turnId || '',
        reason,
        credits_to_charge: creditsToCharge,
        balance_before: currentBalance,
        outcome: 'insufficient'
      });
      throw new Error('INSUFFICIENT_CREDITS');
    }

    const nextBalance = Math.max(0, Math.min(currentBalance - creditsToCharge, quota));
    const nextDailyUsed = dailyUsed + creditsToCharge;
    const update = buildCreditRowUpdate({
      balance: nextBalance,
      dailyUsed: nextDailyUsed,
      lastDailyResetAt,
      lastMonthlyResetAt,
      userId
    });
    await client.query(update.text, update.params);

    if (monthlyResetApplied) {
      const nextPeriodEnd = addMonthsUtc(resetState.now, 1);
      await client.query(
        `UPDATE billing
         SET current_period_start = $1,
             current_period_end = $2
         WHERE user_id = $3`,
        [resetState.now, nextPeriodEnd, userId]
      );
    }

    await client.query(
      `INSERT INTO credit_ledger
        (user_id, session_id, turn_id, delta, balance_after, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        sessionId || '',
        turnId || '',
        -creditsToCharge,
        nextBalance,
        reason,
        metadata || ''
      ]
    );

    await client.query('COMMIT');
    logCreditEvent('info', 'credit_deduction_applied', {
      user_id: userId,
      session_id: sessionId || '',
      request_id: turnId || '',
      reason,
      credits_to_charge: creditsToCharge,
      balance_before: currentBalance,
      balance_after: nextBalance,
      outcome: 'applied'
    });
    return { nextBalance, alreadyCharged: false };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '23505' && turnId) {
      const ledgerResult = await client.query(
        `SELECT balance_after
         FROM credit_ledger
         WHERE user_id = $1 AND turn_id = $2 AND reason = $3
         LIMIT 1`,
        [userId, turnId, reason]
      );
      const existing = ledgerResult.rows[0];
      if (existing) {
        const balanceAfter = Number(existing.balance_after);
        logCreditEvent('info', 'credit_deduction_duplicate', {
          user_id: userId,
          session_id: sessionId || '',
          request_id: turnId || '',
          reason,
          credits_to_charge: creditsToCharge,
          balance_after: balanceAfter,
          outcome: 'unique_constraint'
        });
        return { nextBalance: balanceAfter, alreadyCharged: true };
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
