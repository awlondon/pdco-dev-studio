function inferFilesToChange(finding) {
  const title = String(finding?.title || '').toLowerCase();
  if (title.includes('analytics')) {
    return ['server.js', 'docs/usage-analytics-sql.md'];
  }
  if (title.includes('stripe')) {
    return ['server.js', 'utils/billingEvents.js', 'api/tests/auth.smoke.test.ts'];
  }
  if (title.includes('credit')) {
    return ['utils/userDb.js', 'api/credits.js', 'tests'];
  }
  if (title.includes('auth')) {
    return ['server.js', 'auth/middleware.js', 'api/tests/auth.smoke.test.ts'];
  }
  return ['server.js', 'tests'];
}

export function buildCodexPatchPlan(finding) {
  const files = inferFilesToChange(finding);
  const severity = String(finding?.severity || 'unknown').toUpperCase();
  return {
    problem: `${finding?.title || 'Unknown finding'} (${severity})`,
    impact: `This issue can degrade trust in the testing kernel and may allow regressions to ship unnoticed. Evidence: ${JSON.stringify(finding?.evidence_json || {})}`,
    files_to_change: files,
    steps: [
      'Reproduce the finding in a focused local test before editing production code.',
      'Apply the smallest patch that closes the gap described in the finding title and evidence.',
      'Update API docs or endpoint aliases when route paths change.',
      'Run targeted tests, then run migration + regression checks.'
    ],
    tests_to_add: [
      `Add a test that captures: ${finding?.repro_steps || 'documented reproduction steps'}.`,
      'Add an assertion that fails before the patch and passes afterward.',
      'Add a guard test for adjacent auth/billing edge cases to avoid regressions.'
    ],
    acceptance_checks: [
      'Repro steps no longer trigger the issue.',
      'All existing related tests remain green.',
      'New test coverage demonstrates the fixed behavior.'
    ]
  };
}
