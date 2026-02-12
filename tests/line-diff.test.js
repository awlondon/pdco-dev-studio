import test from 'node:test';
import assert from 'node:assert/strict';

import { computeLineDiff } from '../utils/lineDiff.js';

test('computeLineDiff returns add/remove/equal lines', () => {
  const source = ['a', 'b', 'c'].join('\n');
  const target = ['a', 'x', 'c', 'd'].join('\n');

  const diff = computeLineDiff(source, target);

  assert.deepEqual(diff, [
    { type: 'equal', text: 'a' },
    { type: 'remove', text: 'b' },
    { type: 'add', text: 'x' },
    { type: 'equal', text: 'c' },
    { type: 'add', text: 'd' }
  ]);
});
