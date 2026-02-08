import jwt from '@tsndr/cloudflare-worker-jwt';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE_NAME = 'session';

export async function issueSession(user: any, env: Env) {
  const token = await jwt.sign(
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
        'Set-Cookie': `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_MAX_AGE_SECONDS}`
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
  const valid = await jwt.verify(token, env.SESSION_SECRET);
  if (!valid) {
    return null;
  }
  const decoded = jwt.decode(token);
  const user = decoded?.payload ?? null;
  if (!user) {
    return null;
  }
  return { token, user };
}
