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

export function serializeCreditLedgerRow(entry) {
  return [
    entry.timestamp_utc,
    entry.user_id,
    entry.session_id,
    entry.turn_id,
    entry.delta,
    entry.balance_after,
    entry.reason,
    entry.metadata
  ].map(csvEscape).join(',') + '\n';
}

function resolveCreditLedgerPath(env) {
  return env.GITHUB_CREDIT_LEDGER_PATH || 'data/credit_ledger.csv';
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

export async function readCreditLedger(env) {
  if (!env?.GITHUB_TOKEN || !env?.GITHUB_REPO) {
    throw new Error('Missing GitHub token or repo for credit ledger.');
  }

  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = resolveCreditLedgerPath(env);
  const response = await githubRequest(
    env,
    `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
  );

  return {
    sha: response.sha,
    content: decodeBase64(String(response.content || '').replace(/\n/g, ''))
  };
}

function parseCsvRow(line, headers) {
  const values = line.split(',');
  const entry = {};
  headers.forEach((header, index) => {
    entry[header] = values[index] ?? '';
  });
  return entry;
}

export function parseCreditLedger(content) {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n');
  const headers = lines.shift().split(',');
  return lines.map((line) => parseCsvRow(line, headers));
}

export async function appendCreditLedger(env, entry) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = resolveCreditLedgerPath(env);

  const { sha, content } = await readCreditLedger(env);
  const line = serializeCreditLedgerRow(entry);
  const updated = content + line;

  await githubRequest(env, `/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `credit_ledger: ${entry.user_id} ${entry.turn_id || entry.reason}`,
      content: encodeBase64(updated),
      sha,
      branch
    })
  });
}
