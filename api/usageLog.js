function encodeBase64(value) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8').toString('base64');
  }
  return btoa(value);
}

function decodeBase64(value) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
  }
  return atob(value);
}

export function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeUsageLogRow(entry) {
  return [
    entry.timestamp_utc,
    entry.user_id,
    entry.email,
    entry.session_id,
    entry.event_type,
    entry.request_id,
    entry.intent_type,
    entry.model,
    entry.input_tokens,
    entry.output_tokens,
    entry.input_chars,
    entry.input_est_tokens,
    entry.output_chars,
    entry.output_est_tokens,
    entry.total_est_tokens,
    entry.estimated_credits,
    entry.reserved_credits,
    entry.actual_credits,
    entry.refunded_credits,
    entry.credits_charged,
    entry.credits_used,
    entry.latency_ms,
    entry.status
  ].map(csvEscape).join(',') + '\n';
}

function resolveUsageLogPath(env) {
  return env.GITHUB_USAGE_LOG_PATH || 'data/usage_log.csv';
}

async function githubRequest(env, path, init = {}) {
  const apiBase = env.GITHUB_API_BASE || 'https://api.github.com';
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function readUsageLog(env) {
  if (!env?.GITHUB_TOKEN || !env?.GITHUB_REPO) {
    throw new Error('Missing GitHub token or repo for usage log append.');
  }

  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = resolveUsageLogPath(env);
  const response = await githubRequest(
    env,
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );

  return {
    sha: response.sha,
    content: decodeBase64(String(response.content || '').replace(/\n/g, ''))
  };
}

export async function appendUsageLog(env, entry) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = resolveUsageLogPath(env);

  const { sha, content } = await readUsageLog(env);
  const line = serializeUsageLogRow(entry);
  const updated = content + line;

  await githubRequest(env, `/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `usage: ${entry.user_id} ${entry.request_id}`,
      content: encodeBase64(updated),
      sha,
      branch
    })
  });
}
