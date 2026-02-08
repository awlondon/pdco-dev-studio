import assert from 'node:assert/strict';
import { test } from 'node:test';

const API = 'https://dev.primarydesignco.com/api';

async function fetchWithCookies(
  url: string,
  options: RequestInit = {},
  cookie?: string
) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set('Cookie', cookie);

  const res = await fetch(url, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');

  return { res, setCookie };
}

test('google auth issues session and /me returns user', async () => {
  const id_token = process.env.TEST_GOOGLE_ID_TOKEN;
  assert.ok(id_token, 'TEST_GOOGLE_ID_TOKEN missing');

  const { res: authRes, setCookie } = await fetchWithCookies(
    `${API}/auth/google`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token })
    }
  );

  assert.equal(authRes.status, 200);
  assert.ok(setCookie, 'No session cookie issued');

  const sessionCookie = setCookie.split(';')[0];

  const { res: meRes } = await fetchWithCookies(
    `${API}/me`,
    { method: 'GET' },
    sessionCookie
  );

  assert.equal(meRes.status, 200);

  const body = await meRes.json();
  assert.ok(body.user.email);
  assert.equal(body.user.provider, 'google');
});
