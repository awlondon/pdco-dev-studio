import { createSignedToken, verifySignedToken } from './token';

const SESSION_COOKIE_NAME = 'maya_session';

export async function issueSession(user: any, env: Env, request?: Request) {
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
            'Secure'
          ];

          if (env.COOKIE_DOMAIN) {
            cookieParts.push(`Domain=${env.COOKIE_DOMAIN}`);
            cookieParts.push('SameSite=None');
          } else {
            cookieParts.push('SameSite=Lax');
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
