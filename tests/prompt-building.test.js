import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHistorySummarySystemMessage,
  summarizeHistoryWithModel
} from '../utils/historySummarizer.js';
import { buildTrimmedContext } from '../utils/tokenEfficiency.js';

test('buildHistorySummarySystemMessage formats summary as a system instruction', () => {
  assert.equal(buildHistorySummarySystemMessage(''), '');
  const built = buildHistorySummarySystemMessage('  Keep API responses backward compatible.  ');
  assert.match(built, /^Summary of earlier conversation:\n/);
  assert.match(built, /backward compatible/);
});

test('summarizeHistoryWithModel merges existing summary into user prompt payload', async () => {
  const originalFetch = global.fetch;
  let observedBody = null;

  global.fetch = async (_url, init) => {
    observedBody = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [
            { message: { content: '- Keep auth flow stable.\n- Preserve keyboard accessibility.' } }
          ]
        };
      }
    };
  };

  const summary = await summarizeHistoryWithModel({
    messages: [
      { role: 'user', content: 'Please keep auth flow unchanged.' },
      { role: 'assistant', content: 'Noted, preserving existing OAuth callback behavior.' }
    ],
    llmProxyUrl: 'https://example.internal/llm',
    existingSummary: '- Existing summary bullet.'
  });

  assert.match(observedBody.messages[1].content, /Prior summary:/);
  assert.match(observedBody.messages[1].content, /New history to merge:/);
  assert.match(summary, /Keep auth flow stable/);

  global.fetch = originalFetch;
});

test('buildTrimmedContext injects retained summary as system message before chat turns', async () => {
  const result = await buildTrimmedContext({
    systemPrompt: 'You are a careful coding assistant.',
    messages: [
      { role: 'user', content: 'Retain keyboard nav.' },
      { role: 'assistant', content: 'Will retain keyboard nav.' },
      { role: 'user', content: 'Now add table sorting.' }
    ],
    query: 'add table sorting without breaking keyboard nav',
    maxTokens: 1200,
    historySummary: '- keyboard navigation is a hard requirement',
    historySummaryThresholdTokens: 99999,
    summarizeHistory: async () => {
      throw new Error('should not be called');
    },
    llmProxyUrl: ''
  });

  assert.equal(result.messages[0].role, 'system');
  assert.match(result.messages[1].content, /Summary of earlier conversation/);
  assert.match(result.messages[1].content, /keyboard navigation/i);
  assert.equal(result.metrics.historySummaryRetained, true);
});
