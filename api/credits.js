export function calculateCreditsUsed({
  inputChars,
  outputChars,
  intentType
}) {
  const inputTokens = Math.ceil((inputChars || 0) / 4);
  const outputTokens = Math.ceil((outputChars || 0) / 3);

  const multiplier = intentType === 'code' ? 1.0 : 0.6;

  const totalTokens = Math.ceil((inputTokens + outputTokens) * multiplier);
  const credits = Math.ceil(totalTokens / 250);

  return credits;
}
