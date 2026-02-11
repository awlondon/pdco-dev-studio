import { estimateTokens, isTokenizerAccurate } from './tokenEstimator.js';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const EMBEDDING_VECTOR_SIZE = 96;
const embeddingCache = new Map();

function tokenizeText(text) {
  if (!text) {
    return [];
  }
  const value = String(text);
  return value
    .match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g)
    ?.filter(Boolean)
    || [];
}

function hashTokenToBucket(token) {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) - hash) + token.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % EMBEDDING_VECTOR_SIZE;
}

function normalizeEmbedding(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

function computeLightweightEmbedding(text) {
  const vector = Array.from({ length: EMBEDDING_VECTOR_SIZE }, () => 0);
  const tokens = tokenizeText(String(text || '').toLowerCase()).filter((token) => token.trim());
  if (!tokens.length) {
    return vector;
  }
  for (const token of tokens) {
    const bucket = hashTokenToBucket(token);
    vector[bucket] += 1;
  }
  return normalizeEmbedding(vector);
}

export function getContextTokenBudget({ planTier, intentType }) {
  const normalizedPlan = String(planTier || 'free').toLowerCase();
  const normalizedIntent = String(intentType || 'code').toLowerCase();
  const base = {
    free: 4000,
    starter: 8000,
    pro: 12000,
    power: 16000,
    internal: 20000
  }[normalizedPlan] || 4000;

  const intentMultiplier = {
    chat: 0.8,
    code: 1.0
  }[normalizedIntent] || 1.0;

  return Math.floor(base * intentMultiplier);
}

export function applyUsageAwareReduction({ contextBudget, recentUsage = 0, monthlyLimit = 0 }) {
  if (!Number.isFinite(contextBudget) || contextBudget <= 0) {
    return 0;
  }
  const budget = contextBudget;
  if (!Number.isFinite(recentUsage) || !Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
    return budget;
  }
  if (recentUsage > monthlyLimit * 0.8) {
    return Math.floor(budget * 0.85);
  }
  return budget;
}


export function hasAccurateTokenizer() {
  return isTokenizerAccurate();
}

export function estimateTokensWithTokenizer(text, model = DEFAULT_MODEL) {
  return estimateTokens(text, model);
}

export function estimateMessageTokens(messages = [], model = DEFAULT_MODEL) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0;
  }
  return messages.reduce((sum, message) => {
    const role = message?.role ? String(message.role) : 'user';
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    return sum + estimateTokensWithTokenizer(`${role}:\n${content}`, model);
  }, 0);
}

export function resolveContextMode(mode) {
  const value = String(mode || '').toLowerCase();
  if (value === 'aggressive' || value === 'balanced' || value === 'full') {
    return value;
  }
  return 'balanced';
}

export function getContextModeConfig(mode) {
  const resolvedMode = resolveContextMode(mode);
  if (resolvedMode === 'aggressive') {
    return {
      mode: resolvedMode,
      recentCount: 2,
      relevantCount: 5,
      codeChunkLimit: 4,
      summaryThresholdRatio: 0.35
    };
  }
  if (resolvedMode === 'full') {
    return {
      mode: resolvedMode,
      recentCount: 4,
      relevantCount: 10,
      codeChunkLimit: 10,
      summaryThresholdRatio: 0.7
    };
  }
  return {
    mode: resolvedMode,
    recentCount: 3,
    relevantCount: 7,
    codeChunkLimit: 6,
    summaryThresholdRatio: 0.5
  };
}

export function dedupeMessages(messages = []) {
  const seen = new Set();
  const deduped = [];
  for (const message of messages) {
    if (!message) continue;
    const key = `${message.role || 'user'}::${String(message.content || '').slice(0, 500)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

export function cosineSimilarity(vectorA = [], vectorB = []) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== vectorB.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < vectorA.length; index += 1) {
    const a = Number(vectorA[index]) || 0;
    const b = Number(vectorB[index]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (!magA || !magB) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function embedCached(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return Array.from({ length: EMBEDDING_VECTOR_SIZE }, () => 0);
  }
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }
  const embedding = computeLightweightEmbedding(normalized);
  embeddingCache.set(normalized, embedding);
  return embedding;
}

export function getEmbeddingCacheStats() {
  return {
    size: embeddingCache.size
  };
}

function normalizeMessageForScoring(message) {
  return {
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
    createdAt: message.createdAt || message.created_at || null,
    embedding: Array.isArray(message.embedding) ? message.embedding : null
  };
}

export async function selectRelevantMessages(currentQuery, sessionMessages, maxMessages = 5) {
  if (!Array.isArray(sessionMessages) || sessionMessages.length === 0 || maxMessages <= 0) {
    return [];
  }
  const queryEmbedding = await embedCached(currentQuery);
  const scored = await Promise.all(sessionMessages.map(async (message, index) => {
    const normalized = normalizeMessageForScoring(message);
    const embedding = normalized.embedding || await embedCached(normalized.content);
    const score = cosineSimilarity(queryEmbedding, embedding);
    return {
      ...normalized,
      _index: index,
      score,
      embedding
    };
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxMessages)
    .sort((a, b) => a._index - b._index)
    .map(({ _index, score, ...message }) => ({ ...message, score }));
}

export function chunkCode(code = '') {
  const value = String(code || '');
  if (!value.trim()) {
    return [];
  }
  const chunks = value
    .split(/\n(?=function\s+|class\s+|export\s+|const\s+\w+\s*=\s*\([^)]*\)\s*=>)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.length ? chunks : [value];
}

export async function selectRelevantCodeChunks({ currentQuery, code, maxChunks = 4, maxCharsPerChunk = 1500 }) {
  const chunks = chunkCode(code);
  if (!chunks.length || maxChunks <= 0) {
    return [];
  }
  const scored = await Promise.all(chunks.map(async (chunk, index) => {
    const embedding = await embedCached(chunk);
    return {
      index,
      chunk,
      embedding,
      score: cosineSimilarity(await embedCached(currentQuery), embedding)
    };
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks)
    .sort((a, b) => a.index - b.index)
    .map(({ chunk }) => chunk.slice(0, maxCharsPerChunk));
}

export async function summarizeMessagesWithModel({
  messages,
  llmProxyUrl,
  model = process.env.SUMMARY_MODEL || 'gpt-4.1-nano'
}) {
  if (!llmProxyUrl || !Array.isArray(messages) || messages.length === 0) {
    return '';
  }
  const transcript = messages
    .map((entry) => `${entry.role || 'user'}: ${String(entry.content || '').slice(0, 1200)}`)
    .join('\n');

  try {
    const response = await fetch(llmProxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Summarize prior chat context as concise bullet points preserving requirements, constraints, and pending tasks. Max 220 words.'
          },
          { role: 'user', content: transcript }
        ],
        temperature: 0.1
      })
    });
    if (!response.ok) {
      return '';
    }
    const data = await response.json();
    return String(
      data?.choices?.[0]?.message?.content
      ?? data?.candidates?.[0]?.content
      ?? data?.output_text
      ?? ''
    ).trim();
  } catch {
    return '';
  }
}

export async function buildTrimmedContext({
  systemPrompt = '',
  messages = [],
  codeSegments = [],
  maxTokens = 6000,
  model = DEFAULT_MODEL,
  maxRecentMessages = 6,
  maxRelevantMessages = 5,
  contextMode = 'balanced',
  query = '',
  summaryTriggerTokens = 5000,
  maxCodeChars = 3000,
  llmProxyUrl
}) {
  const normalizedMessages = Array.isArray(messages)
    ? messages
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => normalizeMessageForScoring(entry))
      .filter((entry) => entry.content.trim())
    : [];

  const normalizedSegments = Array.isArray(codeSegments)
    ? codeSegments
      .filter((segment) => segment && typeof segment === 'object')
      .map((segment) => ({
        name: String(segment.name || segment.module || 'code'),
        content: String(segment.content || '')
      }))
      .filter((segment) => segment.content)
    : [];

  const modeConfig = getContextModeConfig(contextMode);
  const effectiveRecentCount = Math.max(1, Math.min(maxRecentMessages, modeConfig.recentCount));
  const effectiveRelevantCount = Math.max(0, Math.min(maxRelevantMessages, modeConfig.relevantCount));
  const effectiveSummaryTrigger = Math.floor(Math.min(summaryTriggerTokens, maxTokens * modeConfig.summaryThresholdRatio));

  const systemTokens = estimateTokensWithTokenizer(systemPrompt, model);
  const naiveTokens = systemTokens
    + estimateMessageTokens(normalizedMessages, model)
    + normalizedSegments.reduce((sum, segment) => {
      return sum + estimateTokensWithTokenizer(`[${segment.name}]\n${segment.content.slice(0, maxCodeChars)}`, model);
    }, 0);

  const recentMessages = normalizedMessages.slice(-effectiveRecentCount);
  const relevantPool = normalizedMessages.slice(0, Math.max(0, normalizedMessages.length - effectiveRecentCount));
  const relevantMessages = await selectRelevantMessages(
    query || recentMessages[recentMessages.length - 1]?.content || '',
    relevantPool,
    effectiveRelevantCount
  );

  const hybridMessages = dedupeMessages([...relevantMessages, ...recentMessages]);
  const olderTokens = estimateMessageTokens(relevantPool, model);

  let summaryText = '';
  let summarized = false;
  if (relevantPool.length && olderTokens > effectiveSummaryTrigger) {
    summaryText = await summarizeMessagesWithModel({
      messages: relevantPool,
      llmProxyUrl,
      model
    });
    summarized = Boolean(summaryText);
  }

  const built = [];
  let usedTokens = 0;

  if (systemPrompt) {
    built.push({ role: 'system', content: systemPrompt });
    usedTokens += systemTokens;
  }

  if (summaryText) {
    const summaryMessage = `Summary of earlier conversation:\n${summaryText}`;
    const summaryTokens = estimateTokensWithTokenizer(summaryMessage, model);
    if (usedTokens + summaryTokens <= maxTokens) {
      built.push({ role: 'system', content: summaryMessage });
      usedTokens += summaryTokens;
    }
  }

  for (const message of hybridMessages) {
    const messageTokens = estimateTokensWithTokenizer(`${message.role}:\n${message.content}`, model);
    if (usedTokens + messageTokens > maxTokens) {
      break;
    }
    built.push({ role: message.role, content: message.content });
    usedTokens += messageTokens;
  }

  const selectedCode = [];
  for (const segment of normalizedSegments) {
    const chunks = await selectRelevantCodeChunks({
      currentQuery: query || recentMessages[recentMessages.length - 1]?.content || '',
      code: segment.content,
      maxChunks: modeConfig.codeChunkLimit,
      maxCharsPerChunk: Math.min(maxCodeChars, 2000)
    });
    chunks.forEach((chunk, index) => {
      selectedCode.push({
        name: `${segment.name}#${index + 1}`,
        content: chunk
      });
    });
  }

  for (const segment of selectedCode) {
    const block = `Relevant code (${segment.name}):\n${segment.content}`;
    const segmentTokens = estimateTokensWithTokenizer(block, model);
    if (usedTokens + segmentTokens > maxTokens) {
      break;
    }
    built.push({ role: 'system', content: block });
    usedTokens += segmentTokens;
  }

  return {
    messages: built,
    tokenCount: usedTokens,
    naiveTokenCount: naiveTokens,
    savedTokens: Math.max(0, naiveTokens - usedTokens),
    summaryText,
    metrics: {
      totalTokensBeforeTrim: naiveTokens,
      totalTokensAfterTrim: usedTokens,
      tokensSaved: Math.max(0, naiveTokens - usedTokens),
      relevanceSelectedCount: relevantMessages.length,
      summarized,
      contextMode: modeConfig.mode,
      recentSelectedCount: recentMessages.length,
      codeChunkCount: selectedCode.length
    }
  };
}
