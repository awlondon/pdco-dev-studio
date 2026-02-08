import jwt from '@tsndr/cloudflare-worker-jwt';

export async function issueSession(user: any, env: Env) {
  const token = await jwt.sign(
    {
      sub: user.id,
      email: user.email,
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
        'Set-Cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=None`
      }
    }
  );
}
