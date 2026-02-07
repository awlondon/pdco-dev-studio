import crypto from 'node:crypto';
import express from 'express';
import { calculateCreditsUsed } from './api/credits.js';
import { appendUsageLog } from './api/usageLog.js';

const app = express();
const port = process.env.PORT || 3000;
const apiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const githubToken = process.env.GITHUB_TOKEN || '';
const githubRepo = process.env.GITHUB_REPO || 'awlondon/maya-dev-ui';
const githubLogPath = process.env.GITHUB_USAGE_LOG_PATH || 'data/usage_log.csv';
const githubLogBranch = process.env.GITHUB_USAGE_LOG_BRANCH || '';

const OUTPUT_ESTIMATE_MULTIPLIER = {
  code: 2.5,
  text: 1.2,
  creative: 1.2
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
  const dailyLimit = normalizeNumber(user?.dailyLimit);
  const todayCreditsUsed = normalizeNumber(user?.todayCreditsUsed);
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

  if (dailyLimit !== null && todayCreditsUsed !== null && todayCreditsUsed >= dailyLimit) {
    res.status(429).json({
      error: 'DAILY_LIMIT_REACHED',
      requestId
    });
    return;
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
        void appendUsageLog({
          entry,
          githubToken,
          repo: githubRepo,
          path: githubLogPath,
          branch: githubLogBranch || undefined
        }).catch((error) => {
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
      void appendUsageLog({
        entry,
        githubToken,
        repo: githubRepo,
        path: githubLogPath,
        branch: githubLogBranch || undefined
      }).catch((error) => {
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
