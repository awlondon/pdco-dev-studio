import { estimateTokens } from './tokenEstimator.js';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

export const DEFAULT_HISTORY_SUMMARY_THRESHOLD_TOKENS = Number(
  process.env.HISTORY_SUMMARY_THRESHOLD_TOKENS || 6000
);

export function normalizeHistoryMessages(messages = []) {
  return Array.isArray(messages)
    ? messages
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'assistant' : entry.role === 'system' ? 'system' : 'user',
        content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? '')
      }))
      .filter((entry) => entry.content.trim())
    : [];
}

export function estimateHistoryTokens(messages = [], model = DEFAULT_MODEL) {
  return normalizeHistoryMessages(messages).reduce((sum, entry) => {
    return sum + estimateTokens(`${entry.role}:\n${entry.content}`, model);
  }, 0);
}

export function splitHistoryByThreshold({
  messages = [],
  recentCount = 6,
  thresholdTokens = DEFAULT_HISTORY_SUMMARY_THRESHOLD_TOKENS,
  model = DEFAULT_MODEL
}) {
  const normalized = normalizeHistoryMessages(messages);
  const totalTokens = estimateHistoryTokens(normalized, model);
  if (!normalized.length || totalTokens <= thresholdTokens) {
    return {
      shouldSummarize: false,
      totalTokens,
      olderMessages: [],
      recentMessages: normalized
    };
  }
  const safeRecentCount = Math.max(1, Number(recentCount) || 6);
  return {
    shouldSummarize: true,
    totalTokens,
    olderMessages: normalized.slice(0, Math.max(0, normalized.length - safeRecentCount)),
    recentMessages: normalized.slice(-safeRecentCount)
  };
}

export async function summarizeHistoryWithModel({
  messages,
  llmProxyUrl,
  model = process.env.SUMMARY_MODEL || 'gpt-4.1-nano',
  existingSummary = ''
}) {
  const normalized = normalizeHistoryMessages(messages);
  if (!llmProxyUrl || !normalized.length) {
    return existingSummary ? String(existingSummary).trim() : '';
  }
  const transcript = normalized
    .map((entry) => `${entry.role}: ${entry.content.slice(0, 1200)}`)
    .join('\n');

  const existing = String(existingSummary || '').trim();
  const userPrompt = existing
    ? `Prior summary:\n${existing}\n\nNew history to merge:\n${transcript}`
    : transcript;

  try {
    const response = await fetch(llmProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Summarize prior chat context as concise bullet points preserving requirements, constraints, decisions, and pending tasks. Keep chronology where important. Max 220 words.'
          },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1
      })
    });
    if (!response.ok) {
      return existing;
    }
    const data = await response.json();
    const summary = String(
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? ''
    ).trim();
    return summary || existing;
  } catch {
    return existing;
  }
}

export function buildHistorySummarySystemMessage(summaryText = '') {
  const normalized = String(summaryText || '').trim();
  return normalized ? `Summary of earlier conversation:\n${normalized}` : '';
}
