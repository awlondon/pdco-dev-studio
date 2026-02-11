export function buildRetryPrompt({ originalPrompt, previousResponse }) {
  const safeOriginal = typeof originalPrompt === 'string' ? originalPrompt.trim() : '';
  const safePrevious = typeof previousResponse === 'string' ? previousResponse.trim() : '';
  const trimmedPrevious = safePrevious.slice(0, 1500);

  return `
The previous response did not fully satisfy the user's intent.

Without asking the user for clarification,
generate a significantly improved alternative response.

Requirements:
- Avoid repeating structure or phrasing of previous response.
- Take a different approach or perspective.
- Improve clarity, usefulness, and completeness.
- Preserve the original goal.
- Use a different structural approach.
- If previous response was explanatory, make it more practical.
- If previous response was minimal, make it more thorough.
- If previous response was code-only, include commentary.
- If previous response was commentary-heavy, be more concise.

Original user request:
${safeOriginal}

Previous response (trimmed for efficiency):
${trimmedPrevious}

Now generate a better version.
`;
}
