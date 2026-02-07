function sanitizeCsvField(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/,/g, ' ');
}

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

export function buildUsageLogLine(entry) {
  const csvLine = [
    entry.timestamp_utc,
    entry.user_id,
    entry.email,
    entry.session_id,
    entry.request_id,
    entry.intent_type,
    entry.model,
    entry.input_chars,
    entry.input_est_tokens,
    entry.output_chars,
    entry.output_est_tokens,
    entry.total_est_tokens,
    entry.credits_charged,
    entry.latency_ms,
    entry.status
  ].map(sanitizeCsvField).join(',') + '\n';

  return csvLine;
}

export async function appendUsageLog({
  entry,
  githubToken,
  repo,
  path = 'data/usage_log.csv',
  branch,
  apiBase = 'https://api.github.com'
}) {
  if (!githubToken || !repo) {
    throw new Error('Missing GitHub token or repo for usage log append.');
  }

  const csvLine = buildUsageLogLine(entry);
  const baseHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json'
  };

  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const getResponse = await fetch(`${apiBase}/repos/${repo}/contents/${path}${refQuery}`, {
    headers: baseHeaders
  });

  if (!getResponse.ok) {
    const text = await getResponse.text();
    throw new Error(`Failed to read usage log: ${getResponse.status} ${text}`);
  }

  const fileData = await getResponse.json();
  const currentContent = decodeBase64(String(fileData.content || '').replace(/\n/g, ''));
  const updatedContent = currentContent + csvLine;

  const body = {
    message: `Append usage log entry (${entry.request_id})`,
    content: encodeBase64(updatedContent),
    sha: fileData.sha
  };

  if (branch) {
    body.branch = branch;
  }

  const putResponse = await fetch(`${apiBase}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!putResponse.ok) {
    const text = await putResponse.text();
    throw new Error(`Failed to append usage log: ${putResponse.status} ${text}`);
  }
}
