import jwt from '@tsndr/cloudflare-worker-jwt';
import { issueSession } from '../session';
import { jsonError } from '../errors';

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

  const certsRes = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!certsRes.ok) {
    return jsonError('Google certs unavailable', 502);
  }

  const { keys } = await certsRes.json();
  const verified = await jwt.verify(id_token, keys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID
  });

  if (!verified) {
    return jsonError('Invalid token', 401);
  }

  const payload: any = jwt.decode(id_token).payload;
  if (!payload) {
    return jsonError('Invalid token payload', 401);
  }

  const user = {
    id: `google:${payload.sub}`,
    email: payload.email,
    name: payload.name,
    provider: 'google'
  };

  return issueSession(user, env);
}
