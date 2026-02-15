import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlayablePrompt,
  selectRelevantPlayableCode
} from '../server/utils/playableWrapper.js';

test('buildPlayablePrompt includes structured game design directives and ambiguity fallback', () => {
  const wrapped = buildPlayablePrompt({
    prompt: 'build something cool',
    code: 'const x = 1;\nfunction run(){ return x; }'
  });

  assert.match(wrapped, /objective \(win condition\)/i);
  assert.match(wrapped, /failure condition/i);
  assert.match(wrapped, /progression/i);
  assert.match(wrapped, /keyboard and\/or mouse inputs/i);
  assert.match(wrapped, /feedback loops/i);
  assert.match(wrapped, /Design rationale/i);
  assert.match(wrapped, /do not ask follow-up questions/i);
  assert.match(wrapped, /build something cool/i);
});

test('selectRelevantPlayableCode keeps result token-efficient', () => {
  const longCode = Array.from({ length: 300 }, (_, index) => `const value${index} = ${index};`).join('\n');
  const selected = selectRelevantPlayableCode(longCode, 220);

  assert.ok(selected.length <= 220);
  assert.match(selected, /const value/);
});
