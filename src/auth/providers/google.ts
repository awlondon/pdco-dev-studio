import { issueSession } from '../session';
import { jsonError } from '../errors';
import { decodeJwtPayload } from '../token';
import { requireEnv } from '../env';

export async function handleGoogle(request: Request, env: Env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const token = body.credential || body.id_token;
  if (!token) {
    return jsonError('Missing Google credential', 400);
  }

  const missing = requireEnv(env, ['GOOGLE_CLIENT_ID', 'SESSION_SECRET']);
  if (missing.length) {
    return jsonError(`Missing env: ${missing.join(', ')}`, 500);
  }

  const isJwt = (value: string) => value.split('.').length === 3;

  try {
    if (!isJwt(token)) {
      return jsonError('id_token is not a JWT', 401);
    }

    const decodedPayload = decodeJwtPayload(token);
    if (!decodedPayload) {
      return jsonError('Invalid token payload', 401);
    }

    const payload = decodedPayload as {
      sub?: string;
      email?: string;
      name?: string;
      iss?: string;
      aud?: string;
      exp?: number;
    };

    if (!payload.aud) {
      return jsonError('Token missing aud', 401);
    }

    if (payload.aud !== env.GOOGLE_CLIENT_ID) {
      return jsonError(`Invalid audience: ${payload.aud}`, 401);
    }

    if (!payload.iss) {
      return jsonError('Token missing iss', 401);
    }

    if (
      payload.iss !== 'https://accounts.google.com' &&
      payload.iss !== 'accounts.google.com'
    ) {
      return jsonError(`Invalid issuer: ${payload.iss}`, 401);
    }

    if (!payload.sub) {
      return jsonError('Token missing sub', 401);
    }

    if (!payload.email) {
      return jsonError('Token missing email', 401);
    }

    const { exp } = payload;
    if (typeof exp === 'number' && exp <= Math.floor(Date.now() / 1000)) {
      return jsonError('Token expired', 401);
    }

    const user = {
      id: `google:${payload.sub}`,
      email: payload.email,
      name: payload.name ?? payload.email,
      provider: 'google'
    };

    return issueSession(user, env, request);
  } catch (err) {
    return jsonError(`Google token error: ${String(err)}`, 401);
  }
}
