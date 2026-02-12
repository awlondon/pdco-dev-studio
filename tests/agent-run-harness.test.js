import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRun, compareRunOutputs, transitionRunStatus } from '../agent/runModel.js';
import { executeAgentScenarioRun } from '../agent/runHarness.js';

test('executeAgentScenarioRun is reproducible for same scenario + seed + environment', async () => {
  const first = createAgentRun({ scenario: 'auth artifact race', seed: 42, environment: 'ci' });
  const second = createAgentRun({ scenario: 'auth artifact race', seed: 42, environment: 'ci' });

  await executeAgentScenarioRun(first);
  await executeAgentScenarioRun(second);

  assert.equal(first.status, 'COMPLETED');
  assert.equal(second.status, 'COMPLETED');
  assert.deepEqual(first.outputs, second.outputs);
});

test('run status transitions enforce finite state machine', () => {
  const run = createAgentRun({ scenario: 'baseline', seed: 1, environment: 'local' });
  transitionRunStatus(run, 'QUEUED');
  transitionRunStatus(run, 'RUNNING');
  transitionRunStatus(run, 'COMPLETED');
  assert.equal(run.status, 'COMPLETED');
  assert.throws(() => transitionRunStatus(run, 'RUNNING'), /Invalid run status transition/);
});

test('compareRunOutputs returns issue delta metadata', async () => {
  const base = createAgentRun({ scenario: 'auth', seed: 2, environment: 'local' });
  const next = createAgentRun({ scenario: 'auth artifact', seed: 2, environment: 'ci' });
  await executeAgentScenarioRun(base);
  await executeAgentScenarioRun(next);

  const comparison = compareRunOutputs(base, next);
  assert.equal(typeof comparison.issueDelta, 'number');
  assert.ok(Array.isArray(comparison.introducedIssues));
  assert.ok(Array.isArray(comparison.resolvedIssues));
});
