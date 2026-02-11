import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCreditsUsed } from '../credits.js';
import {
  applyUsageAwareReduction,
  buildTrimmedContext,
  chunkCode,
  estimateTokensWithTokenizer,
  getContextTokenBudget,
  selectRecentAndRelevantMessages,
  selectRelevantMessages,
  storeEmbeddingsForMessages
} from '../../utils/tokenEfficiency.js';
import { splitHistoryByThreshold } from '../../utils/historySummarizer.js';
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
test('storeEmbeddingsForMessages adds reusable embeddings to each message', async () => {
  const messages = [
    { role: 'user', content: 'Keep keyboard accessibility in focus states.' },
    { role: 'assistant', content: 'I will keep semantic html and focus rings.' }
  ];
  await storeEmbeddingsForMessages(messages);
  assert.ok(Array.isArray(messages[0].embedding));
  assert.ok(messages[0].embedding.length > 0);
});
test('selectRecentAndRelevantMessages merges top semantic matches with recent turns', async () => {
  const messages = [
    { role: 'user', content: 'How can I build a sidebar navigation with keyboard shortcuts?' },
    { role: 'assistant', content: 'Use aria labels and keydown handlers for shortcuts.' },
    { role: 'user', content: 'What stocks are trending today?' },
    { role: 'assistant', content: 'I can show a market summary.' },
    { role: 'user', content: 'Also preserve sidebar shortcuts in future changes.' }
  ];
  const selected = await selectRecentAndRelevantMessages({
    query: 'keep keyboard shortcuts for sidebar navigation',
    messages,
    recentCount: 2,
    topK: 2
  });
  assert.ok(selected.length >= 2);
  assert.match(selected.map((entry) => entry.content).join('\n'), /sidebar|shortcut/i);
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
test('splitHistoryByThreshold isolates older messages when token threshold is exceeded', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `Entry ${index} ` + 'history '.repeat(120)
  }));
  const split = splitHistoryByThreshold({
    messages,
    recentCount: 4,
    thresholdTokens: 600
  });
  assert.equal(split.shouldSummarize, true);
  assert.equal(split.recentMessages.length, 4);
  assert.equal(split.olderMessages.length, 8);
});
test('buildTrimmedContext carries existing summary and avoids summary regeneration when under threshold', async () => {
  const messages = [
    { role: 'user', content: 'Please keep keyboard accessibility.' },
    { role: 'assistant', content: 'Acknowledged. I will preserve keyboard navigation.' },
    { role: 'user', content: 'Add a compact table layout.' }
  ];
  const result = await buildTrimmedContext({
    systemPrompt: 'You are a coding assistant.',
    messages,
    query: 'compact table layout with keyboard support',
    maxTokens: 500,
    historySummary: '- Keep keyboard accessibility as a hard requirement.',
    historySummaryThresholdTokens: 6000,
    summarizeHistory: async () => 'should-not-be-used',
    llmProxyUrl: ''
  });
  assert.match(result.summaryText, /keyboard accessibility/i);
  assert.equal(result.metrics.summarized, false);
  assert.equal(result.metrics.historySummaryRetained, true);
});
