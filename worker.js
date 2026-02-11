import { normalizeRole, requireAuth, requireRole, resolveRoleForUser } from './auth/middleware.js';

const PLAN_BY_PRICE_ID = {
  // "price_123": { tier: "starter", monthly_credits: 5000 },
  // "price_456": { tier: "pro", monthly_credits: 20000 },
  // "price_789": { tier: "power", monthly_credits: 100000 }
};

const FREE_PLAN = { tier: 'free', monthly_credits: 500 };
const GITHUB_API = 'https://api.github.com';
const ANALYTICS_CACHE_TTL_SECONDS = 60 * 10;
const DEFAULT_ANALYTICS_DAYS = 14;
const MAX_ANALYTICS_DAYS = 365;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE_NAME = 'maya_session';
const REQUIRED_USER_HEADERS = [
  'user_id',
  'email',
  'auth_provider',
  'provider_user_id',
  'display_name',
  'created_at',
  'last_login_at',
  'plan_tier',
  'credits_total',
  'credits_remaining',
  'monthly_reset_at',
  'newsletter_opt_in',
  'account_status',
  'stripe_customer_id',
  'stripe_subscription_id',
  'billing_status'
  ,'role'
];
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send';
const SESSION_REVOCATION_TTL_SECONDS = 60 * 60 * 24 * 35;

function isDevEnv(env) {
  const label = env?.ENVIRONMENT || env?.ENV || env?.NODE_ENV;
  return label === 'dev' || label === 'development';
}


function resolveUserStoreDriver(env) {
  const configured = String(env?.USER_STORE_DRIVER || '').trim().toLowerCase();
  if (configured === 'csv') {
    return 'csv';
  }
  if (configured === 'postgres') {
    return 'postgres';
  }
  return isDevEnv(env) ? 'postgres' : 'csv';
}

function isCsvUserStoreDriver(env) {
  return resolveUserStoreDriver(env) === 'csv';
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.startsWith('/api/')
      ? url.pathname.slice(4)
      : url.pathname;

    if (pathname === '/auth/magic/request' && request.method === 'POST') {
      const limit = await enforceAuthRateLimit(request, env, 'magic');
      if (limit) return limit;
      return requestMagicLink(request, env);
    }

    if (pathname === '/auth/magic/verify' && request.method === 'POST') {
      return verifyMagicLink(request, env);
    }

    if (pathname === '/auth/google' && request.method === 'POST') {
      const limit = await enforceAuthRateLimit(request, env, 'google');
      if (limit) return limit;
      return handleGoogleAuth(request, env);
    }

    if (pathname === '/auth/session/revoke' && request.method === 'POST') {
      return revokeCurrentSession(request, env);
    }

    if (pathname === '/me') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      return handleMe(request, env);
    }

    if (pathname === '/usage/analytics' && request.method === 'GET') {
      return handleUsageAnalytics(request, env, ctx);
    }

    if (pathname === '/stripe/webhook' && request.method === 'POST') {
      return handleStripeWebhook(request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleStripeWebhook(request, env, ctx) {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return json({ error: 'Missing stripe-signature header' }, 400);
  }

  let event;
  try {
    event = await verifyStripeSignature({
      rawBody,
      signatureHeader: signature,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET
    });
  } catch (error) {
    return json(
      { error: `Signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      400
    );
  }

  if (env.STRIPE_EVENTS) {
    const already = await env.STRIPE_EVENTS.get(event.id);
    if (already) {
      return json({ received: true, deduped: true }, 200);
    }
    await env.STRIPE_EVENTS.put(event.id, '1', { expirationTtl: 60 * 60 * 24 * 7 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutSessionCompleted(event.data.object, env);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await onSubscriptionUpsert(event.data.object, env);
        break;
      case 'customer.subscription.deleted':
        await onSubscriptionDeleted(event.data.object, env);
        break;
      case 'invoice.payment_succeeded':
        await onInvoicePaymentSucceeded(event.data.object, env);
        break;
      case 'invoice.payment_failed':
        await onInvoicePaymentFailed(event.data.object, env);
        break;
      default:
        break;
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Webhook handler error', event: event.type },
      500
    );
  }

  return json({ received: true }, 200);
}

async function verifyStripeSignature({ rawBody, signatureHeader, webhookSecret }) {
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
    throw new Error('Invalid signature header format');
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = await hmacSHA256Hex(webhookSecret, signedPayload);

  if (!timingSafeEqualHex(signature, expected)) {
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

async function hmacSHA256Hex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return bufToHex(sig);
}

async function hmacSHA256Base64Url(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSHA256Base64Url(secret, signingInput);
  return `${signingInput}.${signature}`;
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function jsonError(message, status = 400) {
  return json({ error: message }, status);
}

async function handleMe(request, env) {
  const session = await getSession(request, env);

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const resolvedUser = {
    id: session.user?.id,
    user_id: session.user?.user_id ?? session.user?.id,
    email: session.user?.email,
    name: session.user?.name ?? session.user?.email?.split('@')[0] ?? 'User',
    provider: session.user?.provider,
    auth_providers: session.user?.auth_providers
      ?? session.user?.authProviders
      ?? (session.user?.provider ? [session.user.provider] : []),
    created_at: session.user?.created_at,
    plan: session.user?.plan ?? 'Free',
    plan_tier: session.user?.plan_tier ?? session.user?.plan,
    billing_status: session.user?.billing_status,
    creditsRemaining: session.user?.creditsRemaining ?? session.user?.credits_remaining ?? 500,
    creditsTotal: session.user?.creditsTotal ?? session.user?.credits_total,
    credits_remaining: session.user?.credits_remaining ?? session.user?.creditsRemaining ?? 500,
    credits_total: session.user?.credits_total ?? session.user?.creditsTotal,
    monthly_reset_at: session.user?.monthly_reset_at
  };

  return new Response(JSON.stringify({
    token: session.token,
    user: resolvedUser
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGoogleAuth(request, env) {
  let idToken = '';
  try {
    const body = await request.json();
    idToken = typeof body?.id_token === 'string' ? body.id_token.trim() : '';
  } catch (error) {
    return jsonError('Invalid request payload', 400);
  }

  if (!idToken) {
    return jsonError('Missing id_token', 400);
  }

  const payload = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  if (!payload) {
    return jsonError('Invalid token', 401);
  }

  const user = {
    id: `google:${payload.sub}`,
    email: payload.email,
    name: payload.name,
    provider: 'google'
  };

  return issueSession(user, env, request);
}

let googleJwksCache = { keys: null, expiresAt: 0 };

async function verifyGoogleIdToken(idToken, clientId) {
  const decoded = decodeJwtParts(idToken);
  if (!decoded) return null;

  const { header, payload, signingInput, signature } = decoded;

  if (payload.aud !== clientId) {
    return null;
  }

  if (
    payload.iss !== 'https://accounts.google.com' &&
    payload.iss !== 'accounts.google.com'
  ) {
    return null;
  }

  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return null;
  }

  const keys = await getGoogleJwks();
  const jwk = Array.isArray(keys) ? keys.find((key) => key.kid === header.kid) : null;
  if (!jwk) {
    return null;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const data = new TextEncoder().encode(signingInput);
  const signatureBytes = base64UrlToUint8Array(signature);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    data
  );

  return verified ? payload : null;
}

async function getGoogleJwks() {
  if (googleJwksCache.keys && Date.now() < googleJwksCache.expiresAt) {
    return googleJwksCache.keys;
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) {
    throw new Error('Failed to fetch Google certs');
  }

  const cacheControl = response.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 300;

  const data = await response.json();
  googleJwksCache = {
    keys: data.keys || [],
    expiresAt: Date.now() + maxAgeSeconds * 1000
  };

  return googleJwksCache.keys;
}

function decodeJwtParts(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: parts[2]
    };
  } catch (error) {
    return null;
  }
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
}

function base64UrlToUint8Array(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const decoded = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

async function requestMagicLink(request, env) {
  let email = '';
  try {
    const body = await request.json();
    email = typeof body?.email === 'string' ? body.email.trim() : '';
  } catch (error) {
    console.warn('Magic link request parse error.', error);
  }

  if (!email) {
    return json({ ok: true });
  }

  const token = crypto.randomUUID();
  const hash = await hashToken(token);

  if (env.AUTH_KV) {
    await env.AUTH_KV.put(
      `magic:${hash}`,
      JSON.stringify({
        email,
        created: Date.now()
      }),
      { expirationTtl: MAGIC_LINK_TTL_SECONDS }
    );
  } else {
    console.warn('AUTH_KV is not configured; magic links will fail verification.');
  }

  const requestOrigin = new URL(request.url).origin;
  const base = env.MAGIC_LINK_BASE || requestOrigin;
  const link = `${base.replace(/\/$/, '')}/auth/magic?token=${encodeURIComponent(token)}`;

  if (isDevEnv(env)) {
    return json({ ok: true, debug_magic_link: link });
  }

  try {
    await sendMagicEmail(email, token, env, requestOrigin);
  } catch (error) {
    console.warn('Magic link email send failed.', error);
  }

  return json({ ok: true });
}

async function verifyMagicLink(request, env) {
  if (!env.AUTH_KV) {
    return jsonError('Auth store unavailable', 500);
  }

  let token = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token.trim() : '';
  } catch (error) {
    return jsonError('Invalid request payload', 400);
  }

  if (!token) {
    return jsonError('Invalid or expired link', 401);
  }

  const hash = await hashToken(token);
  const record = await env.AUTH_KV.get(`magic:${hash}`, { type: 'json' });
  if (!record) {
    return jsonError('Invalid or expired link', 401);
  }

  await env.AUTH_KV.delete(`magic:${hash}`);

function parseEnvOriginList(raw = '') {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function issueSession(user, env, request) {
  if (!env.SESSION_SECRET) {
    return jsonError('Missing SESSION_SECRET', 500);
  }
  const role = resolveRole(user, env);
  const jti = crypto.randomUUID();
  const sessionVersion = Number(user?.session_version || 1);
  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      provider: user.provider,
      role,
      jti,
      session_version: Number.isFinite(sessionVersion) ? sessionVersion : 1,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      iat: Math.floor(Date.now() / 1000)
    },
    env.SESSION_SECRET
  );
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];

  await persistSessionRecord(env, {
    jti,
    userId: user.id,
    role,
    expirationTtl: SESSION_MAX_AGE_SECONDS
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Set-Cookie': cookieParts.join('; '),
      'Content-Type': 'application/json'
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = allowedOrigins(env).includes(origin)
    ? origin
    : DEFAULT_ALLOWED_ORIGINS[0];

async function getSession(request, env) {
  const token = getCookieValue(request.headers.get('cookie'), SESSION_COOKIE_NAME);
  if (!token || !env.SESSION_SECRET) {
    return null;
  }
  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) {
    return null;
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (await isSessionRevoked(env, payload.jti)) {
    return null;
  }
  return {
    token,
    user: {
      id: payload.sub,
      email: payload.email,
      provider: payload.provider,
      role: normalizeRole(payload.role)
    },
    jti: payload.jti,
    session_version: payload.session_version || 1
  };
}

async function handleUsageAnalytics(request, env, ctx) {
  const url = new URL(request.url);
  const userId = url.searchParams.get('user_id');
  const scope = url.searchParams.get('scope') || 'user';
  const daysRaw = url.searchParams.get('days');
  const parsedDays = daysRaw ? Number(daysRaw) : DEFAULT_ANALYTICS_DAYS;
  const days = Number.isFinite(parsedDays) && parsedDays > 0
    ? Math.min(Math.floor(parsedDays), MAX_ANALYTICS_DAYS)
    : DEFAULT_ANALYTICS_DAYS;

  const session = await getSession(request, env);
  const auth = requireAuth(session);
  if (!auth.ok) {
    return auth.response;
  }

  if (scope !== 'user' && scope !== 'admin') {
    return json({ error: 'Invalid scope' }, 400);
  }

  if (scope === 'admin') {
    const roleCheck = requireRole(session, 'admin');
    if (!roleCheck.ok) {
      return roleCheck.response;
    }
  }

  if (scope === 'user' && userId && userId !== session.user.id) {
    return json({ error: 'Forbidden' }, 403);
  }

  const effectiveUserId = scope === 'admin' ? (userId || null) : (userId || session.user.id);

  const cacheKey = `analytics:${scope}:${effectiveUserId || 'all'}:${days}`;
  if (env.ANALYTICS_CACHE) {
    const cached = await env.ANALYTICS_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  }

  const rows = await readUsageLogRows(env);
  const filtered = filterRows(rows, { userId: effectiveUserId, days });
  const analytics = computeAnalytics(filtered);

  const payload = JSON.stringify({
    range_days: days,
    scope,
    user_id: effectiveUserId,
    generated_at: new Date().toISOString(),
    ...analytics
  });

  if (env.ANALYTICS_CACHE) {
    ctx.waitUntil(env.ANALYTICS_CACHE.put(cacheKey, payload, { expirationTtl: ANALYTICS_CACHE_TTL_SECONDS }));
  }

  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

async function upsertUserBillingState(env, userId, patch) {
  try {
    return await upsertUserToStore(env, userId, patch);
  } catch (error) {
    if (String(error?.message || '').includes('GitHub user writes are disabled')) {
      return null;
    }
    throw error;
  }
}

async function findUserIdByStripeCustomer(env, stripeCustomerId) {
  return findUserIdByStripeCustomerInStore(env, stripeCustomerId);
}

async function getUserFromStore(env, userId) {
  const { rows } = await readUsersCSV(env);
  return rows.find((row) => row.user_id === userId) || null;
}

async function upsertUserToStore(env, userId, patch) {
  assertLegacyUserStoreEnabled(env);
  if (env.GITHUB_USER_WRITES_ENABLED !== 'true') {
    throw new Error('GitHub user writes are disabled. Persist billing state in Postgres.');
  }
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const { sha, rows } = await readUsersCSV(env);

  const user = rows.find((row) => row.user_id === userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  if (session?.jti) {
    await revokeSessionJti(env, session.jti);
  }

  return new Response(JSON.stringify({ ok: true, revoked: Boolean(session?.jti) }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  });
}

function splitEmailList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveRole(user, env) {
  return resolveRoleForUser(user, {
    adminEmails: splitEmailList(env.ADMIN_EMAILS),
    internalEmails: splitEmailList(env.INTERNAL_EMAILS)
  });
}

async function persistSessionRecord(env, { jti, userId, role, expirationTtl }) {
  if (!jti || !env.AUTH_KV) {
    return;
  }
  await env.AUTH_KV.put(
    `session:${jti}`,
    JSON.stringify({ user_id: userId, role, issued_at: Date.now() }),
    { expirationTtl }
  );
}

async function revokeSessionJti(env, jti) {
  if (!jti || !env.AUTH_KV) {
    return;
  }
  await env.AUTH_KV.put(`revoked_jti:${jti}`, '1', { expirationTtl: SESSION_REVOCATION_TTL_SECONDS });
  await env.AUTH_KV.delete(`session:${jti}`);
}

async function isSessionRevoked(env, jti) {
  if (!jti || !env.AUTH_KV) {
    return false;
  }
  const revoked = await env.AUTH_KV.get(`revoked_jti:${jti}`);
  return Boolean(revoked);
}

async function enforceAuthRateLimit(request, env, route) {
  if (!env.MY_RATE_LIMITER || typeof env.MY_RATE_LIMITER.limit !== 'function') {
    return null;
  }

  const key = await buildRateLimitKey(request, route);
  const configuredLimit = Number(env[`AUTH_RATE_LIMIT_${route.toUpperCase()}`]);
  const response = await env.MY_RATE_LIMITER.limit({
    key,
    ...(Number.isFinite(configuredLimit) ? { limit: configuredLimit } : {})
  });

  if (response?.success === false) {
    return json({ ok: false, error: 'Too many requests' }, 429);
  }

  return null;
}

async function buildRateLimitKey(request, route) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

  if (route === 'magic') {
    let email = '';
    try {
      const body = await request.clone().json();
      email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    } catch {
      email = '';
    }
    return `auth:magic:${email || ip}`;
  }

  return `auth:${route}:${ip}`;
}

export const __test = {
  resolveRole,
  buildRateLimitKey,
  enforceAuthRateLimit,
  revokeSessionJti,
  isSessionRevoked
};

async function onCheckoutSessionCompleted(session, env) {
  const userId = session.metadata?.user_id || session.client_reference_id;
  if (!userId) {
    throw new Error('Missing user_id in session metadata/client_reference_id');
  }

  const stripeCustomerId = session.customer;
  const stripeSubscriptionId = session.subscription;

  await upsertUserBillingState(env, userId, {
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    billing_status: 'active'
  });
}

async function onSubscriptionUpsert(subscription, env) {
  const stripeCustomerId = subscription.customer;
  const stripeSubscriptionId = subscription.id;

  const plan = mapStripeSubscriptionToPlan(subscription);

  const userId = await findUserIdByStripeCustomer(env, stripeCustomerId);
  if (!userId) {
    throw new Error(`No user for stripe_customer_id=${stripeCustomerId}`);
  }

  await upsertUserBillingState(env, userId, {
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    plan_tier: plan.tier,
    credits_total: plan.monthly_credits,
    billing_status: normalizeStripeSubStatus(subscription.status),
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
  });
}

async function onSubscriptionDeleted(subscription, env) {
  const stripeCustomerId = subscription.customer;
  const userId = await findUserIdByStripeCustomer(env, stripeCustomerId);
  if (!userId) return;

  await upsertUserBillingState(env, userId, {
    billing_status: 'canceled',
    plan_tier: 'free',
    credits_total: FREE_PLAN.monthly_credits,
    clamp_remaining_to_total: true
  });
}

async function onInvoicePaymentSucceeded(invoice, env) {
  const stripeCustomerId = invoice.customer;
  const userId = await findUserIdByStripeCustomer(env, stripeCustomerId);
  if (!userId) return;

  const user = await getUser(env, userId);
  if (!user) return;

  const nextResetAt = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : null;

  await upsertUserBillingState(env, userId, {
    billing_status: 'active',
    credits_remaining: user.credits_total,
    monthly_reset_at: nextResetAt || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  });
}

async function onInvoicePaymentFailed(invoice, env) {
  const stripeCustomerId = invoice.customer;
  const userId = await findUserIdByStripeCustomer(env, stripeCustomerId);
  if (!userId) return;

  await upsertUserBillingState(env, userId, {
    billing_status: 'past_due'
  });
}

function normalizeStripeSubStatus(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  return 'canceled';
}

function mapStripeSubscriptionToPlan(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = PLAN_BY_PRICE_ID[priceId];
  if (!plan) {
    return FREE_PLAN;
  }
  return plan;
}

async function getUser(env, userId) {
  return getUserFromStore(env, userId);
}

async function upsertUserBillingState(env, userId, patch) {
  return upsertUserToStore(env, userId, patch);
}

async function findUserIdByStripeCustomer(env, stripeCustomerId) {
  return findUserIdByStripeCustomerInStore(env, stripeCustomerId);
}

async function getUserFromStore(env, userId) {
  const { rows } = await readUsersCSV(env);
  return rows.find((row) => row.user_id === userId) || null;
}

async function upsertUserToStore(env, userId, patch) {
  assertLegacyUserStoreEnabled(env);
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const { sha, rows } = await readUsersCSV(env);

  const user = rows.find((row) => row.user_id === userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  Object.entries(patch).forEach(([key, value]) => {
    if (key === 'clamp_remaining_to_total' && value === true) {
      const total = Number(user.credits_total || 0);
      user.credits_remaining = Math.min(Number(user.credits_remaining || 0), total);
    } else {
      user[key] = value;
    }
  });

  const csv = serializeCSV(rows);
  const encoded = btoa(csv);

  await githubRequest(env, `/repos/${repo}/contents/data/users.csv`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update billing for user ${userId}`,
      content: encoded,
      sha,
      branch
    })
  });
}

async function findUserIdByStripeCustomerInStore(env, stripeCustomerId) {
  const { rows } = await readUsersCSV(env);
  const user = rows.find((row) => row.stripe_customer_id === stripeCustomerId);
  return user ? user.user_id : null;
}

async function githubRequest(env, path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'maya-dev-worker',
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function readUsersCSV(env) {
  assertLegacyUserStoreEnabled(env);
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const data = await githubRequest(env, `/repos/${repo}/contents/data/users.csv?ref=${branch}`);
  const content = atob(data.content);
  return {
    sha: data.sha,
    rows: parseCSV(content)
  };
}

function assertLegacyUserStoreEnabled(env) {
  if (isCsvUserStoreDriver(env) || env.LEGACY_USERS_CSV === 'true') {
    return;
  }
  throw new Error('USER_STORE_DRIVER=postgres is enabled; legacy CSV user store is disabled.');
}

async function readUsageLogRows(env) {
  assertLegacyUserStoreEnabled(env);
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const res = await githubRequest(env, `/repos/${repo}/contents/data/usage_log.csv?ref=${branch}`);
  const csv = atob(res.content);
  return parseCSV(csv);
}

function withCors(response, headers) {
  const nextHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => nextHeaders.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders
  });
}

export default {
  async fetch(request, env) {
    const baseCorsHeaders = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: baseCorsHeaders
      });
    }

    let origin;
    try {
      origin = canonicalApiOrigin(env);
    } catch (error) {
      return withCors(
        new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Bad gateway' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        }),
        baseCorsHeaders
      );
    }

    const url = new URL(request.url);
    const upstreamPath = normalizePathname(url.pathname);
    const upstreamUrl = new URL(`${origin}${upstreamPath}${url.search}`);

    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual'
    });

    return withCors(upstreamResponse, baseCorsHeaders);
  }
};
