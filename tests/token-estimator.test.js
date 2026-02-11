import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateTokens, isTokenizerAccurate } from '../utils/tokenEstimator.js';

test('estimateTokens returns zero for null-like values', () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(''), 0);
});

test('estimateTokens is deterministic for strings and objects', () => {
  const text = 'Keep keyboard navigation and dark theme support.';
  const first = estimateTokens(text, 'gpt-4.1-mini');
  const second = estimateTokens(text, 'gpt-4.1-mini');
  assert.equal(first, second);

  const objectTokens = estimateTokens({ a: 1, b: 'two' }, 'gpt-4.1-mini');
  assert.ok(objectTokens > 0);
});

test('estimateTokens handles unknown model names by using fallback encoding strategy', () => {
  const tokens = estimateTokens('token test for unknown model', 'non-existent-model-123');
  assert.ok(Number.isInteger(tokens));
  assert.ok(tokens > 0);
});

test('isTokenizerAccurate exposes tokenizer availability as boolean', () => {
  assert.equal(typeof isTokenizerAccurate(), 'boolean');
});
