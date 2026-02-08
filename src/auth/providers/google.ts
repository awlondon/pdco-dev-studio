import { issueSession } from '../session';
import { jsonError } from '../errors';
import { decodeJwtPayload } from '../token';

export async function handleGoogle(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { id_token } = body;
  if (!id_token) {
    return jsonError('Missing id_token', 400);
  }

  let payload = decodeJwtPayload(id_token);
  if (!payload) {
    return jsonError('Invalid Google token', 401);
  }

  const { sub, email, name, iss, aud, exp } = payload as {
    sub?: string;
    email?: string;
    name?: string;
    iss?: string;
    aud?: string;
    exp?: number;
  };

  const validIssuer =
    iss === 'https://accounts.google.com' || iss === 'accounts.google.com';
  const validAudience = aud === env.GOOGLE_CLIENT_ID;
  const notExpired = typeof exp !== 'number' || exp > Math.floor(Date.now() / 1000);

  if (!validIssuer || !validAudience || !notExpired || !sub || !email) {
    return jsonError('Invalid Google payload', 401);
  }

  const user = {
    id: `google:${sub}`,
    email,
    name: name ?? email,
    provider: 'google'
  };

  return issueSession(user, env, request);
}
