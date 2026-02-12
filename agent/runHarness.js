import { appendRunLog, transitionRunStatus } from './runModel.js';

function createSeededRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashText(input = '') {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildIssueCatalog(scenario, environment) {
  const scenarioHint = String(scenario || '').toLowerCase();
  const catalog = [
    {
      severity: 'medium',
      title: 'Authentication retry threshold exceeded',
      description: 'Scenario produced repeated auth retries beyond threshold.',
      matcher: () => scenarioHint.includes('auth')
    },
    {
      severity: 'high',
      title: 'Race detected in artifact write step',
      description: 'Two workers attempted to persist same artifact concurrently.',
      matcher: () => scenarioHint.includes('artifact') || environment === 'ci'
    },
    {
      severity: 'low',
      title: 'Preview snapshot drifted from baseline',
      description: 'Rendered preview differs from baseline hash.',
      matcher: () => true
    },
    {
      severity: 'critical',
      title: 'Unhandled exception in scenario executor',
      description: 'Synthetic exception created for deterministic failure checks.',
      matcher: () => scenarioHint.includes('crash')
    }
  ];
  return catalog.filter((entry) => entry.matcher());
}

export async function executeAgentScenarioRun(run) {
  const { scenario, seed, environment } = run.inputs;
  const rng = createSeededRng(seed);

  transitionRunStatus(run, 'QUEUED');
  appendRunLog(run, { level: 'info', event: 'queued', payload: { scenario, seed, environment } });

  transitionRunStatus(run, 'RUNNING');
  appendRunLog(run, { level: 'info', event: 'started', payload: { runId: run.id } });

  const scenarioHash = hashText(`${scenario}|${environment}|${seed}`);
  const screenshotCount = 1 + Math.floor(rng() * 3);
  for (let index = 0; index < screenshotCount; index += 1) {
    const screenshotHash = hashText(`${scenarioHash}:screenshot:${index}:${rng().toFixed(8)}`);
    run.outputs.screenshots.push({
      id: `ss-${index + 1}`,
      label: `Step ${index + 1}`,
      checksum: screenshotHash
    });
    appendRunLog(run, { level: 'debug', event: 'screenshot.captured', payload: { screenshotHash } });
  }

  const diffCount = 1 + Math.floor(rng() * 2);
  for (let index = 0; index < diffCount; index += 1) {
    const before = hashText(`${scenarioHash}:before:${index}`);
    const after = hashText(`${scenarioHash}:after:${index}:${rng().toFixed(6)}`);
    run.outputs.diffs.push({
      id: `diff-${index + 1}`,
      target: `component-${index + 1}`,
      before,
      after
    });
    appendRunLog(run, { level: 'debug', event: 'diff.generated', payload: { before, after } });
  }

  const catalog = buildIssueCatalog(scenario, environment);
  const issueCount = Math.max(1, Math.min(catalog.length, Math.floor(rng() * catalog.length) + 1));
  run.outputs.issues = catalog.slice(0, issueCount).map((issue, index) => ({
    id: `issue-${index + 1}`,
    severity: issue.severity,
    title: issue.title,
    description: issue.description
  }));
  appendRunLog(run, { level: 'info', event: 'issues.generated', payload: { count: run.outputs.issues.length } });

  transitionRunStatus(run, 'COMPLETED');
  appendRunLog(run, { level: 'info', event: 'completed', payload: { status: run.status } });
  return run;
}
