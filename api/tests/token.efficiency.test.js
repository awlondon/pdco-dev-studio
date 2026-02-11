import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateCreditsUsed } from '../credits.js';
import {
  applyUsageAwareReduction,
  buildTrimmedContext,
  chunkCode,
  estimateTokensWithTokenizer,
  getContextTokenBudget,
  selectRelevantMessages
} from '../../utils/tokenEfficiency.js';

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

test('getContextTokenBudget adjusts for plan and intent', () => {
  assert.equal(getContextTokenBudget({ planTier: 'free', intentType: 'chat' }), 3200);
  assert.equal(getContextTokenBudget({ planTier: 'pro', intentType: 'code' }), 12000);
  assert.equal(getContextTokenBudget({ planTier: 'internal', intentType: 'chat' }), 16000);
});

test('applyUsageAwareReduction scales budget for high usage', () => {
  const reduced = applyUsageAwareReduction({
    contextBudget: 10000,
    recentUsage: 900,
    monthlyLimit: 1000
  });
  assert.equal(reduced, 8500);

  const unchanged = applyUsageAwareReduction({
    contextBudget: 10000,
    recentUsage: 200,
    monthlyLimit: 1000
  });
  assert.equal(unchanged, 10000);
});

test('selectRelevantMessages ranks semantically related context', async () => {
  const messages = [
    { role: 'user', content: 'How do I create a dark theme toggle in CSS?' },
    { role: 'assistant', content: 'Use a class on body and CSS variables for colors.' },
    { role: 'user', content: 'What is the weather in Paris this week?' }
  ];
  const selected = await selectRelevantMessages('Need help with theme toggle variables', messages, 2);
  assert.equal(selected.length, 2);
  assert.match(selected[0].content, /dark theme|class on body/i);
});

test('chunkCode splits source into logical blocks', () => {
  const code = [
    'const base = 1;',
    'function first() { return base; }',
    'class Runner { run() { return true; } }',
    'export function second() { return 2; }'
  ].join('\n');
  const chunks = chunkCode(code);
  assert.ok(chunks.length >= 3);
});

test('buildTrimmedContext enforces token budget and returns efficiency metrics', async () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index < 4
      ? `Constraint ${index}: preserve sidebar behavior and dark theme support ` + 'stable '.repeat(30)
      : `Message ${index} ` + 'token '.repeat(80)
  }));

  const result = await buildTrimmedContext({
    systemPrompt: 'You are a coding assistant.',
    query: 'please keep dark theme support for sidebar',
    messages,
    codeSegments: [{ name: 'moduleA', content: 'const x = 1;\n'.repeat(500) }],
    maxTokens: 340,
    maxRecentMessages: 8,
    maxRelevantMessages: 6,
    contextMode: 'balanced',
    summaryTriggerTokens: 150,
    maxCodeChars: 1200,
    llmProxyUrl: ''
  });

  assert.ok(result.tokenCount <= 340);
  assert.ok(result.savedTokens >= 0);
  assert.ok(result.metrics.tokensSaved >= 0);
  assert.ok(result.metrics.relevanceSelectedCount >= 0);
});
