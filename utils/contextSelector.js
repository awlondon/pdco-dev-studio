import { embedText } from './embeddings.js';
import { cosineSimilarity } from './similarity.js';

function normalizeMessage(message = {}) {
  return {
    ...message,
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
    createdAt: message.createdAt || message.created_at || null
  };
}

export async function selectRelevantMessages({
  query,
  allMessages,
  maxResults = 6,
  embedFn = embedText
}) {
  if (!Array.isArray(allMessages) || allMessages.length === 0 || maxResults <= 0) {
    return [];
  }

  const queryEmbedding = await embedFn(query || '');

  const scored = await Promise.all(allMessages.map(async (message, index) => {
    const normalized = normalizeMessage(message);
    const embedding = Array.isArray(message.embedding)
      ? message.embedding
      : await embedFn(normalized.content);

    return {
      ...normalized,
      embedding,
      _index: index,
      score: cosineSimilarity(queryEmbedding, embedding)
    };
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .sort((a, b) => a._index - b._index)
    .map(({ _index, ...message }) => message);
}

export async function buildContext({ query, sessionMessages = [], maxRelevantResults = 5, recentCount = 3, embedFn = embedText }) {
  const recent = sessionMessages.slice(-Math.max(1, recentCount));
  const relevant = await selectRelevantMessages({
    query,
    allMessages: sessionMessages,
    maxResults: maxRelevantResults,
    embedFn
  });

  const combined = [...recent, ...relevant];
  const deduped = Array.from(
    new Map(combined.map((message, index) => [message.id || `${message.role}:${index}:${message.content.slice(0, 80)}`, message])).values()
  );

  return deduped;
}
