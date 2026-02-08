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

  const token = body.credential || body.id_token;
  if (!token) {
    return jsonError('Missing Google credential', 400);
  }

  let payload: {
    sub?: string;
    email?: string;
    name?: string;
    iss?: string;
    aud?: string;
    exp?: number;
  };

  try {
    const decodedPayload = decodeJwtPayload(token);
    const decoded = decodedPayload ? { payload: decodedPayload } : null;
    if (!decoded?.payload) {
      return jsonError('Invalid token payload', 401);
    }

    if (decoded.payload.aud !== env.GOOGLE_CLIENT_ID) {
      return jsonError(`Invalid audience: ${decoded.payload.aud}`, 401);
    }

    if (
      decoded.payload.iss !== 'https://accounts.google.com' &&
      decoded.payload.iss !== 'accounts.google.com'
    ) {
      return jsonError(`Invalid issuer: ${decoded.payload.iss}`, 401);
    }

    payload = decoded.payload as {
      sub?: string;
      email?: string;
      name?: string;
      iss?: string;
      aud?: string;
      exp?: number;
    };
  } catch (err) {
    return jsonError(`Google token error: ${String(err)}`, 401);
  }

  const { sub, email, name, exp } = payload;
  const notExpired = typeof exp !== 'number' || exp > Math.floor(Date.now() / 1000);

  if (!notExpired || !sub || !email) {
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
