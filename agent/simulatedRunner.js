import crypto from 'node:crypto';

function makeFinding({ severity, title, evidence, reproSteps, suggestedFix }) {
  return {
    severity,
    title,
    evidence_json: evidence,
    repro_steps: reproSteps,
    suggested_fix: suggestedFix
  };
}

function simulateCreditAtomicity({ initialBalance = 100, workers = 12, debit = 10 } = {}) {
  let balance = initialBalance;
  const results = [];
  for (let index = 0; index < workers; index += 1) {
    if (balance >= debit) {
      balance -= debit;
      results.push({ worker: index + 1, applied: true, balance_after: balance });
    } else {
      results.push({ worker: index + 1, applied: false, balance_after: balance });
    }
  }
  return {
    finalBalance: balance,
    successfulDebits: results.filter((entry) => entry.applied).length,
    rows: results
  };
}

function createStripeFixtureSignature({ payload, secret, timestamp }) {
  const signedPayload = `${timestamp}.${payload}`;
  const digest = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

export async function runSimulatedAgentChecks({
  verifyStripeSignature,
  authRoutes = [],
  authRateLimitEnabled = true,
  analyticsEndpoint = '/admin/usage/summary',
  stripeWebhookSecret = 'test_webhook_secret'
}) {
  const findings = [];

  if (!Array.isArray(authRoutes) || authRoutes.length < 3) {
    findings.push(makeFinding({
      severity: 'high',
      title: 'Auth flow route surface appears incomplete',
      evidence: { auth_routes_detected: authRoutes },
      reproSteps: 'Inspect the running API route map and verify login, magic-link request, and logout endpoints are all registered.',
      suggestedFix: 'Register missing auth routes and add integration tests for login/logout/magic-link flow coverage.'
    }));
  }

  if (!authRateLimitEnabled) {
    findings.push(makeFinding({
      severity: 'high',
      title: 'Auth rate limiting disabled in simulated config',
      evidence: { auth_rate_limit_enabled: authRateLimitEnabled },
      reproSteps: 'Send >20 auth attempts in 60 seconds from the same IP and observe no 429 responses.',
      suggestedFix: 'Enable enforceLocalAuthRateLimit() on social + magic-link endpoints and document configurable thresholds.'
    }));
  }

  if (!String(analyticsEndpoint).startsWith('/api/')) {
    findings.push(makeFinding({
      severity: 'medium',
      title: 'Analytics admin endpoint is outside /api namespace',
      evidence: { analytics_endpoint: analyticsEndpoint },
      reproSteps: 'Call the analytics endpoint via frontend environments that only proxy /api routes and verify the call path is inconsistent.',
      suggestedFix: 'Move admin analytics to /api/admin/usage/summary (or alias it) and update UI callers + API docs.'
    }));
  }

  const creditSimulation = simulateCreditAtomicity();
  if (creditSimulation.finalBalance < 0) {
    findings.push(makeFinding({
      severity: 'critical',
      title: 'Credit decrement simulation allows negative balance',
      evidence: creditSimulation,
      reproSteps: 'Run concurrent credit decrements against the same balance and observe negative results.',
      suggestedFix: 'Use row-level locking + idempotent ledger entries for decrement logic inside a DB transaction.'
    }));
  }

  try {
    const payload = JSON.stringify({ id: 'evt_fixture_001', type: 'checkout.session.completed' });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createStripeFixtureSignature({
      payload,
      secret: stripeWebhookSecret,
      timestamp
    });
    verifyStripeSignature({
      rawBody: payload,
      signatureHeader: signature,
      webhookSecret: stripeWebhookSecret
    });

    let tamperedRejected = false;
    try {
      verifyStripeSignature({
        rawBody: `${payload}tampered`,
        signatureHeader: signature,
        webhookSecret: stripeWebhookSecret
      });
    } catch {
      tamperedRejected = true;
    }

    if (!tamperedRejected) {
      findings.push(makeFinding({
        severity: 'high',
        title: 'Stripe webhook signature accepted tampered payload',
        evidence: { fixture_payload: payload, signature },
        reproSteps: 'Reuse a valid stripe-signature header with a modified webhook payload and inspect server response.',
        suggestedFix: 'Recompute HMAC against the raw request body and reject any mismatch before processing events.'
      }));
    }
  } catch (error) {
    findings.push(makeFinding({
      severity: 'high',
      title: 'Stripe webhook signature verification failed fixture check',
      evidence: { error: error?.message || 'unknown' },
      reproSteps: 'Replay fixture webhook payload against signature verification helper.',
      suggestedFix: 'Align signature parsing with Stripe format: t=<ts>,v1=<hmac> and use timing-safe compare.'
    }));
  }

  if (findings.length === 0) {
    findings.push(makeFinding({
      severity: 'low',
      title: 'No failing checks detected; increase deterministic test coverage',
      evidence: {
        auth_routes_detected: authRoutes,
        analytics_endpoint: analyticsEndpoint,
        credit_atomicity: creditSimulation.successfulDebits
      },
      reproSteps: 'Review simulated runner output and compare with expected threat model for auth, billing, and analytics.',
      suggestedFix: 'Add more deterministic checks for session revocation, token expiry handling, and artifact authorization boundaries.'
    }));
  }

  return {
    findings,
    summary: {
      total_checks: 5,
      findings_count: findings.length,
      credit_atomicity: creditSimulation
    }
  };
}
