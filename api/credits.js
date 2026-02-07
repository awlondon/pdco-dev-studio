export function calculateCredits({
  inputTokens,
  outputTokens,
  generationDurationMs,
  intentType,
  outputType
}) {
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);
  const baseCredits = Math.ceil(totalTokens / 500);

  const intentMultiplier = {
    text: 1.0,
    creative: 1.2,
    code: 1.5
  }[intentType] ?? 1.0;

  let durationMultiplier = 1.0;
  if (generationDurationMs >= 30000) durationMultiplier = 2.0;
  else if (generationDurationMs >= 10000) durationMultiplier = 1.5;
  else if (generationDurationMs >= 3000) durationMultiplier = 1.2;

  const outputMultiplier = {
    text: 1.0,
    html: 1.3,
    mixed: 1.4,
    error: 0.0
  }[outputType] ?? 1.0;

  let credits = Math.ceil(
    baseCredits *
    intentMultiplier *
    durationMultiplier *
    outputMultiplier
  );

  if (outputType === 'error') return 0;
  credits = Math.max(1, credits);
  credits = Math.min(credits, 10);

  return credits;
}
