const DEFAULT_CODE_CHAR_LIMIT = 1200;

export function selectRelevantPlayableCode(code = '', maxChars = DEFAULT_CODE_CHAR_LIMIT) {
  const normalized = String(code || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const lines = normalized.split('\n');
  const selected = [];
  let size = 0;

  const pushLine = (line) => {
    if (size >= maxChars) {
      return;
    }
    const next = line.length + 1;
    if (size + next <= maxChars || selected.length === 0) {
      selected.push(line);
      size += next;
    }
  };

  for (const line of lines) {
    if (/\b(function|class|const|let|var|if|for|while|switch|return|addEventListener|keydown|keyup|click|mousedown|mouseup|canvas|requestAnimationFrame)\b/.test(line)) {
      pushLine(line);
    }
  }

  for (let index = lines.length - 1; index >= 0 && size < maxChars; index -= 1) {
    pushLine(lines[index]);
  }

  return selected.join('\n').slice(0, maxChars);
}

export function buildPlayablePrompt({ prompt = '', code = '' } = {}) {
  const normalizedPrompt = String(prompt || '').trim();
  const relevantCode = selectRelevantPlayableCode(code);

  return `You are an AI game designer and rapid gameplay prototyper.
Transform the user request into a practical interactive game experience that can be implemented immediately.

Execution goals:
1. Identify a clear objective (win condition), a failure condition, and a core gameplay loop.
2. Define progression with escalating challenge (difficulty curve, levels, waves, or unlocks).
3. Specify mechanics and controls with explicit keyboard and/or mouse inputs.
4. Add feedback loops (visual/audio/state updates) so each player action has an observable result.
5. Include reward systems such as points, multipliers, resources, combo chains, or risk/reward tradeoffs.
6. Keep the design scope tight enough to be runnable in a single-session prototype.

Output contract:
- Provide implementation-ready instructions and concrete behavior details.
- Prioritize deterministic rules, concrete variables, and event flow over vague ideas.
- Mention objective, mechanics, controls, progression, and feedback by name in the response.
- If relevant code context is provided, adapt and extend it instead of replacing everything blindly.
- If the request is ambiguous, do not ask follow-up questions; choose sensible defaults and state assumptions briefly.
- End with a short "Design rationale" section explaining major game decisions.

User prompt:
${normalizedPrompt || '(none provided)'}

Relevant code context:
${relevantCode || '(none provided)'}
`;
}
