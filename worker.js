const PLAN_BY_PRICE_ID = {
  // "price_123": { tier: "starter", monthly_credits: 5000 },
  // "price_456": { tier: "pro", monthly_credits: 20000 },
  // "price_789": { tier: "power", monthly_credits: 100000 }
};

const FREE_PLAN = { tier: 'free', monthly_credits: 500 };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/stripe/webhook' && request.method === 'POST') {
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

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  throw new Error('Not implemented');
}

async function upsertUserToStore(env, userId, patch) {
  throw new Error('Not implemented');
}

async function findUserIdByStripeCustomerInStore(env, stripeCustomerId) {
  throw new Error('Not implemented');
}
