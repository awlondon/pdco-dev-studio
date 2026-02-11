import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity } from '../utils/similarity.js';
import { selectRelevantMessages } from '../utils/contextSelector.js';
import { buildTrimmedContext, estimateMessageTokens } from '../utils/tokenEfficiency.js';

const fakeEmbed = async (text) => {
  const normalized = String(text || '').toLowerCase();
  return [
    normalized.includes('oauth') ? 2 : 0,
    normalized.includes('billing') ? 2 : 0,
    normalized.includes('session') ? 1 : 0,
    Math.max(1, normalized.split(/\s+/).length) / 10
  ];
};

test('cosineSimilarity returns a valid score', () => {
  const sameDirection = cosineSimilarity([1, 2, 3], [2, 4, 6]);
  const oppositeDirection = cosineSimilarity([1, 0], [-1, 0]);

  assert.ok(sameDirection > 0.99);
  assert.ok(oppositeDirection < 0);
});

test('selectRelevantMessages sorts by semantic score', async () => {
  const selected = await selectRelevantMessages({
    query: 'How should oauth session refresh work?',
    allMessages: [
      { id: '1', role: 'user', content: 'Let us discuss billing proration and invoices.' },
      { id: '2', role: 'assistant', content: 'The OAuth session refresh token should rotate every hour.' },
      { id: '3', role: 'user', content: 'Session cookies must be httpOnly and secure.' }
    ],
    maxResults: 2,
    embedFn: fakeEmbed
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0].id, '2');
  assert.ok(selected[0].score >= selected[1].score);
});

test('integration: older relevant message is selected from a 20-message session', async () => {
  const allMessages = Array.from({ length: 20 }, (_, index) => ({
    id: `m-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === 2
      ? 'Earlier note: oauth callback must preserve state and PKCE verifier.'
      : `Conversation filler message ${index + 1} about unrelated UI tweaks.`
  }));

  const selected = await selectRelevantMessages({
    query: 'How do we preserve oauth callback state?',
    allMessages,
    maxResults: 5,
    embedFn: fakeEmbed
  });

  assert.ok(selected.some((message) => message.id === 'm-3'));
});

test('performance: trimmed context reduces token usage by at least 35%', async () => {
  const verboseMessages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index % 5 === 0 ? 'oauth refresh implementation detail' : 'generic roadmap note'} ${'details '.repeat(80)}`
  }));

  const fullTokenCount = estimateMessageTokens(verboseMessages);

  const trimmed = await buildTrimmedContext({
    systemPrompt: 'You are a precise engineering assistant.',
    messages: verboseMessages,
    query: 'please explain oauth refresh implementation detail',
    maxTokens: Math.max(200, Math.floor(fullTokenCount * 0.6)),
    summarizeHistory: async () => '- summarized prior decisions',
    llmProxyUrl: ''
  });

  const reductionRatio = (fullTokenCount - estimateMessageTokens(trimmed.messages)) / fullTokenCount;
  assert.ok(reductionRatio >= 0.35, `expected >= 0.35 reduction, got ${reductionRatio}`);
});
