import { createSignedToken, verifySignedToken } from './token';
import { jsonError } from './errors';
import { requireEnv } from './env';

const SESSION_COOKIE_NAME = 'maya_session';

export async function issueSession(user: any, env: Env, request?: Request) {
  const missing = requireEnv(env, ['SESSION_SECRET']);
  if (missing.length) {
    return jsonError(`Missing env: ${missing.join(', ')}`, 500);
  }

  const token = await createSignedToken(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      iat: Math.floor(Date.now() / 1000)
    },
    env.SESSION_SECRET
  );
  return new Response(
    JSON.stringify({
      token,
      user,
      session: { token, user }
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': (() => {
          const cookieParts = [
            `${SESSION_COOKIE_NAME}=${token}`,
            'Path=/',
            'HttpOnly',
            'Secure',
            'SameSite=None'
          ];

          const host = request ? new URL(request.url).hostname : '';
          const isPagesDev = host.endsWith('.pages.dev');
          const cookieDomain = env.COOKIE_DOMAIN?.trim();

          if (!isPagesDev && cookieDomain) {
            cookieParts.push(`Domain=${cookieDomain}`);
          } else if (!isPagesDev && host.endsWith('.primarydesignco.com')) {
            cookieParts.push('Domain=.primarydesignco.com');
          }

          return cookieParts.join('; ');
        })()
      }
    }
  );
}

function getCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }
  const cookies = cookieHeader.split(';');
  for (const entry of cookies) {
    const [key, ...rest] = entry.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return null;
}

export async function getSessionFromRequest(request: Request, env: Env) {
  const missing = requireEnv(env, ['SESSION_SECRET']);
  if (missing.length) {
    return jsonError(`Missing env: ${missing.join(', ')}`, 500);
  }

  const token = getCookieValue(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }
  const user = await verifySignedToken(token, env.SESSION_SECRET);
  if (!user) {
    return null;
  }
  return { token, user };
}
