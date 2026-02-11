import { embedText } from './embeddings.js';
import { cosineSimilarity } from './similarity.js';

export function chunkCode(code = '') {
  return String(code || '')
    .split(/\n(?=function|class|export)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

export async function selectRelevantCodeChunks(query, codeChunks = [], { maxResults = 3, embedFn = embedText } = {}) {
  if (!Array.isArray(codeChunks) || !codeChunks.length || maxResults <= 0) {
    return [];
  }

  const queryEmbedding = await embedFn(query || '');

  const scored = await Promise.all(codeChunks.map(async (chunkItem, index) => {
    const chunk = typeof chunkItem === 'string' ? { content: chunkItem } : chunkItem;
    const content = String(chunk.content || chunk.chunk || '');
    const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : await embedFn(content);

    return {
      ...chunk,
      content,
      _index: index,
      score: cosineSimilarity(queryEmbedding, embedding)
    };
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .sort((a, b) => a._index - b._index)
    .map(({ _index, ...chunk }) => chunk);
}
