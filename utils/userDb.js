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
 * @property {string} auth_provider
 * @property {string[] | null} auth_providers
 */

function getUserDbPool() {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    throw new Error('DATABASE_URL is required for user storage.');
  }
  return pool;
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
    plan_tier: row.plan_tier || 'free',
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
    auth_provider: primaryProvider,
    auth_providers: providerNames.length ? providerNames : null
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
      b.plan_tier,
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
      b.plan_tier,
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

export async function getUserById(userId, { pool } = {}) {
  const activePool = pool || getUserDbPool();
  const row = await fetchUserRowById(activePool, userId);
  return mapUserRow(row);
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
          await client.query(
            `UPDATE credits SET balance = $1 WHERE user_id = $2`,
            [balanceAfter, userId]
          );
          await client.query('COMMIT');
          return { nextBalance: balanceAfter, alreadyCharged: true };
        }
      }
    }

    const creditsResult = await client.query(
      `SELECT balance, monthly_quota
       FROM credits
       WHERE user_id = $1
       FOR UPDATE`,
      [userId]
    );
    const creditsRow = creditsResult.rows[0];
    if (!creditsRow) {
      throw new Error(`Credits row missing for user ${userId}`);
    }

    const currentBalance = Number(creditsRow.balance ?? 0);
    const quota = Number.isFinite(creditsTotal)
      ? creditsTotal
      : Number(creditsRow.monthly_quota ?? 0);

    if (currentBalance < creditsToCharge) {
      throw new Error('INSUFFICIENT_CREDITS');
    }

    const nextBalance = Math.max(0, Math.min(currentBalance - creditsToCharge, quota));

    await client.query(
      `UPDATE credits SET balance = $1 WHERE user_id = $2`,
      [nextBalance, userId]
    );

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
    return { nextBalance, alreadyCharged: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
