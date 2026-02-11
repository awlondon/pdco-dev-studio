export function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
    return 0;
  }

  const dot = a.reduce((sum, val, index) => sum + ((Number(val) || 0) * (Number(b[index]) || 0)), 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + ((Number(val) || 0) ** 2), 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + ((Number(val) || 0) ** 2), 0));

  if (!magA || !magB) {
    return 0;
  }

  return dot / (magA * magB);
}
