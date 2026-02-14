export type SemanticChange = {
  type: string;
  name?: string;
  details?: string;
};

export function analyzeFileSemanticDiff(path: string, before: string, after: string): SemanticChange[] {
  if (path.endsWith('.json')) {
    return analyzeJSON(before, after);
  }

  if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) {
    return analyzeJS(before, after);
  }

  if (path.endsWith('.yml') || path.endsWith('.yaml')) {
    return analyzeYAML(before, after);
  }

  return [];
}

function extractFunctions(code: string) {
  const regex = /function\s+([A-Za-z0-9_]+)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  match = regex.exec(code);
  while (match !== null) {
    matches.push(match[1]);
    match = regex.exec(code);
  }

  return matches;
}

function extractExports(code: string) {
  const regex = /export\s+(?:default\s+)?(function|const|class)\s+([A-Za-z0-9_]+)/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  match = regex.exec(code);
  while (match !== null) {
    matches.push(match[2]);
    match = regex.exec(code);
  }

  return matches;
}

function analyzeJS(before: string, after: string): SemanticChange[] {
  const changes: SemanticChange[] = [];

  const beforeFunctions = extractFunctions(before);
  const afterFunctions = extractFunctions(after);

  afterFunctions.forEach((fn) => {
    if (!beforeFunctions.includes(fn)) {
      changes.push({ type: 'function_added', name: fn });
    }
  });

  beforeFunctions.forEach((fn) => {
    if (!afterFunctions.includes(fn)) {
      changes.push({ type: 'function_removed', name: fn });
    }
  });

  const beforeExports = extractExports(before);
  const afterExports = extractExports(after);

  afterExports.forEach((exportName) => {
    if (!beforeExports.includes(exportName)) {
      changes.push({ type: 'export_added', name: exportName });
    }
  });

  return changes;
}

function analyzeJSON(before: string, after: string): SemanticChange[] {
  try {
    const beforeJson = JSON.parse(before || '{}');
    const afterJson = JSON.parse(after || '{}');
    const changes: SemanticChange[] = [];

    if (beforeJson.dependencies && afterJson.dependencies) {
      Object.keys(afterJson.dependencies).forEach((dep) => {
        if (!beforeJson.dependencies[dep]) {
          changes.push({ type: 'dependency_added', name: dep });
        }
      });
    }

    return changes;
  } catch {
    return [];
  }
}

function analyzeYAML(before: string, after: string): SemanticChange[] {
  const changes: SemanticChange[] = [];

  if (!before.includes('jobs') && after.includes('jobs')) {
    changes.push({ type: 'ci_job_added' });
  }

  if (before.includes('runs-on') && !after.includes('runs-on')) {
    changes.push({ type: 'ci_runner_removed' });
  }

  return changes;
}
