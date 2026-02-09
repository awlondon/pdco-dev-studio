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
];
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const MAILCHANNELS_ENDPOINT = 'https://api.mailchannels.net/tx/v1/send';

function isDevEnv(env) {
  const label = env?.ENVIRONMENT || env?.ENV || env?.NODE_ENV;
  return label === 'dev' || label === 'development';
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.startsWith('/api/')
      ? url.pathname.slice(4)
      : url.pathname;

    if (pathname === '/auth/magic/request' && request.method === 'POST') {
      return requestMagicLink(request, env);
    }

    if (pathname === '/auth/magic/verify' && request.method === 'POST') {
      return verifyMagicLink(request, env);
    }

    if (pathname === '/auth/google' && request.method === 'POST') {
      return handleGoogleAuth(request, env);
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

  const user = {
    id: `email:${record.email}`,
    email: record.email,
    provider: 'email'
  };

  return issueSession(user, env, request);
}

async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(digest);
}

async function sendMagicEmail(email, token, env, requestOrigin) {
  if (!env.MAGIC_EMAIL_FROM) {
    console.warn('MAGIC_EMAIL_FROM is not configured; skipping email send.');
    return;
  }

  const base = env.MAGIC_LINK_BASE || requestOrigin;
  const link = `${base.replace(/\/$/, '')}/auth/magic?token=${encodeURIComponent(token)}`;
  const subject = 'Sign in to Maya Dev UI';
  const bodyText = `Click the link below to sign in:\n\n${link}\n\nThis link expires in 15 minutes.\nIf you didn’t request this, you can ignore this email.`;

  const payload = {
    personalizations: [
      {
        to: [{ email }]
      }
    ],
    from: {
      email: env.MAGIC_EMAIL_FROM,
      name: env.MAGIC_EMAIL_FROM_NAME || 'Maya Dev UI'
    },
    subject,
    content: [
      {
        type: 'text/plain',
        value: bodyText
      }
    ]
  };

  const response = await fetch(MAILCHANNELS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mail send failed: ${response.status} ${text}`);
  }
}

async function issueSession(user, env, request) {
  if (!env.SESSION_SECRET) {
    return jsonError('Missing SESSION_SECRET', 500);
  }
  const token = await signJwt(
    {
      sub: user.id,
      email: user.email,
      provider: user.provider,
      iat: Math.floor(Date.now() / 1000)
    },
    env.SESSION_SECRET
  );
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None'
  ];

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Set-Cookie': cookieParts.join('; '),
      'Content-Type': 'application/json'
    }
  });
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }
  const cookies = cookieHeader.split(';');
  for (const entry of cookies) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

function timingSafeEqualString(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function verifySessionToken(token, secret) {
  const decoded = decodeJwtParts(token);
  if (!decoded) return null;
  const expectedSignature = await hmacSHA256Base64Url(secret, decoded.signingInput);
  if (!timingSafeEqualString(expectedSignature, decoded.signature)) {
    return null;
  }
  return decoded.payload;
}

async function getSessionFromRequest(request, env) {
  const session = await getSession(request, env);
  return session?.user || null;
}

async function getSession(request, env) {
  const token = getCookieValue(request.headers.get('cookie'), SESSION_COOKIE_NAME);
  if (!token || !env.SESSION_SECRET) {
    return null;
  }
  const payload = await verifySessionToken(token, env.SESSION_SECRET);
  if (!payload) {
    return null;
  }
  return {
    token,
    user: {
      id: payload.sub,
      email: payload.email,
      provider: payload.provider
    }
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

  // TODO: auth check here (admin vs user)
  // if scope=admin, ensure caller is admin
  if (scope !== 'user' && scope !== 'admin') {
    return json({ error: 'Invalid scope' }, 400);
  }

  const cacheKey = `analytics:${userId || 'all'}:${days}`;
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
  const filtered = filterRows(rows, { userId, days });
  const analytics = computeAnalytics(filtered);

  const payload = JSON.stringify({
    range_days: days,
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
  if (env.LEGACY_USERS_CSV === 'true') {
    return;
  }
  throw new Error('Legacy CSV user store is disabled. Use Postgres-backed storage instead.');
}

async function readUsageLogRows(env) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';

  const res = await githubRequest(env, `/repos/${repo}/contents/data/usage_log.csv?ref=${branch}`);
  const csv = atob(res.content);
  return parseCSV(csv);
}

function filterRows(rows, { userId, days }) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  return rows.filter((row) => {
    if (userId && row.user_id !== userId) return false;
    if (!row.timestamp_utc) return false;
    return new Date(row.timestamp_utc) >= cutoff;
  });
}

function computeAnalytics(rows) {
  const dailyMap = {};
  let totalCredits = 0;
  let totalLatency = 0;
  let successCount = 0;

  for (const row of rows) {
    if (!row.timestamp_utc) {
      continue;
    }

    const date = row.timestamp_utc.slice(0, 10);

    if (!dailyMap[date]) {
      dailyMap[date] = {
        date,
        requests: 0,
        credits: 0,
        latency_sum: 0,
        success: 0,
        by_intent: {}
      };
    }

    const day = dailyMap[date];
    day.requests += 1;

    const credits = Number(row.credits_charged || 0);
    const latency = Number(row.latency_ms || 0);

    day.credits += credits;
    day.latency_sum += latency;

    if (row.status === 'success') {
      day.success += 1;
      successCount += 1;
    }

    if (row.intent_type) {
      day.by_intent[row.intent_type] = (day.by_intent[row.intent_type] || 0) + 1;
    }

    totalCredits += credits;
    totalLatency += latency;
  }

  const daily = Object.values(dailyMap)
    .map((day) => ({
      date: day.date,
      requests: day.requests,
      credits: day.credits,
      avg_latency_ms: day.requests ? Math.round(day.latency_sum / day.requests) : 0,
      by_intent: day.by_intent
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    summary: {
      total_requests: rows.length,
      total_credits: totalCredits,
      avg_latency_ms: rows.length ? Math.round(totalLatency / rows.length) : 0,
      success_rate: rows.length ? Number((successCount / rows.length).toFixed(2)) : 0
    },
    daily
  };
}

function parseCSV(csvText) {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split('\n');
  const headers = lines.shift().split(',');

  return lines.map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] ?? '';
    });
    return obj;
  });
}

function serializeCSV(rows) {
  const headers = REQUIRED_USER_HEADERS;
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => String(row[header] ?? '')).join(','))
  ];

  return lines.join('\n') + '\n';
}
