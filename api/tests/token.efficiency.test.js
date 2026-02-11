import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateCreditsUsed } from '../credits.js';
import { buildTrimmedContext, estimateTokensWithTokenizer } from '../../utils/tokenEfficiency.js';

test('estimateTokensWithTokenizer returns deterministic token counts', () => {
  const text = 'Build a responsive dashboard with charts and filters.';
  const first = estimateTokensWithTokenizer(text, 'gpt-4.1-mini');
  const second = estimateTokensWithTokenizer(text, 'gpt-4.1-mini');
  assert.equal(first, second);
  assert.ok(first > 0);
});

test('calculateCreditsUsed prefers provided token counts', () => {
  const credits = calculateCreditsUsed({
    inputTokens: 600,
    outputTokens: 200,
    intentType: 'chat'
  });
  assert.equal(credits, 2);
});

test('buildTrimmedContext enforces token budget and trims old messages', async () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index} ` + 'token '.repeat(80)
  }));

  const result = await buildTrimmedContext({
    systemPrompt: 'You are a coding assistant.',
    messages,
    codeSegments: [{ name: 'moduleA', content: 'const x = 1;\n'.repeat(400) }],
    maxTokens: 300,
    maxRecentMessages: 6,
    summaryTriggerTokens: 150,
    maxCodeChars: 1200,
    llmProxyUrl: ''
  });

  assert.ok(result.tokenCount <= 300);
  assert.ok(result.messages.length <= 8);
  assert.ok(result.savedTokens >= 0);
});
