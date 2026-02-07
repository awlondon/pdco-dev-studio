import crypto from 'node:crypto';
import express from 'express';
import { calculateCreditsUsed } from './api/credits.js';
import { appendUsageLog, readUsageLog } from './api/usageLog.js';

const app = express();
const port = process.env.PORT || 3000;
const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const githubToken = process.env.GITHUB_TOKEN || '';
const githubRepo = process.env.GITHUB_REPO || 'awlondon/maya-dev-ui';
const githubLogPath = process.env.GITHUB_USAGE_LOG_PATH || 'data/usage_log.csv';
const githubLogBranch = process.env.GITHUB_USAGE_LOG_BRANCH || '';
const githubApiBase = process.env.GITHUB_API_BASE || '';

const OUTPUT_ESTIMATE_MULTIPLIER = {
  code: 2.5,
  text: 1.2,
  creative: 1.2
};
const DAILY_LIMITS = {
  free: 100,
  starter: 500,
  pro: 2000,
  power: 10000
};

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function estimateTokensFromChars(charCount, charsPerToken) {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return 0;
  }
  return Math.ceil(charCount / charsPerToken);
}

function estimateCreditUpperBound({ inputChars, intentType }) {
  const inputTokens = estimateTokensFromChars(inputChars, 4);
  const outputMultiplier = OUTPUT_ESTIMATE_MULTIPLIER[intentType] ?? 1.2;
  const outputTokens = Math.ceil(inputTokens * outputMultiplier);
  const multiplier = intentType === 'code' ? 1.0 : 0.6;
  const totalTokens = Math.ceil((inputTokens + outputTokens) * multiplier);
  return Math.ceil(totalTokens / 250);
}

function parseCsvRow(row) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function parseCsv(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/);
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvRow(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = values[index] ?? '';
      return acc;
    }, {});
  });
}

function creditsUsedToday(rows, userId) {
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .filter((row) => (
      row.user_id === userId
      && row.timestamp_utc?.startsWith(today)
      && row.status === 'success'
    ))
    .reduce((sum, row) => sum + Number(row.credits_charged || 0), 0);
}

function checkDailyThrottle({
  planTier,
  creditsUsedToday: creditsUsed,
  estimatedNextCost
}) {
  const limit = DAILY_LIMITS[planTier] ?? DAILY_LIMITS.free;

  if (creditsUsed >= limit) {
    return {
      allowed: false,
      reason: 'DAILY_LIMIT_REACHED',
      remaining: 0
    };
  }

  if (creditsUsed + estimatedNextCost > limit) {
    return {
      allowed: false,
      reason: 'WOULD_EXCEED_DAILY_LIMIT',
      remaining: Math.max(0, limit - creditsUsed)
    };
  }

  return {
    allowed: true,
    remaining: limit - creditsUsed
  };
}

function decodeBase64(value) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64').toString('utf8');
  }
  return atob(value);
}

async function readUsersCsv(githubEnv) {
  const apiBase = githubEnv.GITHUB_API_BASE || 'https://api.github.com';
  const repo = githubEnv.GITHUB_REPO;
  const branch = githubEnv.GITHUB_BRANCH || 'main';

  const response = await fetch(
    `${apiBase}/repos/${repo}/contents/data/users.csv?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `Bearer ${githubEnv.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json'
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Users CSV fetch failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = decodeBase64(String(data.content || '').replace(/\n/g, ''));
  return parseCsv(content);
}

async function resolvePlanTier({ userId, fallbackTier, githubEnv }) {
  if (!githubEnv?.GITHUB_TOKEN || !githubEnv?.GITHUB_REPO) {
    return fallbackTier;
  }

  try {
    const rows = await readUsersCsv(githubEnv);
    const user = rows.find((row) => row.user_id === userId);
    return user?.plan_tier || fallbackTier;
  } catch (error) {
    console.error('Plan tier lookup failed:', error);
    return fallbackTier;
  }
}

function getRequestId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static('.'));

app.post('/api/chat', async (req, res) => {
  const { messages, prompt, user, sessionId, intentType } = req.body || {};
  const payloadMessages = Array.isArray(messages) && messages.length
    ? messages
    : prompt
      ? [{ role: 'user', content: prompt }]
      : [];

  if (!payloadMessages.length) {
    res.status(400).json({ error: 'Missing messages or prompt.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing OPENAI_API_KEY on the server.' });
    return;
  }

  const requestId = getRequestId();
  const resolvedIntent = intentType || 'text';
  const inputChars = payloadMessages.reduce((total, message) => {
    if (!message?.content) {
      return total;
    }
    return total + String(message.content).length;
  }, 0);
  const inputEstTokens = estimateTokensFromChars(inputChars, 4);
  const outputEstTokens = Math.ceil(
    inputEstTokens * (OUTPUT_ESTIMATE_MULTIPLIER[resolvedIntent] ?? 1.2)
  );
  const totalEstTokens = inputEstTokens + outputEstTokens;

  const remainingCredits = normalizeNumber(user?.remainingCredits);
  const estimatedMaxCredits = estimateCreditUpperBound({
    inputChars,
    intentType: resolvedIntent
  });

  if (
    remainingCredits !== null
    && estimatedMaxCredits !== null
    && remainingCredits < estimatedMaxCredits
  ) {
    res.status(402).json({
      error: 'INSUFFICIENT_CREDITS',
      message: 'This request may exceed your remaining credits.',
      requestId
    });
    return;
  }

  if (githubToken && user?.id) {
    try {
      const githubEnv = {
        GITHUB_TOKEN: githubToken,
        GITHUB_REPO: githubRepo,
        GITHUB_BRANCH: githubLogBranch || 'main',
        GITHUB_USAGE_LOG_PATH: githubLogPath,
        ...(githubApiBase ? { GITHUB_API_BASE: githubApiBase } : {})
      };
      const { content } = await readUsageLog(githubEnv);
      const usageRows = parseCsv(content);
      const usedToday = creditsUsedToday(usageRows, user.id);
      const planTier = await resolvePlanTier({
        userId: user.id,
        fallbackTier: user?.planTier || user?.plan_tier || 'free',
        githubEnv
      });
      const throttle = checkDailyThrottle({
        planTier,
        creditsUsedToday: usedToday,
        estimatedNextCost: estimatedMaxCredits
      });
      if (!throttle.allowed) {
        const entry = {
          timestamp_utc: new Date().toISOString(),
          user_id: user?.id || '',
          email: user?.email || '',
          session_id: sessionId || '',
          request_id: requestId,
          intent_type: resolvedIntent,
          model,
          input_chars: inputChars,
          input_est_tokens: inputEstTokens,
          output_chars: 0,
          output_est_tokens: 0,
          total_est_tokens: totalEstTokens,
          credits_charged: 0,
          latency_ms: 0,
          status: 'blocked'
        };
        void appendUsageLog(githubEnv, entry).catch((error) => {
          console.error('Usage log append failed:', error);
        });
        res.status(429).json({
          error: throttle.reason,
          remaining_today: throttle.remaining,
          requestId
        });
        return;
      }
    } catch (error) {
      console.error('Daily throttle check failed:', error);
    }
  }

  try {
    console.log('LLM REQUEST:', {
      model,
      messages: payloadMessages
    });
    const requestStart = performance.now();
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: payloadMessages
      })
    });

    const latencyMs = Math.round(performance.now() - requestStart);

    if (!upstream.ok) {
      const text = await upstream.text();
      const entry = {
        timestamp_utc: new Date().toISOString(),
        user_id: user?.id || '',
        email: user?.email || '',
        session_id: sessionId || '',
        request_id: requestId,
        intent_type: resolvedIntent,
        model,
        input_chars: inputChars,
        input_est_tokens: inputEstTokens,
        output_chars: 0,
        output_est_tokens: 0,
        total_est_tokens: totalEstTokens,
        credits_charged: 0,
        latency_ms: latencyMs,
        status: 'error'
      };
      if (githubToken) {
        const githubEnv = {
          GITHUB_TOKEN: githubToken,
          GITHUB_REPO: githubRepo,
          GITHUB_BRANCH: githubLogBranch || 'main',
          GITHUB_USAGE_LOG_PATH: githubLogPath,
          ...(githubApiBase ? { GITHUB_API_BASE: githubApiBase } : {})
        };
        void appendUsageLog(githubEnv, entry).catch((error) => {
          console.error('Usage log append failed:', error);
        });
      }
      res.status(upstream.status).send(text || 'Upstream error.');
      return;
    }

    const data = await upstream.json();
    const outputChars = String(data?.choices?.[0]?.message?.content || '').length;
    const outputEstTokens = estimateTokensFromChars(outputChars, 3);
    const totalTokens = inputEstTokens + outputEstTokens;
    const creditsCharged = calculateCreditsUsed({
      inputChars,
      outputChars,
      intentType: resolvedIntent
    });
    const updatedRemainingCredits = remainingCredits !== null
      ? Math.max(0, remainingCredits - creditsCharged)
      : null;

    const entry = {
      timestamp_utc: new Date().toISOString(),
      user_id: user?.id || '',
      email: user?.email || '',
      session_id: sessionId || '',
      request_id: requestId,
      intent_type: resolvedIntent,
      model,
      input_chars: inputChars,
      input_est_tokens: inputEstTokens,
      output_chars: outputChars,
      output_est_tokens: outputEstTokens,
      total_est_tokens: totalTokens,
      credits_charged: creditsCharged,
      latency_ms: latencyMs,
      status: 'success'
    };

    if (githubToken) {
      const githubEnv = {
        GITHUB_TOKEN: githubToken,
        GITHUB_REPO: githubRepo,
        GITHUB_BRANCH: githubLogBranch || 'main',
        GITHUB_USAGE_LOG_PATH: githubLogPath,
        ...(githubApiBase ? { GITHUB_API_BASE: githubApiBase } : {})
      };
      void appendUsageLog(githubEnv, entry).catch((error) => {
        console.error('Usage log append failed:', error);
      });
    }

    res.status(200).json({
      ...data,
      usage: {
        requestId,
        creditsCharged,
        remainingCredits: updatedRemainingCredits,
        inputChars,
        outputChars,
        inputEstTokens,
        outputEstTokens,
        totalEstTokens: totalTokens,
        latencyMs
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error.'
    });
  }
});

app.listen(port, () => {
  console.log(`Maya Dev UI listening on http://localhost:${port}`);
});
