import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetryPrompt } from '../server/utils/retryWrapper.js';

test('buildRetryPrompt adds diversity constraints and trims previous response', () => {
  const previousResponse = 'A'.repeat(2000);
  const prompt = buildRetryPrompt({
    originalPrompt: 'Design a pricing page',
    previousResponse
  });

  assert.match(prompt, /different structural approach/i);
  assert.match(prompt, /more practical/i);
  assert.match(prompt, /Design a pricing page/);
  assert.match(prompt, /Previous response \(trimmed for efficiency\):/);

  const tail = prompt.split('Previous response (trimmed for efficiency):\n')[1] || '';
  const extractedPrevious = tail.split('\n\nNow generate a better version.')[0] || '';
  assert.equal(extractedPrevious.length, 1500);
});
