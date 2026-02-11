const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_VECTOR_SIZE = 96;
const embeddingCache = new Map();

let openaiClient = null;
let openaiLoadAttempted = false;

async function getOpenAiClient() {
  if (openaiClient || openaiLoadAttempted) {
    return openaiClient;
  }
  openaiLoadAttempted = true;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const module = await import('openai');
    const OpenAI = module.default;
    openaiClient = new OpenAI({ apiKey });
  } catch (_error) {
    openaiClient = null;
  }

  return openaiClient;
}

function tokenizeText(text) {
  if (!text) {
    return [];
  }
  return String(text)
    .toLowerCase()
    .match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)
    ?.filter(Boolean) || [];
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

function computeFallbackEmbedding(text) {
  const vector = Array.from({ length: EMBEDDING_VECTOR_SIZE }, () => 0);
  const tokens = tokenizeText(text);
  for (const token of tokens) {
    const bucket = hashTokenToBucket(token);
    vector[bucket] += 1;
  }
  return normalizeEmbedding(vector);
}

export async function embedText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return Array.from({ length: EMBEDDING_VECTOR_SIZE }, () => 0);
  }

  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }

  const client = await getOpenAiClient();
  if (!client) {
    const fallback = computeFallbackEmbedding(normalized);
    embeddingCache.set(normalized, fallback);
    return fallback;
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: normalized
    });
    const embedding = response?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('Embedding response did not include a numeric vector.');
    }
    embeddingCache.set(normalized, embedding);
    return embedding;
  } catch (_error) {
    const fallback = computeFallbackEmbedding(normalized);
    embeddingCache.set(normalized, fallback);
    return fallback;
  }
}

export function getEmbeddingCacheStats() {
  return { size: embeddingCache.size };
}

export function clearEmbeddingCache() {
  embeddingCache.clear();
}
