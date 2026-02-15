import express from 'express';
import cors from 'cors';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { resolveUserStoreDriver, isCsvUserStoreDriver } from './db/index.js';
import { recordUsageEvent } from './db/usage.js';
import {
  fetchCheapestAllowedModel,
  fetchModelPricing,
  fetchFirstNonPremiumModel,
  fetchMonthlyQuota,
  fetchPlanNormalizationFactor,
  fetchPlanPolicy,
  fetchNextTurnIndex,
  fetchSessionEvents,
  fetchSessionSummary,
  fetchUsageDailySummary,
  fetchUsageEventsByRange,
  fetchUsageOverview,
  fetchAdminUsageSummary,
  getUsageAnalyticsPool,
  insertLlmTurnLog,
  insertRouteDecision,
  isPremiumModel
} from './utils/usageAnalytics.js';
import {
  applyCreditDeduction,
  findOrCreateUser,
  findUserByStripeCustomer,
  getUserById,
  resetUserCreditsIfNeeded,
  runScheduledCreditResets,
  updateUser
} from './utils/userDb.js';
import {
  computePayloadHash,
  recordBillingEvent,
  updateBillingEventStatus
} from './utils/billingEvents.js';
import {
  createArtifact,
  createArtifactVersion,
  createArtifactReport,
  deleteArtifact,
  deletePrivateArtifactsForUser,
  fetchArtifactById,
  fetchArtifactVersionById,
  fetchArtifactVersionSummaries,
  fetchArtifactVersions,
  fetchArtifactsByOwner,
  fetchPublicArtifacts,
  forkArtifact,
  normalizeCategoryInput,
  normalizeTagsInput,
  unpublishPublicArtifactsForUser,
  updateArtifactMetadata,
  updateArtifactPublishSettings,
  updateArtifactVisibility
} from './utils/artifactDb.js';
import {
  buildProfileStats,
  deleteProfile,
  fetchProfileByHandle,
  fetchProfileByUserId,
  fetchProfileHandleOwner,
  upsertProfile
} from './utils/profileDb.js';
import { createObjectStorageAdapter } from './utils/objectStorage.js';
import {
  applyUsageAwareReduction,
  buildTrimmedContext,
  estimateMessageTokens,
  estimateTokensWithTokenizer,
  getContextTokenBudget,
  hasAccurateTokenizer,
  resolveContextMode
} from './utils/tokenEfficiency.js';
import { getDbPool } from './utils/queryLayer.js';
import { buildPlayablePrompt } from './server/utils/playableWrapper.js';
import { buildRetryPrompt } from './server/utils/retryWrapper.js';
import { createHttpError, logStructured } from './utils/logger.js';

const app = express();
app.set('trust proxy', 1);
const revokedSessionStore = new Map();
const authRateLimitStore = new Map();

function parseEnvOriginList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveCorsOrigins() {
  const configuredOrigins = parseEnvOriginList(process.env.CORS_ALLOWED_ORIGINS);
  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }
  return [
    'https://maya-dev-ui.pages.dev',
    'https://dev.primarydesignco.com',
    'http://localhost:3000',
    'http://localhost:5173',
    ...parseEnvOriginList(process.env.FRONTEND_URL)
  ];
}

function resolveCookieSameSite() {
  const rawValue = String(process.env.COOKIE_SAMESITE || 'Lax').trim().toLowerCase();
  if (rawValue === 'none') return 'None';
  if (rawValue === 'strict') return 'Strict';
  return 'Lax';
}

function splitEmailList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveUserRole(user) {
  return resolveRoleForUser(user, {
    adminEmails: splitEmailList(process.env.ADMIN_EMAILS),
    internalEmails: splitEmailList(process.env.INTERNAL_EMAILS)
  });
}

function revokeSessionJti(jti) {
  if (!jti) return;
  revokedSessionStore.set(jti, Date.now() + (SESSION_REVOCATION_TTL_SECONDS * 1000));
}

function isSessionRevoked(jti) {
  if (!jti) return false;
  const expiresAt = revokedSessionStore.get(jti);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    revokedSessionStore.delete(jti);
    return false;
  }
  return true;
}

function enforceLocalAuthRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const current = authRateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    authRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  return true;
}

function getRequestIp(req) {
  return req.header('cf-connecting-ip') || req.header('x-forwarded-for') || req.ip || 'unknown';
}


const REQUEST_LOG_EVENT = 'http_request';
const MAX_CHAT_MESSAGE_CHARS = 12000;
const MAX_CODE_CONTEXT_CHARS = 200000;
const MAX_CHAT_HISTORY_COUNT = 60;
const MAX_AUTH_TOKEN_LENGTH = 8192;
const MAX_EMAIL_LENGTH = 320;


const DEV_PERF_ENABLED = process.env.NODE_ENV !== 'production';
const DEV_PERF_WINDOW_SIZE = 200;
const DEV_PERF_ENDPOINTS = new Set([
  '/api/chat',
  '/api/agent/start',
  '/api/session/state'
]);
const devPerfMetrics = new Map();

function percentile(values = [], p = 50) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function recordDevPerfMetric(pathname, latencyMs, statusCode) {
  if (!DEV_PERF_ENABLED || !DEV_PERF_ENDPOINTS.has(pathname)) {
    return;
  }
  const bucket = devPerfMetrics.get(pathname) || [];
  bucket.push({
    latencyMs: Number(latencyMs) || 0,
    statusCode: Number(statusCode) || 0,
    at: Date.now()
  });
  if (bucket.length > DEV_PERF_WINDOW_SIZE) {
    bucket.splice(0, bucket.length - DEV_PERF_WINDOW_SIZE);
  }
  devPerfMetrics.set(pathname, bucket);
}

function summarizeDevPerfMetric(pathname) {
  const samples = devPerfMetrics.get(pathname) || [];
  const latencies = samples.map((sample) => sample.latencyMs).filter(Number.isFinite);
  const errors = samples.filter((sample) => sample.statusCode >= 400).length;
  const total = samples.length;
  return {
    count: total,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    errorRate: total > 0 ? (errors / total) * 100 : 0
  };
}

function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  const safeStatus = Number.isInteger(status) ? status : 500;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  return {
    status: safeStatus,
    code
  };
}

function requestContextMiddleware(req, res, next) {
  const requestStartedAt = Date.now();
  const incomingRequestId = req.header('x-request-id');
  req.requestId = incomingRequestId || crypto.randomUUID();
  req.userId = null;
  res.setHeader('x-request-id', req.requestId);

  res.on('finish', () => {
    const latencyMs = Date.now() - requestStartedAt;
    const requestPathname = req.path || req.originalUrl || '';
    recordDevPerfMetric(requestPathname, latencyMs, res.statusCode);
    logStructured('info', REQUEST_LOG_EVENT, {
      request_id: req.requestId,
      route: req.originalUrl,
      method: req.method,
      user_id: req.userId || null,
      intent_type: req.body?.intentType || req.body?.intent_type || null,
      credits_charged: Number(req.creditsCharged || 0),
      latency_ms: latencyMs,
      status: res.statusCode,
      error_code: res.statusCode >= 400 ? (res.locals.errorCode || 'REQUEST_FAILED') : null
    });
  });

  next();
}

function enforceRequestValidation(req, _res, next) {
  const path = req.path || req.originalUrl || '';
  if (path === '/api/chat') {
    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length > MAX_CHAT_HISTORY_COUNT) {
      return next(createHttpError({
        status: 413,
        code: 'MAX_HISTORY_EXCEEDED',
        message: `messages exceeds max history count of ${MAX_CHAT_HISTORY_COUNT}`
      }));
    }
    const oversizedMessage = messages.find((entry) => {
      const content = typeof entry?.content === 'string'
        ? entry.content
        : JSON.stringify(entry?.content ?? '');
      return content.length > MAX_CHAT_MESSAGE_CHARS;
    });
    if (oversizedMessage) {
      return next(createHttpError({
        status: 413,
        code: 'MESSAGE_TOO_LARGE',
        message: `Each message must be <= ${MAX_CHAT_MESSAGE_CHARS} chars`
      }));
    }
    const codeContent = typeof body.currentCode === 'string'
      ? body.currentCode
      : (typeof body.code === 'string' ? body.code : '');
    if (codeContent.length > MAX_CODE_CONTEXT_CHARS) {
      return next(createHttpError({
        status: 413,
        code: 'CODE_CONTEXT_TOO_LARGE',
        message: `Code context must be <= ${MAX_CODE_CONTEXT_CHARS} chars`
      }));
    }
  }

  if (path.startsWith('/api/auth/')) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    if (email.length > MAX_EMAIL_LENGTH) {
      return next(createHttpError({ status: 400, code: 'EMAIL_TOO_LONG', message: 'Email too long' }));
    }
    if (token.length > MAX_AUTH_TOKEN_LENGTH || idToken.length > MAX_AUTH_TOKEN_LENGTH) {
      return next(createHttpError({ status: 413, code: 'TOKEN_TOO_LARGE', message: 'Token payload too large' }));
    }
  }

  next();
}

async function recordUsageEventToDb({
  user,
  sessionId,
  requestId,
  intentType,
  model,
  inputTokens,
  outputTokens,
  creditsCharged,
  latencyMs,
  status,
  timestamp
}) {
  if (!user || !model) {
    return;
  }
  const planTier = user.plan_tier || 'free';
  const [pricing, creditNormFactorRaw] = await Promise.all([
    fetchModelPricing({ model }),
    fetchPlanNormalizationFactor({ plan: planTier })
  ]);
  const creditNormFactor = Number.isFinite(Number(creditNormFactorRaw))
    ? Number(creditNormFactorRaw)
    : 1;
  const inputTokenValue = Number(inputTokens) || 0;
  const outputTokenValue = Number(outputTokens) || 0;
  const modelCostUsd = pricing
    ? (
      (inputTokenValue / 1000) * Number(pricing.cost_per_1k_input_tokens)
      + (outputTokenValue / 1000) * Number(pricing.cost_per_1k_output_tokens)
    ) * Number(pricing.credit_multiplier)
    : 0;

  await recordUsageEvent({
    userId: user.user_id,
    requestId,
    sessionId: sessionId || crypto.randomUUID(),
    intentType,
    model,
    inputTokens: inputTokenValue,
    outputTokens: outputTokenValue,
    creditsUsed: Number(creditsCharged) || 0,
    creditNormFactor,
    modelCostUsd,
    latencyMs: latencyMs ?? 0,
    success: status === 'success',
    status: status === 'success' ? 'success' : 'error',
    timestamp
  });
}

function usageEventLoggingMiddleware(req, _res, next) {
  req.logUsageEventToDb = (payload) => recordUsageEventToDb(payload);
  next();
}

app.use(usageEventLoggingMiddleware);
app.use(requestContextMiddleware);

const USER_STORE_DRIVER = resolveUserStoreDriver(process.env);
const CSV_USER_STORE_FALLBACK_ENABLED = isCsvUserStoreDriver(process.env);

const CREDIT_MONTHLY_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const CREDIT_DAILY_RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

function millisecondsUntilNextUtcMidnight(now = new Date()) {
  const nextMidnight = new Date(now.getTime());
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(0, nextMidnight.getTime() - now.getTime());
}

async function runCreditResetSweep(reason) {
  try {
    const result = await runScheduledCreditResets();
    logStructured('info', 'credit_reset_sweep', {
      reason,
      daily_reset_users: result.daily_reset_users,
      monthly_reset_users: result.monthly_reset_users,
      next_midnight_utc: result.next_midnight_utc
    });
  } catch (error) {
    logStructured('error', 'credit_reset_sweep_failed', {
      reason,
      error: error?.message || 'unknown_error'
    });
    console.error('Credit reset sweep failed.', error);
  }
}

function startCreditResetScheduler() {
  runCreditResetSweep('startup');
  setInterval(() => {
    runCreditResetSweep('monthly_sweep_interval');
  }, CREDIT_MONTHLY_SWEEP_INTERVAL_MS);

  const startDailyReset = () => {
    runCreditResetSweep('daily_midnight');
    setInterval(() => {
      runCreditResetSweep('daily_midnight');
    }, CREDIT_DAILY_RESET_INTERVAL_MS);
  };

  const initialDelay = millisecondsUntilNextUtcMidnight();
  setTimeout(startDailyReset, initialDelay);
}
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const LLM_PROXY_URL =
  process.env.LLM_PROXY_URL
  || 'https://text-code.primarydesigncompany.workers.dev';
const SESSION_COOKIE_NAME = 'maya_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_REVOCATION_TTL_SECONDS = 60 * 60 * 24 * 35;
const FREE_PLAN = { tier: 'free', monthly_credits: 500 };
const PLAN_DAILY_CAPS = {
  free: 100,
  starter: 500,
  pro: 2000,
  enterprise: 10000,
  power: 10000
};
const DEFAULT_PLAN_CATALOG = {
  free: {
    display_name: 'Free',
    monthly_credits: FREE_PLAN.monthly_credits,
    daily_cap: PLAN_DAILY_CAPS.free,
    price_label: '$0',
    stripe_price_id: null
  },
  starter: {
    display_name: 'Starter',
    monthly_credits: 5000,
    daily_cap: PLAN_DAILY_CAPS.starter,
    price_label: '$12/mo',
    stripe_price_id: process.env.STRIPE_PRICE_STARTER || null
  },
  pro: {
    display_name: 'Pro',
    monthly_credits: 20000,
    daily_cap: PLAN_DAILY_CAPS.pro,
    price_label: '$29/mo',
    stripe_price_id: process.env.STRIPE_PRICE_PRO || null
  },
  enterprise: {
    display_name: 'Enterprise',
    monthly_credits: 100000,
    daily_cap: PLAN_DAILY_CAPS.enterprise,
    price_label: 'Contact sales',
    stripe_price_id: process.env.STRIPE_PRICE_ENTERPRISE || null
  }
};
const STRIPE_PLAN_MAP = (() => {
  const raw = process.env.STRIPE_PLAN_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Invalid STRIPE_PLAN_MAP JSON.', error);
    return {};
  }
})();
const STRIPE_CREDIT_PACKS = (() => {
  const raw = process.env.STRIPE_CREDIT_PACKS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Invalid STRIPE_CREDIT_PACKS JSON.', error);
    return {};
  }
})();

const PLAN_CATALOG = (() => {
  const catalog = {};

  const applyEntry = (tier, entry = {}) => {
    const normalizedTier = String(tier).toLowerCase();
    const displayName = entry.display_name
      || entry.displayName
      || normalizedTier.charAt(0).toUpperCase() + normalizedTier.slice(1);
    const monthlyCredits = Number(entry.monthly_credits ?? entry.monthlyCredits);
    const dailyCap = Number(entry.daily_cap ?? entry.dailyCap);
    catalog[normalizedTier] = {
      tier: normalizedTier,
      display_name: displayName,
      stripe_price_id: entry.stripe_price_id || entry.price_id || entry.priceId || null,
      monthly_credits: Number.isFinite(monthlyCredits)
        ? monthlyCredits
        : (catalog[normalizedTier]?.monthly_credits ?? FREE_PLAN.monthly_credits),
      daily_cap: Number.isFinite(dailyCap)
        ? dailyCap
        : (PLAN_DAILY_CAPS[normalizedTier] ?? null),
      price_label: entry.price_label || entry.priceLabel || catalog[normalizedTier]?.price_label || null
    };
  };


  Object.entries(DEFAULT_PLAN_CATALOG).forEach(([tier, entry]) => {
    applyEntry(tier, entry);
  });

  const rawCatalog = process.env.STRIPE_PLAN_CATALOG;
  if (rawCatalog) {
    try {
      const parsed = JSON.parse(rawCatalog);
      Object.entries(parsed).forEach(([tier, entry]) => {
        applyEntry(tier, entry);
      });
    } catch (error) {
      console.warn('Invalid STRIPE_PLAN_CATALOG JSON.', error);
    }
  }

  if (!Object.keys(catalog).length && Object.keys(STRIPE_PLAN_MAP).length) {
    Object.entries(STRIPE_PLAN_MAP).forEach(([priceId, plan]) => {
      if (!plan?.tier) return;
      applyEntry(plan.tier, {
        stripe_price_id: priceId,
        monthly_credits: plan.monthly_credits ?? plan.monthlyCredits,
        display_name: plan.display_name || plan.displayName
      });
    });
  }

  if (catalog.power && !catalog.enterprise) {
    applyEntry('enterprise', {
      ...catalog.power,
      tier: 'enterprise',
      display_name: 'Enterprise'
    });
  }

  applyEntry(FREE_PLAN.tier, DEFAULT_PLAN_CATALOG.free);
  return catalog;
})();
const PLAN_BY_PRICE_ID = Object.values(PLAN_CATALOG).reduce((acc, plan) => {
  if (plan?.stripe_price_id) {
    acc[plan.stripe_price_id] = plan;
  }
  return acc;
}, {});

function isUserPlanOverridden(user) {
  return Boolean(user?.plan_override);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const ARTIFACT_UPLOADS_DIR = path.join(DATA_DIR, 'artifact_uploads');
const PROFILE_UPLOADS_DIR = path.join(DATA_DIR, 'profile_uploads');
const SESSION_STATE_DIR = path.join(DATA_DIR, 'session_state');
const SESSION_STATE_MAX_BYTES = Number(process.env.SESSION_STATE_MAX_BYTES || 4_000_000);

function getSessionStateDbPool() {
  return getDbPool();
}

async function upsertSessionStateRecord({ userId, sessionId, state, summary = null }) {
  const dbPool = getSessionStateDbPool();
  const updatedAt = new Date().toISOString();
  if (dbPool) {
    const serialized = JSON.stringify(state || {});
    if (Buffer.byteLength(serialized, 'utf8') > SESSION_STATE_MAX_BYTES) {
      throw new Error('Session state exceeds max allowed size');
    }
    await dbPool.query(
      `
      INSERT INTO sessions (session_id, user_id, last_active, state_blob)
      VALUES ($1, $2, NOW(), $3::jsonb)
      ON CONFLICT (session_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        last_active = NOW(),
        state_blob = EXCLUDED.state_blob
      `,
      [sessionId, userId, JSON.stringify({ summary, state, updated_at: updatedAt })]
    );
    return;
  }
  await fs.mkdir(SESSION_STATE_DIR, { recursive: true });
  const payload = {
    user_id: userId,
    session_id: sessionId,
    summary,
    state,
    updated_at: updatedAt
  };
  const filePath = path.join(SESSION_STATE_DIR, `${userId}-${sessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload));
}

async function fetchSessionStateRecord({ userId, sessionId = '' }) {
  const dbPool = getSessionStateDbPool();
  if (dbPool) {
    if (sessionId) {
      const result = await dbPool.query(
        `
        SELECT session_id, user_id, last_active, state_blob
        FROM sessions
        WHERE session_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [sessionId, userId]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        session_id: row.session_id,
        user_id: row.user_id,
        last_active: row.last_active,
        ...(row.state_blob || {})
      };
    }
    const result = await dbPool.query(
      `
      SELECT session_id, user_id, last_active, state_blob
      FROM sessions
      WHERE user_id = $1
      ORDER BY last_active DESC
      LIMIT 1
      `,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      session_id: row.session_id,
      user_id: row.user_id,
      last_active: row.last_active,
      ...(row.state_blob || {})
    };
  }

  if (sessionId) {
    const filePath = path.join(SESSION_STATE_DIR, `${userId}-${sessionId}.json`);
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  }
  await fs.mkdir(SESSION_STATE_DIR, { recursive: true });
  const entries = await fs.readdir(SESSION_STATE_DIR).catch(() => []);
  const prefix = `${userId}-`;
  const files = entries.filter((name) => name.startsWith(prefix) && name.endsWith('.json'));
  files.sort((a, b) => b.localeCompare(a));
  for (const name of files) {
    try {
      const text = await fs.readFile(path.join(SESSION_STATE_DIR, name), 'utf8');
      return JSON.parse(text);
    } catch {
      // try next file
    }
  }
  return null;
}
const ARTIFACT_EVENTS_FILE = path.join(DATA_DIR, 'artifact_events.csv');
const DEFAULT_MAX_CONTEXT_MESSAGES = 8;
const DEFAULT_MAX_RELEVANT_MESSAGES = 8;
const DEFAULT_MAX_CODE_CONTEXT_CHARS = 3000;
const DEFAULT_HISTORY_SUMMARY_THRESHOLD_TOKENS = 6000;
const storageAdapter = createObjectStorageAdapter({
  artifactUploadsDir: ARTIFACT_UPLOADS_DIR,
  profileUploadsDir: PROFILE_UPLOADS_DIR
});

const tokenEfficiencyTelemetry = {
  totalRequests: 0,
  totalTokensBeforeTrim: 0,
  totalTokensAfterTrim: 0,
  totalTokensSaved: 0,
  totalRelevanceSelected: 0,
  summaryUsageCount: 0
};

const CHAT_SYSTEM_PROMPT = `You are a serious, capable engineering assistant.
Be concise, direct, and practical.
Avoid whimsical, playful, or anthropomorphic language.
Demonstrate capability through action (code, structure), not tone.

Default behavior:
- Be proactive and demonstrate capability when possible.
- If the user input is underspecified, choose a reasonable, concrete task and execute it.
- Prefer generating working code, UI components, or functional examples over discussion.

Assume the user is evaluating capability unless stated otherwise.

You MUST respond with valid JSON only. Do not wrap in markdown or code fences.
Return ONLY the following schema with no extra top-level keys:

{
  "assistant": { "text": "string" },
  "ui": {
    "html": "string",
    "css": "string",
    "js": "string"
  }
}

The "ui.html", "ui.css", and "ui.js" fields are optional but MUST be present as
empty strings when not provided. If the user asks a question, respond with
assistant.text. If the user asks to modify or generate UI, include ui.html/css/js.`;

/**
 * 🔴 CORS MUST BE FIRST
 */
const allowedCorsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: resolveCorsOrigins(),
  credentials: true
}));

app.options('*', cors());

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/stripe/webhook')) {
    return next();
  }
  return express.json({ limit: '10mb' })(req, res, next);
});

app.use('/uploads/artifacts', express.static(ARTIFACT_UPLOADS_DIR));
app.use('/uploads/profiles', express.static(PROFILE_UPLOADS_DIR));
app.use(enforceRequestValidation);

/**
 * 🔍 DIAGNOSTIC HEADERS (prove code is live)
 */
app.use((req, res, next) => {
  res.setHeader('X-MAYA-BACKEND', 'alive');
  next();
});

/**
 * HEALTH
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/healthz', (_req, res) => {
  return res.status(200).json({ ok: true });
});

app.get('/api/agent/runs', (_req, res) => {
  res.json({ runs: [] });
});

// --- Compatibility API stubs (frontend expects these) ---
app.get('/api/plans', (_req, res) => {
  return res.json({ plans: [] });
});

app.get('/api/session/state', async (req, res, next) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.json({
        authenticated: false,
        user: null
      });
    }
    return next();
  } catch {
    return res.json({
      authenticated: false,
      user: null
    });
  }
});

app.get('/api/usage/overview', async (req, res, next) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.json({
        credits: 0,
        plan: 'free'
      });
    }
    return next();
  } catch {
    return res.json({
      credits: 0,
      plan: 'free'
    });
  }
});

app.post('/api/run', async (req, res) => {
  const result = {
    code: '<!doctype html><html><body><h1>Hello</h1></body></html>'
  };
  res.json(result);
});


app.get('/api/dev/perf', (_req, res) => {
  if (!DEV_PERF_ENABLED) {
    return res.status(404).json({ ok: false, error: 'Not available' });
  }
  const metrics = {};
  for (const endpoint of DEV_PERF_ENDPOINTS) {
    metrics[endpoint] = summarizeDevPerfMetric(endpoint);
  }
  return res.json({
    ok: true,
    windowSize: DEV_PERF_WINDOW_SIZE,
    metrics,
    generatedAt: new Date().toISOString()
  });
});

app.use('/agent', createAgentRouter({
  getSessionFromRequest,
  verifyStripeSignature
}));

app.use('/api/agent', createAgentRouter({
  getSessionFromRequest,
  verifyStripeSignature
}));

/**
 * SESSION CHECK
 */
app.get('/api/me', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    return res.json({
      user: mapUserForClient(user),
      token: session.token
    });
  } catch (error) {
    console.error('Failed to load /me.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load session' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (session?.jti) {
    revokeSessionJti(session.jti);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/session/revoke', async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (session.jti) {
    revokeSessionJti(session.jti);
  }
  clearSessionCookie(res);
  return res.json({ ok: true, revoked: Boolean(session.jti) });
});

app.patch('/api/account/preferences', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const newsletterOptIn = req.body?.newsletter_opt_in;
    const contextMode = req.body?.context_mode;
    if (typeof newsletterOptIn !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'Invalid preferences payload' });
    }
    if (contextMode !== undefined && !['aggressive', 'balanced', 'full'].includes(String(contextMode).toLowerCase())) {
      return res.status(400).json({ ok: false, error: 'Invalid context mode' });
    }

    const nextPreferences = {
      ...(user.preferences || {}),
      newsletter_opt_in: newsletterOptIn,
      context_mode: resolveContextMode(contextMode || user.preferences?.context_mode || 'balanced')
    };

    const updated = await updateUser(session.sub, {
      preferences: nextPreferences
    });

    return res.json({
      ok: true,
      preferences: nextPreferences,
      user: mapUserForClient(updated)
    });
  } catch (error) {
    console.error('Failed to update preferences.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update preferences' });
  }
});

app.delete('/api/account', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await getUserById(session.sub, { includeDeleted: true });
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (user.deleted_at) {
      return res.status(410).json({ ok: false, error: 'Account already deleted' });
    }

    await deletePrivateArtifactsForUser(session.sub);
    await unpublishPublicArtifactsForUser(session.sub);
    await deleteProfile(session.sub);

    const anonymizedEmail = `deleted+${session.sub}@example.com`;
    const deletedAt = new Date();
    await updateUser(session.sub, {
      email: anonymizedEmail,
      display_name: 'Deleted User',
      auth_providers: [],
      preferences: {
        ...(user.preferences || {}),
        newsletter_opt_in: false
      },
      deleted_at: deletedAt
    });

    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete account.', error);
    return res.status(500).json({ ok: false, error: 'Failed to delete account' });
  }
});

app.get(['/api/plans', '/api/v1/plans'], (req, res) => {
  const plans = Object.values(PLAN_CATALOG)
    .filter((plan) => plan.tier)
    .sort((a, b) => {
      if (a.tier === 'free') return -1;
      if (b.tier === 'free') return 1;
      return (a.monthly_credits || 0) - (b.monthly_credits || 0);
    });
  res.json({ ok: true, plans });
});

app.post('/api/artifacts/metadata', async (req, res) => {
  let source = 'code-only';
  try {
    const transcript = Array.isArray(req.body?.transcript) ? req.body.transcript : [];
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : transcript;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : chat;
    const code = req.body?.code || {};
    const filteredMessages = selectMetadataMessages(messages);
    const hasChatContext = filteredMessages.some((entry) => entry.role === 'user');
    const promptContent = hasChatContext
      ? buildChatPlusCodePrompt(filteredMessages, code)
      : buildCodeOnlyPrompt(code);
    const prompt = [
      {
        role: 'user',
        content: promptContent
      }
    ];

    source = hasChatContext ? 'chat+code' : 'code-only';
    if (!LLM_PROXY_URL) {
      return res.json(buildMetadataResponse({}, source));
    }

    const workerRes = await fetch(LLM_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: prompt,
        temperature: 0.2
      })
    });

    if (!workerRes.ok) {
      return res.json(buildMetadataResponse({}, source));
    }

    const responseText = await workerRes.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    const content = data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? '';
    let parsed = null;
    try {
      parsed = content ? JSON.parse(content) : null;
    } catch {
      parsed = null;
    }

    res.json(buildMetadataResponse(parsed || {}, source));
  } catch (error) {
    console.error('Failed to infer artifact metadata.', error);
    res.json(buildMetadataResponse({}, source));
  }
});

app.post('/api/artifacts', async (req, res) => {
  let artifactId = '';
  let userId = '';
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    userId = user.user_id;

    const screenshotDataUrl = resolveScreenshotDataUrl(req.body);
    const resolvedCode = resolveArtifactCode(req.body) || { language: 'html', content: '' };
    const codeVersions = resolveArtifactCodeVersions(req.body);
    const visibility = req.body?.visibility === 'public' ? 'public' : 'private';
    const tags = normalizeTagsInput(req.body?.tags);
    const category = normalizeCategoryInput(req.body?.category);
    const validation = validateArtifactPayload({
      code: resolvedCode,
      codeVersions,
      visibility,
      screenshotDataUrl
    });
    if (!validation.ok) {
      console.error('Artifact payload rejected.', {
        userId: user.user_id,
        reasons: validation.errors
      });
      return res.status(400).json({ ok: false, error: validation.errors.join(' ') });
    }

    artifactId = crypto.randomUUID();
    const code = resolvedCode;
    const screenshotUrl = await storageAdapter.saveArtifactScreenshot(screenshotDataUrl, artifactId);
    const derivedFrom = req.body?.derived_from || { artifact_id: null, owner_user_id: null };
    const sourceSession = req.body?.source_session || { session_id: req.body?.session_id || '', credits_used_estimate: 0 };
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : null;

    await createArtifact({
      artifactId,
      ownerUserId: user.user_id,
      title: String(req.body?.title || 'Untitled artifact'),
      description: String(req.body?.description || ''),
      visibility,
      code: {
        language: String(code.language || 'html'),
        content: String(code.content || '')
      },
      codeVersions,
      chat,
      sourceSession: {
        session_id: String(sourceSession?.session_id || ''),
        credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
      },
      derivedFrom: {
        artifact_id: derivedFrom?.artifact_id || null,
        owner_user_id: derivedFrom?.owner_user_id || null,
        version_id: derivedFrom?.version_id || null,
        version_label: derivedFrom?.version_label || null
      },
      screenshotUrl,
      tags,
      category
    });

    const artifact = await fetchArtifactById(artifactId);

    await appendArtifactEvent({
      eventType: 'artifact_created',
      userId: user.user_id,
      artifactId,
      sourceArtifactId: artifact.derived_from.artifact_id || '',
      sessionId: artifact.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: user.user_id,
      artifactId,
      sourceArtifactId: artifact.derived_from.artifact_id || '',
      sessionId: artifact.source_session.session_id || ''
    });

    if (visibility === 'public') {
      await appendArtifactEvent({
        eventType: 'artifact_published',
        userId: user.user_id,
        artifactId,
        sourceArtifactId: artifact.derived_from.artifact_id || '',
        sessionId: artifact.source_session.session_id || ''
      });
    }

    logStructured('info', 'artifact_created', {
      user_id: user.user_id,
      artifact_id: artifactId,
      source_artifact_id: artifact.derived_from?.artifact_id || null,
      session_id: artifact.source_session?.session_id || '',
      visibility,
      outcome: 'success'
    });

    return res.json({
      ok: true,
      artifact: applyArtifactDefaults(artifact),
      artifact_id: artifact.artifact_id,
      screenshot_url: artifact.screenshot_url || ''
    });
  } catch (error) {
    logStructured('error', 'artifact_create_failed', {
      user_id: userId || null,
      artifact_id: artifactId || null,
      error: error?.message || 'unknown_error'
    });
    console.error('Failed to create artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to create artifact' });
  }
});

async function handleCreateArtifactVersion(req, res) {
  let artifactId = '';
  let userId = '';
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    artifactId = artifact.artifact_id;
    userId = artifact.owner_user_id;
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const resolvedCode = resolveArtifactCode(req.body) || artifact.code;
    const codeVersions = resolveArtifactCodeVersions(req.body);
    const visibility = req.body?.visibility === 'public'
      ? 'public'
      : (req.body?.visibility === 'private' ? 'private' : artifact.visibility);
    const validation = validateArtifactPayload({
      code: resolvedCode || artifact.code,
      codeVersions,
      visibility,
      screenshotDataUrl: req.body?.screenshot_data_url
    });
    if (!validation.ok) {
      console.error('Artifact version payload rejected.', {
        userId: artifact.owner_user_id,
        artifactId: artifact.artifact_id,
        reasons: validation.errors
      });
      return res.status(400).json({ ok: false, error: validation.errors.join(' ') });
    }
    const code = resolvedCode || artifact.code;
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : null;
    const sourceSession = req.body?.source_session || { session_id: '', credits_used_estimate: 0 };
    const screenshotUrl = await storageAdapter.saveArtifactScreenshot(
      req.body?.screenshot_data_url,
      artifact.artifact_id
    );
    await createArtifactVersion({
      artifactId: artifact.artifact_id,
      ownerUserId: artifact.owner_user_id,
      code: {
        language: String(code?.language || artifact.code?.language || 'html'),
        content: String(code?.content || artifact.code?.content || '')
      },
      codeVersions,
      chat,
      sourceSession: {
        session_id: String(sourceSession?.session_id || ''),
        credits_used_estimate: Number(sourceSession?.credits_used_estimate || 0) || 0
      },
      label: req.body?.label,
      visibility,
      title: String(req.body?.title || artifact.title),
      description: String(req.body?.description || artifact.description),
      screenshotUrl
    });

    const updated = await fetchArtifactById(artifact.artifact_id);

    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: artifact.owner_user_id,
      artifactId: artifact.artifact_id,
      sourceArtifactId: artifact.derived_from?.artifact_id || '',
      sessionId: sourceSession?.session_id || ''
    });

    logStructured('info', 'artifact_version_created', {
      user_id: artifact.owner_user_id,
      artifact_id: artifact.artifact_id,
      source_artifact_id: artifact.derived_from?.artifact_id || null,
      session_id: sourceSession?.session_id || '',
      visibility,
      outcome: 'success'
    });

    return res.json({ ok: true, artifact: applyArtifactDefaults(updated) });
  } catch (error) {
    logStructured('error', 'artifact_version_create_failed', {
      user_id: userId || null,
      artifact_id: artifactId || null,
      error: error?.message || 'unknown_error'
    });
    console.error('Failed to create artifact version.', error);
    return res.status(500).json({ ok: false, error: 'Failed to create artifact version' });
  }
}

app.post('/api/artifacts/:id/version', handleCreateArtifactVersion);
app.post('/api/artifacts/:id/versions', handleCreateArtifactVersion);

app.get('/api/artifacts/:id/versions', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const isOwner = session && artifact.owner_user_id === session.sub;
    const canView = artifact.visibility === 'public'
      ? Boolean(artifact.versioning?.enabled) || isOwner
      : isOwner;
    if (!canView) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const filtered = await fetchArtifactVersionSummaries(artifact.artifact_id);
    const formatted = filtered.map((version, index) => ({
      ...version,
      version_number: version.version_index || index + 1,
      label: version.label || `v${version.version_index || index + 1}`
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return res.json({ ok: true, versions: formatted });
  } catch (error) {
    console.error('Failed to load artifact versions.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact versions' });
  }
});

app.get('/api/profile', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const profile = await fetchProfileByUserId(user.user_id);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }
    const stats = await buildProfileStats(user.user_id);
    return res.json({ ok: true, profile: mapProfileForClient(profile, user, stats) });
  } catch (error) {
    console.error('Failed to load profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

app.get('/api/profile/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '').toLowerCase();
    if (!handle) {
      return res.status(400).json({ ok: false, error: 'Handle is required' });
    }
    const profile = await fetchProfileByHandle(handle);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }
    const user = await getUserById(profile.user_id);
    const stats = await buildProfileStats(profile.user_id);
    return res.json(mapPublicProfile(profile, user, stats));
  } catch (error) {
    console.error('Failed to load public profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load profile' });
  }
});

app.patch('/api/profile', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const { fields, files } = await parseMultipartRequest(req);
    const current = await fetchProfileByUserId(user.user_id);
    const nextHandle = String(fields.handle || current?.handle || '').toLowerCase();
    if (!nextHandle) {
      console.error('Profile update rejected: missing handle.', { userId: user.user_id });
      return res.status(400).json({ ok: false, error: 'Handle is required' });
    }
    const existingOwner = await fetchProfileHandleOwner(nextHandle);
    if (existingOwner && existingOwner !== user.user_id) {
      console.error('Profile update rejected: handle taken.', {
        userId: user.user_id,
        handle: nextHandle
      });
      return res.status(409).json({ ok: false, error: 'Handle is already taken' });
    }
    let avatarUrl = current?.avatar_url || '';
    if (files.avatar) {
      avatarUrl = await storageAdapter.saveProfileAvatar(files.avatar, user.user_id);
    } else if (fields.avatar_url !== undefined) {
      avatarUrl = String(fields.avatar_url || '');
    }
    const demographics = {
      age: fields.age !== undefined ? Number(fields.age) || null : current?.demographics?.age ?? null,
      gender: fields.gender !== undefined
        ? String(fields.gender || '').trim()
        : current?.demographics?.gender || '',
      city: fields.city !== undefined
        ? String(fields.city || '').trim()
        : current?.demographics?.city || '',
      country: fields.country !== undefined
        ? String(fields.country || '').trim()
        : current?.demographics?.country || ''
    };
    const nextProfile = await upsertProfile({
      userId: user.user_id,
      handle: nextHandle,
      displayName: fields.display_name !== undefined
        ? String(fields.display_name || '')
        : current?.display_name || '',
      bio: fields.bio !== undefined ? String(fields.bio || '') : current?.bio || '',
      avatarUrl,
      demographics,
      createdAt: current?.created_at || user.created_at || null
    });
    const stats = await buildProfileStats(user.user_id);
    return res.json({ ok: true, profile: mapProfileForClient(nextProfile, user, stats) });
  } catch (error) {
    console.error('Failed to update profile.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update profile' });
  }
});

app.get('/api/artifacts/:id/versions/:versionId', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    const isOwner = session && artifact.owner_user_id === session.sub;
    const canView = artifact.visibility === 'public'
      ? Boolean(artifact.versioning?.enabled) || isOwner
      : isOwner;
    if (!canView) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const version = await fetchArtifactVersionById(artifact.artifact_id, req.params.versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: 'Version not found' });
    }
    const versionNumber = version.version_index || 1;
    const allowChat = isOwner || artifact.versioning?.chat_history_public;
    const responseVersion = {
      ...version,
      version_number: versionNumber,
      label: version.label || `v${versionNumber}`,
      chat: allowChat ? version.chat : { included: false, messages: null }
    };
    await appendArtifactEvent({
      eventType: 'artifact_version_viewed',
      userId: isOwner ? artifact.owner_user_id : '',
      artifactId: artifact.artifact_id,
      sourceArtifactId: artifact.derived_from?.artifact_id || '',
      sessionId: version.session_id || ''
    });
    return res.json({ ok: true, version: responseVersion });
  } catch (error) {
    console.error('Failed to load artifact version.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact version' });
  }
});

app.patch('/api/artifacts/:id/publish_settings', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const enabled = Boolean(req.body?.enabled);
    const chatHistoryPublic = Boolean(req.body?.chat_history_public);
    await updateArtifactPublishSettings({
      artifactId: artifact.artifact_id,
      ownerUserId: artifact.owner_user_id,
      enabled,
      chatHistoryPublic
    });
    const updated = await fetchArtifactById(artifact.artifact_id);
    return res.json({ ok: true, artifact: updated });
  } catch (error) {
    console.error('Failed to update publish settings.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update publish settings' });
  }
});

app.get('/api/artifacts/private', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const owned = await fetchArtifactsByOwner(session.sub);
    return res.json({ ok: true, artifacts: owned });
  } catch (error) {
    console.error('Failed to load private artifacts.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifacts' });
  }
});

app.get(['/api/artifacts/public', '/api/gallery', '/gallery'], async (req, res) => {
  try {
    const result = await fetchPublicArtifacts({
      query: req.query?.query,
      tag: req.query?.tag,
      sort: req.query?.sort,
      category: req.query?.category,
      page: req.query?.page,
      pageSize: req.query?.page_size
    });
    return res.json({ ok: true, artifacts: result.artifacts, pagination: result.pagination });
  } catch (error) {
    console.error('Failed to load public artifacts.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifacts' });
  }
});

app.get('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.visibility !== 'public' && (!session || artifact.owner_user_id !== session.sub)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return res.json({ ok: true, artifact });
  } catch (error) {
    console.error('Failed to load artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load artifact' });
  }
});

app.post('/api/artifacts/:id/fork', async (req, res) => {
  let sourceArtifactId = '';
  let userId = '';
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    userId = user.user_id;
    const source = await fetchArtifactById(req.params.id);
    if (!source) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    sourceArtifactId = source.artifact_id;
    if (source.visibility !== 'public' && source.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const forkResult = await forkArtifact({
      sourceArtifactId: source.artifact_id,
      ownerUserId: user.user_id,
      sessionId: req.body?.session_id || '',
      creditsUsedEstimate: Number(req.body?.credits_used_estimate || 0) || 0,
      requestedVersionId: req.body?.version_id
    });
    const forked = await fetchArtifactById(forkResult.artifactId);

    await appendArtifactEvent({
      eventType: 'artifact_forked',
      userId: source.owner_user_id,
      artifactId: source.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_created',
      userId: user.user_id,
      artifactId: forked.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });
    await appendArtifactEvent({
      eventType: 'artifact_version_forked',
      userId: source.owner_user_id,
      artifactId: source.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });

    await appendArtifactEvent({
      eventType: 'artifact_imported',
      userId: user.user_id,
      artifactId: forked.artifact_id,
      sourceArtifactId: source.artifact_id,
      sessionId: forked.source_session.session_id || ''
    });

    logStructured('info', 'artifact_forked', {
      user_id: user.user_id,
      artifact_id: forked.artifact_id,
      source_artifact_id: source.artifact_id,
      session_id: forked.source_session?.session_id || '',
      outcome: 'success'
    });

    return res.json({ ok: true, artifact: forked });
  } catch (error) {
    logStructured('error', 'artifact_fork_failed', {
      user_id: userId || null,
      artifact_id: sourceArtifactId || null,
      error: error?.message || 'unknown_error'
    });
    console.error('Failed to fork artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to fork artifact' });
  }
});

app.patch('/api/artifacts/:id/visibility', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const nextVisibility = req.body?.visibility === 'public' ? 'public' : 'private';
    const wasPublic = artifact.visibility === 'public';
    await updateArtifactVisibility({
      artifactId: artifact.artifact_id,
      ownerUserId: artifact.owner_user_id,
      visibility: nextVisibility
    });
    const updated = await fetchArtifactById(artifact.artifact_id);

    if (!wasPublic && nextVisibility === 'public') {
      await appendArtifactEvent({
        eventType: 'artifact_published',
        userId: artifact.owner_user_id,
        artifactId: artifact.artifact_id,
        sourceArtifactId: artifact.derived_from?.artifact_id || '',
        sessionId: artifact.source_session?.session_id || ''
      });
    }

    return res.json({ ok: true, artifact: updated });
  } catch (error) {
    console.error('Failed to update artifact visibility.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update artifact visibility' });
  }
});

app.patch('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (artifact.visibility === 'public') {
      return res.status(400).json({ ok: false, error: 'Public artifacts are immutable' });
    }
    const shouldUpdateTags = Object.prototype.hasOwnProperty.call(req.body || {}, 'tags');
    await updateArtifactMetadata({
      artifactId: artifact.artifact_id,
      ownerUserId: artifact.owner_user_id,
      title: String(req.body?.title || artifact.title),
      description: String(req.body?.description || artifact.description),
      tags: shouldUpdateTags ? normalizeTagsInput(req.body?.tags) : undefined,
      category: req.body?.category !== undefined ? normalizeCategoryInput(req.body?.category) : artifact.category
    });
    const updated = await fetchArtifactById(artifact.artifact_id);
    return res.json({ ok: true, artifact: updated });
  } catch (error) {
    console.error('Failed to update artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to update artifact' });
  }
});

app.delete('/api/artifacts/:id', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    await deleteArtifact({ artifactId: artifact.artifact_id, ownerUserId: artifact.owner_user_id });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to delete artifact' });
  }
});

app.post('/api/artifacts/:id/report', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const artifact = await fetchArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ ok: false, error: 'Artifact not found' });
    }
    if (artifact.visibility !== 'public' && artifact.owner_user_id !== session.sub) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ ok: false, error: 'Reason is required' });
    }
    const reportId = await createArtifactReport({
      artifactId: artifact.artifact_id,
      reporterUserId: session.sub,
      reason
    });
    return res.json({ ok: true, report_id: reportId });
  } catch (error) {
    console.error('Failed to report artifact.', error);
    return res.status(500).json({ ok: false, error: 'Failed to report artifact' });
  }
});

app.get('/api/admin/artifact_reports', async (_req, res) => {
  res.json({ ok: true, reports: [] });
});

app.get(['/api/usage/overview', '/api/v1/usage/overview'], async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const pool = getUsageAnalyticsPool();
    const dailyLimit = resolveDailyCreditLimit(user);
    if (pool) {
      const overviewRow = await fetchUsageOverview({ userId: session.sub });
      const todayKey = new Date().toISOString().slice(0, 10);
      const todayRows = await fetchUsageEventsByRange({
        userId: session.sub,
        startDate: todayKey,
        endDate: todayKey
      });
      const creditsUsedToday = (todayRows || []).reduce((sum, row) => {
        return sum + Number(row.credits_used || 0);
      }, 0);
      const overview = {
        total_requests: Number(overviewRow?.requests || 0),
        total_credits: Number(overviewRow?.credits_used || 0),
        avg_latency_ms: Number(overviewRow?.avg_latency_ms || 0),
        success_rate: Number(overviewRow?.success_rate || 0) / 100
      };
      return res.json({
        ok: true,
        overview,
        credits_used_today: creditsUsedToday,
        daily_limit: dailyLimit
      });
    }

    const usageRows = await loadUsageLogRows();
    const userRows = usageRows.filter((row) => row.user_id === session.sub);
    const monthRows = filterUsageRowsByMonth(userRows);
    const overview = buildUsageOverview(monthRows);
    const todayKey = new Date().toISOString().slice(0, 10);
    const creditsUsedToday = userRows
      .filter((row) => row.timestamp_utc?.startsWith(todayKey))
      .reduce((sum, row) => sum + Number(row.credits_charged || row.credits_used || 0), 0);
    return res.json({
      ok: true,
      overview,
      credits_used_today: creditsUsedToday,
      daily_limit: dailyLimit
    });
  } catch (error) {
    console.error('Failed to load usage overview.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage overview' });
  }
});

app.get('/api/usage/daily', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const days = parseRangeDays(req.query.range) ?? (Number(req.query.days) || 14);
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const rows = await fetchUsageDailySummary({ userId: session.sub, days });
      const daily = (rows || []).map((row) => ({
        date: row.day,
        total_requests: Number(row.requests || 0),
        total_credits: Number(row.credits_used || 0),
        avg_latency_ms: Number(row.avg_latency_ms || 0),
        success_rate: Number(row.success_rate || 0) / 100,
        by_intent: {
          code: Number(row.code_requests || 0),
          text: Number(row.text_requests || 0)
        },
        entries: []
      }));
      return res.json({ ok: true, range_days: days, daily });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days
    });
    const daily = buildDailyUsageSummaries(filtered, { includeEntries: false });
    return res.json({ ok: true, range_days: days, daily });
  } catch (error) {
    console.error('Failed to load usage daily.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage daily' });
  }
});

async function handleUserUsageHistory(req, res) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const days = parseRangeDays(req.query.range) ?? (Number(req.query.days) || 14);
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const events = await fetchUsageEventsByRange({ userId: session.sub, days });
      const mapped = (events || []).map(mapUsageEventRow);
      const daily = buildDailyUsageSummaries(mapped, { includeEntries: true });
      return res.json({ ok: true, range_days: days, daily });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days
    });
    const daily = buildDailyUsageSummaries(filtered, { includeEntries: true });
    return res.json({ ok: true, range_days: days, daily });
  } catch (error) {
    console.error('Failed to load usage history.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage history' });
  }
}

app.get('/api/usage/history', handleUserUsageHistory);
app.get('/user/usage/history', handleUserUsageHistory);

app.get('/api/usage/summary', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const groupBy = String(req.query.group_by || 'session');
    const days = Number(req.query.days);
    const startDate = req.query.start_date ? String(req.query.start_date) : '';
    const endDate = req.query.end_date ? String(req.query.end_date) : '';
    const pool = getUsageAnalyticsPool();
    if (pool) {
      if (groupBy === 'session') {
        const sessions = await fetchSessionSummary({ userId: session.sub });
        return res.json({
          ok: true,
          sessions: (sessions || []).map((row) => ({
            session_id: row.session_id,
            started_at: row.session_start,
            ended_at: row.session_end || row.session_start,
            turns: Number(row.turns || 0),
            credits_used: Number(row.credits_used || 0)
          }))
        });
      }
      const events = await fetchUsageEventsByRange({
        userId: session.sub,
        startDate,
        endDate,
        days: Number.isFinite(days) ? days : null
      });
      return res.json({ ok: true, rows: (events || []).map(mapUsageEventRow) });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = filterUsageRowsByRange({
      rows: usageRows,
      userId: session.sub,
      days,
      startDate,
      endDate
    });
    if (groupBy === 'session') {
      return res.json({
        ok: true,
        sessions: buildSessionSummariesFromUsage(filtered)
      });
    }
    return res.json({ ok: true, rows: filtered });
  } catch (error) {
    console.error('Failed to load usage summary.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load usage summary' });
  }
});

app.get('/admin/usage/summary', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (!user.is_internal) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const days = parseRangeDays(req.query.range) ?? (Number(req.query.days) || 30);
    const startDate = req.query.start_date ? String(req.query.start_date) : '';
    const endDate = req.query.end_date ? String(req.query.end_date) : '';
    const targetUserId = req.query.user_id ? String(req.query.user_id) : '';
    const limit = Number(req.query.limit) || 12;
    const pool = getUsageAnalyticsPool();
    if (!pool) {
      return res.json({ ok: true, summary: { total_requests: 0, total_tokens: 0, models: [] } });
    }

    const summary = await fetchAdminUsageSummary({
      days,
      startDate,
      endDate,
      userId: targetUserId || null,
      limit
    });
    return res.json({ ok: true, range_days: days, summary: summary || { models: [] } });
  } catch (error) {
    console.error('Failed to load admin usage summary.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load admin usage summary' });
  }
});

app.get('/api/session/export/:sessionId', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = req.params.sessionId;
    const pool = getUsageAnalyticsPool();
    if (pool) {
      const events = await fetchSessionEvents({ userId: session.sub, sessionId });
      if (!events?.length) {
        return res.status(404).json({ ok: false, error: 'Session not found' });
      }
      const mapped = events.map((row) => ({
        timestamp_utc: row.created_at,
        session_id: sessionId,
        intent_type: row.intent,
        model: row.model,
        input_tokens: row.tokens_in,
        output_tokens: row.tokens_out,
        credits_charged: row.credits_used,
        latency_ms: row.latency_ms,
        status: row.success ? 'success' : 'failure'
      }));
      const [summary] = buildSessionSummariesFromUsage(mapped);
      return res.json({
        ok: true,
        session: summary,
        events: mapped
      });
    }

    const usageRows = await loadUsageLogRows();
    const filtered = usageRows.filter((row) => {
      return row.session_id === sessionId && row.user_id === session.sub;
    });
    if (!filtered.length) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    const [summary] = buildSessionSummariesFromUsage(filtered);
    return res.json({
      ok: true,
      session: summary,
      events: filtered
    });
  } catch (error) {
    console.error('Failed to export session.', error);
    return res.status(500).json({ ok: false, error: 'Failed to export session' });
  }
});

app.get('/billing/portal', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).send('Unauthorized');
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).send('User not found');
    }
    if (!user.stripe_customer_id) {
      return res.status(400).send('No Stripe customer ID');
    }
    const returnUrl = process.env.FRONTEND_URL
      || req.headers.origin
      || 'https://maya-dev-ui.pages.dev';
    const portalSession = await createStripeBillingPortalSession({
      customerId: user.stripe_customer_id,
      returnUrl
    });
    return res.redirect(portalSession.url);
  } catch (error) {
    console.error('Billing portal failed.', error);
    return res.status(500).send('Unable to load billing portal');
  }
});

app.post('/api/billing/portal-session', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    if (!user.stripe_customer_id) {
      return res.status(400).json({ ok: false, error: 'No Stripe customer ID' });
    }
    const returnUrl = process.env.FRONTEND_URL
      || req.headers.origin
      || 'https://maya-dev-ui.pages.dev';
    const portalSession = await createStripeBillingPortalSession({
      customerId: user.stripe_customer_id,
      returnUrl
    });
    return res.json({ ok: true, url: portalSession.url });
  } catch (error) {
    console.error('Billing portal session failed.', error);
    return res.status(500).json({ ok: false, error: 'Unable to create billing portal session' });
  }
});


function responseIncludesPlayableElements(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) {
    return false;
  }
  const checks = [
    /objective|goal|win condition/,
    /mechanic|controls|input|mouse|keyboard|click/,
    /reward|score|points|progress|feedback/,
    /game|level|challenge|loop/
  ];
  return checks.filter((pattern) => pattern.test(normalized)).length >= 3;
}

function applyPlayablePromptToMessages(messages = [], { prompt, code } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: buildPlayablePrompt({ prompt, code }) }
    ];
  }

  let replaced = false;
  const updated = messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    if (isLast && message?.role === 'user') {
      replaced = true;
      return {
        ...message,
        content: buildPlayablePrompt({
          prompt: prompt || message?.content || '',
          code
        })
      };
    }
    return message;
  });

  if (!replaced) {
    updated.push({
      role: 'user',
      content: buildPlayablePrompt({ prompt, code })
    });
  }

  return updated;
}

function applyPromptToLastUserMessage(messages = [], prompt = '') {
  const safePrompt = typeof prompt === 'string' ? prompt : '';
  if (!Array.isArray(messages) || messages.length === 0) {
    return [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: safePrompt }
    ];
  }

  let replaced = false;
  const updated = messages.map((message, index) => {
    const isLast = index === messages.length - 1;
    if (isLast && message?.role === 'user') {
      replaced = true;
      return {
        ...message,
        content: safePrompt
      };
    }
    return message;
  });

  if (!replaced) {
    updated.push({ role: 'user', content: safePrompt });
  }

  return updated;
}

/**
 * CHAT (FULL IMPLEMENTATION — DO NOT STUB)
 */
app.post('/api/chat', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = req.requestId || crypto.randomUUID();
  const intentType = req.body?.intentType || 'chat';
  let user = null;
  let routeDecision = null;
  let requestedModel = req.body?.model || OPENAI_MODEL;
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const resetState = await resetUserCreditsIfNeeded({ userId: session.sub });
    user = resetState.user;
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const rawCodeContext = typeof req.body?.currentCode === 'string'
      ? req.body.currentCode
      : typeof req.body?.code === 'string'
        ? req.body.code
        : '';
    const contextMode = resolveContextMode(
      req.body?.contextMode
      || req.body?.context_mode
      || user.preferences?.context_mode
      || 'balanced'
    );
    const planTier = user.plan_tier || 'free';
    const baseContextBudget = getContextTokenBudget({ planTier, intentType });
    const adjustedContextBudget = applyUsageAwareReduction({
      contextBudget: baseContextBudget,
      recentUsage: Number(user.credits_used || 0),
      monthlyLimit: Number(user.credits_total || FREE_PLAN.monthly_credits)
    });
    const existingHistorySummary = String(
      req.body?.history_summary
      || req.body?.historySummary
      || req.body?.context_summary
      || ''
    ).trim();

    const trimmedContext = await buildTrimmedContext({
      systemPrompt: CHAT_SYSTEM_PROMPT,
      messages,
      query: messages[messages.length - 1]?.content || '',
      codeSegments: rawCodeContext ? [{ name: 'editor', content: rawCodeContext }] : [],
      maxTokens: adjustedContextBudget,
      model: requestedModel,
      maxRecentMessages: DEFAULT_MAX_CONTEXT_MESSAGES,
      maxRelevantMessages: DEFAULT_MAX_RELEVANT_MESSAGES,
      contextMode,
      summaryTriggerTokens: Math.floor(adjustedContextBudget * 0.65),
      historySummaryThresholdTokens: DEFAULT_HISTORY_SUMMARY_THRESHOLD_TOKENS,
      historySummary: existingHistorySummary,
      maxCodeChars: DEFAULT_MAX_CODE_CONTEXT_CHARS,
      llmProxyUrl: LLM_PROXY_URL
    });
    if (Number(trimmedContext.tokenCount || 0) > adjustedContextBudget) {
      return res.status(413).json({
        ok: false,
        error: 'Context budget exceeded for current plan',
        error_code: 'CONTEXT_BUDGET_EXCEEDED',
        budget_tokens: adjustedContextBudget,
        token_count: Number(trimmedContext.tokenCount || 0)
      });
    }
    const playableMode = Boolean(req.body?.playableMode);
    const retryMode = Boolean(req.body?.retryMode);
    const originalPrompt = typeof req.body?.originalPrompt === 'string'
      ? req.body.originalPrompt
      : '';
    const previousResponse = typeof req.body?.previousResponse === 'string'
      ? req.body.previousResponse
      : '';
    const playablePromptText = typeof req.body?.userPrompt === 'string'
      ? req.body.userPrompt
      : trimmedContext.messages[trimmedContext.messages.length - 1]?.content || '';
    const playableCodeText = typeof req.body?.currentCode === 'string'
      ? req.body.currentCode
      : (typeof req.body?.code === 'string' ? req.body.code : rawCodeContext);
    let finalPrompt = playablePromptText;
    if (retryMode) {
      finalPrompt = buildRetryPrompt({
        originalPrompt,
        previousResponse
      });
      if (playableMode) {
        finalPrompt += '\n\nAlso improve gameplay depth and mechanics.';
      }
    }

    let trimmedMessages = playableMode
      ? applyPlayablePromptToMessages(trimmedContext.messages, {
        prompt: finalPrompt,
        code: playableCodeText
      })
      : trimmedContext.messages;

    if (retryMode) {
      trimmedMessages = playableMode
        ? applyPlayablePromptToMessages(trimmedMessages, {
          prompt: finalPrompt,
          code: playableCodeText
        })
        : applyPromptToLastUserMessage(trimmedMessages, finalPrompt);
    }

    req.body.messages = trimmedMessages;
    if (trimmedContext.summaryText) {
      req.body.context_summary = trimmedContext.summaryText;
    }
    req.body.token_estimate = {
      actual_tokens: trimmedContext.tokenCount,
      naive_tokens: trimmedContext.naiveTokenCount,
      saved_tokens: trimmedContext.savedTokens,
      context_mode: contextMode,
      budget_tokens: adjustedContextBudget,
      estimator: hasAccurateTokenizer() ? 'tiktoken' : 'fallback'
    };
    recordTokenEfficiency(trimmedContext.metrics || {});
    logStructured('info', 'token_efficiency', {
      request_id: requestId,
      user_id: user.user_id,
      session_id: req.body?.sessionId || '',
      ...trimmedContext.metrics
    });
    const promptText = buildPromptText(trimmedMessages);
    const inputChars = promptText.length;
    const inputTokensEstimate = estimateMessageTokens(trimmedMessages, requestedModel);
    req.body.token_estimate.actual_tokens = inputTokensEstimate;
    const estimatedCredits = calculateCreditsUsed({
      inputTokens: inputTokensEstimate,
      outputTokens: 0,
      intentType,
      inputText: promptText,
      model: requestedModel
    });
    const creditsRemaining = resolveCreditsBalance(user);
    const creditsTotal = Number(user.credits_total || 0);
    const dailyLimit = resolveDailyCreditLimit(user);
    const creditsUsedToday = Number.isFinite(dailyLimit)
      ? Number(resetState.daily_used || 0)
      : 0;

    if (Number.isFinite(dailyLimit) && creditsUsedToday >= dailyLimit) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Daily credit limit reached',
        credits_remaining: creditsRemaining,
        daily_limit: dailyLimit,
        credits_used_today: creditsUsedToday
      });
    }

    if (
      Number.isFinite(dailyLimit)
      && creditsUsedToday + estimatedCredits > dailyLimit
    ) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Daily credit limit reached',
        credits_remaining: creditsRemaining,
        daily_limit: dailyLimit,
        credits_used_today: creditsUsedToday,
        estimated_credits: estimatedCredits
      });
    }

    if (!Number.isFinite(creditsRemaining) || creditsRemaining <= 0) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: req.body?.model || OPENAI_MODEL,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Out of credits',
        credits_remaining: creditsRemaining
      });
    }

    if (estimatedCredits > creditsRemaining) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_rejected',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      return res.status(402).json({
        ok: false,
        error: 'Insufficient credits for this request',
        credits_remaining: creditsRemaining,
        estimated_credits: estimatedCredits
      });
    }

    routeDecision = await routeModelForUser({
      user,
      intentType,
      requestedModel,
      sessionId: req.body?.sessionId || ''
    });
    if (routeDecision?.model && routeDecision.model !== requestedModel) {
      req.body.model = routeDecision.model;
    }

    const workerRes = await fetch(LLM_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const responseText = await workerRes.text();
    if (!workerRes.ok) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_error',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      res.status(workerRes.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(responseText);
      return;
    }

    let data;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch {
      data = null;
    }

    if (!data) {
      await appendUsageEntry({
        user,
        requestId,
        sessionId: req.body?.sessionId || '',
        eventType: 'chat_error',
        intentType,
        model: requestedModel,
        inputTokens: inputTokensEstimate,
        outputTokens: 0,
        inputChars,
        outputChars: 0,
        totalTokens: inputTokensEstimate,
        reservedCredits: estimatedCredits,
        actualCredits: 0,
        creditsCharged: 0,
        latencyMs: Date.now() - requestStartedAt,
        status: 'failure'
      });
      res.status(502).json({ ok: false, error: 'Invalid LLM response' });
      return;
    }

    let usage = data?.usage || {};
    let totalTokens = Number(usage?.total_tokens);
    let usageInputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
    let usageOutputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
    const resolvedInputTokens = Number.isFinite(usageInputTokens)
      ? usageInputTokens
      : inputTokensEstimate;
    let outputText =
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? '';
    if (playableMode && outputText && !responseIncludesPlayableElements(outputText)) {
      const reinforcementPrompt = 'Enhance the previous response by adding interactive game mechanics.';
      const reinforcementMessages = [
        ...req.body.messages,
        { role: 'assistant', content: outputText },
        { role: 'user', content: reinforcementPrompt }
      ];
      const reinforcementRes = await fetch(LLM_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...req.body,
          messages: reinforcementMessages
        })
      });
      if (reinforcementRes.ok) {
        const reinforcementData = await reinforcementRes.json();
        data = reinforcementData || data;
        usage = data?.usage || usage;
        totalTokens = Number(usage?.total_tokens);
        usageInputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
        usageOutputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
        outputText =
          data?.choices?.[0]?.message?.content
          ?? data?.candidates?.[0]?.content
          ?? data?.output_text
          ?? outputText;
      }
    }
    const outputChars = outputText ? String(outputText).length : 0;
    const resolvedOutputTokens = Number.isFinite(usageOutputTokens)
      ? usageOutputTokens
      : Number.isFinite(totalTokens)
        ? Math.max(0, totalTokens - resolvedInputTokens)
        : estimateTokensWithTokenizer(outputText, requestedModel);
    const actualCredits = calculateCreditsUsed({
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      intentType,
      totalTokens,
      inputText: promptText,
      outputText,
      model: requestedModel
    });
    let nextRemaining = clampCredits(creditsRemaining - actualCredits, creditsTotal);

    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    if (sessionId) {
      try {
        const turnIndex = await fetchNextTurnIndex({ sessionId });
        if (turnIndex) {
          await insertLlmTurnLog({
            userId: user.user_id,
            sessionId,
            turnIndex,
            intent: normalizeTurnIntent(intentType),
            model: data?.model || req.body?.model || requestedModel,
            glyphSurface: req.body?.glyphSurface ?? req.body?.glyph_surface ?? null,
            glyphJson: req.body?.glyphJson ?? req.body?.glyph_json ?? null,
            promptText,
            promptTokens: resolvedInputTokens,
            completionTokens: resolvedOutputTokens,
            creditsCharged: actualCredits,
            latencyMs: Date.now() - requestStartedAt
          });
        }
      } catch (logError) {
        console.warn('Failed to log LLM turn.', logError);
      }
    }

    try {
      const chargeResult = await applyCreditDeduction({
        userId: user.user_id,
        sessionId,
        turnId: requestId,
        creditsToCharge: actualCredits,
        creditsTotal,
        metadata: formatCreditLedgerMetadata({
          model: data?.model || req.body?.model || requestedModel,
          tokens_in: resolvedInputTokens,
          tokens_out: resolvedOutputTokens
        }),
        usageEvent: {
          sessionId,
          intentType,
          model: data?.model || req.body?.model || requestedModel,
          inputTokens: resolvedInputTokens,
          outputTokens: resolvedOutputTokens,
          totalTokens: Number.isFinite(totalTokens) ? totalTokens : (resolvedInputTokens + resolvedOutputTokens),
          creditsUsed: actualCredits,
          latencyMs: Date.now() - requestStartedAt,
          status: 'success',
          sourceHash: crypto.createHash('sha256').update(`${user.user_id}:${requestId}:success`).digest('hex')
        }
      });
      nextRemaining = Number.isFinite(chargeResult.nextBalance)
        ? chargeResult.nextBalance
        : nextRemaining;
    } catch (chargeError) {
      if (String(chargeError?.message || '') === 'INSUFFICIENT_CREDITS') {
        await appendUsageEntry({
          user,
          requestId,
          sessionId,
          eventType: 'chat_rejected',
          intentType,
          model: data?.model || req.body?.model || requestedModel,
          inputTokens: resolvedInputTokens,
          outputTokens: resolvedOutputTokens,
          inputChars,
          outputChars,
          totalTokens,
          reservedCredits: estimatedCredits,
          actualCredits,
          creditsCharged: 0,
          latencyMs: Date.now() - requestStartedAt,
          status: 'failure'
        });
        return res.status(402).json({
          ok: false,
          error: 'Insufficient credits for this request',
          credits_remaining: creditsRemaining,
          estimated_credits: estimatedCredits
        });
      }
      throw chargeError;
    }

    await appendUsageEntry({
      user,
      requestId,
      sessionId,
      eventType: intentType === 'code' ? 'code_gen' : 'chat_turn',
      intentType,
      model: data?.model || req.body?.model || requestedModel,
      inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens,
      inputChars,
      outputChars,
      totalTokens,
      reservedCredits: estimatedCredits,
      actualCredits,
      creditsCharged: actualCredits,
      latencyMs: Date.now() - requestStartedAt,
      status: 'success'
    });

    req.creditsCharged = actualCredits;
    data.usage = {
      ...usage,
      actual_credits: actualCredits,
      reserved_credits: estimatedCredits,
      credits_charged: actualCredits,
      remainingCredits: nextRemaining,
      credits_remaining: nextRemaining,
      token_estimate: {
        ...(req.body?.token_estimate || {}),
        input_tokens_estimated: resolvedInputTokens,
        output_tokens_estimated: resolvedOutputTokens
      }
    };

    logStructured('info', 'chat_tokens_consumed', {
      request_id: requestId,
      route: req.originalUrl,
      user_id: user.user_id,
      session_id: sessionId,
      intent_type: intentType,
      model: data?.model || req.body?.model || requestedModel,
      prompt_tokens: resolvedInputTokens,
      completion_tokens: resolvedOutputTokens,
      total_tokens: Number.isFinite(totalTokens) ? totalTokens : resolvedInputTokens + resolvedOutputTokens,
      credits_charged: actualCredits,
      latency_ms: Date.now() - requestStartedAt,
      status: 200,
      error_code: null,
      saved_tokens_vs_naive: Number(req.body?.token_estimate?.saved_tokens || 0) || 0
    });

    if (routeDecision?.reason && routeDecision.reason !== 'policy_default') {
      data.routing = {
        requested_model: requestedModel,
        routed_model: data?.model || req.body?.model || requestedModel,
        reason: routeDecision.reason
      };
    }

    if (req.body?.context_summary) {
      data.context_summary = req.body.context_summary;
    }

    res.status(200);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data));
  } catch (err) {
    console.error('Worker proxy error:', err);
    if (user) {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const promptText = buildPromptText(messages);
      const inputChars = promptText.length;
      const inputTokens = estimateMessageTokens(messages, requestedModel);
      const estimatedCredits = calculateCreditsUsed({
        inputTokens,
        outputTokens: 0,
        intentType,
        inputText: promptText,
        model: requestedModel
      });
      try {
        await appendUsageEntry({
          user,
          requestId,
          sessionId: req.body?.sessionId || '',
          eventType: 'chat_error',
          intentType,
          model: requestedModel,
          inputTokens,
          outputTokens: 0,
          inputChars,
          outputChars: 0,
          totalTokens: inputTokens,
          reservedCredits: estimatedCredits,
          actualCredits: 0,
          creditsCharged: 0,
          latencyMs: Date.now() - requestStartedAt,
          status: 'failure'
        });
      } catch (logError) {
        console.warn('Failed to log usage for error.', logError);
      }
    }
    res.status(500).json({ error: 'LLM proxy failed' });
  }
});

/**
 * SESSION CLOSE (LOGGING ONLY)
 */
app.post('/api/session/close', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const sessionId = typeof req.body?.session_id === 'string' ? req.body.session_id : '';
    const endedAt = typeof req.body?.ended_at === 'string'
      ? req.body.ended_at
      : new Date().toISOString();
    const creditsUsed = Number(req.body?.client_estimate?.credits_used) || 0;

    await appendUsageEntry({
      user,
      requestId: crypto.randomUUID(),
      sessionId,
      eventType: 'session_close',
      intentType: 'session_close',
      model: '',
      inputTokens: 0,
      outputTokens: 0,
      inputChars: 0,
      outputChars: 0,
      totalTokens: 0,
      reservedCredits: creditsUsed,
      actualCredits: creditsUsed,
      creditsCharged: creditsUsed,
      latencyMs: 0,
      status: 'success',
      timestamp: endedAt
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Session close log failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to log session close' });
  }
});


app.post('/api/session/state', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = typeof req.body?.session_id === 'string'
      ? req.body.session_id
      : (typeof req.body?.sessionId === 'string' ? req.body.sessionId : '');
    const state = req.body?.state;
    if (!sessionId || !state || typeof state !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid session state payload' });
    }
    await upsertSessionStateRecord({
      userId: session.sub,
      sessionId,
      summary: req.body?.summary || null,
      state
    });
    return res.json({ ok: true, session_id: sessionId });
  } catch (error) {
    console.error('Failed to persist session state.', error);
    if (error?.message?.includes('max allowed size')) {
      return res.status(413).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: 'Failed to persist session state' });
  }
});

app.put('/api/session/state', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = typeof req.body?.session_id === 'string'
      ? req.body.session_id
      : (typeof req.body?.sessionId === 'string' ? req.body.sessionId : '');
    const state = req.body?.state;
    if (!sessionId || !state || typeof state !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid session state payload' });
    }
    await upsertSessionStateRecord({
      userId: session.sub,
      sessionId,
      summary: req.body?.summary || null,
      state
    });
    return res.json({ ok: true, session_id: sessionId });
  } catch (error) {
    console.error('Failed to persist session state.', error);
    if (error?.message?.includes('max allowed size')) {
      return res.status(413).json({ ok: false, error: error.message });
    }
    return res.status(500).json({ ok: false, error: 'Failed to persist session state' });
  }
});

app.get('/api/session/state', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = typeof req.query?.session_id === 'string'
      ? req.query.session_id
      : (typeof req.query?.sessionId === 'string' ? req.query.sessionId : '');
    const payload = await fetchSessionStateRecord({ userId: session.sub, sessionId });
    if (!payload) {
      return res.status(404).json({ ok: false, error: 'Session state not found' });
    }
    return res.json({
      ok: true,
      session_id: payload.session_id || sessionId || null,
      session_state: payload?.state || null,
      summary: payload?.summary || null,
      updated_at: payload?.updated_at || payload?.last_active || null
    });
  } catch {
    return res.status(404).json({ ok: false, error: 'Session state not found' });
  }
});

app.get('/api/session/state/:sessionId', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const sessionId = typeof req.params?.sessionId === 'string' ? req.params.sessionId : '';
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' });
    }
    const payload = await fetchSessionStateRecord({ userId: session.sub, sessionId });
    if (!payload) {
      return res.status(404).json({ ok: false, error: 'Session state not found' });
    }
    return res.json({
      ok: true,
      session_id: payload.session_id || sessionId,
      session_state: payload?.state || null,
      summary: payload?.summary || null,
      updated_at: payload?.updated_at || payload?.last_active || null
    });
  } catch {
    return res.status(404).json({ ok: false, error: 'Session state not found' });
  }
});

app.get('/api/usage/token-overview', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const rows = await loadUsageLogRows();
    const filtered = rows.filter((row) => row.user_id === session.sub);
    const byModel = {};
    const bySession = {};
    let naiveTokens = 0;
    let actualTokens = 0;
    for (const row of filtered) {
      const model = row.model || 'unknown';
      const sessionId = row.session_id || 'unknown';
      const inTokens = Number(row.input_tokens || 0) || 0;
      const outTokens = Number(row.output_tokens || 0) || 0;
      const estimatedInputTokens = Number(row.input_est_tokens || row.input_tokens || 0) || 0;
      naiveTokens += estimatedInputTokens;
      actualTokens += inTokens;
      byModel[model] = (byModel[model] || 0) + inTokens + outTokens;
      bySession[sessionId] = (bySession[sessionId] || 0) + inTokens + outTokens;
    }
    return res.json({
      ok: true,
      tokens_per_model: byModel,
      tokens_per_session: bySession,
      tokens_saved_vs_naive: Math.max(0, naiveTokens - actualTokens),
      actual_input_tokens: actualTokens,
      naive_input_tokens: naiveTokens,
      tokenizer: hasAccurateTokenizer() ? 'tiktoken' : 'fallback'
    });
  } catch (error) {
    console.error('Failed to load token overview.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load token overview' });
  }
});
app.get('/api/usage/token-efficiency', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const totalRequests = tokenEfficiencyTelemetry.totalRequests || 0;
    const before = tokenEfficiencyTelemetry.totalTokensBeforeTrim || 0;
    const after = tokenEfficiencyTelemetry.totalTokensAfterTrim || 0;
    const averageTokensPerRequest = totalRequests > 0
      ? Number((after / totalRequests).toFixed(2))
      : 0;
    const reductionPercent = before > 0
      ? Number((((before - after) / before) * 100).toFixed(2))
      : 0;

    return res.json({
      ok: true,
      total_requests: totalRequests,
      average_tokens_per_request: averageTokensPerRequest,
      percent_reduction_vs_naive: reductionPercent,
      tokens_saved_total: tokenEfficiencyTelemetry.totalTokensSaved || 0,
      summary_usage_count: tokenEfficiencyTelemetry.summaryUsageCount || 0,
      relevance_selected_average: totalRequests > 0
        ? Number((tokenEfficiencyTelemetry.totalRelevanceSelected / totalRequests).toFixed(2))
        : 0
    });
  } catch (error) {
    console.error('Failed to load token efficiency usage.', error);
    return res.status(500).json({ ok: false, error: 'Failed to load token efficiency usage' });
  }
});



/**
 * GOOGLE AUTH STUB
 */
app.get('/api/auth/google', (_req, res) => {
  return res.status(401).json({ ok: false, error: 'Google auth interactive flow is not enabled' });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const ip = getRequestIp(req);
    const googleLimit = Number(process.env.AUTH_RATE_LIMIT_GOOGLE || 20);
    const googleWindowMs = Number(process.env.AUTH_RATE_LIMIT_GOOGLE_WINDOW_MS || 60_000);
    if (!enforceLocalAuthRateLimit({ key: `auth:google:${ip}`, limit: googleLimit, windowMs: googleWindowMs })) {
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }

    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    if (!idToken) {
      return res.status(400).json({ ok: false, error: 'Missing id_token' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'Missing GOOGLE_CLIENT_ID' });
    }
    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ ok: false, error: 'Invalid audience' });
    }
    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      return res.status(401).json({ ok: false, error: 'Invalid issuer' });
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ ok: false, error: 'Token expired' });
    }

    const user = await findOrCreateUser({
      email: payload.email,
      provider: 'google',
      providerUserId: payload.sub,
      displayName: payload.name,
      planTier: FREE_PLAN.tier,
      monthlyCredits: FREE_PLAN.monthly_credits,
      dailyCap: PLAN_DAILY_CAPS[FREE_PLAN.tier] ?? null
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    if (error?.message === 'USER_DELETED') {
      return res.status(403).json({ ok: false, error: 'Account deleted' });
    }
    console.error('Google auth error', error);
    return res.status(500).json({ ok: false, error: 'Google auth failed' });
  }
});

app.post(['/api/auth/email/request', '/api/v1/auth/email/request'], async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const ip = getRequestIp(req);
    const magicLimit = Number(process.env.AUTH_RATE_LIMIT_MAGIC || 6);
    const magicWindowMs = Number(process.env.AUTH_RATE_LIMIT_MAGIC_WINDOW_MS || 60_000);
    const rateKey = `auth:magic:${email || ip}`;
    if (!enforceLocalAuthRateLimit({ key: rateKey, limit: magicLimit, windowMs: magicWindowMs })) {
      return res.status(429).json({ ok: false, error: 'Too many requests' });
    }
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email required' });
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.status(500).json({ ok: false, error: 'Missing EMAIL_TOKEN_SECRET' });
    }

    const token = await createSignedToken(
      {
        sub: email,
        type: 'email_magic',
        exp: Math.floor(Date.now() / 1000) + 15 * 60
      },
      process.env.EMAIL_TOKEN_SECRET
    );

    const base = process.env.BACKEND_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base.replace(/\/$/, '')}/auth/email?token=${encodeURIComponent(token)}`;

    if (process.env.ENVIRONMENT === 'dev') {
      return res.json({ ok: true, debug_magic_link: link });
    }

    await sendMagicEmail(email, link);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Email magic link request failed.', error);
    return res.status(500).json({ ok: false, error: 'Failed to send magic link' });
  }
});

app.post('/api/auth/email/verify', async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing token' });
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.status(500).json({ ok: false, error: 'Missing EMAIL_TOKEN_SECRET' });
    }
    const payload = await verifySignedToken(token, process.env.EMAIL_TOKEN_SECRET);
    if (!payload || payload.type !== 'email_magic' || !payload.sub) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }

    const user = await findOrCreateUser({
      email: payload.sub,
      provider: 'email',
      providerUserId: '',
      displayName: payload.sub.split('@')[0],
      planTier: FREE_PLAN.tier,
      monthlyCredits: FREE_PLAN.monthly_credits,
      dailyCap: PLAN_DAILY_CAPS[FREE_PLAN.tier] ?? null
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    if (error?.message === 'USER_DELETED') {
      return res.status(403).json({ ok: false, error: 'Account deleted' });
    }
    console.error('Email token verification failed.', error);
    return res.status(500).json({ ok: false, error: 'Email verification failed' });
  }
});

app.get('/auth/email', async (req, res) => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    if (!process.env.EMAIL_TOKEN_SECRET) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    const payload = await verifySignedToken(token, process.env.EMAIL_TOKEN_SECRET);
    if (!payload || payload.type !== 'email_magic' || !payload.sub) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }

    const user = await findOrCreateUser({
      email: payload.sub,
      provider: 'email',
      providerUserId: '',
      displayName: payload.sub.split('@')[0],
      planTier: FREE_PLAN.tier,
      monthlyCredits: FREE_PLAN.monthly_credits,
      dailyCap: PLAN_DAILY_CAPS[FREE_PLAN.tier] ?? null
    });

    issueSessionCookie(res, req, user, { redirect: true });
  } catch (error) {
    if (error?.message === 'USER_DELETED') {
      return res.redirect(process.env.FRONTEND_URL || '/');
    }
    console.error('Email callback failed.', error);
    res.redirect(process.env.FRONTEND_URL || '/');
  }
});

app.post('/api/auth/apple', async (req, res) => {
  try {
    const idToken = typeof req.body?.id_token === 'string' ? req.body.id_token.trim() : '';
    if (!idToken) {
      return res.status(400).json({ ok: false, error: 'Missing id_token' });
    }
    if (!process.env.APPLE_CLIENT_ID) {
      return res.status(500).json({ ok: false, error: 'Missing APPLE_CLIENT_ID' });
    }
    const payload = decodeJwtPayload(idToken);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Invalid token' });
    }
    if (payload.aud !== process.env.APPLE_CLIENT_ID) {
      return res.status(401).json({ ok: false, error: 'Invalid audience' });
    }
    if (payload.iss !== 'https://appleid.apple.com') {
      return res.status(401).json({ ok: false, error: 'Invalid issuer' });
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ ok: false, error: 'Token expired' });
    }

    const email = payload.email || `${payload.sub}@appleid.apple.com`;
    const user = await findOrCreateUser({
      email,
      provider: 'apple',
      providerUserId: payload.sub,
      displayName: payload.name || email.split('@')[0],
      planTier: FREE_PLAN.tier,
      monthlyCredits: FREE_PLAN.monthly_credits,
      dailyCap: PLAN_DAILY_CAPS[FREE_PLAN.tier] ?? null
    });

    return issueSessionCookie(res, req, user);
  } catch (error) {
    if (error?.message === 'USER_DELETED') {
      return res.status(403).json({ ok: false, error: 'Account deleted' });
    }
    console.error('Apple auth failed.', error);
    return res.status(500).json({ ok: false, error: 'Apple auth failed' });
  }
});

async function createSubscriptionCheckoutSession({ user, planTier, req }) {
  const requestedTier = String(planTier || 'starter').toLowerCase();
  const plan = PLAN_CATALOG[requestedTier];
  if (!plan || !plan.stripe_price_id) {
    const error = new Error('Invalid plan tier');
    error.status = 400;
    throw error;
  }

  const stripeSession = await createStripeCheckoutSession({
    mode: 'subscription',
    priceId: plan.stripe_price_id,
    user,
    metadata: {
      purchase_type: 'subscription',
      plan_tier: plan.tier,
      price_id: plan.stripe_price_id
    },
    successUrl: process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`,
    cancelUrl: process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
  });

  return stripeSession;
}

app.post('/api/billing/subscriptions', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const stripeSession = await createSubscriptionCheckoutSession({
      user,
      planTier: req.body?.plan_tier,
      req
    });

    return res.json({ ok: true, url: stripeSession.url });
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    console.error('Subscription checkout failed.', error);
    return res.status(500).json({ ok: false, error: 'Checkout failed' });
  }
});

app.get('/checkout/subscription', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const stripeSession = await createSubscriptionCheckoutSession({
      user,
      planTier: req.query?.plan_tier,
      req
    });
    return res.redirect(303, stripeSession.url);
  } catch (error) {
    if (error?.status === 400) {
      return res.status(400).json({ ok: false, error: error.message });
    }
    console.error('Subscription checkout failed.', error);
    return res.status(500).json({ ok: false, error: 'Checkout failed' });
  }
});

app.get('/checkout/credits', async (req, res) => {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const user = await getUserById(session.sub);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const packKey = typeof req.query?.pack === 'string' ? req.query.pack : 'default';
    const pack = STRIPE_CREDIT_PACKS[packKey];
    if (!pack || !pack.price_id || !pack.credits) {
      return res.status(500).json({ ok: false, error: 'Credit pack not configured' });
    }

    const stripeSession = await createStripeCheckoutSession({
      mode: 'payment',
      priceId: pack.price_id,
      user,
      metadata: {
        purchase_type: 'credits',
        pack_key: packKey,
        credits: String(pack.credits)
      },
      successUrl: process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`,
      cancelUrl: process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
    });

    return res.redirect(303, stripeSession.url);
  } catch (error) {
    console.error('Credits checkout failed.', error);
    return res.status(500).json({ ok: false, error: 'Checkout failed' });
  }
});

app.post('/api/stripe/webhook', async (req, res) => {
  let stripeEventId = '';
  try {
    const signature = req.header('stripe-signature');
    if (!signature) {
      return res.status(400).json({ ok: false, error: 'Missing stripe-signature' });
    }

    const rawBody = req.body.toString();
    const event = verifyStripeSignature({
      rawBody,
      signatureHeader: signature,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
    });

    stripeEventId = event.id || '';
    const userId = await resolveStripeEventUserId(event);
    const payloadHash = computePayloadHash(rawBody);
    const recordResult = await recordBillingEvent({
      stripeEventId,
      type: event.type,
      userId,
      status: 'received',
      payloadHash
    });
    if (!recordResult.inserted && !recordResult.skipped) {
      logStructured('info', 'stripe_webhook_duplicate', {
        stripe_event_id: stripeEventId,
        user_id: userId,
        type: event.type,
        outcome: 'replay_rejected'
      });
      return res.status(200).json({ received: true, duplicate: true });
    }

    await updateBillingEventStatus({
      stripeEventId,
      status: 'processing',
      userId
    });

    queueStripeEventProcessing({ event, stripeEventId, userId });
    return res.status(202).json({ received: true, queued: true });
  } catch (error) {
    if (stripeEventId) {
      await updateBillingEventStatus({
        stripeEventId,
        status: 'failed'
      });
    }
    logStructured('error', 'stripe_webhook_failed', {
      stripe_event_id: stripeEventId || null,
      error: error?.message || 'unknown_error'
    });
    console.error('Stripe webhook failed.', error);
    return res.status(400).json({ ok: false, error: 'Webhook failed' });
  }
});



const frontendDistDir = path.join(__dirname, 'pdco-frontend', 'dist');

try {
  await fs.access(frontendDistDir);
  app.use(express.static(frontendDistDir));

  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/uploads/')) {
      return next();
    }
    return res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
} catch {
  console.warn('pdco-frontend/dist not found. Static frontend serving is disabled.');
}

app.use((err, req, res, _next) => {
  const { status, code } = classifyError(err);
  const message = err?.message || 'Internal server error';
  res.locals.errorCode = code;
  logStructured(status >= 500 ? 'error' : 'warn', 'request_error', {
    request_id: req.requestId || null,
    route: req.originalUrl,
    user_id: req.userId || null,
    status,
    error_code: code,
    error_message: message
  });

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Payload too large', error_code: 'PAYLOAD_TOO_LARGE' });
  }

  return res.status(status).json({ ok: false, error: message, error_code: code });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

export function broadcast(payload) {
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log('Maya API listening on', port);
  logStructured('info', 'user_store_driver_selected', { user_store_driver: USER_STORE_DRIVER });
  startCreditResetScheduler();
});

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(padded + padding, 'base64').toString('utf8');
}

function signHmac(data, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createSignedToken(payload, secret) {
  const data = JSON.stringify(payload);
  const signature = signHmac(data, secret);
  return `${base64UrlEncode(data)}.${signature}`;
}

async function verifySignedToken(token, secret) {
  if (!secret) return null;
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) return null;
  const payloadJson = base64UrlDecode(payloadPart);
  const expected = signHmac(payloadJson, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function issueSessionCookie(res, req, user, options = {}) {
  if (!process.env.SESSION_SECRET) {
    res.status(500).json({ ok: false, error: 'Missing SESSION_SECRET' });
    return;
  }
  const role = resolveUserRole(user);
  const jti = crypto.randomUUID();
  const token = await createSignedToken(
    {
      sub: user.user_id,
      email: user.email,
      provider: user.auth_provider,
      role,
      jti,
      session_version: Number(user.session_version || 1),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
    },
    process.env.SESSION_SECRET
  );

  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${resolveCookieSameSite()}`,
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];

  if (process.env.COOKIE_DOMAIN) {
    cookieParts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));

  if (options.redirect) {
    res.redirect(process.env.FRONTEND_URL || '/');
    return;
  }

  res.json({
    token,
    user: mapUserForClient(user),
    session: {
      token,
      user: mapUserForClient(user)
    }
  });
}

function clearSessionCookie(res) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${resolveCookieSameSite()}`,
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];

  if (process.env.COOKIE_DOMAIN) {
    cookieParts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

async function getSessionFromRequest(req) {
  if (!process.env.SESSION_SECRET) {
    return null;
  }
  const cookieHeader = req.header('cookie') || '';
  const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!token) return null;
  const payload = await verifySignedToken(token, process.env.SESSION_SECRET);
  if (!payload) return null;
  if (payload.sub) {
    req.userId = payload.sub;
  }
  return { token, ...payload };
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const entry of cookies) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

function mapUserForClient(user) {
  const creditsRemainingRaw = resolveCreditsBalance(user);
  const creditsTotal = Number(user.credits_total ?? 0);
  const creditsRemaining = clampCredits(creditsRemainingRaw, creditsTotal);
  const authProviders = Array.isArray(user.auth_providers)
    ? user.auth_providers
    : user.auth_providers
      ? String(user.auth_providers).split(',').map((entry) => entry.trim()).filter(Boolean)
      : [];
  return {
    id: user.user_id,
    user_id: user.user_id,
    email: user.email,
    name: user.display_name || user.email?.split('@')[0] || 'User',
    provider: user.auth_provider,
    auth_providers: authProviders.length
      ? authProviders
      : [user.auth_provider].filter(Boolean),
    created_at: user.created_at,
    plan: user.plan_tier,
    plan_tier: user.plan_tier,
    role: resolveUserRole(user),
    billing_status: user.billing_status,
    credits_remaining: creditsRemaining,
    credits_total: creditsTotal,
    monthly_reset_at: user.monthly_reset_at,
    daily_credit_limit: resolveDailyCreditLimit(user),
    creditsRemaining: creditsRemaining,
    creditsTotal: creditsTotal,
    preferences: user.preferences || {},
    is_internal: Boolean(user.is_internal),
    plan_override: user.plan_override || null
  };
}

function clampCredits(remaining, total) {
  if (Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(remaining, total));
  }
  return Math.max(0, remaining);
}

function buildPromptText(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  return messages
    .map((entry) => {
      const role = entry?.role ? String(entry.role) : 'user';
      const content = entry?.content;
      if (typeof content === 'string') {
        return `${role}:\n${content}`;
      }
      if (content === null || content === undefined) {
        return `${role}:`;
      }
      return `${role}:\n${JSON.stringify(content)}`;
    })
    .join('\n\n');
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

function calculateCreditsUsed({ inputTokens, outputTokens, intentType, totalTokens, inputText, outputText, model }) {
  if (Number.isFinite(totalTokens)) {
    return Math.ceil(totalTokens / 250);
  }
  const resolvedInputTokens = Number.isFinite(inputTokens)
    ? inputTokens
    : estimateTokensWithTokenizer(inputText || '', model || OPENAI_MODEL);
  const resolvedOutputTokens = Number.isFinite(outputTokens)
    ? outputTokens
    : estimateTokensWithTokenizer(outputText || '', model || OPENAI_MODEL);
  const multiplier = intentType === 'code' ? 1.0 : 0.6;
  const tokenEstimate = Math.ceil((resolvedInputTokens + resolvedOutputTokens) * multiplier);
  return Math.ceil(tokenEstimate / 250);
}

function resolveCreditsBalance(user) {
  const balance = Number(user?.credits_balance ?? user?.credits_remaining ?? 0);
  return Number.isFinite(balance) ? balance : 0;
}

function resolveDailyCreditLimit(user) {
  const limit = Number(user?.daily_credit_limit);
  if (Number.isFinite(limit)) {
    return limit;
  }
  return PLAN_DAILY_CAPS[user?.plan_tier] ?? null;
}

function formatCreditLedgerMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}


function parseCSV(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n');
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] ?? '';
    });
    return entry;
  });
}

async function loadUsageLogRows() {
  if (!CSV_USER_STORE_FALLBACK_ENABLED) {
    return [];
  }
  try {
    const fileUrl = new URL('./data/usage_log.csv', import.meta.url);
    const text = await fs.readFile(fileUrl, 'utf8');
    return parseCSV(text);
  } catch {
    return [];
  }
}


function applyArtifactDefaults(artifact) {
  if (!artifact) {
    return artifact;
  }
  const versioning = artifact.versioning || {
    enabled: false,
    chat_history_public: false
  };
  return {
    ...artifact,
    current_version_id: artifact.current_version_id || null,
    versioning,
    derived_from: {
      artifact_id: artifact?.derived_from?.artifact_id || null,
      owner_user_id: artifact?.derived_from?.owner_user_id || null,
      version_id: artifact?.derived_from?.version_id || null,
      version_label: artifact?.derived_from?.version_label || null,
      original_artifact_id: artifact?.derived_from?.original_artifact_id || artifact?.derived_from?.artifact_id || null,
      original_owner_user_id: artifact?.derived_from?.original_owner_user_id || artifact?.derived_from?.owner_user_id || null
    }
  };
}

function mapProfileForClient(profile, user, stats) {
  const demographics = profile.demographics || {};
  return {
    user_id: profile.user_id,
    handle: profile.handle,
    display_name: profile.display_name || user?.display_name || '',
    bio: profile.bio || '',
    avatar_url: profile.avatar_url || '',
    demographics,
    age: demographics.age ?? null,
    gender: demographics.gender || '',
    city: demographics.city || '',
    country: demographics.country || '',
    created_at: profile.created_at || user?.created_at || '',
    updated_at: profile.updated_at || profile.created_at || '',
    stats
  };
}

function mapPublicProfile(profile, user, stats) {
  const demographics = profile.demographics || {};
  return {
    handle: profile.handle,
    display_name: profile.display_name || user?.display_name || '',
    bio: profile.bio || '',
    avatar_url: profile.avatar_url || '',
    city: demographics.city || '',
    country: demographics.country || '',
    stats
  };
}

function validateArtifactPayload({ code, codeVersions, visibility, screenshotDataUrl }) {
  const errors = [];
  if (!code || !String(code.content || '').trim()) {
    errors.push('Code content is required.');
  }
  if (!Array.isArray(codeVersions) || codeVersions.length < 1) {
    errors.push('Code versions are required.');
  }
  if (!visibility || (visibility !== 'public' && visibility !== 'private')) {
    errors.push('Visibility must be public or private.');
  }
  if (screenshotDataUrl && typeof screenshotDataUrl === 'string') {
    if (!screenshotDataUrl.startsWith('data:image/png;base64,')) {
      errors.push('Screenshot must be a PNG data URL.');
    }
  } else if (screenshotDataUrl) {
    errors.push('Screenshot must be a PNG data URL.');
  }
  return { ok: errors.length === 0, errors };
}

function resolveScreenshotDataUrl(body) {
  if (body?.screenshot_data_url && typeof body.screenshot_data_url === 'string') {
    return body.screenshot_data_url;
  }
  const screenshot = body?.screenshot;
  if (!screenshot || typeof screenshot !== 'object') {
    return '';
  }
  if (screenshot.content_type !== 'image/png' || typeof screenshot.base64 !== 'string') {
    return '';
  }
  return `data:image/png;base64,${screenshot.base64}`;
}

function resolveArtifactCode(body) {
  if (body?.code && typeof body.code === 'object') {
    return {
      language: String(body.code.language || 'html'),
      content: String(body.code.content || '')
    };
  }
  const artifact = body?.artifact;
  if (artifact && typeof artifact === 'object') {
    return {
      language: String(artifact.language || 'html'),
      content: String(artifact.content || '')
    };
  }
  return null;
}

function resolveArtifactCodeVersions(body) {
  if (body?.code && typeof body.code === 'object' && Array.isArray(body.code.versions)) {
    return body.code.versions;
  }
  if (Array.isArray(body?.code_versions)) {
    return body.code_versions;
  }
  return [];
}

function buildChatPlusCodePrompt(messages = [], code = {}) {
  const recentUserMessages = messages
    .filter((entry) => entry?.role === 'user')
    .map((entry) => String(entry.content || '').trim())
    .filter(Boolean)
    .join('\n');
  const codeSnippet = typeof code?.content === 'string' ? code.content.slice(0, MAX_CODE_CONTEXT_CHARS) : '';
  return `You are generating metadata for a saved code artifact.

Use BOTH the user chat context and the code.

Return:
- A short, concrete title (max 60 chars)
- A one-sentence description (max 160 chars)

Chat:
${recentUserMessages}

Code:
${codeSnippet}

Output JSON ONLY:
{
  "title": "...",
  "description": "..."
}`;
}

function buildCodeOnlyPrompt(code = {}) {
  const codeLanguage = typeof code?.language === 'string' ? code.language : '';
  const codeSnippet = typeof code?.content === 'string' ? code.content.slice(0, MAX_CODE_CONTEXT_CHARS) : '';
  return `You are generating metadata for a saved code artifact.

There is NO chat context.
Infer intent and functionality from the code alone.

Code language: ${codeLanguage}

Code:
${codeSnippet}

Return JSON ONLY:
{
  "title": "...",
  "description": "..."
}`;
}

function buildMetadataResponse(result = {}, source = 'code-only') {
  const title = typeof result.title === 'string' ? result.title.trim() : '';
  const description = typeof result.description === 'string' ? result.description.trim() : '';
  const hasInferred = Boolean(title || description);
  return {
    ok: true,
    inferred: hasInferred,
    title: title || null,
    description: description || null,
    source
  };
}

function selectMetadataMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }
  const normalized = messages
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || '')
    }))
    .filter((entry) => (entry.role === 'user' || entry.role === 'assistant') && entry.content.trim());
  if (!normalized.length) {
    return [];
  }
  const userIndices = [];
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === 'user') {
      userIndices.push(i);
    }
    if (userIndices.length >= 5) {
      break;
    }
  }
  let assistantIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === 'assistant') {
      assistantIndex = i;
      break;
    }
  }
  const indices = new Set(userIndices);
  if (assistantIndex >= 0) {
    indices.add(assistantIndex);
  }
  if (!indices.size) {
    return normalized.slice(-5);
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((index) => normalized[index]);
}


async function parseMultipartRequest(req) {
  const contentType = req.header('content-type') || '';
  if (!contentType.startsWith('multipart/form-data')) {
    return {
      fields: req.body || {},
      files: {}
    };
  }
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    return { fields: {}, files: {} };
  }
  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
  const body = await readRequestBody(req);
  return parseMultipartFormData(body, boundary);
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartFormData(body, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer).slice(1, -1);
  const fields = {};
  const files = {};

  parts.forEach((part) => {
    const cleaned = trimBuffer(part);
    if (!cleaned.length) {
      return;
    }
    const headerEnd = cleaned.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      return;
    }
    const headerText = cleaned.slice(0, headerEnd).toString('utf8');
    const content = cleaned.slice(headerEnd + 4);
    const dispositionMatch = headerText.match(/name="([^"]+)"/);
    if (!dispositionMatch) {
      return;
    }
    const name = dispositionMatch[1];
    const filenameMatch = headerText.match(/filename="([^"]*)"/);
    if (filenameMatch && filenameMatch[1]) {
      const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
      files[name] = {
        filename: filenameMatch[1],
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        data: trimTrailingNewline(content)
      };
      return;
    }
    fields[name] = trimTrailingNewline(content).toString('utf8');
  });

  return { fields, files };
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function trimBuffer(buffer) {
  let start = 0;
  let end = buffer.length;
  if (buffer.slice(0, 2).toString() === '\r\n') {
    start = 2;
  }
  if (buffer.slice(-2).toString() === '\r\n') {
    end -= 2;
  }
  return buffer.slice(start, end);
}

function trimTrailingNewline(buffer) {
  if (buffer.slice(-2).toString() === '\r\n') {
    return buffer.slice(0, -2);
  }
  return buffer;
}

async function appendArtifactEvent({ eventType, userId, artifactId, sourceArtifactId, sessionId }) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ARTIFACT_EVENTS_FILE);
  } catch {
    const header = 'timestamp_utc,event_type,user_id,artifact_id,source_artifact_id,session_id\n';
    await fs.writeFile(ARTIFACT_EVENTS_FILE, header);
  }
  const line = [
    new Date().toISOString(),
    eventType,
    userId,
    artifactId,
    sourceArtifactId,
    sessionId
  ].map((value) => csvEscape(value)).join(',') + '\n';
  await fs.appendFile(ARTIFACT_EVENTS_FILE, line);
}

function filterUsageRowsByRange({ rows, userId, days, startDate, endDate }) {
  const cutoff = Number.isFinite(days)
    ? Date.now() - days * 24 * 60 * 60 * 1000
    : null;
  return rows.filter((row) => {
    if (userId && row.user_id !== userId) {
      return false;
    }
    if (startDate) {
      const day = row.timestamp_utc?.slice(0, 10);
      if (day && day < startDate) {
        return false;
      }
    }
    if (endDate) {
      const day = row.timestamp_utc?.slice(0, 10);
      if (day && day > endDate) {
        return false;
      }
    }
    if (cutoff) {
      const timestamp = new Date(row.timestamp_utc).getTime();
      if (!Number.isFinite(timestamp) || timestamp < cutoff) {
        return false;
      }
    }
    return true;
  });
}

function parseRangeDays(value) {
  if (!value) return null;
  const match = String(value).match(/(\d+)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterUsageRowsByMonth(rows, reference = new Date()) {
  const monthKey = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}`;
  return rows.filter((row) => row.timestamp_utc?.startsWith(monthKey));
}

function normalizeUsageRow(row) {
  return {
    timestamp_utc: row.timestamp_utc,
    session_id: row.session_id,
    request_id: row.request_id,
    intent_type: row.intent_type,
    model: row.model,
    input_tokens: Number(row.input_tokens || 0) || 0,
    output_tokens: Number(row.output_tokens || 0) || 0,
    credits_charged: Number(row.credits_charged || row.credits_used || 0) || 0,
    latency_ms: Number(row.latency_ms || 0) || 0,
    status: row.status || 'unknown'
  };
}

function mapUsageEventRow(row) {
  return {
    timestamp_utc: row.created_at,
    session_id: row.session_id,
    request_id: row.id || '',
    intent_type: row.intent,
    model: row.model,
    input_tokens: Number(row.tokens_in || 0) || 0,
    output_tokens: Number(row.tokens_out || 0) || 0,
    credits_charged: Number(row.credits_used || 0) || 0,
    credits_used: Number(row.credits_used || 0) || 0,
    latency_ms: Number(row.latency_ms || 0) || 0,
    status: row.success ? 'success' : 'failure'
  };
}

function buildUsageOverview(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.totalRequests += 1;
    acc.totalCredits += Number(row.credits_charged || row.credits_used || 0) || 0;
    acc.totalLatency += Number(row.latency_ms || 0) || 0;
    acc.tokensIn += Number(row.input_tokens || 0) || 0;
    acc.tokensOut += Number(row.output_tokens || 0) || 0;
    if (row.status === 'success') {
      acc.successCount += 1;
    }
    return acc;
  }, {
    totalRequests: 0,
    totalCredits: 0,
    totalLatency: 0,
    tokensIn: 0,
    tokensOut: 0,
    successCount: 0
  });
  return {
    total_requests: totals.totalRequests,
    total_credits: totals.totalCredits,
    avg_latency_ms: totals.totalRequests ? totals.totalLatency / totals.totalRequests : 0,
    success_rate: totals.totalRequests ? totals.successCount / totals.totalRequests : 0,
    tokens_in: totals.tokensIn,
    tokens_out: totals.tokensOut
  };
}

function buildDailyUsageSummaries(rows, { includeEntries = false } = {}) {
  const map = new Map();
  rows.forEach((row) => {
    const date = row.timestamp_utc?.slice(0, 10);
    if (!date) {
      return;
    }
    if (!map.has(date)) {
      map.set(date, {
        date,
        total_requests: 0,
        total_credits: 0,
        avg_latency_ms: 0,
        success_rate: 0,
        by_intent: { code: 0, text: 0 },
        entries: []
      });
    }
    const daily = map.get(date);
    const intent = row.intent_type || 'text';
    daily.total_requests += 1;
    daily.total_credits += Number(row.credits_charged || row.credits_used || 0) || 0;
    daily.avg_latency_ms += Number(row.latency_ms || 0) || 0;
    daily.by_intent[intent] = (daily.by_intent[intent] || 0) + 1;
    if (row.status === 'success') {
      daily.success_rate += 1;
    }
    if (includeEntries) {
      daily.entries.push(normalizeUsageRow(row));
    }
  });

  return Array.from(map.values())
    .map((daily) => ({
      ...daily,
      avg_latency_ms: daily.total_requests ? daily.avg_latency_ms / daily.total_requests : 0,
      success_rate: daily.total_requests ? daily.success_rate / daily.total_requests : 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildSessionSummariesFromUsage(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const sessionId = row.session_id || 'session_unknown';
    if (!map.has(sessionId)) {
      map.set(sessionId, {
        session_id: sessionId,
        started_at: row.timestamp_utc,
        ended_at: row.timestamp_utc,
        turns: 0,
        credits_used: 0,
        tokens_in: 0,
        tokens_out: 0
      });
    }
    const summary = map.get(sessionId);
    summary.turns += 1;
    summary.credits_used += Number(row.credits_charged || row.credits_used || 0) || 0;
    summary.tokens_in += Number(row.input_tokens || 0) || 0;
    summary.tokens_out += Number(row.output_tokens || 0) || 0;
    if (row.timestamp_utc < summary.started_at) {
      summary.started_at = row.timestamp_utc;
    }
    if (row.timestamp_utc > summary.ended_at) {
      summary.ended_at = row.timestamp_utc;
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
  });
}

function recordTokenEfficiency(metrics = {}) {
  tokenEfficiencyTelemetry.totalRequests += 1;
  tokenEfficiencyTelemetry.totalTokensBeforeTrim += Number(metrics.totalTokensBeforeTrim || 0);
  tokenEfficiencyTelemetry.totalTokensAfterTrim += Number(metrics.totalTokensAfterTrim || 0);
  tokenEfficiencyTelemetry.totalTokensSaved += Number(metrics.tokensSaved || 0);
  tokenEfficiencyTelemetry.totalRelevanceSelected += Number(metrics.relevanceSelectedCount || 0);
  if (metrics.summarized) {
    tokenEfficiencyTelemetry.summaryUsageCount += 1;
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}


async function routeModelForUser({ user, intentType, requestedModel, sessionId }) {
  const pool = getUsageAnalyticsPool();
  if (!pool) {
    return { model: requestedModel, reason: 'policy_default' };
  }

  const plan = user.plan_tier || 'free';
  const policy = await fetchPlanPolicy({ plan, intentType });
  if (!policy) {
    return { model: requestedModel, reason: 'policy_default' };
  }

  let reason = 'policy_default';
  let candidate = requestedModel && policy.allowed_models?.includes(requestedModel)
    ? requestedModel
    : policy.preferred_models?.[0];

  if (candidate && !(policy.allowed_models || []).includes(candidate)) {
    candidate = policy.allowed_models?.[0];
  }

  if (candidate && await isPremiumModel(candidate) && !policy.premium_allowed) {
    const nonPremium = await fetchFirstNonPremiumModel([
      ...(policy.preferred_models || []),
      ...(policy.allowed_models || [])
    ]);
    if (nonPremium) {
      candidate = nonPremium;
      reason = 'premium_blocked';
    }
  }

  const quota = await fetchMonthlyQuota({ userId: user.user_id, plan });
  const usageRatio = quota?.monthly_credits
    ? Number(quota.normalized_credits_used || 0) / Number(quota.monthly_credits)
    : 0;

  if (policy.allow_fallback && usageRatio >= 0.9) {
    const cheapest = await fetchCheapestAllowedModel(policy.allowed_models || []);
    if (cheapest) {
      candidate = cheapest;
      reason = 'quota_fallback';
    }
  }

  if (candidate && !(policy.allowed_models || []).includes(candidate)) {
    candidate = policy.allowed_models?.[policy.allowed_models.length - 1];
    reason = 'policy_default';
  }

  if (candidate) {
    await insertRouteDecision({
      userId: user.user_id,
      sessionId,
      intentType,
      requestedModel,
      routedModel: candidate,
      reason,
      plan
    });
  }

  return { model: candidate || requestedModel, reason };
}

async function appendUsageEntry({
  user,
  requestId,
  sessionId,
  eventType,
  intentType,
  model,
  inputTokens,
  outputTokens,
  inputChars,
  outputChars,
  totalTokens,
  reservedCredits,
  actualCredits,
  creditsCharged,
  latencyMs,
  status,
  timestamp,
  req = null
}) {
  const timestampValue = timestamp || new Date().toISOString();
  const entry = {
    timestamp_utc: timestampValue,
    user_id: user.user_id,
    email: user.email,
    session_id: sessionId,
    event_type: eventType,
    request_id: requestId,
    intent_type: intentType,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_chars: inputChars,
    input_est_tokens: Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : '',
    output_chars: outputChars,
    output_est_tokens: Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : '',
    total_est_tokens: totalTokens,
    estimated_credits: reservedCredits,
    reserved_credits: reservedCredits,
    actual_credits: actualCredits,
    refunded_credits: 0,
    credits_charged: creditsCharged,
    credits_used: creditsCharged,
    latency_ms: latencyMs ?? '',
    status
  };

  if (eventType !== 'session_close') {
    if (typeof req?.logUsageEventToDb === 'function') {
      await req.logUsageEventToDb({
        user,
        sessionId,
        requestId,
        intentType,
        model,
        inputTokens,
        outputTokens,
        creditsCharged,
        latencyMs,
        status,
        timestamp: timestampValue
      });
    } else {
      await recordUsageEventToDb({
        user,
        sessionId,
        requestId,
        intentType,
        model,
        inputTokens,
        outputTokens,
        creditsCharged,
        latencyMs,
        status,
        timestamp: timestampValue
      });
    }
  }


  if (CSV_USER_STORE_FALLBACK_ENABLED && process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
    const { appendUsageLog } = await import('./api/usageLog.js');
    await appendUsageLog(process.env, entry);
  }
}


async function sendMagicEmail(email, link) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.MAGIC_EMAIL_FROM || 'Maya <auth@primarydesignco.com>',
      to: email,
      subject: 'Sign in to Maya',
      html: `
        <p>Click to sign in:</p>
        <p><a href="${link}">Sign in to Maya</a></p>
        <p>This link expires in 15 minutes.</p>
      `
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${text}`);
  }
}

async function createStripeCheckoutSession({ mode, priceId, user, metadata = {}, successUrl, cancelUrl }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const params = new URLSearchParams();
  params.set('mode', mode);
  params.set('success_url', `${successUrl.replace(/\/$/, '')}/?checkout=success`);
  params.set('cancel_url', `${cancelUrl.replace(/\/$/, '')}/?checkout=cancel`);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('client_reference_id', user.user_id);
  params.set('metadata[user_id]', user.user_id);

  Object.entries(metadata).forEach(([key, value]) => {
    params.set(`metadata[${key}]`, value);
  });

  if (user.stripe_customer_id) {
    params.set('customer', user.stripe_customer_id);
  } else {
    params.set('customer_email', user.email);
  }

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe checkout failed: ${text}`);
  }

  return response.json();
}

async function createStripeBillingPortalSession({ customerId, returnUrl }) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  const params = new URLSearchParams();
  params.set('customer', customerId);
  params.set('return_url', returnUrl);

  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Stripe billing portal failed: ${text}`);
  }

  return response.json();
}

function queueStripeEventProcessing({ event, stripeEventId, userId }) {
  setImmediate(async () => {
    try {
      await handleStripeEvent(event);
      await updateBillingEventStatus({
        stripeEventId,
        status: 'processed',
        userId
      });
      logStructured('info', 'stripe_webhook_processed', {
        stripe_event_id: stripeEventId,
        user_id: userId,
        type: event.type,
        outcome: 'processed'
      });
    } catch (error) {
      await updateBillingEventStatus({
        stripeEventId,
        status: 'failed',
        userId
      });
      logStructured('error', 'stripe_webhook_processing_failed', {
        stripe_event_id: stripeEventId,
        user_id: userId,
        type: event?.type,
        error: error?.message || 'unknown_error'
      });
      console.error('Stripe webhook async processing failed.', error);
    }
  });
}

function verifyStripeSignature({ rawBody, signatureHeader, webhookSecret }) {
  if (!webhookSecret) {
    throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  }
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [key, value] = kv.split('=');
      return [key, value];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) {
    throw new Error('Invalid signature header');
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  if (!timingSafeEqual(signature, expected)) {
    throw new Error('Bad signature');
  }
  const toleranceSec = 5 * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) {
    throw new Error('Timestamp outside tolerance');
  }
  return JSON.parse(rawBody);
}

async function resolveStripeEventUserId(event) {
  const payload = event?.data?.object;
  if (!payload) return null;

  if (event?.type === 'checkout.session.completed') {
    return payload.metadata?.user_id || payload.client_reference_id || null;
  }

  if (event?.type?.startsWith('customer.subscription.')) {
    const user = await findUserByStripeCustomer(payload.customer);
    return user?.user_id || null;
  }

  if (event?.type?.startsWith('invoice.')) {
    const user = await findUserByStripeCustomer(payload.customer);
    return user?.user_id || null;
  }

  return null;
}

async function handleStripeEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutSessionCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionUpsert(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await onInvoicePaymentSucceeded(event.data.object);
      break;
    case 'invoice.payment_failed':
      await onInvoicePaymentFailed(event.data.object);
      break;
    default:
      break;
  }
}

function resolvePlanFromStripePriceId(priceId) {
  if (!priceId) return FREE_PLAN;
  const configuredPlan = PLAN_BY_PRICE_ID[priceId] || STRIPE_PLAN_MAP[priceId];
  if (!configuredPlan) {
    return FREE_PLAN;
  }
  if (typeof configuredPlan === 'string') {
    return PLAN_CATALOG[configuredPlan.toLowerCase()] || FREE_PLAN;
  }
  if (configuredPlan.tier) {
    return PLAN_CATALOG[String(configuredPlan.tier).toLowerCase()] || configuredPlan;
  }
  return FREE_PLAN;
}

function buildPlanReconciliationPatch({ user, plan }) {
  if (!plan?.tier || isUserPlanOverridden(user)) {
    return {};
  }
  const nextTotal = Number(plan.monthly_credits) || FREE_PLAN.monthly_credits;
  const nextBalance = Math.min(resolveCreditsBalance(user), nextTotal);
  return {
    plan_tier: plan.tier,
    credits_total: String(nextTotal),
    credits_remaining: String(nextBalance),
    credits_balance: String(nextBalance),
    daily_credit_limit: String(plan.daily_cap ?? PLAN_DAILY_CAPS[plan.tier] ?? '')
  };
}

async function onCheckoutSessionCompleted(session) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  if (!userId) {
    throw new Error('Missing user_id');
  }

  const patch = {
    stripe_customer_id: session.customer || '',
    stripe_subscription_id: session.subscription || '',
    billing_status: 'active'
  };

  const purchaseType = session.metadata?.purchase_type;
  if (purchaseType === 'credits') {
    const credits = Number(session.metadata?.credits || 0);
    if (Number.isFinite(credits) && credits > 0) {
      const user = await getUserById(userId);
      if (user) {
        const nextRemaining = resolveCreditsBalance(user) + credits;
        patch.credits_remaining = String(nextRemaining);
        patch.credits_balance = String(nextRemaining);
      }
    }
  } else if (purchaseType === 'subscription' && session?.subscription) {
    const priceId = session.metadata?.price_id || session.metadata?.stripe_price_id;
    const plan = resolvePlanFromStripePriceId(priceId);
    const user = await getUserById(userId);
    Object.assign(patch, buildPlanReconciliationPatch({ user, plan }));
  }

  await updateUser(userId, patch);
}

async function onSubscriptionUpsert(subscription) {
  const stripeCustomerId = subscription.customer;
  const stripeSubscriptionId = subscription.id;
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = resolvePlanFromStripePriceId(priceId);
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) {
    throw new Error(`No user for stripe_customer_id=${stripeCustomerId}`);
  }

  const patch = {
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    billing_status: normalizeStripeSubStatus(subscription.status)
  };

  Object.assign(patch, buildPlanReconciliationPatch({ user, plan }));

  await updateUser(user.user_id, patch);
}

async function onSubscriptionDeleted(subscription) {
  const stripeCustomerId = subscription.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  const patch = {
    billing_status: 'canceled'
  };

  if (!isUserPlanOverridden(user)) {
    const remaining = Math.min(
      resolveCreditsBalance(user),
      FREE_PLAN.monthly_credits
    );
    patch.plan_tier = 'free';
    patch.credits_total = String(FREE_PLAN.monthly_credits);
    patch.credits_remaining = String(remaining);
    patch.credits_balance = String(remaining);
    patch.daily_credit_limit = String(PLAN_DAILY_CAPS.free ?? '');
  }

  await updateUser(user.user_id, patch);
}

async function onInvoicePaymentSucceeded(invoice) {
  const stripeCustomerId = invoice.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  const nextResetAt = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  await updateUser(user.user_id, {
    billing_status: 'active',
    credits_remaining: String(user.credits_total || FREE_PLAN.monthly_credits),
    credits_balance: String(user.credits_total || FREE_PLAN.monthly_credits),
    monthly_reset_at: nextResetAt
  });
}

async function onInvoicePaymentFailed(invoice) {
  const stripeCustomerId = invoice.customer;
  const user = await findUserByStripeCustomer(stripeCustomerId);
  if (!user) return;

  await updateUser(user.user_id, {
    billing_status: 'past_due'
  });
}

function normalizeStripeSubStatus(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  return 'canceled';
}
