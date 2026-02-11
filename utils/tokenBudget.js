import { estimateTokens } from './tokenEstimator.js';

export function packMessagesToBudget(messages = [], tokenBudget = 10_000) {
  const packed = [];
  let total = 0;

  for (const message of messages) {
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    const tokens = estimateTokens(content);

    if (total + tokens > tokenBudget) {
      break;
    }

    packed.push(message);
    total += tokens;
  }

  return packed;
}
