import jwt from '@tsndr/cloudflare-worker-jwt';
import { issueSession } from '../session';
import { jsonError } from '../errors';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

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

  let jwks;
  try {
    const res = await fetch(GOOGLE_JWKS_URL);
    jwks = await res.json();
  } catch {
    return jsonError('Failed to fetch Google certs', 500);
  }

  const isValid = await jwt.verify(id_token, jwks.keys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env.GOOGLE_CLIENT_ID
  });

  if (!isValid) {
    return jsonError('Invalid Google token', 401);
  }

  const decoded = jwt.decode(id_token);
  const payload: any = decoded?.payload;

  if (!payload?.sub || !payload?.email) {
    return jsonError('Invalid Google payload', 401);
  }

  const user = {
    id: `google:${payload.sub}`,
    email: payload.email,
    name: payload.name ?? payload.email,
    provider: 'google'
  };

  return issueSession(user, env);
}
