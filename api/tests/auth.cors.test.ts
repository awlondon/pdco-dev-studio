import assert from 'node:assert/strict';
import { test } from 'node:test';

test('API does not emit CORS headers for same-origin requests', async () => {
  const res = await fetch('https://dev.primarydesignco.com/api/me', {
    method: 'GET'
  });

  assert.equal(
    res.headers.get('access-control-allow-origin'),
    null
  );
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
});
