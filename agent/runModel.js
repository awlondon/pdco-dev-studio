const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export const AGENT_RUN_STATUSES = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
};

export function createAgentRun({ scenario, seed, environment } = {}) {
  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() || `run-${now}-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    status: AGENT_RUN_STATUSES.DRAFT,
    inputs: {
      scenario: String(scenario || '').trim(),
      seed: Number(seed) || 1,
      environment: String(environment || 'local')
    },
    logs: [],
    outputs: {
      screenshots: [],
      diffs: [],
      issues: []
    },
    metadata: {
      version: 1
    }
  };
}

export function appendRunLog(run, entry = {}) {
  const now = Date.now();
  const next = {
    ...entry,
    ts: Number(entry.ts) || now,
    level: String(entry.level || 'info'),
    event: String(entry.event || 'log')
  };
  run.logs.push(next);
  run.updatedAt = now;
  return next;
}

export function transitionRunStatus(run, nextStatus) {
  const status = String(nextStatus || '').toUpperCase();
  const allowed = {
    DRAFT: new Set(['QUEUED', 'CANCELLED']),
    QUEUED: new Set(['RUNNING', 'CANCELLED', 'FAILED']),
    RUNNING: new Set(['COMPLETED', 'FAILED', 'CANCELLED']),
    COMPLETED: new Set([]),
    FAILED: new Set([]),
    CANCELLED: new Set([])
  };

  const current = String(run.status || AGENT_RUN_STATUSES.DRAFT).toUpperCase();
  if (!allowed[current]?.has(status) && current !== status) {
    throw new Error(`Invalid run status transition: ${current} -> ${status}`);
  }

  run.status = status;
  const now = Date.now();
  run.updatedAt = now;

  if (status === AGENT_RUN_STATUSES.RUNNING && !run.startedAt) {
    run.startedAt = now;
  }
  if (TERMINAL_STATUSES.has(status)) {
    run.finishedAt = now;
  }

  return run;
}

export function compareRunOutputs(baseRun, candidateRun) {
  const baseIssues = baseRun?.outputs?.issues || [];
  const candidateIssues = candidateRun?.outputs?.issues || [];
  const baseTitles = new Set(baseIssues.map((issue) => String(issue.title || '').toLowerCase()));
  const candidateTitles = new Set(candidateIssues.map((issue) => String(issue.title || '').toLowerCase()));

  return {
    issueDelta: candidateIssues.length - baseIssues.length,
    introducedIssues: candidateIssues.filter((issue) => !baseTitles.has(String(issue.title || '').toLowerCase())),
    resolvedIssues: baseIssues.filter((issue) => !candidateTitles.has(String(issue.title || '').toLowerCase())),
    screenshotDelta:
      (candidateRun?.outputs?.screenshots?.length || 0)
      - (baseRun?.outputs?.screenshots?.length || 0),
    diffDelta: (candidateRun?.outputs?.diffs?.length || 0) - (baseRun?.outputs?.diffs?.length || 0)
  };
}
