import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { runSimulatedAgentChecks } from '../agent/simulatedRunner.js';
import { buildCodexPatchPlan } from '../agent/codexPlan.js';

function verifyStripeSignatureFixture({ rawBody, signatureHeader, webhookSecret }) {
  const parts = String(signatureHeader || '').split(',');
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signature = parts.find((part) => part.startsWith('v1='))?.slice(3);
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  if (signature !== expected) {
    throw new Error('Invalid signature');
  }
  return { id: 'evt_fixture_001', type: 'checkout.session.completed' };
}

test('simulated runner produces structured findings and summary', async () => {
  const result = await runSimulatedAgentChecks({
    verifyStripeSignature: verifyStripeSignatureFixture,
    authRoutes: ['/api/auth/google', '/api/auth/email/request', '/api/auth/logout'],
    authRateLimitEnabled: true,
    analyticsEndpoint: '/admin/usage/summary',
    stripeWebhookSecret: 'test_secret'
  });

  assert.ok(Array.isArray(result.findings));
  assert.ok(result.findings.length >= 1);
  assert.equal(result.summary.total_checks, 5);
  const analyticsFinding = result.findings.find((finding) => /analytics/i.test(finding.title));
  assert.ok(analyticsFinding);
  assert.ok(analyticsFinding.repro_steps.length > 10);
  assert.ok(analyticsFinding.suggested_fix.length > 10);
});

test('codex patch plan template includes all required sections', () => {
  const plan = buildCodexPatchPlan({
    id: 'finding-1',
    severity: 'high',
    title: 'Admin analytics endpoint missing auth guard',
    evidence_json: { endpoint: '/admin/usage/summary' },
    repro_steps: 'Invoke endpoint without admin role.'
  });

  assert.ok(plan.problem);
  assert.ok(plan.impact);
  assert.ok(Array.isArray(plan.files_to_change));
  assert.ok(Array.isArray(plan.steps));
  assert.ok(Array.isArray(plan.tests_to_add));
  assert.ok(Array.isArray(plan.acceptance_checks));
  assert.ok(plan.files_to_change.includes('server.js'));
});
