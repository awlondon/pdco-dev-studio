import { estimateTokensWithTokenizer } from '../utils/tokenEfficiency.js';

export function calculateCreditsUsed({
  inputText,
  outputText,
  intentType,
  totalTokens,
  inputTokens,
  outputTokens,
  model
}) {
  if (Number.isFinite(totalTokens)) {
    return Math.ceil(totalTokens / 250);
  }

  const resolvedInputTokens = Number.isFinite(inputTokens)
    ? inputTokens
    : estimateTokensWithTokenizer(inputText || '', model);
  const resolvedOutputTokens = Number.isFinite(outputTokens)
    ? outputTokens
    : estimateTokensWithTokenizer(outputText || '', model);
  const multiplier = intentType === 'code' ? 1.0 : 0.6;
  const adjustedTokens = Math.ceil((resolvedInputTokens + resolvedOutputTokens) * multiplier);

  return Math.ceil(adjustedTokens / 250);
}
